# ContentOS

ContentOS 是面向本地生活短视频代运营团队的 AI 内容运营与项目管理平台。本仓库实现第一阶段工程基础：Next.js App Router、SQLite + Drizzle、统一 API、Run/Run Step 数据模型、确定性 LLM Mock 模式和完整后台导航。

## 本地运行

要求 Node.js `>=22.13.0`。

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run db:seed
npm run dev
```

打开 `http://localhost:3000`。未配置 `LLM_API_KEY` 时，LLM 客户端自动使用确定性 Mock 响应，核心演示路径无需外部服务。

## 数据库

- 默认数据库：`./data/contentos.db`，可通过 `DATABASE_PATH` 修改。
- Schema：`db/schema.ts`。
- Migration：`drizzle/`。
- Seed：`npm run db:seed`，幂等写入清晰标记为 `is_demo` 的组织、4 位成员和阶段设置。
- 完整重置：`npm run db:reset`，或在开发环境调用 `POST /api/dev/reset` 并传入 `{ "confirm": "RESET_DEMO" }`。

所有时间以 ISO 8601 文本保存，所有业务 ID 使用 UUID。数据库文件被 Git 忽略，进程重启和页面刷新不会清空数据。

## API 规范

- `GET /api/health`
- `GET /api/dashboard`
- `POST /api/dev/reset`（仅非生产环境）

统一返回：

```json
{
  "success": true,
  "data": {},
  "error": null,
  "request_id": "uuid"
}
```

失败响应使用正确 HTTP 状态码，并返回 `error.code` 与 `error.message`。密钥与完整环境变量不会进入 API 响应。

## 质量检查

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## 第一阶段边界

当前未接入真实 OAuth、抖音 API、自动发布、GMV、支付、视频生成、自动剪辑、数字人或企业生产数据。导航中的后续模块均显示明确空状态，不代表对应业务能力已经完成。

