# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, etc.) working in this repository. This is the single agent-instructions file; do not add a separate `CLAUDE.md`.

## Project Overview

astro-koharu is an Astro-based blog rebuilt from Hexo, inspired by the Shoka theme. It uses React for interactive components, Tailwind CSS for styling, and maintains compatibility with legacy Hexo blog content.

## Core Engineering Principles

### 1. Module-First Principle
**Every feature must be implemented as a standalone module with clear boundaries.**
- Logic organized into focused, single-responsibility modules
- Module structure: `src/lib/` (utilities), `src/hooks/` (React hooks), `src/components/` (UI), `src/store/` (state), `src/constants/` (config)

### 2. Interface-First Design
**Modules must expose clear, minimal public APIs.**
- Use barrel exports (`index.ts`) to define public interfaces
- Export TypeScript types alongside implementations
- Document complex functions with JSDoc

### 3. Functional-First Approach
**Prefer pure functions over stateful classes; manage side effects explicitly.**
- Write pure functions (same input → same output)
- Isolate side effects at boundaries
- Immutable data transformations using es-toolkit

### 4. Test-Friendly Architecture
**Design code to be testable without mocking.**
- Pure functions are naturally testable
- Testing priorities: High (lib utilities, data transformations) > Medium (hooks, state) > Low (UI components)

### 5. Simplicity & Anti-Abstraction
**Resist premature abstraction; three instances before extracting a pattern.**
- Don't create abstractions for single-use cases
- Maximum 3 levels of module nesting

### 6. Dependency Hygiene
**Manage dependencies carefully; avoid circular imports and bloat.**
- Use dynamic imports for heavy dependencies (>100KB)
- Conditional bundling for optional features
- No circular dependencies

## IMPORTANT Guidelines

- **Documentation lookup**: Use Context7 MCP server or WebSearch for official docs
- **Keep AGENTS.md updated**: Ask to update when making architectural changes
- **Run lint before completion**: `pnpm lint:fix` must pass before completing tasks
- **Check for dead code**: Run `pnpm knip` periodically
- **Build cache**: `.cache/og-data.json` is intentionally committed to Git for build acceleration (OG metadata cache for link embeds). Do NOT add it to `.gitignore`. Other files under `.cache/` (transformers models, summaries-cache) are already ignored.

## Development Commands

Package manager: **pnpm** (`pnpm@10.28.2`)

```bash
# Development
pnpm dev              # Start dev server at http://localhost:4321
pnpm build            # Build for production
pnpm preview          # Preview production build
pnpm check            # Run Astro type checking
pnpm test             # Run all node:test suites (see package.json test:* scripts)
pnpm cms:install && pnpm cms   # Local CMS (React/Vite app in cms/) at http://localhost:4322

# Linting & Code Quality
pnpm lint             # Run Biome linter and formatter
pnpm lint:fix         # Auto-fix linting issues
pnpm knip             # Find unused files/dependencies

# Koharu CLI (Interactive TUI)
pnpm koharu              # Interactive menu
pnpm koharu backup       # Backup blog content and config (--full for complete backup)
pnpm koharu restore      # Restore from backup (--latest, --dry-run, --force)
pnpm koharu update       # Update theme from upstream (--check, --skip-backup, --force, --rebase, --clean)
pnpm koharu migrate      # Migrate legacy post links (--dry-run, --force; automatically backs up before writes)
pnpm koharu generate     # Generate content assets (interactive menu)
pnpm koharu generate lqips        # Generate LQIP image placeholders
pnpm koharu generate similarities # Generate semantic similarity vectors
pnpm koharu generate summaries    # Generate AI summaries (--model, --force)
pnpm koharu generate all          # Generate all content assets
pnpm koharu clean        # Clean old backups (--keep N to retain N most recent)
pnpm koharu list         # List all backups
```

**Note on Configuration Changes:** After modifying `config/site.yaml`, restart the dev server or rebuild. The YAML configuration is cached during build for performance.

**Config normalization:** `src/lib/config/site.ts` is the single YAML parse/assembly point. Each config section has a pure `normalize*(raw)` function in `src/lib/config/` (content, featured-series, moments) owning its default table and validation — add new sections there, with node:test coverage, instead of reading `yamlConfig` ad hoc. `src/constants/site-config.ts` is a thin assembly/compat layer; `src/lib` must not import from `@constants/site-config`.

