# 专科知识卡平台 · 轻量部署模块

单 Node.js 服务：卡片列表 / AI优化卡片（调用 Dify 工作流）/ 卡片审核 / 系统设置。

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
