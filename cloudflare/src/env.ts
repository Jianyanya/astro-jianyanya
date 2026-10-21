export interface Env {
  DB: D1Database;
  VECTORS: VectorizeIndex;
  QUOTAS: DurableObjectNamespace;
  SITE_ORIGIN?: string;
  CHAT_BASE_URL?: string;
  CHAT_MODEL?: string;
  CHAT_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  SILICONFLOW_API_KEY?: string;
  COOKIE_SECRET: string;
}
