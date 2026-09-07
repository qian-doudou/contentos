# ContentOS

ContentOS 是面向本地生活短视频代运营团队的 AI 内容运营与项目管理平台。当前已完成第四阶段内容模型：在可持久化的 Organization → Client → Brand → Store → Account 业务层级上，加入月度内容计划、结构化内容主表、统一服务端权限边界和按账号计算的目标/实际统计。脚本正文不写入 `contents`，留给后续版本表承载。

## 本地运行

要求 Node.js `>=22.13.0`。

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run db:seed
npm run dev
```

打开 `http://localhost:3000`。统一 LLM Client 默认通过阿里云百炼的 OpenAI 兼容接口调用千问；未配置 API Key 时自动使用确定性 Mock 响应，核心演示路径无需外部服务。

## 百炼千问配置

`.env.example` 已默认配置华北 2（北京）的百炼共享兼容端点，并使用以下模型分层：

- Light：`qwen3.8-flash`
- Standard：`qwen3.7-plus`
- Strong：`qwen3.8-max`

在 `.env.local` 中填写 `LLM_API_KEY` 即可进入 Live 模式；也兼容百炼官方环境变量名 `DASHSCOPE_API_KEY`，其中 `LLM_API_KEY` 优先。生产环境建议把 `LLM_BASE_URL` 替换为 `https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。Base URL 与 API Key 必须属于同一地域，Key 不得写入源码或提交到 Git。

百炼官方参考：[Base URL 总览](https://help.aliyun.com/zh/model-studio/base-url)、[OpenAI 兼容 Chat](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[文本模型选择](https://help.aliyun.com/zh/model-studio/text-generation-model/)。

本地 MVP 的组织由服务端环境变量 `LOCAL_ORGANIZATION_ID` 固定，HTTP header、query 和 body 不能切换组织。开发环境顶部用户切换器通过 HttpOnly、SameSite Cookie 模拟当前用户；生产环境忽略该 Cookie 并禁用切换 API。这是本地演示身份，不是真实登录，不应直接用于公网多租户环境。

## 角色与权限

- `owner`：当前阶段全部权限，包含演示数据恢复。
- `admin`：组织与业务主数据管理，不包含危险系统操作。
- `operator`：只读取 `client_members` 已分配客户的主数据，并可管理这些客户的月度计划与内容；不能修改客户主资料。
- `photographer` / `editor`：当前主数据 API 不授权；本人任务权限随拍摄、剪辑阶段实现。
- `viewer`：只读取 `client_members` 已授权客户，所有主数据写入均返回 403。

权限通过 `lib/auth/permissions.ts` 统一校验。请求其他组织的 ID 返回 404；请求同组织但未授权的客户返回 403，不用空数组掩盖越权。

## 页面

- `/clients`：按名称、行业、负责人、合作状态筛选和分页。
- `/clients/new`：创建客户。
- `/clients/[id]`：客户资料及其品牌、门店、账号层级。
- `/accounts`：按客户 → 品牌 → 门店 → 账号分组管理。
- `/accounts/[id]`：账号定位、目标、内容风格、禁用风格及明确标记为未实现的内容统计。
- `/contents/plans`、`/contents/plans/new`、`/contents/plans/[id]`：月度计划查询、创建、编辑和类型目标/实际统计。
- `/contents`、`/contents/new`、`/contents/[id]`：结构化内容查询、创建、编辑和详情。
- `/team`：成员、角色、负责客户数与状态（Owner / Admin 可访问）。
- 其他导航入口保留后续阶段空状态，不会返回 404。

## 数据库

- 默认数据库：`./data/contentos.db`，可通过 `DATABASE_PATH` 修改。
- Schema：`db/schema.ts`。
- Migration：`drizzle/`。
- Seed：`npm run db:seed`，幂等写入带 `is_demo` 标识的组织、5 位可切换成员、客户授权关系、德祥楼业务层级、2026 年 9 月计划和 1 条结构化内容。
- 恢复演示数据：`npm run db:reset`，或在开发环境调用 `POST /api/dev/reset` 并传入 `{ "confirm": "RESET_DEMO" }`。该操作只恢复固定 demo ID，不物理删除客户、品牌、门店或账号。

所有时间以 ISO 8601 文本保存，所有业务 ID 使用 UUID。核心层级通过包含 `organization_id` 的复合外键约束，服务层所有 ID 查询同时带组织条件。数据库文件被 Git 忽略，进程重启和页面刷新不会清空数据。

## API 规范

基础接口：

- `GET /api/health`
- `GET /api/dashboard`
- `POST /api/dev/reset`（仅非生产环境）
- `GET/POST /api/dev/identity`（POST 仅非生产环境）
- `GET /api/team`

业务主数据接口：

- `GET/POST /api/clients`
- `GET/PUT /api/clients/[id]`
- `POST/PUT /api/brands`（品牌更新在 JSON body 传 `id`）
- `POST/PUT /api/stores`（门店更新在 JSON body 传 `id`）
- `GET/POST /api/accounts`
- `GET/PUT /api/accounts/[id]`

内容模型接口：

- `GET/POST /api/content-plans`
- `GET/PUT /api/content-plans/[id]`
- `GET/POST /api/contents`
- `GET/PUT /api/contents/[id]`

`GET /api/content-plans` 支持 `accountId`、`year`、`month`、`status`、`page`、`pageSize`。`GET /api/contents` 支持关键字、客户/品牌/门店/账号/计划、内容类型、目标、优先级、运营人、状态、计划发布日期和分页。

`GET /api/clients` 支持 `search`、`industry`、`ownerUserId`、`cooperationStatus`、`status`、`page`、`pageSize`。核心业务对象不提供物理删除 API，停用请更新为 `status=inactive`。

所有接口统一返回：

```json
{
  "success": true,
  "data": {},
  "error": null,
  "request_id": "uuid"
}
```

失败响应使用正确 HTTP 状态码，包含 `error.code`、`error.message` 与同一个 `request_id` 响应头。API 不返回密钥或完整环境变量。

## Demo 主数据

- Organization：星火本地生活运营有限公司
- Users：运营负责人、运营A、摄影A、剪辑A、查看者
- Client / Brand：德祥楼，餐饮 / 铜锅涮羊肉，城市菏泽
- Store：德祥楼（演示门店）
- Account：德祥楼老板IP，目标为本地曝光、老板人设、团购转化
- Monthly Plan：2026 年 9 月，计划 8 条，人设/产品/本地/转化各 25%
- Content：《老板带你认识鲁西南铜锅涮》，结构化字段齐全，未写入脚本正文

## 质量检查

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## 当前边界

当前未接入真实 OAuth、抖音 API、脚本版本/审核流程、自动发布、GMV、支付、视频生成、自动剪辑、数字人或企业生产数据。第四阶段没有调用 AI，`current_*_version_id`、`active_approved_*_version_id` 和 `ai_review_status` 仅保留可空指针；账号页旧的内容统计占位仍明确返回 0 与 `implemented=false`。
