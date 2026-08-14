// 浏览器端冒烟测试：自动拉起无头 Edge，覆盖 登录→建卡→上传→AI抽取→审核→设置
// 前置：node server.js 与 node test/mock-dify.js 已启动，且系统设置已指向 http://127.0.0.1:3788
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const APP_URL = process.env.KC_APP_URL || "http://127.0.0.1:3742";
const SAMPLE = process.env.KC_SAMPLE || path.join(__dirname, "sample.txt");
const PORT = parseInt(process.env.KC_CDP_PORT || "9226", 10);
const TARGET = "http://127.0.0.1:" + PORT;

async function waitJson(url, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("CDP endpoint not ready: " + url);
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kc-edge-"));
  const edge = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile, APP_URL
  ], { stdio: "ignore", windowsHide: true });

  try {
    await waitJson(TARGET + "/json/version");
    let tab = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const list = await waitJson(TARGET + "/json/list");
      tab = list.find(t => t.type === "page" && (t.url.includes(APP_URL) || t.url.includes("index")));
      if (tab) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (!tab) throw new Error("未找到模块页面");

    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    const errors = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
      if (msg.method === "Runtime.exceptionThrown") {
        errors.push("EXCEPTION: " + (msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text));
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push("LOG: " + msg.params.entry.text);
      if (msg.method === "Page.javascriptDialogOpening") dialogOpen = true;
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        errors.push("CONSOLE: " + (msg.params.args || []).map(a => a.value || a.description).join(" "));
      }
    };
    await new Promise(r => ws.onopen = r);
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error("Eval failed: " + JSON.stringify(r.result.exceptionDetails));
      return r.result ? r.result.result.value : undefined;
    };
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Page.enable");
    await send("DOM.enable");
    await new Promise(r => setTimeout(r, 1500));

    const results = [];
    let dialogOpen = false;
    const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log((ok ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : "")); };
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    check("登录页初始可见", await evalJs("!document.getElementById('loginPage').classList.contains('hidden')"));
    await evalJs("doLogin()");
    for (let i = 0; i < 30 && await evalJs("document.querySelectorAll('#cardTableBody tr').length") !== 7; i++) await sleep(200);
    check("登录后卡片列表 7 行", await evalJs("document.querySelectorAll('#cardTableBody tr').length") === 7);
    check("侧边栏用户显示", await evalJs("document.getElementById('userName').textContent") === "平台管理员");
    check("列表无护理问题列", await evalJs("Array.from(document.querySelectorAll('#page-card-list thead th')).map(t=>t.textContent).join(',')") === "卡片名称,病种,共性,版本,状态,最后修改,操作");
    check("列表无 AI 徽标（种子为手工卡）", await evalJs("document.querySelectorAll('#cardTableBody .tag-purple').length") === 0);
    check("卡片列表统计卡 3 项", await evalJs("document.querySelectorAll('#page-card-list .stat-card').length") === 3);
    check("列表病种筛选含默认 3 病种", await evalJs("document.getElementById('filterDisease').options.length") === 4);
    await evalJs("openCardDetail('card1')");
    check("生效卡有版本历史按钮", await evalJs("document.getElementById('cardDetailFooter').textContent.includes('版本历史')"));
    await evalJs("showVersions('card1')");
    await sleep(400);
    check("版本历史弹层显示 v1.0", await evalJs("document.getElementById('versionsModal').classList.contains('show') && document.getElementById('versionsModalBody').textContent.includes('v1.0')"));
    await evalJs("closeVersionsModal(); closeCardDetail()");

    await evalJs("showPage('ai-workbench')");
    check("上传区存在", await evalJs("!!document.getElementById('dropzone')"));
    check("选卡列表 7 项（初始化全已定稿）", await evalJs("document.querySelectorAll('#iterateCardList .card-select-item').length") === 7);

    const doc = await send("DOM.getDocument");
    const q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#fileInput" });
    await send("DOM.setFileInputFiles", { nodeId: q.result.nodeId, files: [SAMPLE] });
    await sleep(400);
    check("上传弹窗出现且文件名预填", await evalJs("document.getElementById('uploadLitModal').classList.contains('show') && document.getElementById('uploadLitName').value === 'sample.txt'"));
    check("上传弹窗显示文件大小", await evalJs("document.getElementById('uploadLitFileMeta').textContent.includes('KB') || document.getElementById('uploadLitFileMeta').textContent.includes('MB')"));
    await evalJs("confirmUploadLiterature()");
    await sleep(300);
    check("未填病种/年月确认有提示", await evalJs("document.getElementById('uploadLitModal').classList.contains('show')"));
    await evalJs("document.getElementById('uploadLitDiseaseId').value='d_ami'; document.getElementById('uploadLitYear').value='2025'; document.getElementById('uploadLitMonth').value='06'; confirmUploadLiterature()");
    await sleep(800);
    check("上传后弹窗关闭", await evalJs("!document.getElementById('uploadLitModal').classList.contains('show')"));
    check("上传后文献被选中", await evalJs("document.getElementById('aiLitSelect').value !== ''"));
    check("文献已选中（selectedFileId）", await evalJs("selectedFileId !== ''"));

    await evalJs("selectIterateCard(document.querySelector('#iterateCardList .card-select-item'))");
    check("已选择目标卡片", await evalJs("selectedCardId !== ''"));
    await evalJs("aiGotoStep2()");
    check("进入步骤2", await evalJs("!document.getElementById('ai-step2-content').classList.contains('collapsed')"));
    await evalJs("aiStartExtract()");
    await sleep(4500);
    check("优化完成状态", await evalJs("document.getElementById('aiExtractStatus').textContent") === "优化完成");
    check("迭代对比面板出现", await evalJs("document.getElementById('aiExtractResult').innerHTML.includes('iterate-compare')"));
    check("建议行 = 3", await evalJs("document.querySelectorAll('.iterate-diff-row').length") === 3);
    check("措施卡片化呈现", await evalJs("document.querySelectorAll('.idr-m-card').length") >= 2);
    check("措施 JSON 微调框存在", await evalJs("!!document.querySelector('.idr-json')"));
    check("字段显示中文标签", await evalJs("Array.from(document.querySelectorAll('.idr-field')).map(e => e.textContent).join(',')") === "护理目标,护理问题触发,推荐护理措施");

    await evalJs("acceptIterateSuggestion('iter_0')");
    await evalJs("aiConfirmDraft()");
    await sleep(1600);
    check("确认后回到列表", await evalJs("document.querySelector('.page.active').id") === "page-card-list");
    check("列表出现 AI 草稿（8 张）", await evalJs("document.querySelectorAll('#cardTableBody tr').length") === 8);
    await evalJs("var c=CARDS.find(function(x){return x.aiGenerated;}); if(c) openCardDetail(c.id)");
    check("AI 草稿详情自动关联上传文献", await evalJs("document.getElementById('cardDetailBody').textContent.includes('sample.txt') && document.getElementById('cardDetailBody').textContent.includes('溶栓治疗专家共识')"));
    await evalJs("closeCardDetail()");

    await evalJs("openCreateCardModal()");
    check("创建模态框标题", await evalJs("document.getElementById('createCardModalTitle').textContent") === "新建知识卡片");
    check("新建类型默认护理问题卡", await evalJs("document.getElementById('newCardType').value") === "护理问题卡");
    await evalJs("document.getElementById('newCardType').value='评估卡'; updateTypeFields()");
    check("切换评估卡隐藏护理字段区并提示", await evalJs("document.getElementById('nursingFieldsWrap').style.display === 'none' && document.getElementById('nonNursingHint').style.display !== 'none'"));
    await evalJs("document.getElementById('newCardType').value='护理问题卡'; updateTypeFields()");
    check("切回护理问题卡恢复字段区", await evalJs("document.getElementById('nursingFieldsWrap').style.display !== 'none'"));
    await evalJs("document.getElementById('newCardName').value='冒烟测试卡'; document.getElementById('nc_questionName').value='冒烟问题'; addRefRow(); document.querySelector('#refEditor .rf-title').value='冒烟文献'; document.querySelector('#refEditor .rf-section').value='§1'; saveNewCard()");
    await sleep(800);
    check("创建后列表 9 张", await evalJs("document.querySelectorAll('#cardTableBody tr').length") === 9);
    await evalJs("var c=CARDS.find(function(x){return x.name==='冒烟测试卡';}); if(c) openCardDetail(c.id)");
    check("详情显示手动添加的引用", await evalJs("document.getElementById('cardDetailBody').textContent.includes('冒烟文献')"));
    await evalJs("closeCardDetail()");

    await evalJs("showPage('review-queue')");
    await sleep(800);
    check("一审队列空（初始化全已定稿，仅空态行）", await evalJs("document.querySelectorAll('#reviewTableBody tr').length") === 1);
    check("一审队列空态提示", await evalJs("document.getElementById('reviewTableBody').textContent.includes('队列已清空')"));
    await evalJs("switchReviewTab('done')");
    await sleep(500);
    check("审核历史 7 条生效版", await evalJs("document.querySelectorAll('#reviewTableBody tr').length") === 7);
    check("审核历史无进入审核按钮", await evalJs("!document.getElementById('reviewTableBody').textContent.includes('进入审核')"));
    check("审核历史有查看详情", await evalJs("document.getElementById('reviewTableBody').textContent.includes('查看详情')"));
    await evalJs("switchReviewTab('l1')");

    await evalJs("showPage('settings')");
    await sleep(800);
    check("设置页加载 Dify Base URL", await evalJs("document.getElementById('setDifyBase').value") === "http://127.0.0.1:3788");
    check("设置页病种管理列表 3 项", await evalJs("document.querySelectorAll('#diseaseTableBody tr').length") === 3);
    await evalJs("testDify()");
    await sleep(1500);
    check("测试连接成功", await evalJs("document.getElementById('setDifyTestResult').textContent.includes('连接成功')"));

    await evalJs("var c=CARDS.find(function(x){return x.name==='冒烟测试卡';}); if(c) openCardDetail(c.id)");
    check("草稿详情有删除按钮", await evalJs("!!document.querySelector('#cardDetailFooter .btn-danger')"));
    dialogOpen = false;
    await evalJs("setTimeout(function(){ document.querySelector('#cardDetailFooter .btn-danger').click(); }, 0)");
    for (let i = 0; i < 30 && !dialogOpen; i++) await sleep(100);
    await send("Page.handleJavaScriptDialog", { accept: true });
    await sleep(800);
    check("删除后列表回到 8 张", await evalJs("document.querySelectorAll('#cardTableBody tr').length") === 8);

    await evalJs("showPage('literature')");
    await sleep(600);
    check("文献页显示已上传文献", await evalJs("document.querySelectorAll('#literatureTableBody tr').length") === 1 && await evalJs("document.getElementById('literatureTableBody').textContent.includes('sample.txt')"));
    check("文献列表显示病种与发表时间", await evalJs("document.getElementById('literatureTableBody').textContent.includes('AMI') && document.getElementById('literatureTableBody').textContent.includes('2025-06')"));
    await evalJs("document.querySelector('#literatureTableBody a').click()");
    await sleep(400);
    check("编辑文献弹窗年月回填", await evalJs("document.getElementById('editLitModal').classList.contains('show') && document.getElementById('editLitYear').value==='2025' && document.getElementById('editLitMonth').value==='06' && document.getElementById('editLitDiseaseId').value==='d_ami'"));
    await evalJs("document.getElementById('editLitMonth').value='07'; saveEditLiterature()");
    await sleep(600);
    check("编辑保存后列表含新发表时间", await evalJs("document.getElementById('literatureTableBody').textContent.includes('2025-07')"));
    dialogOpen = false;
    await evalJs("setTimeout(function(){ var a=document.querySelector('#literatureTableBody a[style*=\"danger\"]'); if(a) a.click(); }, 0)");
    for (let i = 0; i < 30 && !dialogOpen; i++) await sleep(100);
    await send("Page.handleJavaScriptDialog", { accept: true });
    await sleep(800);
    check("删除文献后列表为空态", await evalJs("document.querySelectorAll('#literatureTableBody tr').length") === 1 && await evalJs("document.getElementById('literatureTableBody').textContent.includes('暂无文献')"));

    console.log("---");
    check("无 JS/console 错误", errors.length === 0, errors.join(";"));
    const failed = results.filter(r => !r.ok);
    console.log(failed.length ? "FAILED: " + failed.length : "ALL PASS");
    ws.close();
    process.exit(failed.length ? 1 : 0);
  } finally {
    try { edge.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}

main().catch(e => { console.error("HARNESS ERROR: " + e.message); process.exit(2); });
