import { loadConfig } from './config.js';
import { database } from './database.js';
import type { Runtime } from './handler.js';
import { Ledger } from './ledger.js';
import { Providers } from './providers.js';
import { Retrieval } from './retrieval.js';
import { Store } from './store.js';

let runtime: Runtime | undefined;
export function getRuntime(env: Record<string, unknown>): Runtime {
  if (runtime) return runtime;
  const c = loadConfig(env);
  const db = database(String(env.DATABASE_URL ?? ''));
  const providers = new Providers(c);
  const origins =
    env.VERCEL === '1' && env.VERCEL_ENV === 'production'
      ? [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]
          .filter((host): host is string => typeof host === 'string' && /^[a-z0-9.-]+\.vercel\.app$/.test(host))
          .map((host) => `https://${host}`)
      : [];
  runtime = { c, providers, origins, ledger: new Ledger(db, c), retrieval: new Retrieval(new Store(db), providers, c) };
  return runtime;
}
