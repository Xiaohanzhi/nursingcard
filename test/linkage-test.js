// 知识卡聚合内容接口 · 自测脚本
// 用法：
//   node test/linkage-test.js                          # 默认 http://127.0.0.1:3742 admin/admin123，聚合全部已定稿卡
//   node test/linkage-test.js <baseUrl> <用户名> <密码> [cardIds] [输出文件]
// 示例：
//   node test/linkage-test.js http://127.0.0.1:3742 admin admin123
//   node test/linkage-test.js http://127.0.0.1:3742 admin admin123 "card1,card2" out.txt
const fs = require("fs");
const path = require("path");

const BASE = (process.argv[2] || "http://127.0.0.1:3742").replace(/\/+$/, "");
const USER = process.argv[3] || "admin";
const PASS = process.argv[4] || "admin123";
const CARD_IDS = process.argv[5] || "";
const OUT_FILE = process.argv[6] || "";

async function api(p, token) {
  const r = await fetch(BASE + p, { headers: token ? { Authorization: "Bearer " + token } : {} });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("请求失败 " + r.status + " " + (j.error || ""));
  return j;
}

async function main() {
  console.log("=== 知识卡聚合内容接口自测 ===");
  console.log("目标地址:", BASE);
  console.log("账号:", USER, "/", PASS);
  console.log("");

  // 1) 登录
  console.log("[1] 登录…");
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS })
  });
  const loginJson = await login.json();
  if (login.status !== 200) { console.log("    登录失败:", loginJson.error || login.status); process.exit(1); }
  const token = loginJson.token;
  console.log("    登录成功:", loginJson.user.displayName, "| 角色:", loginJson.user.role);
  console.log("");

  // 2) 已定稿卡列表
  console.log("[2] 已定稿卡列表…");
  const cards = await api("/api/linkage/cards", token);
  console.log("    共", cards.length, "张：");
  cards.forEach((c, i) => console.log("    " + (i + 1) + ". " + c.name + "（" + c.questionName + "）" + c.version));
  console.log("");

  // 3) 聚合内容（全量）
  console.log("[3] 聚合内容（全部已定稿卡）…");
  const full = await api("/api/linkage/content", token);
  console.log("    聚合卡数:", full.count);
  console.log("    ─── 内容开始 ───");
  console.log(full.content);
  console.log("    ─── 内容结束 ───");
  console.log("");

  // 4) 子集聚合（可选）
  if (CARD_IDS) {
    console.log("[4] 聚合内容（cardIds=" + CARD_IDS + "）…");
    const sub = await api("/api/linkage/content?cardIds=" + encodeURIComponent(CARD_IDS), token);
    console.log("    聚合卡数:", sub.count);
    console.log("    ─── 子集内容开始 ───");
    console.log(sub.content);
    console.log("    ─── 子集内容结束 ───");
    console.log("");
  }

  // 5) 可选：保存到文件
  if (OUT_FILE) {
    const target = path.resolve(OUT_FILE);
    fs.writeFileSync(target, full.content, "utf8");
    console.log("[5] 全量聚合内容已保存到:", target);
  } else {
    console.log("[5] 未指定输出文件（如需保存，第 5 个参数传文件路径即可）");
  }
  console.log("");
  console.log("=== 自测完成 ===");
}

main().catch(e => { console.error("自测出错:", e.message); process.exit(2); });
