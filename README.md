# 专科知识卡平台 · 轻量部署模块

单 Node.js 服务：卡片列表 / AI优化卡片（调用 Dify 工作流）/ 文献管理 / 卡片审核 / 系统设置。

## 环境要求
- Node.js 18+（建议 20+，本模块在 Node 24 上验证）
- 可访问 Dify 服务的网络（工作流由贵方提供）

## 安装与启动
```bash
cd knowledge-card-module
npm install
npm start          # 或双击 start.bat
```
默认端口 **3742**，浏览器访问 `http://服务器IP:3742`。

## 默认账号（首次登录后请修改密码）
| 账号 | 密码 | 角色 |
|---|---|---|
| admin | admin123 | 管理员（可进系统设置） |
| zhang | 123456 | 知识工程师（建卡/上传/AI抽取） |
| li | 123456 | 一审审核员 |
| wang | 123456 | 二审审核员 |

## 配置 Dify 工作流
管理员登录 → 系统设置 → 填入：
- **Base URL**：如 `https://dify.example.com`
- **API Key**：工作流应用的 API 密钥
- **Workflow ID**：工作流 ID
- 输入变量名：`file` / `card` / `prompt`（可按工作流实际命名调整）
- 输出变量名：默认 `output`

模块按以下契约调用：
1. `POST {baseUrl}/v1/files/upload` 上传用户文件，取 upload_file_id；
2. `POST {baseUrl}/v1/workflows/run`，inputs 固定为：
   - `file`：`{"type":"document","transfer_method":"local_file","upload_file_id":"..."}`
   - `card`：选中卡片 8 字段 + measures 的 JSON 字符串（字段契约见 `docs/dify-contract.md`）
   - `prompt`：用户提示词
3. 读取输出变量（默认 `output`），优先解析为结构化 JSON：
   `{ "suggestions":[{field,old,new,reason,ref}], "card":{...}, "refs":[{title,section,excerpt}] }`
   解析失败则按原文文本展示。

JSON 输入/输出契约详见 [docs/dify-contract.md](docs/dify-contract.md)。

也可用 `node test/mock-dify.js` 启动本地模拟 Dify 进行端到端联调（Base URL 填 `http://127.0.0.1:3788`）。

## 配置说明
首次启动生成 `config.json`，也可用环境变量覆盖：
- `PORT`、`JWT_SECRET`、`DIFY_BASE_URL`、`DIFY_API_KEY`、`DIFY_WORKFLOW_ID`

`files` 配置：`maxSizeMb`（默认20）、`allowedExtensions`（默认 pdf/docx/xlsx/txt）、`ttlHours`（临时文件保留小时数，默认24）。

## 文献管理

上传的文献永久保存在 `uploads/literature/`（登记于 `data/db.json` 的 `literature`），可在"文献管理"页统一查看/搜索/下载/删除；AI优化卡片可直接选择文献库文献或上传新文献（自动入库）。

- `POST /api/literature`：上传（multipart，字段名 `file`）
- `GET /api/literature?keyword=`：列表/搜索
- `GET /api/literature/:id/download`：下载
- `DELETE /api/literature/:id`：删除
- `POST /api/settings/cleanup`（管理员）：手动触发临时文件清理

`uploads/tmp/` 仅作过渡目录，超期（`ttlHours`）文件由启动与每小时任务扫描清理，不影响文献库。

## 知识卡聚合内容接口

将当前已定稿的护理问题卡按统一模板聚合为"总知识卡内容"文本，供外部调用（如自行对接其他 Dify 工作流）。

先登录获取 token：
```bash
curl -X POST http://服务器:3742/api/auth/login -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

获取已定稿卡列表：
```bash
curl http://服务器:3742/api/linkage/cards -H "Authorization: Bearer <token>"
```

获取聚合内容（默认全部已定稿卡，可按 cardIds 选择子集）：
```bash
curl "http://服务器:3742/api/linkage/content" -H "Authorization: Bearer <token>"
curl "http://服务器:3742/api/linkage/content?cardIds=card1,card2" -H "Authorization: Bearer <token>"
```

返回示例：
```json
{
  "count": 2,
  "cardIds": ["card1", "card2"],
  "content": "【卡片1】护理问题：疼痛；护理目标：疼痛缓解，NRS 评分 ≤ 3 分；触发逻辑：NRS评分≥4分、上腹痛、牙痛、心前区压榨样疼痛；推荐护理措施：首优护理措施：休息与活动（①绝对卧床；②指导避免增加腹压动作）……\n【卡片2】护理问题：活动无耐力；护理目标：活动耐力提高，活动时无明显不适；……"
}
```

说明：内容按最后修改时间倒序（最新在前）；非法 cardIds 自动忽略；本接口不调用任何 Dify 流程。

## 对接现有系统
- **反向代理**（nginx 示例）：
  ```nginx
  location /knowledge-card/ {
      proxy_pass http://127.0.0.1:3742/;
      proxy_set_header Host $host;
  }
  ```
- **iframe 嵌入**：系统菜单指向 `/knowledge-card/` 即可；如需无感登录，后续扩展 SSO（`/api/auth/sso` 已预留，配置 `ssoEnabled` 后对接）。

## 数据与备份
- 数据文件：`data/db.json`（卡片、账号、抽取历史、临时文件登记）
- 上传文件：`uploads/tmp/`（超过 TTL 自动清理）
- 备份：停止服务后复制上述两个位置即可；或直接拷贝 `data/db.json`。
