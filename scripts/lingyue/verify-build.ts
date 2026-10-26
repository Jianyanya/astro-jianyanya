import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';

const vercel = process.env.VERCEL === '1' || process.platform !== 'win32';
const directory = vercel ? '.vercel/output/static/' : 'dist/client/';
for (const file of ['_lingyue-snapshot.json', '.env.local', '.cache/lingyue/prepared.json']) {
  const present = await access(new URL(`../../${directory}${file}`, import.meta.url)).then(
    () => true,
    () => false,
  );
  assert.equal(present, false, `Private artifact in public output: ${file}`);
}
if (vercel) {
  const config = JSON.parse(await readFile(new URL('../../.vercel/output/config.json', import.meta.url), 'utf8'));
  const routes = config.routes as Array<{ src?: string; dest?: string; handle?: string }>;
  const route = routes.find((r) => r.src && r.dest && new RegExp(r.src).test('/api/lingyue/quota'));
  console.log('Belluna function route:', JSON.stringify(route));
  assert.ok(route?.dest?.includes('_render'), 'Vercel output must route Belluna API to its function');
  // Astro emits one shared function. Configure that artifact rather than a glob that
  // also consumes the separate api/editor/og.ts function in Vercel's build matcher.
  const functionConfig = new URL('../../.vercel/output/functions/_render.func/.vc-config.json', import.meta.url);
  const options = JSON.parse(await readFile(functionConfig, 'utf8'));
  options.supportsCancellation = true;
  await writeFile(functionConfig, `${JSON.stringify(options, null, 2)}\n`);
}
console.log('Belluna public build artifacts verified.');
