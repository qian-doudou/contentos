# ContentOS

ContentOS 是面向本地生活短视频代运营团队的 AI 内容运营与项目管理平台。当前已完成第十六阶段 Feedback & Eval：Production Run 支持版本化人工评分；规则与人工反馈沉淀为 Bad Case；Prompt 改进只生成隔离 Draft，并且必须经过行级 Diff、冻结输入 A/B、确定性上线门槛和人工确认后才能创建新的组织级生产 Skill 版本。

## 本地运行

要求 Node.js `>=22.13.0`。

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run db:seed
npm run dev
```

打开 `http://localhost:3001`。开发与生产启动脚本均固定使用 3001 端口，避免与同机运行的其他项目冲突。统一 LLM Client 默认通过阿里云百炼的 OpenAI 兼容接口调用千问；未配置 API Key 时自动使用确定性 Mock 响应，核心演示路径无需外部服务。

## 百炼千问配置

`.env.example` 已默认配置华北 2（北京）的百炼共享兼容端点，并使用以下模型分层：

- Light：`qwen3.8-flash`
- Standard：`qwen3.7-plus`
- Strong：`qwen3.8-max`

在 `.env.local` 中填写 `LLM_API_KEY` 即可进入 Live 模式；也兼容百炼官方环境变量名 `DASHSCOPE_API_KEY`，其中 `LLM_API_KEY` 优先。`LLM_TIMEOUT_MS` 默认为 30000，短暂网络错误或 429/5xx 最多自动重试 1 次。生产环境建议把 `LLM_BASE_URL` 替换为 `https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。Base URL 与 API Key 必须属于同一地域，Key 不得写入源码或提交到 Git。

没有 Key 时，Skill Test Run 使用由 Output Schema 确定生成的 Mock JSON。前端和 Run Trace 只显示安全配置、模型名和用量，不返回 API Key、Base URL、完整环境变量或服务器绝对路径。

Embedding 使用 `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL`，同样通过百炼 OpenAI 兼容端点。未配置 `EMBEDDING_API_KEY` 时使用中文字符 bigram、关键词权重和小型同义词归一的确定性向量，不会将完整脚本放入 Embedding。

百炼官方参考：[Base URL 总览](https://help.aliyun.com/zh/model-studio/base-url)、[OpenAI 兼容 Chat](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[文本模型选择](https://help.aliyun.com/zh/model-studio/text-generation-model/)。

本地 MVP 的组织由服务端环境变量 `LOCAL_ORGANIZATION_ID` 固定，HTTP header、query 和 body 不能切换组织。开发环境顶部用户切换器通过 HttpOnly、SameSite Cookie 模拟当前用户；生产环境忽略该 Cookie 并禁用切换 API。这是本地演示身份，不是真实登录，不应直接用于公网多租户环境。

## 角色与权限

- `owner`：当前阶段全部权限，包含演示数据恢复。
- `admin`：组织与业务主数据管理，不包含危险系统操作。
- `operator`：只读取 `client_members` 已分配客户的主数据，并可管理这些客户的月度计划与内容；不能修改客户主资料。
- `photographer`：只读取本人拍摄任务、已批准脚本与 Checklist，并可更新本人 Checklist 执行状态。
- `editor`：只读取分配给本人的剪辑任务，可开始处理并提交不可变成片版本；不获得客户主数据或他人任务权限。
- `viewer`：只读取 `client_members` 已授权客户，所有主数据写入均返回 403。

权限通过 `lib/auth/permissions.ts` 统一校验。请求其他组织的 ID 返回 404；请求同组织但未授权的客户返回 403，不用空数组掩盖越权。

## 页面

- `/clients`：按名称、行业、负责人、合作状态筛选和分页。
- `/clients/new`：创建客户。
- `/clients/[id]`：客户资料及其品牌、门店、账号层级。
- `/accounts`：按客户 → 品牌 → 门店 → 账号分组管理。
- `/accounts/[id]`：账号定位、目标、内容风格、禁用风格及明确标记为未实现的内容统计。
- `/contents/import`：上传 CSV / JSON，预览逐行校验、重复与错误后再正式写入。
- `/ai/memory`：按可访问账号管理品牌/账号 Memory、新增替代、停用、档案初始化和 Context 快照预览。账号详情同步提供 Memory Tab。
- `/ai/dedup-test`：输入候选选题，查看同账号 Top10、规则分数、Top5 Skill 输入、LLM / Mock 判定与 Fallback 状态。
- `/ai/planner`：只填写账号、候选数量、拍摄日期、首要目标与特殊要求；展示代码计算的计划缺口、候选去重/质量结论，支持保留版本的“换角度”和人工选择后写入。
- `/contents/plans`、`/contents/plans/new`、`/contents/plans/[id]`：月度计划查询、创建、编辑和类型目标/实际统计。
- `/contents`：结构化内容筛选、表格与七列 Kanban；拖拽失败时回滚界面状态。
- `/contents/new`、`/contents/[id]`：内容创建、编辑、脚本版本生成/人工修改、客户审核、合法状态转换和状态时间线。
- `/review/[token]`：只展示 Token 绑定的指定脚本或成片版本，支持客户批准、要求修改或拒绝；无后台导航和其他内容枚举入口。
- `/shoots`：按日历或列表查看真实拍摄排期，支持客户、状态与日期筛选及新建排期。
- `/shoots/[id]`：展示客户、门店、时间、运营、摄影与移动端 Checklist；每条直接读取排期时锁定的 Approved Script 版本、人物、产品与 shots。
- `/edits`：Editor 工作台，按当前开发身份在服务端限定任务范围并支持状态筛选。
- `/edits/[id]`：剪辑分配、开始处理、成片版本提交、Diff 式元数据列表和内外部审核记录。内容详情页同步提供该面板。
- `/analytics/content`：按账号、时间、内容类型、Hook 类型和内容目标筛选表现快照，提供字段映射、逐行错误报告和确认写入式 CSV 导入。
- `/ai/reviews`：先预览代码聚合的数据事实，再生成 AI 解释与策略；展示样本门槛、人工确认、Memory 写入和下月计划草案入口。
- `/skills`、`/skills/[id]`：Skill 列表、只读生产 Prompt、Schema/元数据版本配置、不可变版本历史和 Test Run；Prompt 变更统一转入评测中心。
- `/evals`：确定性质量指标、Production Run 评分、Bad Case、改进草案和 Eval Case 管理。
- `/evals/proposals/[id]`：旧/新 Prompt 行级 Diff、固定输入 A/B 指标、改善/退化 Case、上线门槛与人工确认。
- `/settings/ai`：安全的百炼模式/模型概览、当前额度和可追加的模型价格配置。
- `/ops`：按月份查看计划目标、真实发布、剩余缺口、自然月进度、风险原因、团队事实和额度预警，并直接进入计划处理。
- `/ops/ai-cost`：按日期汇总 AI 调用、Tokens、Points 和 estimated cost，支持 Skill、模型、客户、账号、用户维度；缺少价格时明确显示“未知”。
- `/ops/runs`、`/ops/runs/[id]`：查询真实 Run，并查看步骤时间线、Context Snapshot、Skill 版本、模型、Token、成本、Points、错误、重试和最终业务对象。
- `/team`：成员、角色、负责客户数与状态（Owner / Admin 可访问）。
- 其他导航入口保留后续阶段空状态，不会返回 404。

## 数据库

- 默认数据库：`./data/contentos.db`，可通过 `DATABASE_PATH` 修改。
- Schema：`db/schema.ts`。
- Migration：`drizzle/`。
- Seed：`npm run db:seed`，幂等写入带 `is_demo` 标识的组织、5 位可切换成员、客户授权关系、德祥楼业务层级、2026 年 9 月计划、结构化内容、3 条历史内容、6 条已确认档案 Memory、9 个系统 Skill 及版本快照（含只用于 Eval 的 `prompt_improver`）、2026 演示 AI 额度、运营风险阈值配置，以及待拍摄和已拍摄的真实工作流演示数据。不预置虚构经营指标、Performance Snapshot、评分、Bad Case 或模型价格。
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
- `GET /api/ops/runs/[id]`

AI 质量闭环接口：

- `GET /api/evals`（质量指标、评分、Bad Case、草案和 Eval Case 总览）
- `POST /api/evals/scan`（Owner / Admin 运行确定性 Bad Case 规则扫描）
- `POST /api/evals/ratings`
- `PUT /api/evals/ratings/[id]`（新增评分历史版本，不覆盖旧版本）
- `GET /api/evals/bad-cases`
- `PUT /api/evals/bad-cases/[id]`
- `POST /api/evals/proposals`（只保存 Draft）
- `GET /api/evals/proposals/[id]`
- `POST /api/evals/proposals/[id]/run`（A/B 均为 `run_type=eval`）
- `POST /api/evals/proposals/[id]/apply`（仅通过门槛后由人工确认）
- `POST /api/evals/cases`

Memory 与 Context 接口：

- `GET/POST /api/memories`（查询传 `accountId`；POST 只接受人工确认输入）
- `POST /api/memories/initialize`
- `POST /api/memories/[id]/deactivate`
- `POST /api/context/build`

历史检索接口：

- `GET /api/contents/import`
- `POST /api/contents/import/preview`
- `POST /api/contents/import/commit`
- `POST /api/ai/dedup-test`

AI Content Planner 接口：

- `GET/POST /api/ai/planner`
- `GET /api/ai/planner/[id]`
- `POST /api/ai/planner/[id]/persist`
- `POST /api/ai/planner/[id]/candidates/[candidateId]/reangle`

脚本与审核接口：

- `GET/POST /api/contents/[id]/scripts`（GET 读取版本工作区；POST 创建人工新版本）
- `POST /api/contents/[id]/scripts/generate`
- `POST /api/contents/[id]/approvals`
- `POST /api/approvals/[id]/decision`（内部指定审核人）
- `GET/POST /api/review/[token]`（外部客户专属链接）

拍摄管理接口：

- `GET/POST /api/shoots`
- `GET/PUT /api/shoots/[id]`
- `POST /api/shoots/[id]/items`（加入已批准内容）
- `POST /api/shoots/[id]/items/[itemId]/action`（已拍、缺镜、改期、取消或从未执行排期移除）

剪辑与成片审核接口：

- `GET /api/edits`（按服务端权限范围查询 Editor 任务）
- `GET/POST /api/contents/[id]/edits`（版本工作区 / 提交新成片版本）
- `POST /api/contents/[id]/edits/assign`
- `POST /api/contents/[id]/edits/start`
- `POST /api/contents/[id]/edits/review`（为当前版本重新发起审核）
- `POST /api/approvals/[id]/decision`（根据 approval type 分派脚本或成片内部审核）
- `GET/POST /api/review/[token]`（根据 Token 只展示绑定的脚本或成片）

发布与表现接口：

- `POST /api/contents/[id]/publish`（事务内创建唯一有效发布记录并执行 `READY_TO_PUBLISH → PUBLISHED`）
- `GET /api/contents/[id]/performance`
- `POST /api/publishes/[id]/snapshots`（人工新增不可变快照）
- `GET /api/analytics/content`
- `POST /api/performance/import/preview`
- `POST /api/performance/import/commit`

策略复盘接口：

- `GET/POST /api/strategy-reviews`（列表 / 生成 Production Run）
- `GET /api/strategy-reviews/aggregate`（只运行代码聚合，不调用 AI）
- `GET /api/strategy-reviews/[id]`
- `POST /api/strategy-reviews/[id]/confirm`
- `POST /api/strategy-reviews/[id]/reject`
- `POST /api/strategy-reviews/[id]/next-plan`
- `GET/PUT /api/settings/strategy-review`（Owner / Admin 配置表现规律最少样本数）

运营中心接口：

- `GET /api/ops/overview`（Owner / Admin；支持 `year` + `month`）
- `GET/PUT /api/ops/config`（PUT 仅 Owner / Admin）
- `GET /api/ops/ai-cost`（Owner / Admin；支持 `from` + `to`）
- `GET /api/ops/runs/[id]`（Owner / Admin；其他组织 ID 返回 404）

导入单次上限 200 行 / 1 MB，去重策略为 `external_id`、`title_published_at` 或 `canonical`。正式写入只接受已持久化且无错误的预览批次；数据库唯一约束会再次阻止重复。Embedding 的 `canonical_text` 仅由 title + topic + angle + hook_text + core_message 组成。上述字段改变时旧向量在业务事务中标记 `stale`，随后重新建立 Active 向量。

历史召回只查询同一 organization + account 的 `PUBLISHED` / `REVIEWED` Content。Top10 的 content_id、similarity、retrieval_method、source_hash 和 rank 保存到检索记录；规则综合语义、Topic、Angle、Hook 和 Core Message，Topic 权重仅 10%。最多 5 条进入 `duplicate_judge`，输出 content_id 必须属于本次 Top5，否则 Run 失败并使用确定性规则结果。去重页始终使用 `run_type=test`、`billed_points=0`。

Memory 来源只允许 `brand_profile`、`confirmed_preference`、`confirmed_performance`、`confirmed_strategy` 和 `manual`。公开写接口强制使用 `manual`，不接受客户端伪造来源。相同 organization + scope + key 只允许一条 Active；替代时在同一事务中将旧记忆标记为 `superseded` 并新增记录。

Context Builder 只读取 Active、已生效且未过期的 Memory，按 L0 系统规则、L1 稳定档案、L2 当前计划/任务、L3 相关 Memory、L4 历史已发布内容结构化摘要组装。服务端上限为 L1 6 条、L3 20 条、L4 10 条和总字符估算 12000；超出时按优先级截断，并把所用 ID、截断原因、字符/Token 估算与构建时间写入 `context_snapshots.context_snapshot_json`。

Planner 的正式 Run 固定记录 `context_build`、`content_planner`、`candidate_retrieval`、`candidate_duplicate_judge`、`quality_check`、`persist_selected_contents` 六个主步骤。生成阶段只写 `planner_sessions` 与带版本的 `planner_candidates`，Run 状态停在 `manual_review_required`；高度重复或质量阻断的候选不可保存。“换角度”会创建新候选版本并再次执行检索、重复判断与质量检查，不覆盖旧版本。选中项、额度扣减、Points ledger、Run 完成状态在一个 SQLite 事务中提交。

脚本生成的 Production Run 固定记录 `context_build`、`script_generator`、`quality_check`、`persist_script_version`。账号或品牌停用、没有有效 Active Memory、Schema 失败、质量阻断或最终持久化失败时不会创建脚本版本，也不会扣 AI Points；已发生的真实 usage 与失败 Run 仍保留。只有脚本版本、Content 指针、状态日志和 Points 在事务内全部成功后，才为 `script_generator` usage 计费；`quality_checker` 不重复计费。

`script_versions` 永不覆盖旧正文，同一 Content 的 `version_no` 唯一递增。创建新草稿不会删除旧批准记录；已批准 Content 提交新版本时会进入 `WAITING_APPROVAL` 并清空 `active_approved_script_version_id`，避免拍摄误用旧版。后续 Shoot 只能读取该活动批准指针。`approvals` 保存具体 Content/Version 绑定，迁移中的数据库触发器会阻止跨组织、跨 Content 的脚本指针与审核绑定。

`shoot_contents.approved_script_version_id` 锁定加入排期时的活动已批准脚本，后续草稿不会改变历史 Checklist。加入拍摄在同一事务中执行 `APPROVED → WAITING_SHOOT`；已拍执行 `WAITING_SHOOT → SHOT`；从未执行排期移除或取消执行 `WAITING_SHOOT → APPROVED`。缺镜和改期保留 `WAITING_SHOOT`，可关联同客户、同门店的新拍摄。Shoot 整体状态只由关联项组合推导，不接受 completed count 或任意状态写入。

`edit_versions` 只记录 URL 或安全的相对本地素材引用，不上传大型视频文件。版本号在同一 Content 内唯一递增，数据库触发器禁止原地更新版本，并校验 Editor 角色、Content 版本指针和 `final_video` Approval 绑定。`SHOT → EDITING → WAITING_REVIEW`、退回到 `REVISION`、再提交和批准到 `READY_TO_PUBLISH` 均由统一服务在事务中写入状态日志，通用 transition API 无法绕过。

`publishes` 在同一组织内对每个 Content 只允许一条 Active 记录，并校验抖音作品 ID 唯一性。创建发布记录、写入 `contents.published_at`、执行 `READY_TO_PUBLISH → PUBLISHED` 和追加状态日志属于同一事务；通用 transition API 仍不能直接发布。`performance_snapshots` 对 `publish_id + snapshot_time` 建唯一约束且禁止更新，人工录入与 CSV 提交都只新增历史时间点。

互动率、团购点击率、订单转化率和千次播放 GMV 均由服务端代码计算。必要字段缺失或分母为 0 时返回 `null`，不会返回 `Infinity` 或 `NaN`。CSV 单次上限 500 行 / 1 MB，必须先映射表头、预览并修正全部错误行；提交只接受服务端保存的预览批次，重复时间点会跳过而不会覆盖旧数据。

策略复盘遵循 Compute First, LLM Second。周期内每条有效发布只选择周期结束前最后一个累计 Snapshot，代码计算发布数量、样本数量、平均/中位播放、content type / hook type / content goal 分组表现、TOP/Bottom、团购 CTR、千次播放 GMV 与发布频率。AI 输入只包含冻结的聚合事实、TOP/Bottom 结构化摘要、当月目标、最多 20 条相关 Active Memory 和已确认策略 Memory，不包含完整脚本或全部 Snapshot。Production Run 记录 `metrics_aggregate`、`context_build`、`performance_analyzer`、`strategy_planner`、`persist_strategy_review`；两个 Skill 输出都经 Schema 校验，推荐内容配比再由代码校验合计 100。最终复盘未持久化时 usage 保留但不扣 Points。

客户履约按 Monthly Plan 关联 Content 的真实 active Publish 计数。当前月进度使用 Asia/Shanghai 自然日除以当月实际天数；完成率与进度的容忍度、高风险差距、月底天数和剩余条数均来自组织级 `ops.config`。过去月份不再套用当前日期曲线：未完成的 active 计划标记 `overdue`，已停用计划标记 `closed_with_gap`。团队区只展示 Operator、Photographer、Editor 的可追溯事实，不计算绩效分。

AI 额度按 70% / 90% / 100% 分级预警。收费 Production Run 在额度不足或达到 100% 时仍由服务端统一阻止；额度耗尽后的 Test/Eval 只允许在组织配置开启时由 Owner/Admin 继续执行，且始终不扣正式 Points。`ai_usage_logs.attempts` 保存实际调用尝试次数；成本汇总中只要存在无有效价格的调用，完整 estimated cost 就返回 `null`，同时保留已知部分供排查，绝不猜价。

Run 列表与详情均在服务端移除 API Key、Authorization、Token、Base URL、数据库路径和服务器绝对路径。详情只读取同一 organization 的 Run 与 Context Snapshot，跨组织 ID 返回 404。

评分当前值保存在 `ratings`，每次修改都向不可变 `rating_versions` 追加完整快照。综合评分不高于 2、品牌事实/过期信息标签、失效 Memory 引用、高重复仍默认可选、连续两次 Schema 失败或人工标记会生成幂等 Bad Case。Bad Case Snapshot 会经过与 Run 详情相同的敏感字段脱敏。

Prompt 改进由 `prompt_improver` 通过统一 LLM Client 以 Eval Run 生成，但结果只保存为 `improvement_proposals.status=draft`，不会写入 `skills`。A/B 对每个 Eval Case 使用完全相同的 Input、Context Snapshot、Output Schema 和模型档位；结果分别保存 Eval Run 与不可变 Case Result，且不扣正式 Points。少于 3 个 Case 明确显示“数据不足”。严重品牌事实错误或失效 Memory 使用不为 0、Schema 通过率下降、高重复违规增加、关键规则总体退化或任一 Case 退化都会阻止应用。

只有 Owner / Admin 在门槛通过后显式确认，服务端才创建新 Skill 版本。系统内置 Skill 不会被组织直接改写：首次应用会复制完整历史形成组织级版本链，其他组织继续使用全局基线。直接修改或回滚生产 Prompt 均返回 `PROMPT_CHANGE_REQUIRES_EVAL`。

`strategy_reviews` 的 AI 分析与数据事实分字段保存。Draft 或 Rejected 不会写 Memory；Confirmed 才创建 `confirmed_strategy` 来源的 strategy Memory。只有有效快照内容数达到管理员阈值，并且确认时显式勾选，才额外创建 `confirmed_performance` 来源的 performance_pattern Memory。下月计划以 `inactive` 状态创建为草案，沿用月度计划唯一约束，已存在时返回 409 且不覆盖。

动态价格事实只允许来自 Context 的 L1–L3 已确认信息，不从历史内容摘要继承。模型生成 Context 中不存在的具体价格时，服务端会在展示前移除，并记录 `unverified_dynamic_fact` 质量提示；过期或 superseded 的旧价格不会进入 Context 或候选正文。

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
- Content：《老板带你认识鲁西南铜锅涮》待办内容，另有 3 条用于 Top10 召回的演示历史内容；均不含脚本正文或虚构经营指标
- Shoot：2026-09-10 德祥楼待拍演示排期；另有 1 场已完成拍摄及状态日志
- Edit：《老板带你看传统铜锅怎么开锅》已处于 `SHOT`，分配给剪辑 A，可直接演示开始剪辑与成片审核闭环
- AI：9 个系统内置 Skill；Planner、脚本、去重、质量、表现分析和策略规划均保留 v1 并使用阶段化 v2 协议，另含不计正式 Points 的 Prompt 改进 Skill；演示组织当期 1000 Points，初始已用 0
- Memory：从德祥楼 Brand/Account 已确认字段初始化 6 条，`source_type=brand_profile`、`confidence=1`

## 质量检查

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## 当前边界

当前未接入真实 OAuth、抖音 API、大型素材文件上传、自动发布、自动同步 GMV、支付、视频生成、自动剪辑、数字人或企业生产数据。发布与表现数据只支持人工录入和 CSV 导入；Seed 不预置虚构经营指标，因此首次策略复盘前需要先录入有效 Snapshot。外部审核 Token 适用于本地 MVP 演示，尚未接入短信、邮件或企业客户身份体系；原始 Token 只在提交或重发审核响应中返回一次。真实百炼调用需配置有效 Key 并为实际模型名添加价格配置；没有价格时成本显示“未知”。

本阶段没有实现 LLM-as-Judge；所有上线结论只使用可复现的 Schema、规则、人工标注和成本/耗时指标。质量中心只扫描最近 100 个 Production Run，历史更早 Run 需要后续批处理能力。

拍摄阶段只记录结构化 Checklist 与缺镜说明，不存储视频或图片文件。Performance Snapshot 不支持更新或覆盖；录错数据时当前阶段需追加新的时间点保留历史，尚未实现冲正标记流程。
