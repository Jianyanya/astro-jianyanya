import { z } from 'zod';

const fingerprint = z.object({ schema: z.literal(1), version: z.string(), hash: z.string() });
export async function verifyDeployment(
  origin: string,
  expected: { version: string; hash: string },
  request: typeof fetch = fetch,
) {
  const url = new URL('/lingyue-version.json', origin);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('发布地址必须使用 HTTPS');
  url.searchParams.set('verify', Date.now().toString());
  const response = await request(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('网站版本尚未就绪');
  }
  const parsed = fingerprint.safeParse(await response.json());
  if (!parsed.success || parsed.data.version !== expected.version || parsed.data.hash !== expected.hash)
    throw new Error('网站与本地知识版本不一致');
}
