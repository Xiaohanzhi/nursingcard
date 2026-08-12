# Dify 工作流 JSON 契约（护理问题卡 · 迭代优化）

> 本契约与模块代码完全一致：`server.js` 的 `cardToDify()` 生成 card 入参，`normalizeResult()` 解析 output。
> 工作流输入变量：`file`（文件）、`card`（下方 JSON 字符串）、`prompt`（提示词）；输出变量：`output`（JSON 字符串）。

## 一、card 入参示例（模块发送给 Dify 的选中卡片内容）

```json
{
  "card_name": "AMI · 疼痛护理",
  "card_type": "护理问题卡",
  "disease": "AMI",
  "is_common": false,
  "question_name": "疼痛",
  "goal": "疼痛缓解，NRS 评分 ≤ 3 分",
  "trigger_cond": "NRS评分≥4分、上腹痛、牙痛、心前区压榨样疼痛",
  "measures": [
    {
      "priority": "首优",
      "measure_name": "休息与活动",
      "activities": ["①绝对卧床", "②指导避免增加腹压动作"]
    },
    {
      "priority": "次优",
      "measure_name": "非药物技巧缓解疼痛",
      "activities": ["①摆放合适体位", "②放松疗法"]
    }
  ],
  "version": "v1.0",
  "status": "已定稿"
}
```

字段说明：`priority` 枚举 首优/次优/次次优/多学科（辅助）；`is_common` true=共性 false=专病；`status` 草稿/一级审核中/二级审核中/已定稿/已废弃。

## 二、output 返回示例（真实契约，只输出需要优化的字段）

**规则：**
- 顶层为 `result.suggestions[]`（当前真实工作流返回），仅对内容字段提出优化：`goal`、`trigger_cond`、`measures`（也可含 `question_name`、`card_name`、`disease`、`is_common`）
- 每条建议固定字段：`field`（字段键名）、`old`（优化前）、`new`（优化后）、`reason`（依据说明）、`ref`（引用章节）
- **不需要优化的字段一律不出现**；若全部无需优化，返回空数组
- `measures` 的 `old`/`new` 可为措施对象数组、JSON 字符串，或纯文本（如"①…②…③…"，模块自动拆分为结构化措施）

```json
{
  "result": {
    "mode": "优化建议",
    "summary": "基于最新文献优化AMI活动无耐力护理卡，补充溶栓后监测、活动安全评估及分阶段活动指导。",
    "suggestions": [
      {
        "field": "goal",
        "old": "活动耐力提高，活动时无明显不适",
        "new": "再灌注治疗后24小时内监测生命体征，活动耐量逐步提升至NYHA I-II级，无再灌注性心律失常/出血",
        "reason": "文献建议四、五指出溶栓后需监测再灌注并发症，活动需评估血流动力学稳定性",
        "ref": "《急性ST段抬高型心肌梗死溶栓治疗专家共识》建议四、五"
      },
      {
        "field": "trigger_cond",
        "old": "心悸、头晕、气促、活动时心率明显增快或血氧下降",
        "new": "溶栓后出现再灌注性心律失常（如加速性室性自主心律）、血压波动>20%、血氧<90%或胸痛复发",
        "reason": "文献第5章强调再灌注后心律失常及出血为活动禁忌，需结合溶栓后监测指标",
        "ref": "《急性ST段抬高型心肌梗死溶栓治疗专家共识》第5.2.2节"
      },
      {
        "field": "measures",
        "old": "①运动评估②评估器械及设备支持③解释渐进性活动意义",
        "new": "①溶栓后24h内持续心电监护，评估Killip心功能分级②分阶段活动：静息→床边坐起→床边活动→室内行走③活动前后监测心率/BP/SpO2，出现再灌注症状立即停止",
        "reason": "文献建议三、六明确溶栓后活动需分阶段进行，结合再灌注监测及并发症预防",
        "ref": "《急性ST段抬高型心肌梗死溶栓治疗专家共识》建议三、六及第5.2.2节"
      }
    ],
    "refs": [
      {
        "title": "急性ST段抬高型心肌梗死溶栓治疗专家共识",
        "section": "建议四、五、六",
        "excerpt": "溶栓后需监测再灌注并发症，活动需分阶段进行，结合心功能分级评估活动安全"
      }
    ]
  }
}
```

## 三、字段映射与解析规则（模块侧）

1. 模块读取输出变量（默认 `output`），期望 JSON 字符串；带 ```json 围栏会自动剥离。
2. 识别 `result.suggestions` / `result.optimization` 即按结构化解析；`field` 键名映射为中文标签：
   - `goal` → 护理目标、`trigger_cond` → 护理问题触发、`measures` → 推荐护理措施
   - `question_name` → 护理问题名称、`card_name` → 卡片名称、`disease` → 关联病种、`is_common` → 共性/专病
   - 形态B（`result.suggestions`）：`old/new/reason/ref` 直接使用；形态A（`result.optimization`）：`original → old`、`optimized → new`、`rationale → reason`
3. 兼容旧契约 `{ suggestions: [{ field, old, new, reason, ref }] }`（field 中英文均可），三种格式统一输出为同构结构化结果。
4. 前端呈现：每条建议"🔴 优化前 / 🟢 AI 优化后 / 📖 依据"三栏；`推荐护理措施`以结构化措施卡片展示（优先级标签+措施名+活动），并提供 JSON 微调框；采纳后确认生成新草稿卡片（版本 v0.1，记录 iterateFrom），`refs` 合并到引用来源。

## 四、Dify 工作流建议配置

- 提示词要求："只输出 JSON，不要 Markdown 围栏；仅当字段有优化价值时输出对应建议，无变化字段不要输出；measures 的 original/optimized 输出为对象数组"。
- LLM 节点输出变量 `output` 接 LLM 结果；若输出不稳定，可加"参数提取/代码节点"强制 JSON 化。
- 入参 `card` 定义为 paragraph 类型，LLM 节点直接引用 `{{#card#}}`。
