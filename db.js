const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const UPLOAD_DIR = path.join(__dirname, "uploads", "tmp");
const LITERATURE_DIR = path.join(__dirname, "uploads", "literature");

let state = null;

function nextId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function now() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function seed() {
  const mkUser = (id, username, password, displayName, role) => ({
    id, username, passwordHash: bcrypt.hashSync(password, 10), displayName, role, createdAt: now()
  });
  const users = [
    mkUser("u1", "admin", "admin123", "平台管理员", "admin"),
    mkUser("u2", "zhang", "123456", "张工程师", "engineer"),
    mkUser("u3", "li", "123456", "李护士长", "reviewer1"),
    mkUser("u4", "wang", "123456", "王主任", "reviewer2")
  ];

  const cards = [
    {
      id: "card1", name: "AMI · 疼痛护理", type: "护理问题卡", disease: "AMI", isCommon: false,
      version: "v1.0", status: "published", scene: "入院、CCU监护期",
      questionName: "疼痛", goal: "疼痛缓解，NRS 评分 ≤ 3 分",
      triggerCond: "NRS评分≥4分、上腹痛、牙痛、心前区压榨样疼痛",
      measures: [
        { priority: "首优", name: "休息与活动", activities: ["①绝对卧床", "②指导避免增加腹压动作"] },
        { priority: "次优", name: "非药物技巧缓解疼痛", activities: ["①摆放合适体位", "②放松疗法"] },
        { priority: "次次优", name: "用药护理-镇痛药、扩血管药", activities: ["①遵医嘱扩血管", "②遵医嘱镇痛", "③监测生命体征"] },
        { priority: "多学科（辅助）", name: "多学科疼痛管理", activities: ["报告医生，必要时疼痛科会诊"] }
      ],
      refs: [],
      aiGenerated: false, aiSource: "", iterateFrom: "",
      rejectReason: "", createdBy: "u2", updatedBy: "u3",
      createdAt: "2026-06-10 09:30", updatedAt: "2026-06-10 09:30"
    },
    {
      id: "card2", name: "AMI · 活动无耐力护理", type: "护理问题卡", disease: "AMI", isCommon: false,
      version: "v1.0", status: "published", scene: "CCU监护期、恢复期",
      questionName: "活动无耐力", goal: "活动耐力提高，活动时无明显不适",
      triggerCond: "心悸、头晕、气促、活动时心率明显增快或血氧下降",
      measures: [
        { priority: "首优", name: "运动疗法", activities: ["①运动评估", "②评估器械及设备支持", "③解释渐进性活动意义"] }
      ],
      refs: [],
      aiGenerated: false, aiSource: "", iterateFrom: "",
      rejectReason: "", createdBy: "u2", updatedBy: "u3",
      createdAt: "2026-06-08 14:20", updatedAt: "2026-06-08 14:20"
    },
    {
      id: "card3", name: "AMI · 心衰呼吸功能护理", type: "护理问题卡", disease: "AMI", isCommon: false,
      version: "v1.0", status: "published", scene: "CCU监护期",
      questionName: "心衰：呼吸功能", goal: "呼吸困难缓解，SpO₂ ≥ 95%",
      triggerCond: "呼吸困难、呼吸频率>24次/分、SpO₂<90%、口唇发绀",
      measures: [
        { priority: "首优", name: "评估实施目标氧疗管理", activities: ["①按目标氧饱和度和血气调整氧流量", "②设定目标氧饱和度"] },
        { priority: "次优", name: "呼吸监测", activities: ["①监测生命体征", "②血气分析"] },
        { priority: "次次优", name: "病因治疗及诱因消除", activities: ["①消除病因", "②病因治疗"] },
        { priority: "多学科（辅助）", name: "辅助呼吸功能锻炼", activities: ["咳嗽/深呼吸/缩唇呼吸/呼吸训练器"] }
      ],
      refs: [],
      aiGenerated: false, aiSource: "", iterateFrom: "",
      rejectReason: "", createdBy: "u2", updatedBy: "u2",
      createdAt: "2026-06-16 14:30", updatedAt: "2026-06-16 14:30"
    },
    {
      id: "card4", name: "AMI · 猝死风险防范", type: "护理问题卡", disease: "AMI", isCommon: false,
      version: "v1.0", status: "published", scene: "CCU监护期",
      questionName: "潜在并发症猝死", goal: "及早识别猝死先兆，预防猝死发生",
      triggerCond: "晕厥、频发室性早搏、短阵室速、心前区剧痛",
      measures: [
        { priority: "首优", name: "猝死的预防和抢救", activities: ["①备好急救用品", "②减少诱因"] },
        { priority: "次优", name: "病情监测", activities: ["①监测生命体征", "②评估猝死先兆", "③监测意识状态"] }
      ],
      refs: [],
      aiGenerated: false, aiSource: "", iterateFrom: "",
      rejectReason: "", createdBy: "u2", updatedBy: "u3",
      createdAt: "2026-06-14 09:00", updatedAt: "2026-06-14 09:00"
    },
    {
      id: "card5", name: "AMI · 恶心呕吐护理", type: "护理问题卡", disease: "AMI", isCommon: false,
      version: "v1.0", status: "published", scene: "入院、用药期间",
      questionName: "恶心呕吐", goal: "恶心呕吐缓解，维持水电解质平衡",
      triggerCond: "恶心、上腹部不适、呕吐",
      measures: [
        { priority: "首优", name: "恶心呕吐管理", activities: ["①保持呼吸道通畅", "②指导合适体位"] },
        { priority: "次优", name: "营养管理", activities: ["①指导饮食并记录"] },
        { priority: "次次优", name: "水电解质管理", activities: ["①监测电解质", "②监测生命体征", "③监测出量"] }
      ],
      refs: [],
      aiGenerated: false, aiSource: "", iterateFrom: "",
      rejectReason: "", createdBy: "u2", updatedBy: "u2",
      createdAt: "2026-06-15 11:00", updatedAt: "2026-06-15 11:00"
    },
    {
      id: "card6", name: "AMI · 发热护理", type: "护理问题卡", disease: "AMI", isCommon: false,
      version: "v1.0", status: "published", scene: "住院期间",
      questionName: "体温高", goal: "体温降至正常（≤ 37.3℃）",
      triggerCond: "体温>37.3℃",
      measures: [
        { priority: "首优", name: "降温措施", activities: ["①1类物理降温", "②2类物理降温"] },
        { priority: "次优", name: "监测发热情况", activities: ["①选合适测温方式", "②复测体温"] },
        { priority: "次次优", name: "监测感染指标", activities: ["①血常规", "②血红蛋白"] }
      ],
      refs: [],
      aiGenerated: false, aiSource: "", iterateFrom: "",
      rejectReason: "", createdBy: "u2", updatedBy: "u2",
      createdAt: "2026-08-06 17:00", updatedAt: "2026-08-06 17:00"
    },
    {
      id: "card7", name: "AMI · 心输出量减少护理", type: "护理问题卡", disease: "AMI", isCommon: false,
      version: "v1.0", status: "published", scene: "CCU监护期",
      questionName: "心输出量减少的护理", goal: "维持有效心输出量，血流动力学稳定",
      triggerCond: "HR>100bpm 或 Killip≥II级 或 BP<90/60mmHg",
      measures: [
        { priority: "首优", name: "紧急处理", activities: ["①立即通知医生", "②监测生命体征Q15min", "③确保静脉通路", "④评估出入量", "⑤检查颈静脉充盈"] },
        { priority: "首优", name: "床旁监护与体位", activities: ["①心电监护", "②记录出入量", "③抬高床头30°"] },
        { priority: "次优", name: "活动饮食管理", activities: ["①活动休息安排", "②低盐低脂", "③每日体重"] }
      ],
      refs: [],
      aiGenerated: false, aiSource: "", iterateFrom: "",
      rejectReason: "", createdBy: "u2", updatedBy: "u3",
      createdAt: "2026-06-08 14:20", updatedAt: "2026-06-08 14:20"
    }
  ];

  return { version: 2, users, cards, extractTasks: [], uploadedFiles: [], literature: [] };
}

function initDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(LITERATURE_DIR)) fs.mkdirSync(LITERATURE_DIR, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    try { state = JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
    catch (e) { state = seed(); }
    if (!state.users) state.users = [];
    if (!state.cards) state.cards = [];
    if (!state.extractTasks) state.extractTasks = [];
    if (!state.uploadedFiles) state.uploadedFiles = [];
    if (!state.literature) state.literature = [];
    if (state.version !== 2) state.version = 2;
  } else {
    state = seed();
  }
  saveDb();
  return state;
}

function getDb() {
  if (!state) initDb();
  return state;
}

function saveDb() {
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, DB_PATH);
}

module.exports = { initDb, getDb, saveDb, nextId, now, UPLOAD_DIR, LITERATURE_DIR };
