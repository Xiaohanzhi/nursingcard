// 真实 Dify 联调：配置 → 测试连接 → 上传 → 抽取 → 轮询（结果或错误）
// 用法：node test/real-dify-e2e.js <baseUrl> <apiKey> <workflowId> [promptVar]
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:3742";
const DIFY_BASE = process.argv[2];
const DIFY_KEY = process.argv[3];
const DIFY_WF = process.argv[4];
const PROMPT_VAR = process.argv[5] || "promot";
const SAMPLE = path.join(__dirname, "sample.txt");

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
  let r = await req("POST", "/api/auth/login", { username: "admin", password: "admin123" });
  const token = r.json.token;

  r = await req("PUT", "/api/settings", {
    dify: {
      baseUrl: DIFY_BASE, apiKey: DIFY_KEY, workflowId: DIFY_WF, timeoutMs: 120000,
      inputNames: { file: "file", card: "card", prompt: PROMPT_VAR },
      outputVar: "output"
    },
    files: { maxSizeMb: 20, ttlHours: 24, allowedExtensions: [".pdf", ".docx", ".xlsx", ".txt"] }
  }, token);
  console.log("配置保存:", r.status === 200 ? "OK" : JSON.stringify(r.json));

  r = await req("POST", "/api/settings/test-dify", {}, token);
  console.log("测试连接:", r.status === 200 ? r.json.message : ("失败 " + JSON.stringify(r.json)));

  const buf = fs.readFileSync(SAMPLE);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "text/plain" }), "sample.txt");
  r = await req("POST", "/api/files/upload", fd, token, true);
  if (r.status !== 200) { console.log("上传失败:", JSON.stringify(r.json)); process.exit(1); }
  console.log("文件上传 OK, fileId=" + r.json.fileId);

  r = await req("POST", "/api/extract", {
    fileId: r.json.fileId, cardId: "card7",
    prompt: "请基于文献对目标护理问题卡提出优化建议，输出 JSON：suggestions[{field,old,new,reason,ref}], card, refs"
  }, token);
  const taskId = r.json.id;
  console.log("抽取任务已提交: " + taskId);

  let task = null;
  for (let i = 0; i < 120; i++) {
    await new Promise(res => setTimeout(res, 1000));
    const rr = await req("GET", "/api/extract/" + taskId, null, token);
    task = rr.json;
    if (task.status === "completed" || task.status === "failed") break;
  }
  console.log("任务状态:", task.status);
  if (task.status === "completed") {
    console.log("结构化:", task.result.structured);
    console.log("结果摘要:", JSON.stringify(task.result).slice(0, 1500));
  } else if (task.status === "failed") {
    console.log("任务错误:", task.error);
  }
  process.exit(task.status === "completed" ? 0 : 1);
}

main().catch(e => { console.error("E2E ERROR: " + e.message); process.exit(2); });
