// normalizeResult 单元测试：覆盖真实工作中遇到的全部返回形态
const { normalizeResult } = require("../normalize");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("PASS | " + name); }
  else { fail++; console.log("FAIL | " + name + (detail ? " | " + detail : "")); }
}

// 形态B：result.suggestions（英文键）
const formB = JSON.stringify({
  result: {
    mode: "优化建议", summary: "测试",
    suggestions: [
      { field: "goal", old: "旧目标", new: "新目标", reason: "依据", ref: "文献§1" },
      { field: "trigger_cond", old: "旧触发", new: "新触发", reason: "依据2" },
      { field: "measures", old: "①旧措施", new: "①新措施②新措施2", reason: "依据3", ref: "文献§2" }
    ],
    refs: [{ title: "共识", section: "§1", excerpt: "摘录" }]
  }
});
let r = normalizeResult(formB);
check("形态B 结构化", r.structured === true);
check("形态B 字段映射", r.suggestions.map(s => s.field).join(",") === "护理目标,护理问题触发,推荐护理措施");
check("形态B 值正确", r.suggestions[0].old === "旧目标" && r.suggestions[0].new === "新目标" && r.suggestions[0].reason === "依据" && r.suggestions[0].ref === "文献§1");

// 形态A：result.optimization
const formA = JSON.stringify({
  result: {
    optimization: [
      { field: "goal", original: "旧", optimized: "新", rationale: "理据" },
      { field: "measures", original: [{ priority: "首优", measure_name: "A", activities: ["1"] }], optimized: [{ priority: "次优", measure_name: "B", activities: ["2"] }], rationale: "理据2" }
    ]
  }
});
r = normalizeResult(formA);
check("形态A 结构化", r.structured === true && r.suggestions.length === 2);
check("形态A 字段映射", r.suggestions[0].field === "护理目标" && r.suggestions[1].field === "推荐护理措施");
check("形态A 数组值保留", Array.isArray(r.suggestions[1].old) && r.suggestions[1].old[0].measure_name === "A");

// 形态C：顶层 suggestions（中文键）
const formC = JSON.stringify({
  suggestions: [{ field: "护理目标", old: "旧", new: "新", reason: "依据", ref: "文献" }],
  refs: []
});
r = normalizeResult(formC);
check("形态C 结构化", r.structured === true && r.suggestions.length === 1 && r.suggestions[0].field === "护理目标");

// 形态D：字段键值映射（当前真实工作流返回）
const formD = JSON.stringify({
  goal: { original: "活动耐力提高，活动时无明显不适", optimized: "活动耐力逐步提高，NRS疼痛评分≤3分，6分钟步行距离较前增加10%", reason: "结合2024 STEMI溶栓共识建议" },
  trigger_cond: { original: "心悸、头晕、气促", optimized: "活动中出现胸痛加重、呼吸困难、心率增加>20次/分", reason: "依据文献第5.2节" },
  measures: [{ original: "①运动评估②评估器械及设备支持", optimized: "①心功能NYHA分级评估②溶栓后24h内持续心电监护③分阶段活动计划", reason: "整合文献第4.1节与第6.2节要求" }]
});
r = normalizeResult(formD);
check("形态D 结构化", r.structured === true && r.suggestions.length === 3);
check("形态D 字段映射", r.suggestions.map(s => s.field).join(",") === "护理目标,护理问题触发,推荐护理措施");
check("形态D 值正确", r.suggestions[0].new.includes("6分钟步行距离") && r.suggestions[2].new.includes("分阶段活动") && r.suggestions[2].old.includes("运动评估"));

// Qwen 思考块包裹（本次真实输出）
const thinkWrapped = "<think>\nThinking Process:\n1. Analyze the request...\n2. Plan the JSON output...\n</think>\n" + formD;
r = normalizeResult(thinkWrapped);
check("思考块剥离后结构化", r.structured === true && r.suggestions.length === 3);

// 思考块 + 围栏 + 前后杂文
const messy = "好的，我来分析。\n```json\n" + formB + "\n```\n以上是结果。";
r = normalizeResult(messy);
check("围栏/杂文剥离后结构化", r.structured === true && r.suggestions.length === 3);

// 回显卡片 → 非结构化 + 诊断
const echo = JSON.stringify({ result: { card_name: "AMI · 疼痛护理", measures: [{ priority: "首优", measure_name: "A", activities: ["1"] }] } });
r = normalizeResult(echo);
check("回显判定非结构化", r.structured === false && r.echoHint === true);

// John Doe 占位 → 非结构化
const jd = JSON.stringify({ result: { name: "John Doe", age: 30 } });
r = normalizeResult(jd);
check("占位 JSON 判定非结构化", r.structured === false && r.jsonDetected === true);

// 纯文本 → 非结构化
r = normalizeResult("这是一段普通文本");
check("纯文本判定非结构化", r.structured === false && r.jsonDetected === false);

console.log("---");
console.log(fail ? "FAILED: " + fail : "ALL PASS (" + pass + ")");
process.exit(fail ? 1 : 0);