## Architecture

### Tech Stack
- **Framework**: Astro 7.x with React integration
- **Styling**: Tailwind CSS 4.x with plugins
- **Content**: Astro Content Collections (`src/content/blog/`)
- **i18n**: Custom translation system (`src/i18n/`) with Astro i18n routing
- **Animations**: Motion (Framer Motion successor)
- **State**: Nanostores
- **Search**: Pagefind (static)
- **Utilities**: es-toolkit, date-fns, sanitize-html

### Project Structure
```plain
src/
├── components/   # React & Astro components
├── content/blog/ # Markdown/MDX posts (translations under <locale>/ subdirs)
├── i18n/         # Internationalization (translations, config, utils)
├── layouts/      # Page layouts
├── pages/        # File-based routing ([lang]/ mirrors for non-default locales)
├── lib/          # Utility functions
├── hooks/        # React hooks
├── constants/    # Config, router, animations
├── scripts/      # Build-time scripts
├── store/        # Global state (nanostores)
└── types/        # TypeScript types
```

### Module Organization

**Dependency Flow** (avoid circular dependencies):
```plain
pages/ → components/ → hooks/ → lib/ → constants/
                               ↓
                             types/
```

**File Naming**:
- Barrel exports: `index.ts`
- Single export: Match filename (`useMediaQuery.ts`)
- React components: PascalCase (`PostCard.tsx`)

**Module Size Limits**:
- Max 500 lines per file
- Max 15 public exports per module
- Max 10 imports per file

### Path Aliases
```plain
@/          → src/
@lib/*      → src/lib/*
@hooks/*    → src/hooks/*
@components/* → src/components/*
@constants/* → src/constants/*
```

### Key Concepts

**Content System**: Blog posts in `src/content/blog/` using Astro Content Collections. Hierarchical categories supporting `'工具'` or `['笔记', '前端', 'React']`.

**Featured Series**: Special category-based content series with dedicated pages and homepage highlights. Configured via `featuredSeries` in `config/site.yaml`. Each series requires a unique `slug` (must not conflict with reserved routes) and `categoryName`. Supports multiple series, individual enable/disable, and homepage highlight control. Dynamic routes generated at `[seriesSlug].astro`.

