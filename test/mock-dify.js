// 本地模拟 Dify 服务：用于端到端联调（在系统设置中把 Base URL 指向本服务即可）
// 启动：node test/mock-dify.js [端口]   （默认 3788）
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
const port = parseInt(process.argv[2], 10) || 3788;
const uploadDir = path.join(os.tmpdir(), "mock-dify-uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/v1/parameters", (req, res) => {
  res.json({
    user_input_form: [
      { file: { variable: "file", label: "文件", type: "file", required: true } },
      { card: { variable: "card", label: "知识卡内容", type: "paragraph", required: true } },
      { prompt: { variable: "prompt", label: "提示词", type: "paragraph", required: true } }
    ]
  });
});

app.post("/v1/files/upload", upload.single("file"), (req, res) => {
  res.json({ id: "mock-file-" + Date.now() });
});

app.post("/v1/workflows/run", (req, res) => {
  const inputs = req.body.inputs || {};
  const fileInput = inputs.file || {};
  const card = inputs.card || "{}";
  let cardObj = {};
  try { cardObj = JSON.parse(card); } catch (e) { /* 忽略 */ }
  const prompt = String(inputs.prompt || "");
  let output;
  if (prompt.includes("OPT_FORMAT")) {
    // 形态A：result.optimization / original / optimized / rationale
    output = JSON.stringify({
      result: {
        optimization: [
          { field: "goal", original: cardObj.goal || "", optimized: "疼痛显著缓解（NRS评分≤3分）且ST段回落≥50%，无再灌注并发症", rationale: "文献指出溶栓成功标志包括胸痛缓解、ST段回落≥50%及再灌注性心律失常（Section 4.6）" },
          { field: "measures", original: cardObj.measures || [], optimized: [{ priority: "首优", measure_name: "再灌注监护与体位管理", activities: ["①绝对卧床并抬高床头30°", "②转运途中持续心电监护"] }], rationale: "文献强调溶栓时效性与出血风险监测" }
        ],
        refs: [{ title: "2025 ACC/AHA ACS 指南", section: "§4.6", excerpt: "溶栓成功标志包括胸痛缓解、ST段回落≥50%。" }]
      }
    });
  } else if (prompt.includes("KEYMAP")) {
    // 形态D：字段键值映射（当前真实工作流返回）
    output = JSON.stringify({
      goal: { original: cardObj.goal || "", optimized: "活动耐力逐步提高，NRS疼痛评分≤3分，6分钟步行距离较前增加10%", reason: "结合2024 STEMI溶栓共识建议" },
      trigger_cond: { original: cardObj.trigger_cond || "", optimized: "活动中出现胸痛加重、呼吸困难、心率增加>20次/分、血氧<90%或新发心律失常", reason: "依据文献第5.2节心律失常管理内容" },
      measures: [{ original: "①运动评估②评估器械及设备支持③解释渐进性活动意义", optimized: "①心功能NYHA分级评估②溶栓后24h内持续心电监护③分阶段活动计划（卧床→坐位→床边站立→院内步行）", reason: "整合文献第4.1节与第6.2节要求" }]
    });
  } else if (prompt.includes("ECHO")) {
    // 回显形态：把输入卡片原样包在 result 里（工作流未执行优化的典型故障）
    output = JSON.stringify({ result: cardObj });
  } else if (prompt.includes("OLD_FORMAT")) {
    // 形态C（旧契约）：顶层 suggestions / old / new / reason / ref
    output = JSON.stringify({
      suggestions: [
        { field: "护理问题触发", old: cardObj.trigger_cond || "", new: "NRS评分≥4分、上腹痛、牙痛、心前区压榨样疼痛、伴恶心呕吐", reason: "文献新增伴随症状触发条件", ref: "2025 ACC/AHA ACS 指南 §4.2" },
        { field: "护理目标", old: cardObj.goal || "", new: "疼痛缓解，NRS 评分 ≤ 3 分，且无伴随症状加重", reason: "补充伴随症状评估要求", ref: "2025 ACC/AHA ACS 指南 §4.2" }
      ],
      refs: [
        { title: "2025 ACC/AHA ACS 指南", section: "§4.2 疼痛管理", excerpt: "对胸痛患者应采用PQRST方法系统评估疼痛特点，NRS≥4分需及时药物干预。" }
      ]
    });
  } else {
    // 形态B（当前真实工作流）：result.suggestions / field(英文键) / old / new / reason / ref
    output = JSON.stringify({
      result: {
        mode: "优化建议",
        summary: "基于最新文献优化AMI活动无耐力护理卡，补充溶栓后监测、活动安全评估及分阶段活动指导。",
        suggestions: [
          {
            field: "goal",
            old: cardObj.goal || "",
            new: "再灌注治疗后24小时内监测生命体征，活动耐量逐步提升至NYHA I-II级，无再灌注性心律失常/出血",
            reason: "文献建议四、五指出溶栓后需监测再灌注并发症，活动需评估血流动力学稳定性",
            ref: "《急性ST段抬高型心肌梗死溶栓治疗专家共识》建议四、五"
          },
          {
            field: "trigger_cond",
            old: cardObj.trigger_cond || "",
            new: "溶栓后出现再灌注性心律失常（如加速性室性自主心律）、血压波动>20%、血氧<90%或胸痛复发",
            reason: "文献第5章强调再灌注后心律失常及出血为活动禁忌，需结合溶栓后监测指标",
            ref: "《急性ST段抬高型心肌梗死溶栓治疗专家共识》第5.2.2节"
          },
          {
            field: "measures",
            old: "①运动评估②评估器械及设备支持③解释渐进性活动意义",
            new: "①溶栓后24h内持续心电监护，评估Killip心功能分级②分阶段活动：静息→床边坐起→床边活动→室内行走③活动前后监测心率/BP/SpO2，出现再灌注症状立即停止",
            reason: "文献建议三、六明确溶栓后活动需分阶段进行，结合再灌注监测及并发症预防",
            ref: "《急性ST段抬高型心肌梗死溶栓治疗专家共识》建议三、六及第5.2.2节"
          }
        ],
        refs: [
          { title: "急性ST段抬高型心肌梗死溶栓治疗专家共识", section: "建议四、五、六", excerpt: "溶栓后需监测再灌注并发症，活动需分阶段进行，结合心功能分级评估活动安全" }
        ]
      }
    });
  }
  res.json({
    workflow_run_id: "mock-run-" + Date.now(),
    task_id: "mock-task-" + Date.now(),
    data: {
      id: "mock-data-" + Date.now(),
      workflow_id: "mock-workflow",
      status: "succeeded",
      outputs: { output },
      elapsed_time: 1.2,
      total_tokens: 100,
      created_at: new Date().toISOString()
    }
  });
});

app.listen(port, "127.0.0.1", () => {
  console.log("Mock Dify 已启动: http://127.0.0.1:" + port);
});
