import { createHmac, timingSafeEqual } from 'node:crypto';

export function cookieValue(request: Request, name: string) {
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** OAuth flow data is short-lived and integrity protected; GitHub tokens never enter cookies. */
export function signFlow(data: unknown, secret: string) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`oauth:${body}`).digest('base64url');
  return `${body}.${signature}`;
}

export function readFlow(value: string | undefined, secret: string): unknown {
  if (!value || value.length > 6000) return undefined;
  const [body, signature, extra] = value.split('.');
  if (!body || !signature || extra || !/^[\w-]{43}$/.test(signature)) return undefined;
  const expected = createHmac('sha256', secret).update(`oauth:${body}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}
