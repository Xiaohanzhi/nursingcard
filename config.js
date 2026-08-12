const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CONFIG_PATH = path.join(__dirname, "config.json");

const DEFAULT_CONFIG = {
  server: { port: 3742, jwtSecret: "", ssoEnabled: false },
  dify: {
    baseUrl: "",
    apiKey: "",
    workflowId: "",
    timeoutMs: 300000,
    inputNames: { file: "file", card: "card", prompt: "prompt" },
    outputVar: "output"
  },
  files: {
    maxSizeMb: 20,
    allowedExtensions: [".pdf", ".docx", ".xlsx", ".txt"],
    ttlHours: 24
  }
};

let config = null;

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over !== undefined ? over : base;
  if (base && typeof base === "object" && over && typeof over === "object") {
    const out = {};
    Object.keys(base).forEach(k => { out[k] = deepMerge(base[k], over[k]); });
    Object.keys(over || {}).forEach(k => { if (!(k in out)) out[k] = over[k]; });
    return out;
  }
  return over !== undefined ? over : base;
}

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = deepMerge(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
    } catch (e) {
      config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  } else {
    config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    saveConfig(config);
  }
  if (!config.server.jwtSecret) {
    config.server.jwtSecret = crypto.randomBytes(24).toString("hex");
    saveConfig(config);
  }
  if (process.env.PORT) config.server.port = parseInt(process.env.PORT, 10);
  if (process.env.JWT_SECRET) config.server.jwtSecret = process.env.JWT_SECRET;
  if (process.env.DIFY_BASE_URL) config.dify.baseUrl = process.env.DIFY_BASE_URL;
  if (process.env.DIFY_API_KEY) config.dify.apiKey = process.env.DIFY_API_KEY;
  if (process.env.DIFY_WORKFLOW_ID) config.dify.workflowId = process.env.DIFY_WORKFLOW_ID;
  return config;
}

function getConfig() {
  if (!config) loadConfig();
  return config;
}

function saveConfig(cfg) {
  config = cfg;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

function maskSecret(s) {
  if (!s) return "";
  if (s.length <= 8) return "****";
  return s.slice(0, 4) + "****" + s.slice(-4);
}

module.exports = { loadConfig, getConfig, saveConfig, maskSecret };
