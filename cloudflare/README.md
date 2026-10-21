# 铃月：Cloudflare 免费部署

## 当前状态（2026-10-21）

后端已部署到 `https://belluna.love/api/lingyue/`，D1 与 Vectorize 已发布 129 篇文章、521 个切片。真实短对话、指定文章的混合检索/重排/来源引用、较长流式回复、重复请求拦截和跨站限制均已通过首次验证。未购买或升级付费计划；这不代表所有流量与长历史都已通过免费 CPU 限制测试，仍需观察线上指标。

用户决定先完成首次部署，自动更新稍后配置。GitHub Actions 工作流默认关闭：只有仓库变量 `LINGYUE_AUTO_SYNC=true` 才执行。未配置 Token 和启用工作流前，后续文章变更不会自动更新助手索引。

首次接入修复：REST D1 接收 SQL 对象而非 Worker binding 的 batch 数组；构建器用十六进制文本字面量安全序列化绑定参数，真实失败回滚已验证。请求支持有限重试，写入保持幂等。索引恢复复用已有向量，按 128 条合并上传并统一等待 Vectorize 异步处理完成。Worker 的默认 fetch 显式绑定全局对象，避免 Node 与 Workers 调用上下文差异。

博客继续由原 Cloudflare Pages/GitHub 项目发布。`belluna.love/api/lingyue/*` 由独立 Worker 路由处理，D1 保存公开知识片段与关键词索引，Vectorize 保存 BGE-M3 向量，SQLite Durable Object 保存限额和预算账本。无容器、无常驻服务器；不需要升级 Cloudflare Pro 或 Workers Paid。

DeepSeek Flash 仍按模型用量扣费。SiliconFlow 标准版 BGE-M3/重排目前免费。Cloudflare 免费套餐的 CPU、存储和操作次数都有上限，部署后必须检查实际用量，不能把本机打包或模拟测试当作免费套餐性能验收。免费 Worker 每次请求 10ms CPU，等待模型网络响应不算 CPU。超过免费额度时应暂停/排查，不自动购买付费服务。

## 首次配置（只做一次）

在博客仓库根目录执行。以下资源操作需要已登录自己的 Cloudflare 账号，尚未执行。

```powershell
pnpm install --frozen-lockfile
pnpm --dir cloudflare exec wrangler login
pnpm --dir cloudflare exec wrangler whoami
pnpm --dir cloudflare exec wrangler d1 create lingyue-knowledge
pnpm --dir cloudflare exec wrangler vectorize create lingyue-knowledge --dimensions=1024 --metric=cosine
pnpm --dir cloudflare exec wrangler vectorize create-metadata-index lingyue-knowledge --property-name=document --type=string
```

记录账号 ID 和新建 D1 的数据库 ID。确认账号仍在 Free 计划，并能创建免费 Vectorize 索引；如控制台要求付费，先停止并核对，不确认升级。

```powershell
$env:CLOUDFLARE_ACCOUNT_ID='<账号 ID>'
$env:LINGYUE_D1_ID='<D1 数据库 ID>'
node cloudflare/scripts/configure.mjs
pnpm --dir cloudflare migrate
pnpm --dir cloudflare deploy
pnpm --dir cloudflare exec wrangler secret put DEEPSEEK_API_KEY
pnpm --dir cloudflare exec wrangler secret put SILICONFLOW_API_KEY
pnpm --dir cloudflare exec wrangler secret put COOKIE_SECRET
```

三个 `secret put` 命令会交互读取输入，不把 Key 写进命令参数、Git 或前端。Cookie secret 使用随机且至少 32 字符的值，不能使用示例值或 API Key。部署前检查 `wrangler.jsonc` 的路由仍为自己的 `belluna.love`，域名由同一账号管理并启用 Cloudflare 代理。此 Worker 没有公开管理/写文章接口，也不运行 Qdrant。仅允许模型读取知识。

## 后续写博客：正常提交即可

仓库内 `.github/workflows/lingyue.yml` 在 `main` 分支推送后自动执行：

1. 检查和测试助手，构建博客，生成 `.cache/lingyue/snapshot.json`。
2. 应用 D1 迁移，撤回已删除、草稿、密码文章和含加密块文章。
3. 对比快照和切片哈希；没有变化直接跳过。新/变化切片生成 embedding，未变向量不重新上传；已缓存的相同文本向量直接复用。
4. 准备新一版 D1/FTS 索引，等待新增向量在 Vectorize 可查询，然后切换有效版本。
5. 部署 Worker。原博客的 Cloudflare 自动发布流程保持不变。

