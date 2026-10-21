export interface Env {
  DB: D1Database;
  VECTORS: VectorizeIndex;
  QUOTAS: DurableObjectNamespace;
  SITE_ORIGIN?: string;
  DEEPSEEK_API_KEY?: string;
  SILICONFLOW_API_KEY?: string;
  COOKIE_SECRET: string;
}
