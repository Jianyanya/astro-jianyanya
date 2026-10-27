import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { Auth } from '../../src/server/lingyue/auth.js';
import { handleRequest } from '../../src/server/lingyue/handler.js';
import { Ledger } from '../../src/server/lingyue/ledger.js';
import { Providers } from '../../src/server/lingyue/providers.js';
import { Retrieval } from '../../src/server/lingyue/retrieval.js';
import { Store } from '../../src/server/lingyue/store.js';
import { testConfig as c, createTestDatabase } from './database-fixture.js';

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => {
  fixture = await createTestDatabase();
});
beforeEach(async () => {
  await fixture.reset();
});
after(async () => {
  await fixture?.close();
});
const cookieOf = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith(name + '='))!
    .split(';')[0]!;
const request = (path: string, cookie = '', method = 'GET', data?: unknown) =>
  new Request('https://belluna.love/api/lingyue/' + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: 'https://belluna.love',
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': '192.0.2.2',
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

test('OAuth binds state and PKCE, requests no repository scopes and stores only hashed session tokens', async () => {
  let exchanges = 0;
  let challenge = '';
  const auth = new Auth(fixture.db, c, (async (url, init) => {
    if (String(url).endsWith('/access_token')) {
      exchanges++;
      const body = JSON.parse(String(init?.body));
      assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), challenge);
      assert.equal(body.redirect_uri, 'https://belluna.love/api/lingyue/auth/callback');
      return Response.json({ access_token: 'fictional-github-token-never-stored' });
    }
    return Response.json({ id: 12345, login: 'fictional-reader' });
  }) as typeof fetch);
  const login = await auth.handle(request('auth/login?returnTo=%2Fpost%2Frag'));
  const location = new URL(login.headers.get('Location')!);
  assert.equal(location.origin, 'https://github.com');
  assert.equal(location.searchParams.has('scope'), false);
  challenge = location.searchParams.get('code_challenge')!;
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  const flow = cookieOf(login, 'belluna_oauth');
  const invalid = await auth.handle(request('auth/callback?code=fictional&state=bad', flow));
  assert.equal(exchanges, 0);
  assert.match(invalid.headers.get('Location')!, /failed/);
  const response = await auth.handle(request(`auth/callback?code=fictional&state=${location.searchParams.get('state')}`, flow));
  assert.equal(exchanges, 1);
  assert.equal(response.headers.get('Location'), 'https://belluna.love/post/rag?lingyue_login=ok');
  const cookie = cookieOf(response, 'belluna_session');
  assert.equal((await auth.user(request('quota', cookie)))?.id, '12345');
  const rows = await fixture.db.query('SELECT * FROM lingyue.auth_sessions');
  assert.doesNotMatch(JSON.stringify(rows), /fictional-github-token|belluna_session/);
  assert.match(String(rows[0]?.token_hash), /^[a-f0-9]{64}$/);
  assert.ok(response.headers.getSetCookie().some((value) => value.includes('HttpOnly') && value.includes('Secure')));
});

test('forged/expired sessions fail, logout revokes the server session, clearing cookies cannot reset account quota', async () => {
  const auth = new Auth(fixture.db, c);
  assert.equal(await auth.user(request('quota', 'belluna_session=' + 'x'.repeat(43))), undefined);
  const expired = (await auth.issue({ id: 12345, login: 'reader' }, Date.now() - 8 * 86400000)).split(';')[0]!;
  assert.equal(await auth.user(request('quota', expired)), undefined);
  const one = (await auth.issue({ id: 12345, login: 'reader' })).split(';')[0]!;
  const two = (await auth.issue({ id: 12345, login: 'renamed-reader' })).split(';')[0]!;
  const first = (await auth.user(request('quota', one)))!;
  const second = (await auth.user(request('quota', two)))!;
  assert.equal(first.visitor, second.visitor);
  const ledger = new Ledger(fixture.db, c);
  const id = crypto.randomUUID();
  await ledger.reserve(id, first.visitor, 'ip');
  await ledger.settle(id, true);
  assert.equal((await ledger.quota(second.visitor, 'ip')).remaining, 19);
  await auth.handle(request('auth/logout', one, 'POST', {}));
  assert.equal(await auth.user(request('quota', one)), undefined);
  assert.ok(await auth.user(request('quota', two)));
  const unsafe = await auth.handle(request('auth/login?returnTo=https://example.org'));
  const unsafeFlow = unsafe.headers.get('set-cookie')!;
  assert.doesNotMatch(Buffer.from(unsafeFlow.split('=')[1]!.split('.')[0]!, 'base64url').toString(), /example.org/);
});

