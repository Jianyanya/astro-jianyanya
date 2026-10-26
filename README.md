# 铃月の小屋

jianyanya 的个人博客，一间红金暖调的日系轻甜女仆咖啡厅 🐾

红是主角，金是亮点，黑白是骨架，粉是糖——60% 中性色 + 30% 红/黑 + 10% 金/粉。

## 特点

- 基于 **Astro 7** 静态输出，加载轻快
- 女仆咖啡厅配色：奶油白底 + 女仆红 `#B83B3B` + 琥珀金 `#D99A2B` + 腮红粉点缀
- 猫娘元素、樱花飘落、圆角卡片、柔和暖光阴影
- Pagefind 无后端全站搜索、LQIP 图片占位、Markdown 增强语法
- 内置写作室（/editor）、文章落款、i18n 多语言

## 常用命令

```bash
pnpm install       # 安装依赖
pnpm dev           # 本地开发 http://localhost:4321
pnpm build         # 生产构建
pnpm preview       # 预览构建产物
pnpm koharu generate lqips   # 图片变更后重新生成 LQIP 占位
```

> 修改 `config/site.yaml` 后需要重启开发服务器或重新构建。

铃月助手采用 Vercel + Neon PostgreSQL/pgvector 部署，配置及文章发布步骤见
[铃月部署与文章发布](docs/features/lingyue-deployment.md)。

## 结构速查

- `config/site.yaml` — 站点信息、导航、社交链接、评论等全部配置
- `src/content/blog/` — 博客文章（Markdown）
- `src/pages/about.md` — 关于页
- `src/styles/theme/` — 主题配色变量（shadcn.css / index.css）
- `public/img/` — 头图、头像、立绘等静态图片

## 致谢

基于 [astro-koharu](https://github.com/cosZone/astro-koharu) 主题改造，设计灵感来自 Hexo 的 [Shoka](https://shoka.lostyu.me/computer-science/note/theme-shoka-doc/) 主题。感谢原作者 cosZone 的开源贡献。
