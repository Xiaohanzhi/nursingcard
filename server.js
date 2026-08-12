const express = require("express");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { randomUUID } = require("crypto");

const configLib = require("./config");
const dbLib = require("./db");
const dify = require("./dify");
const { FIELD_LABEL_MAP, normalizeResult } = require("./normalize");

const app = express();
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = dbLib.UPLOAD_DIR;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const cfg = () => configLib.getConfig();
const db = () => dbLib.getDb();

/* ============ 鉴权 ============ */
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, displayName: user.displayName },
    cfg().server.jwtSecret,
    { expiresIn: "24h" }
  );
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({ error: "未登录" });
  try {
    req.user = jwt.verify(h.slice(7), cfg().server.jwtSecret);
    next();
  } catch (e) {
    return res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "无权限执行该操作" });
    next();
  };
}

function userName(userId) {
  const u = db().users.find(x => x.id === userId);
  return u ? u.displayName : (userId || "");
}

/* ============ 认证接口 ============ */
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "用户名和密码不能为空" });
  const user = db().users.find(x => x.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
});

app.get("/api/auth/me", auth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, displayName: req.user.displayName, role: req.user.role });
});

app.put("/api/auth/password", auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: "参数不完整" });
  if (String(newPassword).length < 6) return res.status(400).json({ error: "新密码至少 6 位" });
  const user = db().users.find(x => x.id === req.user.id);
  if (!user || !bcrypt.compareSync(oldPassword, user.passwordHash)) {
    return res.status(400).json({ error: "原密码错误" });
  }
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  dbLib.saveDb();
  res.json({ success: true });
});

app.post("/api/auth/sso", (req, res) => {
  if (!cfg().server.ssoEnabled) return res.status(501).json({ error: "SSO 未启用，请使用内置账号登录" });
  return res.status(400).json({ error: "SSO 对接待实现：请配置外部身份校验接口" });
});

/* ============ 卡片接口 ============ */
function cardPublic(c) {
  return {
    ...c,
    creatorName: userName(c.createdBy),
    updaterName: userName(c.updatedBy)
  };
}

app.get("/api/cards", auth, (req, res) => {
  const { status, keyword, isCommon } = req.query;
  let list = db().cards;
  if (status) list = list.filter(c => c.status === status);
  if (isCommon !== undefined && isCommon !== "") list = list.filter(c => String(c.isCommon) === isCommon);
  if (keyword) {
    const kw = String(keyword).toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(kw) || c.questionName.toLowerCase().includes(kw));
  }
  list = list.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json(list.map(cardPublic));
});

app.post("/api/cards", auth, requireRole("engineer", "admin"), (req, res) => {
  const { name, disease, isCommon, questionName, goal, triggerCond, measures, refs } = req.body || {};
  if (!name || !questionName) return res.status(400).json({ error: "卡片名称和护理问题名称为必填" });
  const card = {
    id: dbLib.nextId("kc"),
    name, type: "护理问题卡", disease: disease || "AMI", isCommon: !!isCommon,
    version: "v0.1", status: "draft", scene: "待编辑",
    questionName, goal: goal || "", triggerCond: triggerCond || "",
    measures: Array.isArray(measures) ? measures : [],
    refs: Array.isArray(refs) ? normalizeRefs(refs) : [], aiGenerated: false, aiSource: "", iterateFrom: "",
    rejectReason: "", createdBy: req.user.id, updatedBy: req.user.id,
    createdAt: dbLib.now(), updatedAt: dbLib.now()
  };
  db().cards.unshift(card);
  dbLib.saveDb();
  res.json({ id: card.id, status: "draft", version: "v0.1" });
});

app.get("/api/cards/:id", auth, (req, res) => {
  const c = db().cards.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "卡片不存在" });
  res.json(cardPublic(c));
});

app.put("/api/cards/:id", auth, requireRole("engineer", "admin"), (req, res) => {
  const c = db().cards.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "卡片不存在" });
  if (c.status !== "draft") return res.status(400).json({ error: "仅草稿状态可编辑" });
  const { name, disease, isCommon, questionName, goal, triggerCond, measures, refs } = req.body || {};
  if (name) c.name = name;
  if (disease !== undefined) c.disease = disease;
  if (isCommon !== undefined) c.isCommon = !!isCommon;
  if (questionName !== undefined) c.questionName = questionName;
  if (goal !== undefined) c.goal = goal;
  if (triggerCond !== undefined) c.triggerCond = triggerCond;
  if (measures !== undefined) c.measures = Array.isArray(measures) ? measures : c.measures;
  if (refs !== undefined) c.refs = Array.isArray(refs) ? normalizeRefs(refs) : c.refs;
  c.updatedBy = req.user.id;
  c.updatedAt = dbLib.now();
  dbLib.saveDb();
  res.json({ success: true, id: c.id });
});

