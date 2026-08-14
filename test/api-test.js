// 接口级端到端测试：登录 → 卡片 CRUD → 审核流转 → 上传 → AI 抽取(mock Dify) → 确认草稿 → 设置
// 前置：node test/mock-dify.js 与 node server.js 已启动，且系统设置已指向 http://127.0.0.1:3788
const BASE = process.env.KC_BASE || "http://127.0.0.1:3742";
const fs = require("fs");
const path = require("path");
const os = require("os");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("PASS | " + name); }
  else { fail++; console.log("FAIL | " + name + (detail ? " | " + detail : "")); }
}

async function req(method, p, body, token, raw) {
  const headers = {};
  if (token) headers["Authorization"] = "Bearer " + token;
  let payload;
  if (body && !raw) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  if (raw) payload = body;
  const r = await fetch(BASE + p, { method, headers, body: payload });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

async function main() {
  // 登录
  let r = await req("POST", "/api/auth/login", { username: "admin", password: "admin123" });
  check("管理员登录", r.status === 200 && r.json.token, "status=" + r.status);
  const admin = r.json.token;
  r = await req("POST", "/api/auth/login", { username: "li", password: "123456" });
  const reviewer1 = r.json.token;
  r = await req("POST", "/api/auth/login", { username: "wang", password: "123456" });
  const reviewer2 = r.json.token;

  // 越权：录入账号访问设置
  r = await req("GET", "/api/settings", null, reviewer1);
  check("一审账号无权访问设置", r.status === 403);

  // 病种管理
  r = await req("GET", "/api/diseases", null, admin);
  check("病种列表默认 3 个", r.status === 200 && r.json.length === 3 &&
    r.json.map(d => d.name).join(",") === "AMI,肥胖,肺癌", "names=" + r.json.map(d => d.name).join(","));
  check("病种列表含引用计数", r.status === 200 && r.json.every(d => typeof d.refCount === "number"));
  r = await req("POST", "/api/diseases", { name: "高血压" }, admin);
  check("新增病种", r.status === 200 && r.json.id && r.json.name === "高血压");
  const disNewId = r.json.id;
  r = await req("POST", "/api/diseases", { name: "高血压" }, admin);
  check("重复病种名被拒绝", r.status === 400);
  r = await req("POST", "/api/diseases", { name: "高血压2" }, reviewer1);
  check("非管理员不可新增病种", r.status === 403);
  r = await req("PUT", "/api/diseases/" + disNewId, { name: "高血压病" }, admin);
  check("病种改名", r.status === 200 && r.json.name === "高血压病");
  r = await req("PUT", "/api/diseases/" + disNewId, { status: "inactive" }, admin);
  check("病种停用", r.status === 200 && r.json.status === "inactive");
  r = await req("PUT", "/api/diseases/" + disNewId, { status: "active" }, admin);
  check("病种启用", r.status === 200 && r.json.status === "active");
  r = await req("DELETE", "/api/diseases/" + disNewId, null, admin);
  check("未引用病种可删除", r.status === 200 && r.json.success);
  r = await req("DELETE", "/api/diseases/d_ami", null, admin);
  check("被引用病种不可删除", r.status === 400);
  r = await req("PUT", "/api/diseases/d_ami", { name: "急性心肌梗死" }, admin);
  r = await req("GET", "/api/cards/card1", null, admin);
  check("改名后卡片病种名称跟随", r.json.disease === "急性心肌梗死");
  await req("PUT", "/api/diseases/d_ami", { name: "AMI" }, admin);

  // 卡片列表
  r = await req("GET", "/api/cards", null, admin);
  check("卡片列表 7 张种子", r.status === 200 && r.json.length === 7, "n=" + (r.json && r.json.length));
  check("种子卡默认无引用来源", r.json.every(c => Array.isArray(c.refs) && c.refs.length === 0));
  r = await req("GET", "/api/cards?diseaseId=d_ami", null, admin);
  check("卡片列表按病种筛选", r.status === 200 && r.json.length === 7 && r.json.every(c => c.diseaseId === "d_ami"));
  r = await req("GET", "/api/cards?diseaseId=d_lung", null, admin);
  check("卡片病种筛选无结果", r.status === 200 && r.json.length === 0);

  // 知识卡聚合内容接口
  r = await req("GET", "/api/linkage/cards", null, admin);
  check("联动卡片列表 7 张已定稿", r.status === 200 && r.json.length === 7);
  r = await req("GET", "/api/linkage/content", null, admin);
  check("聚合内容默认全量", r.status === 200 && r.json.count === 7 &&
    r.json.content.includes("护理问题：") && r.json.content.includes("护理目标：") &&
    r.json.content.includes("触发逻辑：") && r.json.content.includes("推荐护理措施：") &&
    r.json.content.includes("首优护理措施：") && r.json.content.includes("【卡片1】"));
  r = await req("GET", "/api/linkage/content?cardIds=card1,card2", null, admin);
  check("聚合内容子集生效", r.status === 200 && r.json.count === 2 &&
    r.json.content.includes("【卡片1】") && r.json.content.includes("【卡片2】"));
  r = await req("GET", "/api/linkage/content?cardIds=card1,notexist", null, admin);
  check("非法 id 被忽略", r.status === 200 && r.json.count === 1);
  r = await req("GET", "/api/linkage/content?diseaseId=d_ami", null, admin);
  check("聚合按病种 id 筛选", r.status === 200 && r.json.count === 7);
  r = await req("GET", "/api/linkage/content?disease=AMI", null, admin);
  check("聚合按病种名称筛选", r.status === 200 && r.json.count === 7);
  r = await req("GET", "/api/linkage/content?diseaseId=d_lung", null, admin);
  check("聚合病种筛选无结果", r.status === 200 && r.json.count === 0);
  r = await req("GET", "/api/linkage/content", null, null);
  check("未登录访问聚合接口返回 401", r.status === 401);

  // 创建草稿
  r = await req("POST", "/api/cards", {
    name: "测试卡·新建", disease: "AMI", isCommon: false,
    questionName: "测试问题", goal: "测试目标", triggerCond: "测试触发",
    measures: [{ priority: "首优", name: "测试措施", activities: ["活动A"] }]
  }, admin);
  check("创建草稿卡", r.status === 200 && r.json.id, "id=" + r.json.id);
  const newId = r.json.id;

  // 编辑草稿
  r = await req("PUT", "/api/cards/" + newId, { goal: "修改后目标" }, admin);
  check("编辑草稿卡", r.status === 200 && r.json.success);

  // 引用来源：保存 / 清空
  r = await req("PUT", "/api/cards/" + newId, { refs: [{ title: "测试文献", section: "§1", excerpt: "摘录内容" }] }, admin);
  check("保存引用来源", r.status === 200 && r.json.success);
  r = await req("GET", "/api/cards/" + newId, null, admin);
  check("引用已保存", r.json.refs.length === 1 && r.json.refs[0].title === "测试文献" && r.json.refs[0].section === "§1");
  r = await req("PUT", "/api/cards/" + newId, { refs: [{ title: "   ", section: "x" }, { title: "第二篇文献" }] }, admin);
  r = await req("GET", "/api/cards/" + newId, null, admin);
  check("空标题引用被丢弃且可增改", r.json.refs.length === 1 && r.json.refs[0].title === "第二篇文献");
  r = await req("PUT", "/api/cards/" + newId, { refs: [] }, admin);
  r = await req("GET", "/api/cards/" + newId, null, admin);
  check("引用可清空", r.json.refs.length === 0);

  // 卡片类型与删除规则
  r = await req("POST", "/api/cards", { name: "评估卡测试", type: "评估卡", disease: "AMI", isCommon: false }, admin);
  check("创建评估卡（无需护理问题）", r.status === 200 && r.json.id, "id=" + r.json.id);
  const evalId = r.json.id;
  r = await req("GET", "/api/cards/" + evalId, null, admin);
  check("评估卡类型已保存", r.json.type === "评估卡" && r.json.questionName === "" && r.json.measures.length === 0);
  r = await req("POST", "/api/cards", { name: "非法类型", type: "未知类型", questionName: "x" }, admin);
  check("非法类型被拒绝", r.status === 400);
  r = await req("DELETE", "/api/cards/" + evalId, null, admin);
  check("草稿可删除", r.status === 200 && r.json.success);
  r = await req("GET", "/api/cards/" + evalId, null, admin);
  check("删除后卡片不存在", r.status === 404);
  r = await req("DELETE", "/api/cards/card1", null, admin);
  check("已定稿不可删除", r.status === 400);

  // 提交一审
  r = await req("POST", "/api/cards/" + newId + "/submit-review", {}, admin);
  check("提交一审", r.status === 200 && r.json.status === "review1");

  // 已提交后不可编辑
  r = await req("PUT", "/api/cards/" + newId, { goal: "x" }, admin);
  check("审核中不可编辑", r.status === 400);

  // 一审通过（reviewer1）
  r = await req("POST", "/api/cards/" + newId + "/review", { level: 1, action: "approve" }, reviewer1);
  check("一审通过 → 二审", r.status === 200 && r.json.status === "review2");

  // 二审退回（reviewer2）
  r = await req("POST", "/api/cards/" + newId + "/review", { level: 2, action: "reject", comment: "目标描述需补充" }, reviewer2);
  check("二审退回 → 草稿", r.status === 200 && r.json.status === "draft");
  r = await req("GET", "/api/cards/" + newId, null, admin);
  check("退回原因已记录", r.json.rejectReason === "目标描述需补充");

  // 重新提交并二审通过
  await req("POST", "/api/cards/" + newId + "/submit-review", {}, admin);
  await req("POST", "/api/cards/" + newId + "/review", { level: 1, action: "approve" }, reviewer1);
  r = await req("POST", "/api/cards/" + newId + "/review", { level: 2, action: "approve" }, reviewer2);
  check("二审通过 → 已定稿并升版", r.status === 200 && r.json.status === "published" && r.json.version === "v1.0", "version=" + r.json.version);

  // 已定稿新建版本
  r = await req("POST", "/api/cards/" + newId + "/new-version", {}, admin);
  check("已定稿新建版本 → 草稿 v1.1", r.status === 200 && r.json.status === "draft" && r.json.version === "v1.1", "version=" + r.json.version);
  const verId = r.json.id;

  // 版本链：新版本二审通过后旧版停用
  r = await req("POST", "/api/cards/" + verId + "/submit-review", {}, admin);
  await req("POST", "/api/cards/" + verId + "/review", { level: 1, action: "approve" }, reviewer1);
  r = await req("POST", "/api/cards/" + verId + "/review", { level: 2, action: "approve" }, reviewer2);
  check("新版本定稿为 v1.1", r.status === 200 && r.json.status === "published" && r.json.version === "v1.1");
  r = await req("GET", "/api/cards/" + newId, null, admin);
  check("旧版自动停用", r.json.status === "superseded");
  r = await req("GET", "/api/cards", null, admin);
  check("列表默认不含停用版", r.status === 200 && !r.json.some(c => c.status === "superseded") && r.json.some(c => c.id === verId));
  r = await req("GET", "/api/cards?includeHistory=1", null, admin);
  check("含历史时包含停用版", r.status === 200 && r.json.some(c => c.id === newId && c.status === "superseded"));
  const lineId = r.json.find(x => x.id === verId).lineId;
  check("同链仅一个生效已定稿", r.json.filter(c => c.lineId === lineId && c.status === "published").length === 1);
  r = await req("POST", "/api/cards/" + newId + "/new-version", {}, admin);
  check("停用版不可再新建版本", r.status === 400);
  r = await req("GET", "/api/cards/" + verId + "/versions", null, admin);
  check("版本历史含新旧两版", r.status === 200 && r.json.length === 2 && r.json.some(v => v.status === "superseded") && r.json.some(v => v.status === "published"));
  r = await req("GET", "/api/review/history", null, admin);
  check("审核历史含新旧两版", r.status === 200 && r.json.some(x => x.id === newId && x.status === "superseded") && r.json.some(x => x.id === verId && x.status === "published"));
  r = await req("GET", "/api/linkage/content", null, admin);
  check("聚合仅含生效版", r.status === 200 && !r.json.cardIds.includes(newId));

  // 设置 Dify 指向 mock
  r = await req("PUT", "/api/settings", {
    dify: { baseUrl: "http://127.0.0.1:3788", apiKey: "mock-key", workflowId: "mock-wf", timeoutMs: 30000, outputVar: "output", inputNames: { file: "file", card: "card", prompt: "prompt" } },
    files: { maxSizeMb: 20, ttlHours: 24, allowedExtensions: [".pdf", ".docx", ".xlsx", ".txt"] }
  }, admin);
  check("保存 Dify 配置", r.status === 200 && r.json.success);
  r = await req("GET", "/api/settings", null, admin);
  check("配置回读（密钥掩码）", r.status === 200 && r.json.dify.apiKeyMasked === "****");

  // 测试连接
  r = await req("POST", "/api/settings/test-dify", {}, admin);
  check("Dify 测试连接", r.status === 200 && r.json.success, JSON.stringify(r.json));

  // 上传文献（永久文献库）
  const txt = path.join(os.tmpdir(), "kc_api_sample_" + Date.now() + ".txt");
  fs.writeFileSync(txt, "2025 ACC/AHA ACS 指南：疼痛管理章节摘要……", "utf8");
  const buf = fs.readFileSync(txt);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "text/plain" }), "sample.txt");
  fd.append("diseaseId", "d_ami");
  fd.append("publishedAt", "2025-06");
  r = await req("POST", "/api/literature", fd, admin, true);
  check("上传文献入库", r.status === 200 && r.json.id, "id=" + r.json.id);
  const fileId = r.json.id;

  // 缺少病种 / 发表时间被拒
  const fdNoMeta = new FormData();
  fdNoMeta.append("file", new Blob([buf], { type: "text/plain" }), "nometa.txt");
  r = await req("POST", "/api/literature", fdNoMeta, admin, true);
  check("缺病种/发表时间上传被拒", r.status === 400);
  const fdNoDate = new FormData();
  fdNoDate.append("file", new Blob([buf], { type: "text/plain" }), "nodate.txt");
  fdNoDate.append("diseaseId", "d_ami");
  r = await req("POST", "/api/literature", fdNoDate, admin, true);
  check("缺发表时间上传被拒", r.status === 400);

  // 非法扩展名
  const bad = new FormData();
  bad.append("file", new Blob([buf], { type: "application/octet-stream" }), "evil.exe");
  r = await req("POST", "/api/literature", bad, admin, true);
  check("非法扩展名被拒绝", r.status === 400);

  // 文献列表 / 搜索 / 下载 / 同名 / 删除
  r = await req("GET", "/api/literature", null, admin);
  check("文献列表 1 条", r.status === 200 && r.json.length === 1 && r.json[0].name === "sample.txt");
  check("文献列表含病种与发表时间", r.json[0].diseaseName === "AMI" && r.json[0].publishedAt === "2025-06");
  r = await req("GET", "/api/literature?keyword=sample", null, admin);
  check("文献关键词搜索", r.status === 200 && r.json.length === 1);
  r = await req("GET", "/api/literature?keyword=不存在", null, admin);
  check("文献搜索无结果", r.status === 200 && r.json.length === 0);
  const dl = await fetch(BASE + "/api/literature/" + fileId + "/download", { headers: { Authorization: "Bearer " + admin } });
  check("文献下载内容一致", dl.status === 200 && (await dl.text()).includes("疼痛管理章节摘要"));
  const fd2 = new FormData();
  fd2.append("file", new Blob([buf], { type: "text/plain" }), "sample.txt");
  fd2.append("diseaseId", "d_ami");
  fd2.append("publishedAt", "2025-06");
  r = await req("POST", "/api/literature", fd2, admin, true);
  check("同名文献不冲突", r.status === 200 && r.json.id !== fileId);
  const dupId = r.json.id;
  r = await req("GET", "/api/literature", null, admin);
  check("文献列表 2 条", r.status === 200 && r.json.length === 2);

  // 病种 / 年份筛选
  r = await req("GET", "/api/literature?diseaseId=d_ami", null, admin);
  check("文献按病种筛选", r.status === 200 && r.json.length === 2);
  r = await req("GET", "/api/literature?yearFrom=2025&yearTo=2025", null, admin);
  check("文献按年份筛选", r.status === 200 && r.json.length === 2);
  r = await req("GET", "/api/literature?yearFrom=2026", null, admin);
  check("文献年份筛选无结果", r.status === 200 && r.json.length === 0);

  // 编辑文献：改名 / 病种 / 发表时间
  r = await req("PUT", "/api/literature/" + dupId, { diseaseId: "d_lung", publishedAt: "2025-12" }, admin);
  check("编辑文献病种/发表时间", r.status === 200);
  r = await req("GET", "/api/literature?diseaseId=d_lung", null, admin);
  check("编辑后按新病种筛选", r.status === 200 && r.json.length === 1 && r.json[0].publishedAt === "2025-12" && r.json[0].diseaseName === "肺癌");

  r = await req("DELETE", "/api/literature/" + fileId, null, admin);
  check("文献可删除", r.status === 200 && r.json.success);
  const dl2 = await fetch(BASE + "/api/literature/" + fileId + "/download", { headers: { Authorization: "Bearer " + admin } });
  check("删除后下载 404", dl2.status === 404);

  // 清理逻辑：超期临时文件被扫描删除、文献库不受影响
  const tmpFd = new FormData();
  tmpFd.append("file", new Blob([buf], { type: "text/plain" }), "tmp_probe.txt");
  r = await req("POST", "/api/files/upload", tmpFd, admin, true);
  check("临时文件上传（兼容接口）", r.status === 200 && r.json.fileId);
  const tmpId = r.json.fileId;
  const srvTmpFile = path.join(__dirname, "..", "uploads", "tmp", tmpId + ".txt");
  const past = new Date(Date.now() - 48 * 3600 * 1000);
  fs.utimesSync(srvTmpFile, past, past);
  r = await req("POST", "/api/settings/cleanup", {}, admin);
  check("超期临时文件被清理", r.status === 200 && r.json.success && r.json.cleanedFiles >= 1 && !fs.existsSync(srvTmpFile));
  r = await req("GET", "/api/literature", null, admin);
  check("清理不影响文献库", r.status === 200 && r.json.length === 1);

  // 为 AI 优化准备一份文献
  const fd3 = new FormData();
  fd3.append("file", new Blob([buf], { type: "text/plain" }), "sample.txt");
  fd3.append("diseaseId", "d_ami");
  fd3.append("publishedAt", "2025-06");
  r = await req("POST", "/api/literature", fd3, admin, true);
  const extractFileId = r.json.id;

  // 发起抽取（目标：card7 已定稿）
  r = await req("POST", "/api/extract", { fileId: extractFileId, cardId: "card7", prompt: "请基于文献优化疼痛相关卡片" }, admin);
  check("发起 AI 抽取任务", r.status === 200 && r.json.id, "id=" + r.json.id);
  const extId = r.json.id;

  // 轮询完成
  let task = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(res => setTimeout(res, 500));
    const rr = await req("GET", "/api/extract/" + extId, null, admin);
    task = rr.json;
    if (task.status === "completed" || task.status === "failed") break;
  }
  check("抽取任务完成", task && task.status === "completed", task && task.error);
  check("结果为结构化", task && task.result && task.result.structured === true);
  check("建议数 = 3", task && task.result && task.result.suggestions.length === 3, "n=" + (task.result && task.result.suggestions.length));
  check("字段映射为中文", task && task.result.suggestions.map(s => s.field).join(",") === "护理目标,护理问题触发,推荐护理措施", (task.result.suggestions || []).map(s => s.field).join(","));

  // 确认生成草稿
  const accepted = (task.result.suggestions || []).map(s => ({ field: s.field, new: s.new }));
  r = await req("POST", "/api/extract/" + extId + "/confirm", { accepted }, admin);
  check("确认生成 AI 草稿", r.status === 200 && r.json.status === "draft", "id=" + r.json.id);
  check("AI 草稿版本为来源卡下一版", r.json.version === "v1.1", "version=" + r.json.version);
  const draftId = r.json.id;
  r = await req("GET", "/api/cards/" + draftId, null, admin);
  check("AI 草稿字段已应用", r.json.goal.includes("再灌注治疗后24小时") && r.json.aiGenerated === true);
  check("AI 草稿记录来源卡片", r.json.iterateFrom === "card7");
  check("AI 草稿继承版本链", r.json.lineId === "card7");
  check("纯文本措施已拆分为结构化数组", Array.isArray(r.json.measures) && r.json.measures.length === 1 && r.json.measures[0].measure_name === "AI 优化措施" && r.json.measures[0].activities.length === 3);
  const refTitles = (r.json.refs || []).map(x => x.title);
  check("AI 草稿自动关联上传文献", refTitles.includes("sample.txt"));
  check("AI 草稿合并 AI 输出引用", refTitles.includes("急性ST段抬高型心肌梗死溶栓治疗专家共识"));

  // 英文键直传确认（不经过前端中文标签）
  r = await req("POST", "/api/extract", { fileId: extractFileId, cardId: "card7", prompt: "英文键测试" }, admin);
  const extId2 = r.json.id;
  let task2 = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(res => setTimeout(res, 500));
    const rr = await req("GET", "/api/extract/" + extId2, null, admin);
    task2 = rr.json;
    if (task2.status === "completed" || task2.status === "failed") break;
  }
  check("第二次抽取完成", task2 && task2.status === "completed");
  r = await req("POST", "/api/extract/" + extId2 + "/confirm", {
    accepted: [
      { field: "goal", new: "英文键目标已更新" },
      { field: "measures", new: JSON.stringify([{ priority: "首优", measure_name: "英文键措施", activities: ["活动1"] }]) }
    ]
  }, admin);
  check("英文键确认成功", r.status === 200 && r.json.status === "draft");
  r = await req("GET", "/api/cards/" + r.json.id, null, admin);
  check("英文键字段已应用", r.json.goal === "英文键目标已更新" && r.json.measures[0].measure_name === "英文键措施");

  // 旧契约回归（mock 按 prompt 含 OLD_FORMAT 返回旧格式）
  r = await req("POST", "/api/extract", { fileId: extractFileId, cardId: "card7", prompt: "OLD_FORMAT 回归测试" }, admin);
  const extId3 = r.json.id;
  let task3 = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(res => setTimeout(res, 500));
    const rr = await req("GET", "/api/extract/" + extId3, null, admin);
    task3 = rr.json;
    if (task3.status === "completed" || task3.status === "failed") break;
  }
  check("旧格式抽取完成", task3 && task3.status === "completed");
  check("旧格式仍按结构化解析", task3 && task3.result.structured === true);
  r = await req("POST", "/api/extract/" + extId3 + "/confirm", {
    accepted: (task3.result.suggestions || []).map(s => ({ field: s.field, new: s.new }))
  }, admin);
  check("旧格式确认成功", r.status === 200);
  r = await req("GET", "/api/cards/" + r.json.id, null, admin);
  check("旧格式字段已应用", r.json.goal.includes("无伴随症状加重"));

  // 形态A 回归（result.optimization / original / optimized / rationale）
  r = await req("POST", "/api/extract", { fileId: extractFileId, cardId: "card7", prompt: "OPT_FORMAT 测试" }, admin);
  const extId4 = r.json.id;
  let task4 = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(res => setTimeout(res, 500));
    const rr = await req("GET", "/api/extract/" + extId4, null, admin);
    task4 = rr.json;
    if (task4.status === "completed" || task4.status === "failed") break;
  }
  check("形态A 抽取完成", task4 && task4.status === "completed");
  check("形态A 建议映射为中文", task4 && task4.result.suggestions.map(s => s.field).join(",") === "护理目标,推荐护理措施");
  r = await req("POST", "/api/extract/" + extId4 + "/confirm", {
    accepted: (task4.result.suggestions || []).map(s => ({ field: s.field, new: s.new }))
  }, admin);
  check("形态A 确认成功", r.status === 200);
  r = await req("GET", "/api/cards/" + r.json.id, null, admin);
  check("形态A 字段已应用", r.json.goal.includes("ST段回落≥50%") && Array.isArray(r.json.measures) && r.json.measures[0].measure_name === "再灌注监护与体位管理");

  // 回显形态（工作流未执行优化，返回输入卡片）：应标记为诊断提示
  r = await req("POST", "/api/extract", { fileId: extractFileId, cardId: "card7", prompt: "ECHO 测试" }, admin);
  const extId5 = r.json.id;
  let task5 = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(res => setTimeout(res, 500));
    const rr = await req("GET", "/api/extract/" + extId5, null, admin);
    task5 = rr.json;
    if (task5.status === "completed" || task5.status === "failed") break;
  }
  check("回显形态抽取完成", task5 && task5.status === "completed");
  check("回显形态判定为非结构化", task5 && task5.result.structured === false);
  check("回显诊断标记正确", task5 && task5.result.jsonDetected === true && task5.result.echoHint === true);
  r = await req("POST", "/api/extract/" + extId5 + "/confirm", { accepted: [] }, admin);
  check("非结构化确认成功", r.status === 200 && r.json.status === "draft");
  r = await req("GET", "/api/cards/" + r.json.id, null, admin);
  check("非结构化草稿也关联上传文献", (r.json.refs || []).length >= 1 && r.json.refs[0].title === "sample.txt" && r.json.refs[0].section === "上传文献");

  // 形态D（字段键值映射，当前真实工作流返回）
  r = await req("POST", "/api/extract", { fileId: extractFileId, cardId: "card2", prompt: "KEYMAP 测试" }, admin);
  const extId6 = r.json.id;
  let task6 = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(res => setTimeout(res, 500));
    const rr = await req("GET", "/api/extract/" + extId6, null, admin);
    task6 = rr.json;
    if (task6.status === "completed" || task6.status === "failed") break;
  }
  check("形态D 抽取完成", task6 && task6.status === "completed");
  check("形态D 建议映射为中文", task6 && task6.result.structured === true && task6.result.suggestions.map(s => s.field).join(",") === "护理目标,护理问题触发,推荐护理措施");
  check("形态D 字段值正确", task6 && task6.result.suggestions[0].new.includes("6分钟步行距离") && task6.result.suggestions[2].new.includes("分阶段活动"));
  r = await req("POST", "/api/extract/" + extId6 + "/confirm", {
    accepted: (task6.result.suggestions || []).map(s => ({ field: s.field, new: s.new }))
  }, admin);
  check("形态D 确认成功", r.status === 200);
  r = await req("GET", "/api/cards/" + r.json.id, null, admin);
  check("形态D 字段已应用", r.json.goal.includes("6分钟步行距离") && r.json.measures[0].measure_name === "AI 优化措施");

  // 抽取历史
  r = await req("GET", "/api/extract/history", null, admin);
  check("抽取历史存在", r.status === 200 && r.json.length >= 1);

  // 清理
  await req("DELETE", "/api/files/" + fileId, null, admin);
  try { fs.unlinkSync(txt); } catch (e) { /* 忽略 */ }

  console.log("---");
  console.log(fail ? "FAILED: " + fail : "ALL PASS (" + pass + ")");
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error("HARNESS ERROR: " + e.message); process.exit(2); });
