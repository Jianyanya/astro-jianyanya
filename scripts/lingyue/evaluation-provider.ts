import { loadConfig } from '../../src/server/lingyue/config.js';
import { Providers } from '../../src/server/lingyue/providers.js';
import { hash } from '../../src/server/lingyue/text.js';
import { cache, jsonFile, localEnv, saveJson } from './files.js';

export async function evaluationProvider() {
  let calls = 0;
  const providers = new Providers(loadConfig(await localEnv()), (async (url, options) => {
    const target = new URL(`evaluation-models/${hash(`${url}:${String(options?.body)}`)}.json`, cache);
    try {
      return Response.json(await jsonFile(target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    calls++;
    const response = await fetch(url, options);
    if (!response.ok) return response;
    const payload = await response.json();
    await saveJson(target, payload);
    return Response.json(payload);
  }) as typeof fetch);
  return { providers, calls: () => calls };
}