**Bangumi Page**: Optional media tracking page integrating [Bangumi API](https://api.bgm.tv). Configured via `bangumi` section in `config/site.yaml` — comment out to disable (page + navigation auto-hidden). Data fetched client-side in React (`BangumiCollection` component with `client:load`). Types in `src/types/bangumi.ts`, API client in `src/lib/bangumi/`, data hook in `src/hooks/useBangumiData.ts`. Navigation item auto-injected via `routers` in `src/constants/site-config.ts`.

**Theme System**: Dark/light toggle with localStorage, inline check in `<head>` prevents FOUC.

**i18n System**: Two-layer translation architecture with locale-aware routing.
- **UI strings** (`src/i18n/translations/`): TypeScript dictionaries with `t(locale, key, params?)` function. Keys defined in `zh.ts` (source-of-truth), other locales are partial overrides. ~170 keys.
- **Content strings** (`config/i18n-content.yaml`): YAML-based translations for category names, series fields, featured category labels. Accessed via `getContentCategoryName()` / `getContentSeriesField()` / `getContentFeaturedCategoryField()` (internal to `src/lib/content/categories.ts`).
- **Routing**: Default locale has no URL prefix; other locales use `/<locale>/` prefix. Static pages in `src/pages/[lang]/` are thin wrappers using `getLocaleStaticPaths()`. Dynamic routes declare their param space once in `src/pages/_shared/routes.ts`; root/mirror pages share it via `localePaths(enumerate)` from `src/pages/_shared/utils.ts`, which injects `locale` into props — pages pass it explicitly to `<Layout locale={...}>`. `assertLocaleMirrorsComplete()` fails the build if a root page lacks its `[lang]/` mirror (exemptions in `MIRROR_EXEMPT`).
- **React hook**: `useTranslation()` reads from `$locale` nanostore (synced via `astro:page-load` event). Returns `{ t, locale }`.
- **Content locale**: Posts in `src/content/blog/<locale>/` are detected by slug prefix (`getSlugLocaleInfo()`); `filterPostsByLocale()` provides fallback — non-default locales show translations + untranslated default-locale posts.
- **Locale config**: `enabled` flag in `config/site.yaml` allows disabling locales without removing content. `isI18nEnabled` controls conditional Astro i18n routing.
- **`localizedPath(path, locale?)`** defaults to `defaultLocale` — no need for `locale ?? defaultLocale` at call sites.
- **Do NOT enable Astro `fallback`** in `astro.config.mjs` — it breaks `[seriesSlug].astro` dynamic routes.

**Markdown**: Shiki highlighting, auto-generated heading IDs/links via rehype plugins, GFM support.

**Colophon (落款)**: Configurable post marks (how a post was written, reading notices, ……). Dictionary in `colophon:` of `config/site.yaml` (groups with `exclusive`/`placement`, marks with `icon`/`label`/`description`/`tone`/`placement`); posts reference marks via frontmatter `colophon: [id | { id, note } | { icon, label, … }]`. Normalizer `src/lib/config/colophon.ts`; pure per-post resolution `src/lib/content/colophon.ts` (unknown ids / exclusive conflicts become warnings, never build errors; `colophon.defaults` fill groups a post leaves empty, `colophon: []` opts out); site-bound + localized helpers in `src/lib/content/post-colophon.ts` (overrides in `config/i18n-content.yaml` → `<locale>.colophon`). Surfaces: cover meta popover, pre-article banner, end-of-article seal (`src/components/post/colophon/`), post card icons, archives `?mark=` filter. Config icons must come from `BUNDLED_ICON_SETS` in `src/lib/config/icon-sets.ts` (also drives astro-icon `include`); adding a set needs `@iconify-json/<set>` too.

**Post source & actions**: Each public post's raw file (frontmatter included) is emitted at `<post url>.md` (`src/pages/post/[...slug].md.ts` + `[lang]` mirror, param space `postSourceRoute`). `isPostSourcePublic()` in `src/lib/content/post-source.ts` gates both the endpoint and the breadcrumb `PostMarkdownActions` button — posts with `password` or any `:::encrypted` block never expose source. `postActions:` in `config/site.yaml` controls copy / download / open-in-writing-room (`openInEditor: off | dev | everyone`, requires `editor.enabled`).

**Writing Room**: Public Markdown editor at `/editor` (`src/features/editor/`, enabled by `editor.enabled`; docs in `docs/features/editor.md`). Drafts live in localStorage; `/editor?from=<same-origin .md path>` imports a post as a copy draft (deduped by source). The CMS reuses the same editor for save-to-disk. Article properties edit the YAML in place (including the colophon section, whose dictionary is serialized into the page at build time).

### Cloudflare deployment target (2026-10-21)

The user approved the Free Cloudflare backend and automatic knowledge updates. `cloudflare/` is a standalone pnpm workspace inside this Git repository: Worker fetch/SSE, D1 FTS5/content, Vectorize BGE-M3 dense vectors, and a SQLite-backed Durable Object for atomic quota/budget reservations. `cloudflare/README.md` is the current production setup guide. The parent Node/Qdrant implementation remains a local/legacy alternative; older same-server deployment notes below are historical, not the production target.

- Keep the static blog deployment unchanged. Worker route: `belluna.love/api/lingyue/*`; no login or visitor API keys. Never upgrade a Cloudflare plan automatically.
- Model/persona/prompt code for this target lives in `cloudflare/src/`; do not update only the parent server when changing production behavior. Preserve current UI and persona unless explicitly requested.
- Chat currently uses Intern Discovery `deepseek-v4.1-flash-1017`. Worker `CHAT_BASE_URL` / `CHAT_MODEL` are server configuration; `CHAT_API_KEY` is a Worker Secret. Local summary/tag scripts use `SUMMARY_*`. Legacy `DEEPSEEK_API_KEY` fallback applies only to the official DeepSeek host, never to another provider. Explicitly disable thinking and do not combine that with `reasoning_effort: low`.
- Publishing follows the user's local generation workflow: run summaries/tags, then `pnpm generate:knowledge`, then git push. The knowledge command builds a fresh private snapshot and synchronizes D1/Vectorize through existing local Wrangler OAuth; no new CI API token is required. `cloudflare/scripts/local-auth.ts` reads local settings and captures auth output only in memory. Never log OAuth tokens, copy them to GitHub, or commit `.cache/lingyue/` or secrets.
- Local knowledge synchronization updates the live database before the subsequent blog push; explain this timing. The original Cloudflare Pages Git integration still publishes blog pages automatically. No separate assistant GitHub Actions workflow is required. D1 caches embeddings; reuse unchanged vectors and wait for Vectorize readiness before publishing an index version.
- Retrieval must check the active D1 version and public-document allowlist after vector search. Revoke deleted/private documents even if a subsequent index update fails. Serialize publishers and preserve the active version on failure.
- Keep the quota Durable Object short-lived: no model fetch or SSE in the object. Durable leases/ledger survive eviction; uncertain calls retain reserved cost. Browser history is not long-term server memory.
- Additional checks: `pnpm --dir cloudflare check`, `pnpm --dir cloudflare test`, `pnpm --dir cloudflare build` (dry-run). Local mocks/builds do not prove live Vectorize consistency or compliance with Free Worker 10ms CPU; measure after account authorization and deployment.
- `LINGYUE_DEV_BACKEND=http://127.0.0.1:8788` selects Wrangler dev; default remains the existing local Node backend at port 8787.

### Lingyue Blog Assistant (铃月)

The assistant is maintained in the parent workspace alongside this blog. See `../README.md` for setup, deployment, costs, and verification limits. Keep the blog static; the assistant runs as a separate Node.js service on the same server, reached through the same-origin `/api/lingyue/` proxy. Visitors do not log in or supply API keys.

**Module locations**:
- `src/components/lingyue/`: Astro launcher, React chat panel, SSE client, and styles. Mounted in `src/layouts/AppShell.astro`; `src/lib/client-panel.ts` supports `client:panel="lingyue"` so chat JavaScript loads only after opening the panel.
- `src/features/lingyue/`: Astro integration, private knowledge snapshot export, and development proxy to `127.0.0.1:8787`.
- `../lingyue-server/src/`: configuration, HTTP/SSE, model providers, Markdown chunking, incremental indexing, hybrid retrieval, SQLite storage, and quota/budget reservations.
- `../lingyue-server/evaluation/questions.json`: document-level retrieval candidates for offline/live evaluation; labels still need human evidence review.
- `../deploy/`: shared-server Docker Compose, images, and production Nginx proxy. Backend and Qdrant ports stay internal.

**Content and retrieval boundaries**:
- Export only published public content using the blog's collection, locale, slug, and `isPostSourcePublic()` rules. Exclude drafts, password-protected posts, and posts containing encrypted blocks; never execute MDX while indexing.
- Build output is moved to `.cache/lingyue/snapshot.json`; the intermediate `/_lingyue-snapshot.json` is removed from `dist` and returns 404 during development. Never publish the snapshot or serialize article bodies/vectors into client props.
- Use SiliconFlow `BAAI/bge-m3` dense embeddings with a self-hosted Qdrant collection, SQLite FTS5 with Chinese preprocessing, application-side RRF, and `BAAI/bge-reranker-v2-m3`. Document and query embeddings must use compatible model/preprocessing versions. The existing Snowflake-based similar-post script is independent.
- Keep document withdrawal filtering and versioned index publication intact. A failed rebuild must not publish a partial index or re-expose withdrawn articles. Unchanged chunks reuse cached embeddings.
- Chat has no file, Shell, arbitrary SQL, publishing, or blog-writing tools. Internal index/usage-accounting writes do not grant the model write permissions.

**Configuration and visitor state**:
- Secrets belong only in the parent workspace's `.env`: `DEEPSEEK_API_KEY`, `SILICONFLOW_API_KEY`, and `COOKIE_SECRET`. `node scripts/setup.mjs` creates the file with a random Cookie secret without overwriting an existing file.
- Chat is fixed to `https://api.deepseek.com/v1`, model `deepseek-flash`; do not silently switch to Pro. Provider/model/base URL and output limits are controlled by the server, not request fields.
- Never put secrets in `PUBLIC_*`, Astro props, browser storage, Git, logs, or model context. Log neither chat request bodies nor raw upstream errors.
- `SITE_ORIGIN` must match the browser origin. The dev proxy and backend use separate processes. Production real-IP headers must be accepted only from explicitly trusted proxies.
- Anonymous daily quotas, concurrency, and daily/monthly cost reservations are enforced server-side and persisted in SQLite. Preserve conservative accounting for cancelled/failed requests with unknown usage; a restart must not reset spent allowances.
- Conversation history lives only in browser memory/sessionStorage, with a clear action; do not write visitor dialogue to the vector store or introduce long-term memory. Handle Astro navigation, current article ID updates, SSE cancellation, and source attribution.
- Current artwork lives in `src/assets/lingyue/source-rig-v4/`: sixteen registered layers from the approved smaller-head, simplified-dress V4 master. The connected tail emerges from the right rear waist. Rebuild with `node ../scripts/build-belluna-v4.mjs`; source plates, prompts, masks and validation live in `../images/belluna-runtime-v4/`. `LingyueCharacter.astro` emits optimized WebP images in a shared `1037 1516` SVG canvas; `CharacterPart.astro` always places them at `(0,0)`. Never crop transparent borders or independently resize/reposition facial features. Keep the repair underpainting BEFORE the tail/ear layers in SVG paint order; otherwise restored hair conceals the visible tail root. The tail pivot is `(675,764)`, not V3's old floating-tail pivot. Prior V2/V3 material remains in place, and the approved V3 runtime is sealed with hashes in `../images/belluna-v3-approved-frozen/`; never overwrite/delete that snapshot.
- `companion.ts` owns peek/out pose, hover, and 45-second idle retraction; `character.css` owns the individual part animation and reduced-motion overrides. The nonmodal React dialog sends `koharu:lingyue-state` (open, busy, draft, speaking). Busy generation, drafts, pointer reading, selected text, and hidden tabs prevent retraction. No model calls or chat hydration occur on hover. Persist the companion across Astro navigation and keep the 12-second hydration-failure hint/retry behavior.
- `dock.css` places the opened chat over the left sidebar/TOC and switches the retained standing V4 rig to `LingyuePerch.astro` (a separate leaning pose). Per user preference, NEVER move, squeeze or resize the article/page frame when chat opens. `positionDock()` in companion.ts measures `main article.prose` before falling back to the home content column; above 992px it sizes/positions only the panel, with a 24px gap before text. Recompute on resize and Astro page load, including persisted roots. Narrow screens retain a closable overlay. Shared variables align panel and perch. Do not restore the abandoned page-margin scheme. Pose art/prompt notes are in `../images/belluna-dock-v1/`.
- Perch expressions live in `src/assets/lingyue/perch-v1/`, rendered by `LingyuePerch.astro` and `perch.css`: curious/blink, happy/hover, thinking, talking, doubtful, smug. All expression patches share the original 1536x1024 canvas at `(0,0)`; retain the original body/hair, and never independently move/resize face patches. Rebuild with `node ../scripts/build-belluna-perch-expressions.mjs`; donor art, prompts, registration, masks, previews and notes are in `../images/belluna-perch-expressions-v1/`. Chat state adds `outcome` (idle/complete/interrupted/error); only a fully consumed successful stream triggers five seconds of smug, failures trigger five seconds of doubtful, cancellation stays neutral. Busy state outranks hover, hover outranks temporary reactions. Do not add semantic emotion inference or paid calls. Talking is a two-frame text-stream indicator, not audio lip sync. CSS freezes a single mouth for reduced-motion/motion-off and pauses animation when hidden. Preserve prior static perch source and the frozen V3 snapshot.
- Character expression follows local interaction/request state; do not add paid emotion inference. Whole-character tilt and breathing preserve face registration. Current visually checked motion: arm two degrees, tail four degrees, ears 3.2/2.6 degrees, hair tips 0.9 degrees. V4 origins are scoped by `data-art-version="source-v4"` in character.css. Root checks cover these declared ranges only. `companion.ts` tracks `visibilitychange`; CSS pauses character animation when the page is hidden. Respect reduced-motion and the blog's `motion-off` mode. Current runtime documentation is in `../images/belluna-runtime-v4/`; older source-visible decomposition and art are retained. This is a lightweight SVG sprite rig, not a Live2D mesh or a layered PSD.

**Commands** (run from the parent workspace, not this blog directory):

`pose.css` and companion.ts own the staged peek/open/retract handoff (`data-stage`: peek/opening/settling/open/closing/returning). React requests `koharu:lingyue-close-request`; only the companion emits `koharu:lingyue-retract` after the exit finishes. Do not close the dialog early or let initial hydrated open=false overwrite the requested pose. Cancel pending pose timers on reversal/disposal; already-open launcher clicks focus the input without requesting quota again. Reduced-motion/motion-off must bypass waits as well as animation. Keep the dock geometry and face registration fixed. Preview, behavior and test notes: `../images/belluna-pose-v1/README.md`; browser checks: `../.acceptance/check-pose.mjs`. Return focus only when it was inside the closing dialog. Busy generation, drafts and reading still protect idle retraction.

Perch body motion uses `src/assets/lingyue/perch-motion-v1/` (eight layers) plus the retained eight expression patches, sharing 1536x1024 coordinates. Rebuild with `node ../scripts/build-belluna-perch-motion.mjs`; notes/prompts/previews in `../images/belluna-perch-motion-v1/`. Keep fixed viewport clips and original-pixel root covers around ears/tail/hair ends; do not rotate the face, arms, or whole perch. Source interior alpha is typically 252–253, so alpha === 255 is NOT an interior test. `perch.css` drives state-dependent tail/ear/hair timing; paused when hidden and disabled by reduced-motion/motion-off. Root covers render after body and before expressions. All sixteen image layers retain their full canvas. Use `../.acceptance/check-perch-motion.mjs` for declared-angle seam screenshots, unchanged face/hand regions, state timing, accessibility and video; rerun expression/dock checks after changes. This motion is a sprite rig, not mesh deformation.

```bash
node scripts/setup.mjs
pnpm --dir astro-jianyanya build       # Export the private knowledge snapshot
pnpm --dir lingyue-server index       # Requires configured SiliconFlow and running Qdrant
pnpm --dir lingyue-server dev         # Terminal 1: backend; Node.js 24+
pnpm --dir astro-jianyanya dev        # Terminal 2: blog at the configured SITE_ORIGIN

pnpm --dir lingyue-server test
pnpm --dir lingyue-server check
pnpm --dir lingyue-server build
pnpm --dir lingyue-server evaluate    # Offline keyword baseline; no model API calls
node scripts/check-browser.mjs       # Headless Edge, simulated replies, external network blocked
node scripts/check-dev.mjs           # Real local dev proxy; model keys forced empty
```

`pnpm --dir lingyue-server evaluate --live` explicitly calls embedding/rerank providers after a real index is built; it does not call chat generation and is not covered by visitor quotas. Review provider costs before running it. Blog lint/check/build commands above still apply to blog code changes.

**Verification baseline (2026-10-19)**: 19 tests, backend checks/build, blog lint/check/build, browser interactions, and dev proxy checks passed. HTTP tests use a real local boundary with simulated external providers. Knip still reports existing repository findings. Real DeepSeek/SiliconFlow quality and billing, real Qdrant, Docker/Compose runtime, and production TLS/real-IP configuration remain unverified; do not describe the mock tests or offline retrieval scores as live deployment/answer-quality acceptance. See `../.acceptance/verification.json` when available.

**Subsequent local verification (2026-10-19)**: Windows-native Qdrant 1.16.3 was downloaded from the official release and its SHA256 verified. The 129-document snapshot was indexed into 521 chunks; real SiliconFlow embedding/rerank and one short DeepSeek Flash reply with citations passed without retrieval degradation. This does not establish full answer quality or Docker/production readiness. Parent-workspace `scripts/start-local.ps1` reuses running local services; `-Reindex` explicitly updates the index. `scripts/stop-local.ps1` checks tracked PID/start time and preserves unmanaged processes/data. Local logs and data are under `../data/`; startup records are in `../.acceptance/local-deployment.json`. These are background local processes, not automatically starting Windows services.

## Component Patterns

### Component Design Principles

1. **Single Responsibility**: Each component does one thing well
2. **Props Interface**: Clear, minimal props
3. **Composition over Configuration**: Use composable components

### UI Components
- Follow **shadcn/ui patterns** with Radix UI primitives
- Use **`class-variance-authority` (cva)** for variants
- Merge Tailwind classes via `cn()` in `src/lib/utils.ts`

### Astro vs React

**Astro components** (`.astro`): Layouts, pages, static content (no JS shipped by default)
**React components** (`.tsx`): Interactive UI (state, events)

**Client directives**:
- `client:load` - Critical interactive elements (header, nav, search)
- `client:idle` - Lower-priority interactions (tooltips, modals)
- `client:visible` - Below-the-fold components (footer, comments)
- `client:only="react"` - Skip SSR (framework-specific)

### Astro Script Initialization

Always handle initialization race condition:

```typescript
// ✅ Good: Initialize immediately if DOM ready
if (document.readyState !== "loading") init();
document.addEventListener("astro:page-load", init);

// Cleanup on page swap
document.addEventListener("astro:before-swap", cleanup);
```

## Code Style & Quality

### Linting & Formatting
Biome (line width: 128, single quotes, trailing commas). Tailwind classes must be sorted.

### Frontend Quality Priorities
1. **User Experience** (Performance, Accessibility, Progressive Enhancement)
2. **Correctness** (Type safety, Edge cases, Error handling)
3. **Maintainability** (Clear abstractions, Component reuse)
4. **Performance** (Bundle size, Runtime optimization)
5. **Code brevity** (Concise but clear)

### Core Web Vitals Targets
- LCP < 2.5s
- FID/INP < 100ms
- CLS < 0.1

### Error Handling Strategy
**Layered and context-appropriate:**
1. **Data Layer** (`src/lib/`): Return `null` or throw typed errors
2. **React Components**: Use `ErrorBoundary` for component errors
3. **Async Operations**: Explicit try-catch or `.catch()`
4. **Validation**: At system boundaries only

### Performance Best Practices
- Lazy load heavy dependencies (>100KB): `const THREE = await import("three");`
- Don't prematurely optimize - measure first
- Use `useMemo()` for expensive computations only
- Use `useCallback()` only when passing to memoized children
- Use `useSyncExternalStore` for scroll events (see `useCurrentHeading`)
- **Avoid large props**: Never pass large data (like `body` content) as props. Pre-compute derived values (e.g., `wordCount`, `readingTime`) instead. Large props get serialized into HTML when passed to client components, causing page bloat.

### Code Reuse Patterns
1. **Pure Functions** (`src/lib/`): Extract when used 2+ times
2. **React Hooks** (`src/hooks/`): Extract when pattern repeated 3+ times
3. **Shared Types** (`src/types/`): Extract when used 3+ times

### State Management Best Practices

**State Lifting**: Place state at nearest common ancestor, avoid over-lifting.

**Derived State**: Prefer `const filtered = posts.filter(...)` over `useEffect` synchronization.

**Immutability**: Always use immutable updates: `setUser(prev => ({ ...prev, name: 'Alice' }))`.

**URL State Management**: Use **nuqs** (https://nuqs.dev/) for shareable state (search, pagination, filters, tabs). Benefits: shareable URLs, bookmarkable, browser navigation, SEO-friendly.

```typescript
// ✅ Good: URL state for filters
const [search, setSearch] = useQueryState('q', { defaultValue: '' });
const [category, setCategory] = useQueryState('category');
// URL: /posts?q=react&category=tech (shareable!)
```

For Astro projects, use native `URLSearchParams`:
```typescript
const url = new URL(Astro.request.url);
const search = url.searchParams.get('q') || '';
```

### React Best Practices

**Avoid useCallback Overuse**: Only use when callback passed to memoized child.

**Fix Circular Dependencies in useEffect**: Use refs for latest state without re-subscribing.

**Avoid useState for Static Values**: Use constants or `useMemo` for computed values.

**Extract Custom Hooks**: When `useState` + `useRef` + `useEffect` pattern repeats 2+ times.

**Scroll Events**: Use `useSyncExternalStore` instead of `useState` + `useEffect`.

**Media Queries**: Use existing hooks: `useIsMobile()`, `useMediaQuery()` from `@hooks/useMediaQuery`.

**Animations**: Use Motion's `useReducedMotion()` for animation components.

**SSR Hydration**: Never use `suppressHydrationWarning`. Use `useIsMounted()` hook for client-only values.

```typescript
// ✅ Good: Avoid hydration mismatch
const isMounted = useIsMounted();
const isEnabled = useStore(christmasEnabled);
<div className={cn({ 'z-5': isMounted && isEnabled })} />
```

## Testing Strategy

**Test business logic rigorously; test UI pragmatically.**

**High Priority**: Content utilities, data transformations, build scripts
**Medium Priority**: Complex React hooks, state management
**Low Priority**: UI components (manual testing preferred)

```typescript
// Example: Pure function test
describe("getCategoryLinks", () => {
  it("returns all links recursively", () => {
    const category = {
      name: "笔记",
      link: "/category/notes",
      children: [
        { name: "前端", link: "/category/notes/front-end", children: [] }
      ]
    };
    expect(getCategoryLinks(category)).toEqual(["/category/notes/front-end"]);
  });
});
```

## Development Checklist

### Before Starting
- [ ] Understand requirement clearly
- [ ] Check existing code for similar patterns
- [ ] Verify no circular dependencies

### During Implementation
- [ ] Follow Module-First Principle
- [ ] Write pure functions where possible
- [ ] Use TypeScript strictly (no `any`)
- [ ] Extract shared logic after third use
- [ ] Handle errors appropriately
- [ ] Use existing hooks (`useMediaQuery`, `useIsMounted`, etc.)

### Component Development
- [ ] Choose Astro vs React appropriately
- [ ] Use correct client directive
- [ ] Follow composition patterns
- [ ] Wrap interactive sections in `ErrorBoundary`
- [ ] Handle SSR hydration properly

### Before Committing
- [ ] **Run linter**: `pnpm lint:fix` ✅ Required
- [ ] Run type checker: `pnpm check`
- [ ] Run affected tests: `pnpm test` or the matching `pnpm test:*` script
- [ ] Check for unused code: `pnpm knip`
- [ ] Verify build succeeds: `pnpm build`

## Commit & Pull Request Guidelines

- Short imperative subjects with Conventional Commit prefixes (`feat:`, `fix:`, `chore:` ……); keep each commit focused and include generated assets the change requires.
- PRs explain the user-visible effect, list validation commands, link related issues, and include screenshots or recordings for visual changes. Call out configuration, migration, performance, or i18n impact explicitly.
- This is a public repo: keep secrets from `.env` out, and use neutral/fictional content in tests, fixtures, screenshots and sample posts.

## Common Code Smells

**Component-Level**:
- Oversized components (> 300 lines)
- Props drilling beyond 3 levels → use Context
- Overuse of useEffect → use derived state

**State Management**:
- Duplicate state → single source of truth
- Missing URL state for shareable filters → use nuqs

**Performance**:
- Unnecessary re-renders → missing memo when needed
- Premature optimization → measure first
- Large dependencies not lazy-loaded (> 100KB)

## Common Pitfalls

### 1. Circular Dependencies
Extract shared logic to separate file instead of importing between peer modules.

### 2. Hydration Mismatches
Use `useIsMounted()` for client-only values, never `suppressHydrationWarning`.

### 3. Overuse of useEffect
Prefer derived values: `const fullName = \`${first} ${last}\``instead of`useEffect` synchronization.

### 4. Over-abstraction
Inline until pattern appears 3 times. Avoid unnecessary abstractions.

### 5. Tight Coupling to Framework
Keep business logic pure, framework calls at boundaries.

## Resources

### Documentation
- [Astro Docs](https://docs.astro.build/)
- [React Docs](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Motion](https://motion.dev/)
- [Nanostores](https://github.com/nanostores/nanostores)

### Tools
- [Biome](https://biomejs.dev/) - Linter and formatter
- [Pagefind](https://pagefind.app/) - Static search
- [es-toolkit](https://es-toolkit.slash.page/) - Utility library

### Internal References
- Core utilities: `src/lib/content/`, `src/lib/utils.ts`
- Reusable hooks: `src/hooks/`
- Animation presets: `src/constants/anim/`
- Site configuration: `src/constants/site-config.ts`
