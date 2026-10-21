# 铃月：本地生成知识库，Cloudflare 发布博客

## 当前模型服务

摘要、标签和铃月对话使用 Intern Discovery 的 `deepseek-v4.1-flash-1017`，OpenAI 兼容地址为 `https://discovery-api.intern-ai.org.cn/v1`。摘要/标签使用博客本机 `.env` 的 `SUMMARY_API_BASE_URL`、`SUMMARY_MODEL`、`SUMMARY_API_KEY`；线上对话使用 Worker 的 `CHAT_BASE_URL`、`CHAT_MODEL` 和 Secret `CHAT_API_KEY`。修改本机 `.env` 不会自动更新线上 Secret。

生成与对话均显式关闭 thinking；SDK 的 `reasoning_effort: low` 会开启思考，可能耗尽标签的短输出预算，因此不同时设置。Embedding 和重排继续使用原 SiliconFlow BGE 模型，无需重建已有向量库。旧 `DEEPSEEK_API_KEY` 仅兼容官方接口配置，不会被转发给新服务商。配额和预算预留设置保持不变，预算数值只是保护阈值，并非新平台的实际账单。

沿用博客已有流程：本地生成摘要、标签和知识库，再提交 Markdown 并推送 GitHub；Cloudflare Pages 按原配置自动发布博客。保留 Worker + D1 + Vectorize + SQLite Durable Object，不增加 GitHub Actions，不要求额外创建 `CLOUDFLARE_API_TOKEN`。

## 日常更新

在博客仓库根目录运行：

```powershell
pnpm generate:summaries
pnpm generate:tags
pnpm generate:knowledge
git add .
git commit -m "docs: update posts"
git push
```

摘要和标签仍按需要生成。修改完文章和标签后再运行知识库命令，避免索引与最终内容不一致。

`pnpm generate:knowledge` 会：

1. 运行现有 `pnpm build`，通过 Astro 的 collection、正式 slug、locale 和公开性规则生成最新知识快照。
2. 捕获本机 Wrangler 登录授权，仅在内存中用于访问现有 D1 和 Vectorize。
3. 本地切分 Markdown，仅为新/变化的内容调用 SiliconFlow BGE-M3；复用已有 embedding 缓存和未变向量。
4. 同步 D1 的片段、关键词索引和 Vectorize；删除、草稿、密码和加密文章先撤出检索。
5. 等待新增向量可检索后切换有效版本，记录 `.cache/lingyue/last-sync.json`。内容没变时直接跳过。

**此命令包含云端同步，并非纯离线导出。** 知识库会在命令成功时更新；文章网页要等随后 git push 和 Pages 部署完成才更新，两者可能短暂不同步。建议同步成功后立即推送。更新失败不切换有效索引，被撤回的文章仍先停止检索。

只提交 Markdown、摘要/标签等既有产物和代码配置。知识快照、向量缓存、数据库和 Key 不提交 Git，也不会作为客户端 props 或公开静态文件发布。不能仅提交一个本地 JSON 文件就让 Vectorize 自动导入它。

## 本机配置（已有部署，无须重复创建资源）

```powershell
pnpm install --frozen-lockfile
pnpm --dir cloudflare exec wrangler login
```

本机已经登录时不用重复登录；授权失效时重新执行登录命令。`cloudflare/wrangler.jsonc` 中的 `account_id`、D1 的 `database_id` 和 Vectorize 的 `index_name` 指向已有资源，均不是秘密。迁移账号时再修改，日常写作无需处理。

博客 `.env` 中设置 `SILICONFLOW_API_KEY`。读取优先级：进程环境 → 博客 `.env` → 父目录 `.env`，因此当前 `E:/assitantAI/.env` 中的配置继续有效。此命令不使用 `CLOUDFLARE_API_TOKEN`，也不向 GitHub 上传凭据。

聊天 Key、SiliconFlow Key 和 Cookie secret 已保存在 Worker Secrets。知识生成命令只需要 embedding Key，不需要聊天 Key，也不会更改 Worker 的聊天配置、配额或人设。

完整命令会自动重建博客以保证快照新鲜。如果刚手动运行过 `pnpm build`，可用低层命令复用该快照：

```powershell
pnpm --dir cloudflare sync:local
```

使用低层命令前，必须确认快照对应最新文章。成功后 `.cache/lingyue/last-sync.json` 记录版本和同步时间；失败输出不会包含 Key。

## 部署与维护

博客仍由原 Pages 项目从 GitHub main 自动部署，普通文章访问不调用模型。助手 API 在 `belluna.love/api/lingyue/*` 上由 Worker 处理，D1 保存内容/FTS5，Vectorize 保存 BGE-M3 向量，SQLite Durable Object 处理限额和预算。

文章知识更新无需重新部署 Worker。只有修改助手后端代码或配置时才执行：

```powershell
pnpm --dir cloudflare check
pnpm --dir cloudflare test
pnpm --dir cloudflare build # dry-run
pnpm --dir cloudflare run deploy
```

`pnpm --dir cloudflare sync` 保留为显式 API Token 的高级维护入口，日常使用 `generate:knowledge` 即可。此前准备的助手 GitHub Actions 工作流已从本地方案移除；原博客 Cloudflare 自动部署保持不变。

## 验证边界

2026-10-21 首次部署已上线 129 篇文章、521 个切片。真实短对话、指定文章的混合检索/重排/引用、较长流式回复和浏览器聊天检查通过。用户确认 Workers 套餐为 Free，本轮没有购买或升级付费计划。DeepSeek 仍按用量收费。

免费 Worker 标称每次请求 10ms CPU，等待模型的网络时间不计 CPU。首批采样部分请求超过标称值，但抽测未出现 CPU 超限中断；不能据此保证长期免费运行的稳定性，仍应观察线上 CPU 和额度。不要自动升级套餐。

每次改动后的检查仍为 `pnpm lint:fix`、`pnpm check`、相关测试和 `pnpm build`。知识同步需要联网，新增片段会调用 embedding 服务，原有摘要/标签命令使用其各自的模型配置。
