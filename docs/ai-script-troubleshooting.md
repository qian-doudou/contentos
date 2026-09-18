# AI 脚本：真实生成与排障

## 操作路径

1. 启动现有项目，打开 `/scripts/new`，选账号。品牌与 Memory 自动带入，不必重新填写。
2. 点击“AI 生成 3 组方向”，等待策划、历史检索与质量检查完成。
3. 选一组方向，可调整拍摄参数，点击“按这个方向生成脚本”。
4. 成功后展示口播、分镜、产品植入、行动引导和标签，可复制或修改，之后再提交审核。
5. 页面地址保留 `sessionId`；刷新或重新打开该地址能恢复已保存脚本，不重复扣费。

生成结果仍是待审草稿，品牌事实、医疗表述等须由业务人员审核后使用。生成成功不等于审核通过或可以自动发布。

## 分清真实与演示

- 有 `LLM_API_KEY`（或 `DASHSCOPE_API_KEY`）：调用配置的模型。调用失败返回业务错误，不保存替代模板脚本。
- 没有 Key：确定性 Mock，供本地演示，不表示千问已经可用。
- 页面“千问已配置”只代表存在配置。真实成功应在 `/ops/runs` 中同时看到实际模型、provider request id、Token 用量和成功步骤，不能只看页面有文字。
- 历史 `mock-fallback:*` Run 是旧版降级记录，不是真实模型返回，不会改写这些历史记录。
- 没有有效价格配置时成本为 `unknown`；不根据模型名称猜测费用。

## 网络与代理

部分电脑的浏览器和 curl 能访问百炼，但 Node 原生 fetch 不自动使用 HTTP 代理，导致之前生成时反复连接超时。统一 Provider Transport 使用 Undici Agent，只对服务端 AI/Embedding 请求启用：无代理时直连，配置代理时读取 `https_proxy` / `HTTPS_PROXY`、`http_proxy` / `HTTP_PROXY` 和 `no_proxy` / `NO_PROXY`。`LLM_CONNECT_TIMEOUT_MS` 单独限制建立连接的等待，不会截断已经开始返回的模型生成。

代理必须是自己正在使用且可信的代理。不要盲目复制他人的代理地址；Key 不能放在前端或 URL 中。修改环境变量后重启 `npm run dev`，不要关闭现有服务之外的进程。代理凭据、Key 和完整环境变量不会写入前端或 Run Trace。

官方接口资料：[百炼 Chat Completions](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[百炼结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)、[Undici 环境代理](https://github.com/nodejs/undici/blob/main/docs/docs/api/EnvHttpProxyAgent.md)。

## 输出协议

每次请求把当前 Skill 保存的 Output JSON Schema 附在运行时消息中，明确字段、类型、枚举和必填项；返回后仍经过 Schema 和业务校验。百炼支持的混合思考 Qwen 模型使用非思考模式进行 JSON 生成。这里只修复统一客户端协议，不自动编辑任何生产 Skill Prompt 或历史版本。

## 可恢复错误与扣点

- `LLM_CONNECTION_FAILED`：检查启动服务的网络与代理；最多重试一次。
- `LLM_TIMEOUT`：模型整体生成超时；不会自动重复发起同一任务，检查网络或调整 `LLM_TIMEOUT_MS` 后手动重试。
- `LLM_AUTH_FAILED`：检查 Key、服务地域和模型权限；不无意义重试。
- `LLM_RATE_LIMITED`：检查百炼余额或限流，稍后重试。
- `LLM_MODEL_NOT_FOUND`：核对模型名称与 API 地址。
- `LLM_OUTPUT_INVALID` / `LLM_RESPONSE_INVALID`：返回格式不合法；不会把未校验结果写入业务表。

选题已保存而脚本失败时，保留选题和已成功的策划费用；脚本失败不扣脚本积分。重试只生成脚本，不重复保存选题。失败 Run 保留尝试次数，未返回的 Token 用量为 null，不虚构 0。

## 本次真实验证（2026-09-16）

通过浏览器在仁爱宠物医院 Demo 账号执行，没有直接调用模型绕过 Run Trace：

- 生成三组选题：`qwen3.7-plus`，4409 input / 885 output tokens，模型请求 16293 ms。
- 选择一组并生成 Script V1：`qwen3.8-max`，5066 input / 888 output tokens，模型请求 23304 ms。
- 两次质量检查均由 `qwen3.8-flash` 实际返回；Planner 与 Script Run 均为 completed。
- 成功保存选题与脚本合计扣 5 Points，余额 985 → 980；不是替代模板。

以上是这一次联调记录，不是性能保证。最终用户使用前仍需审核草稿。
