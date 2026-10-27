import { createHash, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { cookieValue, readFlow, signFlow } from './auth-cookies.js';
import type { Config } from './config.js';
import type { Query } from './database.js';
import { PublicError } from './limits.js';

const SESSION = 'belluna_session';
const FLOW = 'belluna_oauth';
const lifetime = 7 * 86400;
const flowSchema = z.object({
  state: z.string().length(43),
  verifier: z.string().length(43),
  expires: z.number(),
  back: z.string(),
});
const profileSchema = z.object({
  id: z.number().int().positive().safe(),
  login: z.string().regex(/^[a-z\d](?:[a-z\d-]{0,38})$/i),
});
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export interface SignedInUser {
  id: string;
  login: string;
  visitor: string;
}

export class Auth {
  constructor(
    readonly db: Query,
    readonly c: Config,
    readonly request: typeof fetch = fetch,
  ) {}
  get configured() {
    return Boolean(this.c.GITHUB_CLIENT_ID && this.c.GITHUB_CLIENT_SECRET);
  }
  private cookie(name: string, value: string, maxAge: number) {
    const path = name === FLOW ? '/api/lingyue/auth' : '/api/lingyue';
    return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${this.c.SITE_ORIGIN.startsWith('https:') ? '; Secure' : ''}`;
  }
  async user(request: Request, now = Date.now()): Promise<SignedInUser | undefined> {
    const token = cookieValue(request, SESSION);
    if (!token || !/^[\w-]{43}$/.test(token)) return undefined;
    const [row] = await this.db.query<{ github_id: string; login: string }>(
      'SELECT github_id,login FROM lingyue.auth_sessions WHERE token_hash=$1 AND expires>$2',
      [digest(token), now],
    );
    if (!row) return undefined;
    return {
      id: row.github_id,
      login: row.login,
      visitor: createHmac('sha256', this.c.COOKIE_SECRET).update(`github:${row.github_id}`).digest('hex'),
    };
  }
  /** Called only after the server has verified GitHub's /user response. */
  async issue(profile: z.infer<typeof profileSchema>, now = Date.now()) {
    const checked = profileSchema.parse(profile);
    const token = randomBytes(32).toString('base64url');
    await this.db.query('DELETE FROM lingyue.auth_sessions WHERE expires<=$1', [now]);
    await this.db.query('INSERT INTO lingyue.auth_sessions VALUES($1,$2,$3,$4)', [
      digest(token),
      String(checked.id),
      checked.login,
      now + lifetime * 1000,
    ]);
    return this.cookie(SESSION, token, lifetime);
  }
  async handle(request: Request) {
    const url = new URL(request.url);
    const action = url.pathname.split('/').at(-1);
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    const redirect = (back: string, result?: string) => {
      const target = new URL(back, this.c.SITE_ORIGIN);
      if (result) target.searchParams.set('lingyue_login', result);
      headers.set('Location', target.toString());
      return new Response(null, { status: 303, headers });
    };
    if (action === 'logout' && request.method === 'POST') {
      if (
        request.headers.get('origin') !== new URL(this.c.SITE_ORIGIN).origin ||
        request.headers.get('sec-fetch-site') === 'cross-site'
      )
        throw new PublicError(403, '请在博客里退出登录喵~');
      const token = cookieValue(request, SESSION);
      if (token && /^[\w-]{43}$/.test(token))
        await this.db.query('DELETE FROM lingyue.auth_sessions WHERE token_hash=$1', [digest(token)]);
      headers.append('Set-Cookie', this.cookie(SESSION, '', 0));
      return Response.json({ authenticated: false }, { headers });
    }
    if (request.method !== 'GET' || !['login', 'callback'].includes(action ?? ''))
      return new Response(null, { status: 405, headers });
    if (!this.configured) throw new PublicError(503, '登录入口还在准备，稍后再来找我喵~');
    const callback = new URL('/api/lingyue/auth/callback', this.c.SITE_ORIGIN).toString();
    if (action === 'login') {
      // OAuth cookies and callback must share the canonical host, including when a Vercel alias is used.
      if (url.origin !== new URL(this.c.SITE_ORIGIN).origin) return redirect(url.pathname + url.search);
      const requested = url.searchParams.get('returnTo') ?? '/';
      const back =
        requested.startsWith('/') && !requested.startsWith('//') && !/[\\\p{Cc}]/u.test(requested) && requested.length <= 2000
          ? requested
          : '/';
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      headers.append(
        'Set-Cookie',
        this.cookie(FLOW, signFlow({ state, verifier, back, expires: Date.now() + 600000 }, this.c.COOKIE_SECRET), 600),
      );
      const target = new URL('https://github.com/login/oauth/authorize');
      target.search = new URLSearchParams({
        client_id: this.c.GITHUB_CLIENT_ID,
        redirect_uri: callback,
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();
      headers.set('Location', target.toString());
      return new Response(null, { status: 303, headers });
    }
    const flow = flowSchema.safeParse(readFlow(cookieValue(request, FLOW), this.c.COOKIE_SECRET));
    headers.append('Set-Cookie', this.cookie(FLOW, '', 0));
    if (!flow.success || flow.data.expires < Date.now() || flow.data.state !== url.searchParams.get('state'))
      return redirect('/', 'failed');
    const code = url.searchParams.get('code');
    if (!code || code.length > 512 || url.searchParams.has('error')) return redirect(flow.data.back, 'cancelled');
    try {
      const tokenResponse = await this.request('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.c.GITHUB_CLIENT_ID,
          client_secret: this.c.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: callback,
          code_verifier: flow.data.verifier,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenResponse.ok) {
        await tokenResponse.body?.cancel();
        throw new Error('OAuth exchange failed');
      }
      const { access_token } = z.object({ access_token: z.string().min(1).max(4096) }).parse(await tokenResponse.json());
      const profileResponse = await this.request('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Belluna-Blog',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!profileResponse.ok) {
        await profileResponse.body?.cancel();
        throw new Error('OAuth profile failed');
      }
      headers.append('Set-Cookie', await this.issue(profileSchema.parse(await profileResponse.json())));
      return redirect(flow.data.back, 'ok');
    } catch {
      // Neither the authorization code nor the GitHub access token is logged or persisted.
      return redirect(flow.data.back, 'failed');
    }
  }
}
