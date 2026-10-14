import { promises as fs } from 'node:fs';
import { generateText } from '@xsai/generate-text';
import { glob } from 'glob';
import matter from 'gray-matter';

// --------- Configuration ---------
const CONTENT_GLOB = 'src/content/blog/**/*.md';
const NON_DEFAULT_LOCALE_GLOBS = getNonDefaultLocaleGlobs();

// LLM API settings — same env vars as generateSummaries.ts
try {
  process.loadEnvFile();
} catch {
  // .env is optional
}
const API_BASE_URL = process.env.SUMMARY_API_BASE_URL ?? 'http://127.0.0.1:1234/v1/';
const API_KEY = process.env.SUMMARY_API_KEY ?? 'lm-studio';
const DEFAULT_MODEL = process.env.SUMMARY_MODEL ?? 'deepseek-flash';

function getNonDefaultLocaleGlobs(): string[] {
  return ['src/content/blog/en/**', 'src/content/blog/ja/**', 'src/content/blog/ko/**'];
}

// --------- Parse CLI Arguments ---------
function parseArgs(): { force: boolean } {
  const args = process.argv.slice(2);
  return { force: args.includes('--force') };
}

// --------- LLM API ---------
async function generateTags(title: string, text: string): Promise<string[]> {
  const truncatedText = text.slice(0, 4000);

  const { text: raw } = await generateText({
    apiKey: API_KEY,
    baseURL: API_BASE_URL,
    model: DEFAULT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          '你是博客标签助手。根据文章内容给出 3-5 个简短的中文标签（每个 2-8 个字，可以是技术名词或主题概括）。只输出一个 JSON 数组，例如 ["KNN","WiFi指纹","项目实践"]，不要任何其他文字。',
      },
      {
        role: 'user',
        content: `文章标题：${title}\n\n文章内容：\n${truncatedText}`,
      },
    ],
    temperature: 0.3,
    maxTokens: 500,
    reasoning_effort: 'low',
  });

  const match = raw.match(/\[[\s\S]*?\]/);
  if (!match) throw new Error('No tags array in LLM response');
  const tags = JSON.parse(match[0]) as string[];
  return tags
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 5);
}

// --------- Main ---------
async function main() {
  const { force } = parseArgs();
  console.log('=== AI Tag Generator ===');
  console.log(`Model: ${DEFAULT_MODEL}`);

  const files = (await glob(CONTENT_GLOB, { ignore: NON_DEFAULT_LOCALE_GLOBS })).sort();
  console.log(`Found ${files.length} markdown files`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const [i, file] of files.entries()) {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = matter(raw);
    const title = String(parsed.data.title ?? file);

    if (!force && Array.isArray(parsed.data.tags) && parsed.data.tags.length > 0) {
      skipped++;
      continue;
    }

    const plainText = parsed.content
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*`|\-[\]()!]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (plainText.length < 15) {
      skipped++;
      continue;
    }

    process.stdout.write(`  [${i + 1}/${files.length}] generating: ${title}...`);
    try {
      const tags = await generateTags(title, plainText);
      parsed.data.tags = tags;
      const output = matter.stringify(parsed.content, parsed.data, { language: 'yaml' });
      await fs.writeFile(file, output);
      console.log(` ${tags.join(' / ')}`);
      updated++;
    } catch (error) {
      console.log(` Error: ${(error as Error).message}`);
      errors++;
    }
    // 简单限速，避免触发 API 频率限制
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  console.log(`\nUpdated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
  console.log('Done! Tags written into frontmatter.');
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