app.post("/api/cards/:id/new-version", auth, requireRole("engineer", "admin"), (req, res) => {
  const src = db().cards.find(x => x.id === req.params.id);
  if (!src) return res.status(404).json({ error: "卡片不存在" });
  if (src.status !== "published") return res.status(400).json({ error: "仅已定稿卡片可新建版本" });
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = dbLib.nextId("kc");
  copy.version = bumpMinor(src.version);
  copy.status = "draft";
  copy.aiGenerated = false;
  copy.iterateFrom = src.id;
  copy.rejectReason = "";
  copy.createdBy = req.user.id;
  copy.updatedBy = req.user.id;
  copy.createdAt = dbLib.now();
  copy.updatedAt = dbLib.now();
  db().cards.unshift(copy);
  dbLib.saveDb();
  res.json({ id: copy.id, status: "draft", version: copy.version });
});

app.post("/api/cards/:id/submit-review", auth, requireRole("engineer", "admin"), (req, res) => {
  const c = db().cards.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "卡片不存在" });
  if (c.status !== "draft") return res.status(400).json({ error: "仅草稿状态可提交审核" });
  c.status = "review1";
  c.updatedBy = req.user.id;
  c.updatedAt = dbLib.now();
  dbLib.saveDb();
  res.json({ status: "review1" });
});

app.post("/api/cards/:id/review", auth, (req, res) => {
  const { level, action, comment } = req.body || {};
  const lv = parseInt(level, 10);
  if (![1, 2].includes(lv) || !["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "无效审核参数" });
  }
  if (lv === 1 && !["reviewer1", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "仅一审审核员可操作一级审核" });
  }
  if (lv === 2 && !["reviewer2", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "仅二审审核员可操作二级审核" });
  }
  const c = db().cards.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "卡片不存在" });
  if ((lv === 1 && c.status !== "review1") || (lv === 2 && c.status !== "review2")) {
    return res.status(400).json({ error: "卡片当前状态不可审核" });
  }
  if (action === "approve") {
    if (lv === 1) {
      c.status = "review2";
  } else {
      c.status = "published";
      c.version = c.version === "v0.1" ? "v1.0" : c.version;
      c.rejectReason = "";
    }
  } else {
    c.status = "draft";
    c.rejectReason = (comment && comment.trim()) ? comment.trim() : "退回修改";
  }
  c.updatedBy = req.user.id;
  c.updatedAt = dbLib.now();
  dbLib.saveDb();
  res.json({ status: c.status, version: c.version });
});

app.get("/api/review/pending", auth, (req, res) => {
  const lv = parseInt(req.query.level, 10);
  if (![1, 2].includes(lv)) return res.status(400).json({ error: "无效级别" });
  const status = lv === 1 ? "review1" : "review2";
  const list = db().cards.filter(c => c.status === status).slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json(list.map(cardPublic));
});

app.get("/api/review/history", auth, (req, res) => {
  const list = db().cards.filter(c => c.status === "published").slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json(list.map(cardPublic));
});

/* ============ 文件上传 ============ */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, randomUUID() + ext);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!cfg().files.allowedExtensions.includes(ext)) {
      return cb(new Error("不支持的文件类型：" + ext + "（允许 " + cfg().files.allowedExtensions.join(" / ") + "）"));
    }
    cb(null, true);
  }
});

app.post("/api/files/upload", auth, requireRole("engineer", "admin"), (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "文件上传失败" });
    if (!req.file) return res.status(400).json({ error: "未收到文件" });
    const name = decodeUploadName(req.file.originalname);
    const maxBytes = cfg().files.maxSizeMb * 1024 * 1024;
    if (req.file.size > maxBytes) {
      try { require("fs").unlinkSync(req.file.path); } catch (e) { /* 忽略 */ }
      return res.status(400).json({ error: "文件超过大小限制（" + cfg().files.maxSizeMb + "MB）" });
    }
    const file = {
      id: path.basename(req.file.filename, path.extname(req.file.filename)),
      name,
      ext: path.extname(name).toLowerCase(),
      size: req.file.size,
      path: req.file.path,
      uploadedBy: req.user.id,
      uploadedAt: dbLib.now()
    };
    db().uploadedFiles.unshift(file);
    dbLib.saveDb();
    res.json({ fileId: file.id, fileName: file.name, ext: file.ext, size: file.size });
  });
});

