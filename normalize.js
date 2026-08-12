// Dify 输出归一化：支持多种真实返回形态 + 思考块/围栏剥离
const FIELD_LABEL_MAP = {
  card_name: "卡片名称",
  question_name: "护理问题名称",
  goal: "护理目标",
  trigger_cond: "护理问题触发",
  measures: "推荐护理措施",
  disease: "关联病种",
  is_common: "共性/专病"
};

function parseJsonLoose(raw) {
  let obj = null;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    let s = raw.trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();
    try {
      obj = JSON.parse(s);
    } catch (e) {
      const m = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (m) { try { obj = JSON.parse(m[0]); } catch (e2) { obj = null; } }
    }
  }
  return obj;
}

function mapField(f) {
  return FIELD_LABEL_MAP[String(f || "").trim()] || String(f || "").trim();
}

function normalizeResult(raw) {
  const obj = parseJsonLoose(raw);

  let suggestions = [];
  let card = null;
  let refs = [];
  let structured = false;
  let jsonDetected = false;
  let echoHint = false;

  // 形态A：{ result: { optimization: [{ field, original, optimized, rationale, ref? }] } }
  const optList = obj && obj.result && Array.isArray(obj.result.optimization) ? obj.result.optimization : null;
  if (optList) {
    structured = true;
    suggestions = optList.map(it => {
      if (!it || typeof it !== "object") return null;
      return { field: mapField(it.field), old: it.original, new: it.optimized, reason: it.rationale || "", ref: it.ref || "" };
    }).filter(Boolean);
    if (obj.result.refs) refs = obj.result.refs;
    if (!Array.isArray(refs)) refs = [];
  }

  // 形态B：{ result: { suggestions: [{ field, old, new, reason, ref }] } }
  const resSug = obj && obj.result && Array.isArray(obj.result.suggestions) ? obj.result.suggestions : null;
  if (!structured && resSug) {
    structured = true;
    suggestions = resSug.map(it => {
      if (!it || typeof it !== "object") return null;
      return { field: mapField(it.field), old: it.old, new: it.new, reason: it.reason || it.rationale || "", ref: it.ref || "" };
    }).filter(Boolean);
    if (obj.result.refs) refs = obj.result.refs;
    if (!Array.isArray(refs)) refs = [];
  }

  // 形态C：顶层 { suggestions: [...] }
  if (!structured && obj && (Array.isArray(obj.suggestions) || obj.card || obj.card_json)) {
    structured = true;
    suggestions = obj.suggestions || [];
    if (typeof suggestions === "string") { try { suggestions = JSON.parse(suggestions); } catch (e) { suggestions = []; } }
    if (!Array.isArray(suggestions) && suggestions && typeof suggestions === "object") suggestions = [suggestions];
    if (!Array.isArray(suggestions)) suggestions = [];
    suggestions = suggestions.filter(s => s && typeof s === "object").map(s => { s.field = mapField(s.field); return s; });
    card = obj.card || obj.card_json || null;
    if (typeof card === "string") { try { card = JSON.parse(card); } catch (e) { card = null; } }
    refs = obj.refs || [];
    if (typeof refs === "string") { try { refs = JSON.parse(refs); } catch (e) { refs = []; } }
    if (!Array.isArray(refs)) refs = [];
  }

  // 形态D：字段键值映射 { goal: {original,optimized,reason}, measures: [{...}] }
  if (!structured && obj) {
    const inner = obj.result && typeof obj.result === "object" ? obj.result : null;
    const candidates = inner ? [obj, inner] : [obj];
    let fieldHits = null;
    for (let i = 0; i < candidates.length; i++) {
      const hits = Object.keys(FIELD_LABEL_MAP).filter(k => candidates[i][k] !== undefined);
      const hasDiff = hits.some(k => {
        const v = candidates[i][k];
        const items = Array.isArray(v) ? v : [v];
        return items.some(it => it && typeof it === "object" && (it.original !== undefined || it.optimized !== undefined));
      });
      if (hits.length && hasDiff) { fieldHits = { src: candidates[i], keys: hits }; break; }
    }
    if (fieldHits) {
      structured = true;
      suggestions = [];
      fieldHits.keys.forEach(k => {
        const v = fieldHits.src[k];
        const items = Array.isArray(v) ? v : [v];
        items.filter(it => it && typeof it === "object" && (it.original !== undefined || it.optimized !== undefined)).forEach(it => {
          suggestions.push({
            field: FIELD_LABEL_MAP[k],
            old: it.original,
            new: it.optimized,
            reason: it.reason || it.rationale || "",
            ref: it.ref || ""
          });
        });
      });
      if (fieldHits.src.refs && Array.isArray(fieldHits.src.refs)) refs = fieldHits.src.refs;
    }
  }

  if (structured) {
    return { structured: true, suggestions, card, refs, text: typeof raw === "string" ? raw : JSON.stringify(obj) };
  }
  if (obj) {
    jsonDetected = true;
    const res = obj.result && typeof obj.result === "object" ? obj.result : null;
    if (res && !Array.isArray(res.suggestions) && !Array.isArray(res.optimization) && (res.card_name || res.measures)) {
      echoHint = true;
    }
  }
  return { structured: false, suggestions: [], card: null, refs: [], text: typeof raw === "string" ? raw : JSON.stringify(raw || ""), jsonDetected, echoHint };
}

module.exports = { FIELD_LABEL_MAP, normalizeResult };
