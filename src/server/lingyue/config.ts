import { z } from 'zod';

const positive = (fallback: number) => z.coerce.number().finite().positive().default(fallback);
const integer = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const schema = z.object({
  SITE_ORIGIN: z.string().url().default('https://belluna.love'),
  CHAT_BASE_URL: z
    .string()
    .transform((s) => s.replace(/\/+$/, ''))
    .pipe(z.enum(['https://api.deepseek.com/v1', 'https://discovery-api.intern-ai.org.cn/v1']))
    .default('https://api.deepseek.com/v1'),
  CHAT_MODEL: z.enum(['deepseek-flash', 'deepseek-v4.1-flash-1017']).default('deepseek-flash'),
  CHAT_API_KEY: z.string().default(''),
  DEEPSEEK_API_KEY: z.string().default(''),
  SILICONFLOW_API_KEY: z.string().default(''),
  COOKIE_SECRET: z.string().min(32),
  EMBEDDING_MODEL: z.literal('BAAI/bge-m3').default('BAAI/bge-m3'),
  RERANK_MODEL: z.literal('BAAI/bge-reranker-v2-m3').default('BAAI/bge-reranker-v2-m3'),
  RERANK_ENABLED: z.enum(['true', 'false']).default('true'),
  DAILY_VISITOR_LIMIT: integer(30),
  DAILY_IP_LIMIT: integer(100),
  DAILY_GLOBAL_LIMIT: integer(300),
  IP_PER_MINUTE: integer(6),
  MAX_CONCURRENT: integer(4),
  DAILY_BUDGET_CNY: positive(10),
  MONTHLY_BUDGET_CNY: positive(200),
  USD_TO_CNY_BUDGET_RATE: positive(8),
  CHAT_INPUT_USD_PER_MILLION: positive(0.3),
  CHAT_OUTPUT_USD_PER_MILLION: positive(1.2),
  MAX_INPUT_TOKENS: integer(10000),
  MAX_OUTPUT_TOKENS: integer(1500),
});
export type Config = z.infer<typeof schema>;
export const loadConfig = (env: unknown): Config => {
  const c = schema.parse(env);
  return {
    ...c,
    CHAT_API_KEY: c.CHAT_API_KEY || (c.CHAT_BASE_URL === 'https://api.deepseek.com/v1' ? c.DEEPSEEK_API_KEY : ''),
  };
};