app.delete("/api/files/:id", auth, (req, res) => {
  const idx = db().uploadedFiles.findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "文件不存在" });
  const file = db().uploadedFiles[idx];
  db().uploadedFiles.splice(idx, 1);
  dbLib.saveDb();
  try { require("fs").unlinkSync(file.path); } catch (e) { /* 文件可能已被清理 */ }
  res.json({ success: true });
});

/* ============ AI 抽取 ============ */
const DEFAULT_PROMPT = "请基于当前文献优化现有护理问题卡内容。";

const CARD_STATUS_LABEL = { draft: "草稿", review1: "一级审核中", review2: "二级审核中", published: "已定稿", deprecated: "已废弃" };

function cardToDify(c) {
  return {
    card_name: c.name,
    card_type: "护理问题卡",
    disease: c.disease,
    is_common: c.isCommon,
    question_name: c.questionName,
    goal: c.goal,
    trigger_cond: c.triggerCond,
    measures: (c.measures || []).map(m => ({
      priority: m.priority,
      measure_name: m.name,
      activities: m.activities || []
    })),
    version: c.version,
    status: CARD_STATUS_LABEL[c.status] || c.status
  };
}

async function runExtractTask(taskId) {
  const task = db().extractTasks.find(t => t.id === taskId);
  if (!task) return;
  task.status = "running";
  dbLib.saveDb();
  try {
    const c = cfg();
    if (!c.dify.baseUrl || !c.dify.apiKey || !c.dify.workflowId) {
      throw new Error("请先在系统设置中配置 Dify 工作流（Base URL / API Key / Workflow ID）");
    }
    const file = db().uploadedFiles.find(f => f.id === task.fileId);
    if (!file || !require("fs").existsSync(file.path)) throw new Error("上传文件已失效，请重新上传");
    const card = db().cards.find(x => x.id === task.cardId);
    if (!card) throw new Error("目标卡片不存在");

    const uploadFileId = await dify.uploadFile(c.dify, file.path, file.name);
    const inputs = {};
    inputs[c.dify.inputNames.file] = { type: "document", transfer_method: "local_file", upload_file_id: uploadFileId };
    inputs[c.dify.inputNames.card] = JSON.stringify(cardToDify(card));
    inputs[c.dify.inputNames.prompt] = task.prompt || DEFAULT_PROMPT;

    const outputs = await dify.runWorkflow(c.dify, inputs);
    const raw = outputs && c.dify.outputVar && outputs[c.dify.outputVar] !== undefined
      ? outputs[c.dify.outputVar]
      : JSON.stringify(outputs || {});
    task.resultRaw = typeof raw === "string" ? raw : JSON.stringify(raw);
    task.result = normalizeResult(raw);
    task.status = "completed";
  } catch (e) {
    task.status = "failed";
    task.error = (e && e.message) ? e.message : String(e);
  }
  task.completedAt = dbLib.now();
  dbLib.saveDb();
}

app.post("/api/extract", auth, requireRole("engineer", "admin"), (req, res) => {
  const { fileId, cardId, prompt } = req.body || {};
  if (!fileId) return res.status(400).json({ error: "请先上传文献文件" });
  if (!cardId) return res.status(400).json({ error: "请选择要迭代的目标卡片" });
  const file = db().uploadedFiles.find(f => f.id === fileId);
  if (!file) return res.status(400).json({ error: "上传文件不存在或已失效" });
  const card = db().cards.find(x => x.id === cardId);
  if (!card) return res.status(400).json({ error: "目标卡片不存在" });
  const task = {
    id: dbLib.nextId("ext"),
    fileId, cardId, fileName: file.name, cardName: card.name,
    prompt: (prompt && prompt.trim()) ? prompt.trim() : DEFAULT_PROMPT,
    status: "pending", result: null, resultRaw: "", error: "",
    createdBy: req.user.id, createdAt: dbLib.now(), completedAt: ""
  };
  db().extractTasks.unshift(task);
  dbLib.saveDb();
  res.json({ id: task.id, status: "pending" });
  setImmediate(() => runExtractTask(task.id));
});

app.get("/api/extract/history", auth, (req, res) => {
  const list = db().extractTasks.slice(0, 50).map(t => ({
    id: t.id, fileName: t.fileName, cardName: t.cardName, status: t.status,
    error: t.error, createdAt: t.createdAt, completedAt: t.completedAt
  }));
  res.json(list);
});

app.get("/api/extract/:id", auth, (req, res) => {
  const task = db().extractTasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  res.json(task);
});