GitHub 仓库 **Settings → Secrets and variables → Actions** 配置：

| 类型 | 名称 | 用途 |
|---|---|---|
| Variables | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| Variables | `LINGYUE_D1_ID` | D1 数据库 ID |
| Variables | `LINGYUE_AUTO_SYNC` | 准备好凭据后设为 `true` 启用自动发布，未设置时跳过任务 |
| Secrets | `CLOUDFLARE_API_TOKEN` | CI 发布、D1 和 Vectorize 写入 |
| Secrets | `SILICONFLOW_API_KEY` | CI 为新增片段生成向量 |

CI Token 限定到该账号与博客域名，所需权限为 Account Workers Scripts Edit、D1 Edit、Vectorize Edit，以及 Zone Workers Routes Edit / Zone Read。Cloudflare Wrangler 的本机 OAuth 登录不能代替 GitHub Actions 的 Token。DeepSeek Key 只需要放在 Worker Secret，无须加入 GitHub Actions。

完成后先从 Actions 手动运行一次该工作流。以后照常修改 Markdown 并推送即可；失败时 Actions 会标红，修正后重新运行，无须手动删除索引。两个发布流程独立，文章发布和助手知识更新可能相差几分钟；只有同步成功后助手才使用新内容。若需要严格同时发布，可后续统一发布入口。

D1 保存版本化的内容，Vectorize 的向量 ID 按内容稳定生成。更新时少量旧/新向量可能共存，检索结果必须再次通过有效 D1 版本与公开文章名单校验，只有通过的内容才进入模型上下文。旧/失败版本向量在下次同步时回收，embedding 缓存也随成功发布清理。失败的构建不切换有效版本，但被撤回文章会先停止检索。CI 并发串行化，D1 发布锁避免本机与 CI 同时写索引。

## 本机调试与同步

旧的 Node/Qdrant 本机版本保留。要调试 Worker，在 `cloudflare/.dev.vars` 中设置本地 Cookie secret、模型 Key、`SITE_ORIGIN=http://localhost:4321`，执行 `pnpm --dir cloudflare dev`；博客启动前设置 `LINGYUE_DEV_BACKEND=http://127.0.0.1:8788`。本地 Vectorize 不能用普通内存替代来验收真实召回；完整检索仍需账号绑定与线上测试。本地调试不会自动复用父目录 `.env`。

手动同步仅作为 CI 故障排查入口：先 `pnpm build`，在进程环境设置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`LINGYUE_D1_ID` 和 `SILICONFLOW_API_KEY`，再 `pnpm --dir cloudflare sync`。不要将这些值写进仓库。

```powershell
pnpm --dir cloudflare check
pnpm --dir cloudflare test
pnpm --dir cloudflare build # dry-run，不创建远程资源
pnpm lint:fix
pnpm check
pnpm build
```

## 上线检查

- `/api/lingyue/quota` 返回 JSON，响应不可缓存，Cookie 为 HttpOnly/Secure。
- Flash 能流式回答，知识问题携带有效文章来源，社交短句保持现有人设。
- 取消回复会中止上游请求，重复请求不会重复扣次数；额度/预算在 Worker/DO 重启后保留。上游已调用但无 usage 的请求保留预留费用，避免取消刷额度。
- 修改、删除、设为私密的文章经过一次推送后按预期更新；模拟 embedding 失败时旧有效知识仍可用，撤回内容不再进入回复。
- 在 Cloudflare 查看 CPU 时间、D1 扫描行数、Vectorize 查询/存储维度；未实测前不保证 10ms CPU 可覆盖所有长历史和流式情况。
- 日常浏览文章和角色静态素材不进入助手 Worker，不产生模型调用；会话历史仍只保存在浏览器会话缓存，不写入长期记忆。

参考：[Workers 价格](https://developers.cloudflare.com/workers/platform/pricing/)、[Vectorize 价格](https://developers.cloudflare.com/vectorize/platform/pricing/)、[D1/FTS5](https://developers.cloudflare.com/d1/sql-api/sql-statements/)、[Vectorize 异步写入](https://developers.cloudflare.com/vectorize/reference/client-api/)。
