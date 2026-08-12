const axios = require("axios");
const fs = require("fs");
const path = require("path");

const MIME_MAP = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".doc": "application/msword",
  ".xls": "application/vnd.ms-excel"
};

function enrich(e) {
  if (e && e.config) {
    const where = (e.config.method || "?").toUpperCase() + " " + e.config.url;
    const status = e.response ? "HTTP " + e.response.status : "";
    const body = e.response && e.response.data ? " " + JSON.stringify(e.response.data).slice(0, 300) : "";
    return status + " " + where + body + " | " + (e.message || "");
  }
  return (e && e.message) || String(e);
}

function apiBase(cfg) {
  let b = String(cfg.baseUrl || "").trim().replace(/\/+$/, "");
  if (!b) return "";
  if (!/\/v1$/i.test(b)) b += "/v1";
  return b;
}

async function uploadFile(cfg, filePath, fileName) {
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: MIME_MAP[path.extname(fileName).toLowerCase()] || "application/octet-stream" }), fileName);
  fd.append("user", "knowledge-card");
  let res;
  try {
    res = await axios.post(apiBase(cfg) + "/files/upload", fd, {
      headers: { Authorization: "Bearer " + cfg.apiKey },
      timeout: cfg.timeoutMs
    });
  } catch (e) {
    throw new Error("Dify 文件上传失败：" + enrich(e));
  }
  const id = res.data && (res.data.id || (res.data.data && res.data.data.id));
  if (!id) throw new Error("Dify 文件上传失败：未返回文件 id");
  return id;
}

async function runWorkflow(cfg, inputs) {
  let res;
  try {
    res = await axios.post(apiBase(cfg) + "/workflows/run", {
      inputs,
      response_mode: "blocking",
      user: "knowledge-card"
    }, {
      headers: { Authorization: "Bearer " + cfg.apiKey },
      timeout: cfg.timeoutMs
    });
  } catch (e) {
    throw new Error("Dify 工作流调用失败：" + enrich(e));
  }
  const d = res.data || {};
  const run = d.data || d;
  if (run.status && run.status !== "succeeded" && run.status !== "completed") {
    throw new Error("Dify 工作流执行失败：" + (run.error || run.status));
  }
  return run.outputs || d.outputs || {};
}

async function getParameters(cfg) {
  let res;
  try {
    res = await axios.get(apiBase(cfg) + "/parameters", {
      headers: { Authorization: "Bearer " + cfg.apiKey },
      timeout: cfg.timeoutMs
    });
  } catch (e) {
    throw new Error("Dify 参数获取失败：" + enrich(e));
  }
  return res.data;
}

module.exports = { uploadFile, runWorkflow, getParameters, apiBase };
