// Dify 连通性探测：参数端点 → 文件上传 → 工作流运行（真实联调用）
// 用法：node test/dify-probe.js <baseUrl> <apiKey> [workflowId] [sampleFile]
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const base = String(process.argv[2] || "").replace(/\/+$/, "");
const key = process.argv[3] || "";
const wf = process.argv[4] || "";
const sample = process.argv[5] || path.join(__dirname, "sample.txt");

function brief(e) {
  if (!e) return "unknown";
  if (e.response) return "HTTP " + e.response.status + " " + JSON.stringify(e.response.data);
  return e.message;
}

async function main() {
  console.log("目标: " + base + "（工作流 ID: " + (wf || "未提供") + "）");

  // 1) 参数端点（验证地址+密钥+应用有效，返回工作流入参定义）
  let inputVars = [];
  try {
    const r = await axios.get(base + "/parameters", {
      headers: { Authorization: "Bearer " + key }, timeout: 15000
    });
    console.log("\n[1] /parameters 连接成功");
    console.log(JSON.stringify(r.data, null, 2).slice(0, 2000));
    (r.data.user_input_form || []).forEach(function (f) {
      const k = Object.keys(f)[0];
      const v = f[k];
      inputVars.push({ variable: v.variable, label: v.label, type: v.type, required: v.required !== false });
    });
    console.log("\n工作流入参变量: " + inputVars.map(v => v.variable + "(" + v.type + (v.required ? ",必填" : "") + ")").join(" | "));
  } catch (e) {
    console.log("\n[1] /parameters 失败: " + brief(e));
  }

  // 2) 文件上传
  let fileId = "";
  try {
    const buf = fs.readFileSync(sample);
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: "text/plain" }), path.basename(sample));
    fd.append("user", "knowledge-card");
    const r = await axios.post(base + "/files/upload", fd, {
      headers: { Authorization: "Bearer " + key }, timeout: 30000
    });
    fileId = r.data && (r.data.id || (r.data.data && r.data.data.id));
    console.log("\n[2] 文件上传成功, upload_file_id=" + fileId);
  } catch (e) {
    console.log("\n[2] 文件上传失败: " + brief(e));
  }

  // 3) 工作流运行（blocking）
  try {
    const card = JSON.stringify({
      name: "AMI · 疼痛护理", disease: "AMI", isCommon: false,
      questionName: "疼痛", goal: "疼痛缓解，NRS 评分 ≤ 3 分",
      triggerCond: "NRS评分≥4分、上腹痛、牙痛、心前区压榨样疼痛",
      measures: [{ priority: "首优", name: "休息与活动", activities: ["①绝对卧床"] }],
      version: "v1.0", status: "published"
    });
    const inputs = {};
    inputVars.forEach(function (v) {
      if (v.type === "file") {
        inputs[v.variable] = fileId ? { type: "document", transfer_method: "local_file", upload_file_id: fileId } : null;
      } else if (v.variable === "card") {
        inputs[v.variable] = card;
      } else {
        inputs[v.variable] = "请基于文献对目标护理问题卡提出优化建议，输出 JSON：suggestions[{field,old,new,reason,ref}], card, refs";
      }
    });
    console.log("\n[3] 发送入参: " + JSON.stringify(Object.keys(inputs)));
    const r = await axios.post(base + "/workflows/run", {
      inputs,
      response_mode: "blocking",
      user: "knowledge-card"
    }, { headers: { Authorization: "Bearer " + key }, timeout: 120000 });
    console.log("\n[3] 工作流运行成功:");
    console.log(JSON.stringify(r.data, null, 2).slice(0, 3000));
  } catch (e) {
    console.log("\n[3] 工作流运行失败: " + brief(e));
  }
}

main().catch(e => console.error("PROBE ERROR: " + e.message));
