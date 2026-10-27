# 铃月部署与文章发布

当前架构：Astro 静态文章 + Vercel Node.js 聊天函数 + Neon PostgreSQL/pgvector。
2026-10-27 已完成 `belluna.love` 正式域名切换，GitHub main 推送由 Vercel 自动部署。
Cloudflare 继续管理 DNS；旧 Pages 自动构建已暂停，旧助手 Worker 路由已停用。
旧 Pages 部署、Worker、D1 和 Vectorize 保留用于回退。

## GitHub 登录与使用频次

聊天需要博客自己的 GitHub OAuth 会话，评论区 Giscus 登录不能替代服务端验证。
创建 OAuth App：Homepage URL 为 `https://belluna.love`，Callback URL 为
`https://belluna.love/api/lingyue/auth/callback`。将 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`
放在本机 `.env.local` 和 Vercel Production 服务端环境变量中，不使用 `PUBLIC_` 前缀。
本地调试 OAuth 时另建使用本地回调地址的 App；不要给不可信 Preview 部署生产密钥。

`pnpm knowledge:migrate` 会顺序执行幂等 SQL，增加登录会话、共享冷却和撤回名单，补充运行账号权限。
OAuth 使用 state 和 PKCE；仅读取公开账号信息，不请求仓库权限，GitHub Token 只在回调请求中使用。
会话有效期 7 天，浏览器保存 HttpOnly Cookie，数据库只保存随机会话 Token 的哈希。
退出会撤销当前会话。浏览器对话按账号分别在标签页暂存，不上传为长期记忆。

每个 GitHub 账号每天 **20 次**（`DAILY_VISITOR_LIMIT=20`，北京时间零点恢复），
清缓存、换设备或重新登录不会重置账号额度。还有原有 IP、全站次数和费用上限。
`USER_COOLDOWN_SECONDS=10` 控制同账号请求间隔；`MODEL_START_INTERVAL_SECONDS=2` 控制全站开始间隔，
`MAX_CONCURRENT=2` 控制并发。上游返回 429/503 时，共享冷却至少
`MODEL_COOLDOWN_SECONDS=30` 秒，较长的 `Retry-After` 也会被尊重。
前端倒计时结束只刷新状态，不会自动重新提交问题。

明确被 429 等请求校验错误拒绝的生成退还次数和预算；断流、超时、网关 5xx 等未知用量仍保留预算。
这些间隔是本站保护设置，不代表服务商实际配额；持续限流仍需检查服务商的限额和服务状态。
服务端只记录阶段、错误类别和 HTTP 状态，不记录 Key、OAuth Code、GitHub Token 或对话正文。

## 调整聊天框左侧位置

大屏定位由 `src/components/lingyue/companion.ts` 的 `positionDock()` 计算：
`textLeft - width - 40` 中 `40` 是聊天框与正文的间隔，增大它就继续向左移动。
`src/components/lingyue/dock.css` 的 `--lingyue-dock-left: 12px` 是小屏/回退位置，
大屏会被 JS 设置的变量覆盖。调整时检查是否越过屏幕左边缘，不要修改文章容器宽度或边距。

## 模块位置

| 目录 | 职责 |
| --- | --- |
| `src/components/lingyue/` | 原有形象、动效、聊天 UI，按需加载 |
| `src/server/lingyue/` | 人格、模型、混合检索、HTTP/SSE、额度账本 |
| `src/pages/api/lingyue/[action].ts` | `/api/lingyue/chat`、`/api/lingyue/quota` |
| `src/features/lingyue/` | 公开文章快照、站点知识指纹 |
| `scripts/lingyue/` | 本地向量生成、上传、启用、发布和清理 |
| `migrations/lingyue/` | 数据库初始化 SQL |

文章正文和向量不放入浏览器 props；AI 没有文件、SQL、Shell 工具。
站点文章继续预渲染，只有聊天/额度接口按请求运行。
`vercel.json` 为聊天和额度路径显式转发到 Astro 的 `_render` 函数；项目同时有独立的
写作室预览函数，首次部署已发现仅依赖适配器生成的路由会导致聊天路径返回平台 404。
构建后检查还会校验函数路由和私有文件未进入公开输出。

## 首次配置

1. 在 Neon 创建供铃月使用的数据库，将发布账号连接串写进本机 `.env.local`：

   ```dotenv
   KNOWLEDGE_DATABASE_URL=postgresql://发布账号:密码@主机/数据库?sslmode=verify-full
   ```

2. 执行 `pnpm knowledge:migrate`。脚本创建表和 `lingyue_runtime` 角色，将受限账号的
   `DATABASE_URL` 保存到同一忽略文件。重复执行不重置已有角色密码。
   运行角色能读取知识、写额度账本，不能改文章、向量和有效版本。

3. 本机配置 `CHAT_BASE_URL`、`CHAT_MODEL`、`CHAT_API_KEY`、`SILICONFLOW_API_KEY`、
   `COOKIE_SECRET`、`SITE_ORIGIN` 和现有额度/预算。已有父目录配置可执行
   `node --import tsx scripts/lingyue/configure-local.ts` 复制缺少的服务端字段。

4. 如有旧 Cloudflare 向量缓存，执行 `pnpm knowledge:import-cloudflare`。
   它通过已有 Wrangler 登录只读导出缓存，不改变旧知识版本或额度。只需迁移时执行。

5. 本地执行 `pnpm build`、`pnpm knowledge:begin`、`pnpm generate:knowledge`、`pnpm knowledge:stage`。
   前者构建快照并生成缺少的向量；后者上传完整待发布版本，不改变线上有效版本。

6. Vercel 导入 GitHub 原博客仓库，框架 Astro，构建 `pnpm build`，保持框架默认输出设置。
   仓库根目录就是包含 `package.json` 的目录，和本机外层工作区名称无关。
   选择平台支持且满足 package.json 的 Node 版本，函数与 Neon 区域尽量靠近。

7. Vercel 服务端配置 `DATABASE_URL`（受限账号）、模型配置、`COOKIE_SECRET`、站点地址及额度。
   **不要上传 `KNOWLEDGE_DATABASE_URL`**，不使用 `PUBLIC_` 前缀。
   测试/Preview 环境使用独立数据库和对应 `SITE_ORIGIN`，不要让不可信 PR 使用生产密钥。
   当前模型保持 Intern Discovery `deepseek-v4.1-flash-1017`，Embedding `BAAI/bge-m3`。

8. 验证临时站点后，将正式域名绑定 Vercel；Cloudflare DNS 可以继续保留。
   切换时撤掉旧 Worker 的 `/api/lingyue/*` 路由，防止流量被旧后端接管。
   对正式站点运行 `pnpm knowledge:activate`，只有知识指纹一致才启用。
   对测试站点可显式传 `--origin=https://你的测试域名`，必须使用隔离数据库。

CLI 若无法写系统目录，使用 `pnpm exec vercel login --global-config .vercel/local-auth`。
所有后续 CLI 命令都带同样的 `--global-config`；这个目录受 Git 忽略，不会被部署。

## 日常文章更新

```sh
# 修改、增加或删除 Markdown 后
pnpm generate:summaries   # 按需
pnpm generate:tags        # 按需

# 审阅并提交本次内容，发布脚本不会自动 git add 无关文件
git add <本次需要提交的文件>
git commit -m "docs: update posts"

# 构建快照 → 线上撤回删除/私密文章 → 本地增量向量 → 上传 → Git push → 验证网站 → 启用知识
pnpm publish:blog
```

首次迁移需先完成账号与域名配置。普通更新不需要手动部署 Worker，也不需要 GitHub Actions Token。
迁移推送前暂停旧 Cloudflare Pages 的生产/预览自动构建，保留原部署作为回退；
否则同一次 Git 推送会让旧平台尝试发布新的 Vercel 构建产物。
本地编辑和 `generate:knowledge` 不改变线上知识；后者仍会对缺少的向量调用 Embedding API。
本地向量缓存不提交 Git，换电脑后需要恢复缓存或从数据库导出。
如果构建更新了有意跟踪的 `.cache/og-data.json`，请审阅并提交后重试发布。

`publish:blog` 等待最多 20 分钟。失败时在 `.cache/lingyue/release.json` 记录阶段，
待发布版本可重复上传。网站稍后部署成功，可以运行 `pnpm knowledge:activate` 重试最后一步。
只有内容指纹匹配才允许切换；另一个发布已经启用时，CAS 会拒绝覆盖。
不要在等待期间修改文章或并行发布，也不要将发布中断误认为已全部上线。

也可分步运行：`pnpm build` → `knowledge:begin` → `generate:knowledge` → `knowledge:stage`
→ Git 推送/网站部署 → `knowledge:activate`。`knowledge:begin` 是明确的线上发布操作，
根据刚构建的快照撤回文章并保存本机发布凭据；单独本地编辑、构建和生成向量不会撤回。
激活必须使用匹配快照的发布凭据，不能沿用被后续发布或人工撤回作废的凭据。
网站部署和数据库不是一个事务；部署成功到知识启用之间可能有短暂版本差，失败需重试。

## 更新与删除

- 快照只包含允许公开的文章；草稿、带密码或加密块的文章被排除。
- 新版本完整保存本次公开片段，正文和向量在同一数据库事务中写入。
- 激活只修改有效版本；所有召回在取 top-k 前限定该版本。
- 删除/转私密在正式发布开始时先写入独立撤回名单，所有召回在 top-k 前排除；
  重排后、模型请求前和返回来源时再次检查。之后生成/部署失败，撤回仍然保留。
  仅在本机删除文件、构建、运行 `generate:knowledge` 不影响云端。
- 紧急只撤回一篇可执行 `pnpm knowledge:withdraw --id=文章ID`，不需要先生成向量或部署。
  ID 是快照使用的文章 ID，不是标题或任意文件路径；该操作也作废旧发布凭据。
- 恢复公开文章要重新发布，完整新版本验证启用后才清除对应撤回标记。
- 修改后旧片段不会混入新版本；生成、上传失败不会发布部分数据。
- 允许空知识库；恢复文章可以生成或启用对应版本。
- 旧版本保留 7 天供故障回退和在途请求，应用查询不会读取它们。
- `pnpm knowledge:cleanup` 独立、可重复执行，不依赖文章发生变化。
  每次成功启用也会尝试清理；失败后下次执行重试。尚无定时物理清理任务。
- 已经发给访客的回答和旧会话历史不会因为删除文章而自动撤回。
  已发送给模型的在途请求也不能追回；撤回检查保证的是后续检索和下一次模型调用的证据。

目前向量搜索使用 pgvector 精确余弦距离。关键词分支沿用中文分词、标识符与汉字二元词，
当前 PostgreSQL 实现是标题/标签/正文加权词项匹配；不是原 SQLite FTS5 BM25，
迁移验收需对比召回结果。RRF、重排和最多 6 个来源的对话流程保留。
完整切分策略、真实 tokenizer、证据门槛与评测说明见 [RAG 实现说明](./lingyue-rag.md)。

本轮优化首次发布前执行 `pnpm knowledge:migrate`，随后按上述发布流程重建/启用新版本。
新增 SQL 向后兼容旧服务；不要只部署新代码而漏掉撤回表和运行账号 SELECT 权限。

## 验证与回退

```sh
pnpm lint:fix
pnpm check
pnpm test:lingyue
pnpm build
```

Windows 无符号链接权限时，本地构建使用 Node 适配器；正式 Vercel/Linux 构建使用官方 Vercel
适配器。同一套 API 代码，本地可运行 `node dist/server/entry.mjs` 验证产物。
本地 PGlite 测试是真实 PostgreSQL/pgvector SQL 执行，但不代表线上网络、并发和取消已经验收。

域名切换前验收：正常文章与 Pagefind、Markdown 回答、人设、来源、取消、错误 Key、额度、
新增/更新/删除、知识指纹、HTTPS 和实际访客网络访问。
首次迁移使用新的 Neon 额度账本，旧 Cloudflare DO 的历史额度/预算不自动迁入；
切换当天访客次数会重新计数。后续部署一直复用 Neon 账本，不会随函数重启或部署重置。
旧资源保留期间不要执行旧 Cloudflare 同步脚本覆盖其回退数据。
网站回滚时知识版本也要匹配；知识启用命令仍会验证实际站点指纹，不能仅回滚前端便认为完成。

如需整体回退到迁移前的 Cloudflare 版本：先确认旧 Pages 保留部署和旧知识库可用，
将根域名重新指向旧 Pages，并恢复 `belluna.love/api/lingyue/*` 到 `belluna-lingyue` Worker
的路由及其所需代理配置。不要直接恢复旧 Pages 对新 main 的自动构建；先选择对应的旧代码。
Neon 数据保持不动，待回退站点的文章和回答确认正常后再处理后续发布。