function applyField(card, field, value) {
  const v = (value === undefined || value === null) ? "" : value;
  const label = FIELD_LABEL_MAP[String(field || "").trim()] || String(field || "").trim();
  switch (label) {
    case "卡片名称": card.name = String(v); break;
    case "护理问题名称": card.questionName = String(v); break;
    case "护理目标": card.goal = String(v); break;
    case "护理问题触发": card.triggerCond = String(v); break;
    case "关联病种": card.disease = String(v); break;
    case "共性/专病": card.isCommon = (v === "true" || v === true); break;
    case "推荐护理措施":
      if (typeof v === "string") {
        const s = String(v).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
        if (s.startsWith("[")) {
          try {
            const parsed = JSON.parse(s);
            card.measures = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.measures) ? parsed.measures : card.measures);
          } catch (e) { /* 忽略无法解析的措施 */ }
        } else if (s) {
          // 纯文本措施（如 "①…②…③…"）→ 拆分为单条措施
          const parts = s.split(/[①②③④⑤⑥⑦⑧⑨⑩]/).map(x => x.trim()).filter(Boolean);
          card.measures = [{ priority: "首优", measure_name: "AI 优化措施", activities: parts.length ? parts : [s] }];
        }
      }
      else if (Array.isArray(v)) card.measures = v;
      break;
    default: break;
  }
}

function normalizeRefs(refs) {
  return (refs || []).map(r => ({
    title: String(r.title || "").trim(),
    section: String(r.section || "").trim(),
    excerpt: String(r.excerpt || "").trim()
  })).filter(r => r.title);
}

function mergeRefs() {
  const seen = new Set();
  const out = [];
  Array.from(arguments).forEach(arr => {
    (arr || []).forEach(r => {
      if (!r || !r.title) return;
      const key = (r.title || "") + "|" + (r.section || "");
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ title: r.title, section: r.section || "", excerpt: r.excerpt || "" });
    });
  });
  return out;
}

app.post("/api/extract/:id/confirm", auth, requireRole("engineer", "admin"), (req, res) => {
  const task = db().extractTasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  if (task.status !== "completed") return res.status(400).json({ error: "任务尚未完成" });
  const target = db().cards.find(x => x.id === task.cardId);
  if (!target) return res.status(400).json({ error: "目标卡片不存在" });
  const base = JSON.parse(JSON.stringify(target));
  const accepted = Array.isArray(req.body.accepted) ? req.body.accepted : [];
  const fileName = task.fileName || "";
  const uploadRef = fileName ? { title: fileName, section: "上传文献", excerpt: "" } : null;

  if (task.result && task.result.structured) {
    accepted.forEach(a => applyField(base, a.field, a.new));
    const aiRefs = (task.result.refs || []).map(r => ({ title: r.title || "AI 抽取", section: r.section || "", excerpt: r.excerpt || "" }));
    base.refs = mergeRefs(base.refs, uploadRef ? [uploadRef] : [], aiRefs);
  } else {
    base.refs = mergeRefs(base.refs, [{
      title: fileName || "AI 抽取原文",
      section: "上传文献",
      excerpt: String(task.resultRaw || "").slice(0, 500)
    }]);
  }

  base.id = dbLib.nextId("kc");
  base.version = bumpMinor(target.version);
  base.status = "draft";
  base.aiGenerated = true;
  base.aiSource = task.fileName || "AI 抽取";
  base.iterateFrom = target.id;
  base.rejectReason = "";
  base.createdBy = req.user.id;
  base.updatedBy = req.user.id;
  base.createdAt = dbLib.now();
  base.updatedAt = dbLib.now();
  db().cards.unshift(base);
  dbLib.saveDb();
  res.json({ id: base.id, status: "draft", version: base.version, name: base.name });
});

/* ============ 系统设置 ============ */
function sanitizeSettingsForClient() {
  const c = cfg();
  return {
    server: { port: c.server.port, ssoEnabled: c.server.ssoEnabled },
    dify: {
      baseUrl: c.dify.baseUrl,
      apiKeyMasked: configLib.maskSecret(c.dify.apiKey),
      hasApiKey: !!c.dify.apiKey,
      workflowId: c.dify.workflowId,
      timeoutMs: c.dify.timeoutMs,
      inputNames: { ...c.dify.inputNames },
      outputVar: c.dify.outputVar
    },
    files: { ...c.files }
  };
}

app.get("/api/settings", auth, requireRole("admin"), (req, res) => {
  res.json(sanitizeSettingsForClient());
});