test('daily limit is twenty and user/global spacing is persisted across ledger instances', async () => {
  const ledger = new Ledger(fixture.db, c),
    other = new Ledger(fixture.db, c);
  const now = Date.parse('2026-10-27T12:00:00Z');
  const id = crypto.randomUUID();
  await ledger.reserve(id, 'reader', 'ip', now);
  await ledger.settle(id, true);
  await assert.rejects(
    other.reserve(crypto.randomUUID(), 'reader', 'ip', now + 3000),
    (error: unknown) => Number((error as { retryAt: number }).retryAt) === now + 10000,
  );
  await assert.rejects(
    other.reserve(crypto.randomUUID(), 'another', 'ip2', now + 1000),
    (error: unknown) => Number((error as { retryAt: number }).retryAt) === now + 2000,
  );
  for (let i = 1; i < 20; i++) {
    const next = crypto.randomUUID();
    await ledger.reserve(next, 'reader', 'ip', now + i * 60001);
    await ledger.settle(next, true);
  }
  assert.equal((await other.quota('reader', 'ip', now + 21 * 60001)).remaining, 0);
  await assert.rejects(
    other.reserve(crypto.randomUUID(), 'reader', 'ip', now + 21 * 60001),
    (error: unknown) => (error as { status: number }).status === 429,
  );
});

test('anonymous/forged callers cannot run a model, upstream 429 refunds quota and starts a shared cooldown', async () => {
  let calls = 0;
  const auth = new Auth(fixture.db, c);
  const providers = new Providers(c, (async () => {
    calls++;
    return Response.json({ error: 'limited' }, { status: 429, headers: { 'Retry-After': '45' } });
  }) as typeof fetch);
  const ledger = new Ledger(fixture.db, c);
  const runtime = { c, auth, providers, ledger, retrieval: new Retrieval(new Store(fixture.db), providers, c) };
  const data = () => ({ requestId: crypto.randomUUID(), message: '在吗', history: [] });
  assert.equal((await handleRequest(request('chat', '', 'POST', data()), runtime)).status, 401);
  assert.equal(
    (await handleRequest(request('chat', 'lingyue=forged; belluna_session=' + 'x'.repeat(43), 'POST', data()), runtime)).status,
    401,
  );
  assert.equal(calls, 0);
  const cookie = (await auth.issue({ id: 12345, login: 'reader' })).split(';')[0]!;
  const response = await handleRequest(request('chat', cookie, 'POST', data()), runtime);
  const frames = await response.text();
  assert.match(frames, /event: error/);
  assert.doesNotMatch(frames, /event: done/);
  assert.match(frames, /retryAt/);
  assert.equal((await fixture.db.query('SELECT * FROM lingyue.requests')).length, 0);
  const gate = new Ledger(fixture.db, c);
  const user = (await auth.user(request('quota', cookie)))!;
  const status = await gate.quota(user.visitor, 'ip');
  assert.equal(status.remaining, 20);
  assert.ok(status.retryAt >= Date.now() + 40000);
  const second = await handleRequest(request('chat', cookie, 'POST', data()), runtime);
  assert.equal(second.status, 429);
  assert.ok(Number(second.headers.get('Retry-After')) >= 40);
  assert.equal(calls, 1);
});
