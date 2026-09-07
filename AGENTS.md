<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## ContentOS 阶段提交规则

每阶段完成并执行该阶段要求的验证后，创建一个 Git commit，提交信息严格使用以下对应名称。未完成或未验证的阶段不得提前创建完成提交；该列表仅规定提交命名，不代表阶段已经完成，也不代替各阶段的业务需求。

1. `stage-01-foundation`
2. `stage-02-business-master-data`
3. `stage-03-team-permission`
4. `stage-04-content-model`
5. `stage-05-content-workflow`
6. `stage-06-ai-infrastructure`
7. `stage-07-memory-context`
8. `stage-08-history-retrieval`
9. `stage-09-ai-planner`
10. `stage-10-script-approval`
11. `stage-11-shoot-management`
12. `stage-12-edit-review`
13. `stage-13-publish-performance`
14. `stage-14-ai-review-strategy`
15. `stage-15-ops-cost`
16. `stage-16-feedback-eval`
17. `stage-17-final-integration`

提交前检查暂存内容，排除密钥、本地环境文件、数据库、依赖目录和构建产物；保留 `.env.example`、migration、seed、测试与锁文件。