app.put("/api/settings", auth, requireRole("admin"), (req, res) => {
  const c = cfg();
  const body = req.body || {};
  if (body.dify) {
    const d = body.dify;
    if (d.baseUrl !== undefined) c.dify.baseUrl = String(d.baseUrl).trim();
    if (d.apiKey !== undefined && String(d.apiKey).trim() && !String(d.apiKey).includes("****")) {
      c.dify.apiKey = String(d.apiKey).trim();
    }
    if (d.workflowId !== undefined) c.dify.workflowId = String(d.workflowId).trim();
    if (d.timeoutMs !== undefined) c.dify.timeoutMs = Math.max(10000, parseInt(d.timeoutMs, 10) || 120000);
    if (d.inputNames) {
      if (d.inputNames.file) c.dify.inputNames.file = d.inputNames.file;
      if (d.inputNames.card) c.dify.inputNames.card = d.inputNames.card;
      if (d.inputNames.prompt) c.dify.inputNames.prompt = d.inputNames.prompt;
    }
    if (d.outputVar) c.dify.outputVar = d.outputVar;
  }
  if (body.files) {
    const f = body.files;
    if (f.maxSizeMb) c.files.maxSizeMb = Math.max(1, parseInt(f.maxSizeMb, 10) || 20);
    if (Array.isArray(f.allowedExtensions) && f.allowedExtensions.length) {
      c.files.allowedExtensions = f.allowedExtensions.map(x => String(x).toLowerCase()).filter(x => x.startsWith("."));
    }
    if (f.ttlHours) c.files.ttlHours = Math.max(1, parseInt(f.ttlHours, 10) || 24);
  }
  configLib.saveConfig(c);
  const portChanged = body.server && body.server.port && parseInt(body.server.port, 10) !== c.server.port;
  res.json({ success: true, portChanged, ...sanitizeSettingsForClient() });
});

app.post("/api/settings/test-dify", auth, requireRole("admin"), async (req, res) => {
  const c = cfg();
  if (!c.dify.baseUrl || !c.dify.apiKey) {
    return res.status(400).json({ error: "请先填写 Base URL / API Key 并保存" });
  }
  try {
    const params = await dify.getParameters(c.dify);
    const vars = (params.user_input_form || []).map(f => {
      const k = Object.keys(f)[0];
      return { variable: f[k].variable, label: f[k].label, type: f[k].type, required: f[k].required !== false };
    });
    res.json({
      success: true,
      message: "Dify 连接成功，工作流入参：" + (vars.length ? vars.map(v => v.variable + "(" + v.type + ")").join("、") : "无"),
      inputs: vars
    });
  } catch (e) {
    const detail = (e && e.response && e.response.data && (e.response.data.message || JSON.stringify(e.response.data))) || (e && e.message) || String(e);
    res.status(502).json({ error: "Dify 连接失败：" + detail });
  }
});

/* ============ 静态资源与启动 ============ */
app.use(express.static(PUBLIC_DIR));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API not found" });
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

function bumpMinor(v) {
  const m = String(v || "").match(/v(\d+)\.(\d+)/);
  return m ? "v" + m[1] + "." + (parseInt(m[2], 10) + 1) : "v0.1";
}

function cleanupOldFiles() {
  const c = cfg();
  const ttlMs = c.files.ttlHours * 3600 * 1000;
  const cutoff = Date.now() - ttlMs;
  const fs = require("fs");
  const before = db().uploadedFiles.length;
  db().uploadedFiles = db().uploadedFiles.filter(f => {
    const t = new Date(String(f.uploadedAt).replace(" ", "T")).getTime();
    if (!t || t < cutoff) {
      try { fs.unlinkSync(f.path); } catch (e) { /* 忽略 */ }
      return false;
    }
    return true;
  });
  if (db().uploadedFiles.length !== before) dbLib.saveDb();
}

function decodeUploadName(name) {
  if (!name) return name;
  // 已含中日韩字符说明解码正常，直接返回
  if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(name)) return name;
  try {
    // busboy 按 latin1 解码 UTF-8 字节导致乱码，尝试还原
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    if (!decoded.includes("\uFFFD") && decoded !== name) return decoded;
  } catch (e) { /* 忽略 */ }
  return name;
}

configLib.loadConfig();
dbLib.initDb();
cleanupOldFiles();
setInterval(cleanupOldFiles, 60 * 60 * 1000);

const port = cfg().server.port;
app.listen(port, "0.0.0.0", () => {
  console.log("专科知识卡平台模块已启动: http://localhost:" + port);
  console.log("配置文件: " + path.join(__dirname, "config.json"));
});
