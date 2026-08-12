// 浏览器端冒烟测试：自动拉起无头 Edge，覆盖 登录→建卡→上传→AI抽取→审核→设置
// 前置：node server.js 与 node test/mock-dify.js 已启动，且系统设置已指向 http://127.0.0.1:3788
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const APP_URL = process.env.KC_APP_URL || "http://127.0.0.1:3742";
const SAMPLE = process.env.KC_SAMPLE || path.join(__dirname, "sample.txt");
const PORT = 9226;
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
      tab = list.find(t => t.type === "page" && (t.url.includes("3742") || t.url.includes("index")));
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
    const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log((ok ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : "")); };
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    check("登录页初始可见", await evalJs("!document.getElementById('loginPage').classList.contains('hidden')"));
    await evalJs("doLogin()");
    await sleep(1200);
    check("登录后卡片列表 7 行", await evalJs("document.querySelectorAll('#cardTableBody tr').length") === 7);
    check("侧边栏用户显示", await evalJs("document.getElementById('userName').textContent") === "平台管理员");

    await evalJs("showPage('ai-workbench')");
    check("上传区存在", await evalJs("!!document.getElementById('dropzone')"));
    check("选卡列表 7 项（初始化全已定稿）", await evalJs("document.querySelectorAll('#iterateCardList .card-select-item').length") === 7);

    const doc = await send("DOM.getDocument");
    const q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#fileInput" });
    await send("DOM.setFileInputFiles", { nodeId: q.result.nodeId, files: [SAMPLE] });
    await sleep(800);
    check("上传后文件列表 1 项", await evalJs("document.querySelectorAll('#uploadList .upload-item').length") === 1);
    check("文件被选中", await evalJs("selectedFileId !== ''"));

    await evalJs("selectIterateCard(document.querySelector('#iterateCardList .card-select-item'))");
    check("已选择目标卡片", await evalJs("selectedCardId !== ''"));
    await evalJs("aiGotoStep2()");
    check("进入步骤2", await evalJs("!document.getElementById('ai-step2-content').classList.contains('collapsed')"));
    await evalJs("aiStartExtract()");
    await sleep(4500);
    check("抽取完成状态", await evalJs("document.getElementById('aiExtractStatus').textContent") === "抽取完成");
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

    await evalJs("showPage('settings')");
    await sleep(800);
    check("设置页加载 Dify Base URL", await evalJs("document.getElementById('setDifyBase').value") === "http://127.0.0.1:3788");
    await evalJs("testDify()");
    await sleep(1500);
    check("测试连接成功", await evalJs("document.getElementById('setDifyTestResult').textContent.includes('连接成功')"));

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
