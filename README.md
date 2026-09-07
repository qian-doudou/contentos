# ContentOS

ContentOS 是面向本地生活短视频代运营团队的 AI 内容运营与项目管理平台。当前已完成第七阶段长期记忆与上下文构建：在已有 Organization → Client → Brand → Store → Account → Monthly Plan → Content 业务链路上，加入可追溯、只新增替代的 Memory，以及有固定预算和持久化快照的确定性 Context Builder。本阶段不调用 LLM，不生成选题。

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

在 `.env.local` 中填写 `LLM_API_KEY` 即可进入 Live 模式；也兼容百炼官方环境变量名 `DASHSCOPE_API_KEY`，其中 `LLM_API_KEY` 优先。`LLM_TIMEOUT_MS` 默认为 30000，短暂网络错误或 429/5xx 最多自动重试 1 次。生产环境建议把 `LLM_BASE_URL` 替换为 `https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。Base URL 与 API Key 必须属于同一地域，Key 不得写入源码或提交到 Git。

没有 Key 时，Skill Test Run 使用由 Output Schema 确定生成的 Mock JSON。前端和 Run Trace 只显示安全配置、模型名和用量，不返回 API Key、Base URL、完整环境变量或服务器绝对路径。

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
- `/ai/memory`：按可访问账号管理品牌/账号 Memory、新增替代、停用、档案初始化和 Context 快照预览。账号详情同步提供 Memory Tab。
- `/contents/plans`、`/contents/plans/new`、`/contents/plans/[id]`：月度计划查询、创建、编辑和类型目标/实际统计。
- `/contents`：结构化内容筛选、表格与七列 Kanban；拖拽失败时回滚界面状态。
- `/contents/new`、`/contents/[id]`：内容创建、编辑、合法状态转换和状态时间线。
- `/skills`、`/skills/[id]`：Skill 列表、Prompt/Schema 编辑、不可变版本历史、新版本式回滚和 Test Run。
- `/settings/ai`：安全的百炼模式/模型概览、当前额度和可追加的模型价格配置。
- `/ops/runs`：按 Run 类型和状态查询真实执行、Step、Usage、成本与计费 Points。
- `/team`：成员、角色、负责客户数与状态（Owner / Admin 可访问）。
- 其他导航入口保留后续阶段空状态，不会返回 404。

## 数据库

- 默认数据库：`./data/contentos.db`，可通过 `DATABASE_PATH` 修改。
- Schema：`db/schema.ts`。
- Migration：`drizzle/`。
- Seed：`npm run db:seed`，幂等写入带 `is_demo` 标识的组织、5 位可切换成员、客户授权关系、德祥楼业务层级、2026 年 9 月计划、1 条结构化内容、6 条已确认档案 Memory、8 个系统 Skill 及其 v1 快照，以及 2026 演示 AI 额度。不预置虚构模型价格。
- 恢复演示数据：`npm run db:reset`，或在开发环境调用 `POST /api/dev/reset` 并传入 `{ "confirm": "RESET_DEMO" }`。该操作只恢复固定 demo ID，不物理删除业务记录，也不绕过状态机重置已有内容的工作流状态。

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
- `POST /api/contents/[id]/transition`
- `GET /api/contents/[id]/history`

AI 基础设施接口：

- `GET /api/skills`
- `GET/PUT /api/skills/[id]`
- `POST /api/skills/[id]/rollback`
- `POST /api/skills/[id]/test`
- `GET /api/settings/ai`
- `POST /api/settings/ai/prices`
- `GET /api/ops/runs`

Memory 与 Context 接口：

- `GET/POST /api/memories`（查询传 `accountId`；POST 只接受人工确认输入）
- `POST /api/memories/initialize`
- `POST /api/memories/[id]/deactivate`
- `POST /api/context/build`

Memory 来源只允许 `brand_profile`、`confirmed_preference`、`confirmed_performance`、`confirmed_strategy` 和 `manual`。公开写接口强制使用 `manual`，不接受客户端伪造来源。相同 organization + scope + key 只允许一条 Active；替代时在同一事务中将旧记忆标记为 `superseded` 并新增记录。

Context Builder 只读取 Active、已生效且未过期的 Memory，按 L0 系统规则、L1 稳定档案、L2 当前计划/任务、L3 相关 Memory、L4 历史已发布内容结构化摘要组装。服务端上限为 L1 6 条、L3 20 条、L4 10 条和总字符估算 12000；超出时按优先级截断，并把所用 ID、截断原因、字符/Token 估算与构建时间写入 `context_snapshots.context_snapshot_json`。

Skill 的 Input/Output Schema 在写入和执行时都经 Zod 校验。Production Run 先检查剩余 Points，仅在经校验的业务结果成功持久化时，与业务写入在同一事务内扣点。Test/Eval Run 不扣点；正式任务最终失败时 `billed_points=0`，但仍保留已发生调用的 usage 和可计算成本。只有存在生效的 `model_price_configs` 时才计算 `estimated_cost`，否则返回 `null`。

`GET /api/content-plans` 支持 `accountId`、`year`、`month`、`status`、`page`、`pageSize`。`GET /api/contents` 支持关键字、客户/品牌/门店/账号/计划、内容类型、目标、优先级、运营人、状态、计划发布日期和分页。

`contents.status` 只使用 `IDEA`、`SCRIPTING`、`WAITING_APPROVAL`、`APPROVED`、`WAITING_SHOOT`、`SHOT`、`EDITING`、`WAITING_REVIEW`、`REVISION`、`READY_TO_PUBLISH`、`PUBLISHED`、`REVIEWED`。普通 `PUT /api/contents/[id]` 不接受 `status`；必须通过状态 API 并写入原因。涉及 Shoot 关系或 Publish 记录的转换不允许由通用 API 直接执行。

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
- AI：8 个系统内置 Skill，每个含 v1 快照；演示组织当期 1000 Points，初始已用 0
- Memory：从德祥楼 Brand/Account 已确认字段初始化 6 条，`source_type=brand_profile`、`confidence=1`

## 质量检查

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## 当前边界

当前未接入真实 OAuth、抖音 API、脚本版本/客户审核对象、Shoot 任务、Publish 记录、自动发布、GMV、支付、视频生成、自动剪辑、数字人或企业生产数据。第七阶段不提供正式内容策划/脚本生成 API，不调用 LLM；L4 仅在当前可访问账号内对已发布/已复盘内容做确定性关键词相关性排序，尚未实现下一阶段的 Embedding/向量历史检索。真实百炼调用需配置有效 Key 并为实际模型名添加价格配置；没有价格时成本显示“未知”。

由于 Shoot/Publish 业务对象尚未实现，`APPROVED → WAITING_SHOOT`、`WAITING_SHOOT → APPROVED/SHOT` 和 `READY_TO_PUBLISH → PUBLISHED` 目前只会被服务端阻止，不伪造尚未存在的业务副作用。`current_*_version_id`、`active_approved_*_version_id` 和 `ai_review_status` 仍仅为可空指针。
