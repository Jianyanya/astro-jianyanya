import { readFile, writeFile } from 'node:fs/promises';

const id = process.env.LINGYUE_D1_ID;
if (!id || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Set LINGYUE_D1_ID to the created D1 database ID');
const file = new URL('../wrangler.jsonc', import.meta.url);
const config = JSON.parse(await readFile(file, 'utf8'));
config.d1_databases[0].database_id = id;
await writeFile(file, JSON.stringify(config, null, 2) + '\n');
