import type { APIRoute } from 'astro';
import { manifestOf } from '../../server/lingyue/manifest';
import { getSnapshot } from './snapshot';

/** Public fingerprint only; never includes article bodies, vectors or credentials. */
export const GET: APIRoute = async () => Response.json(manifestOf(await getSnapshot()));
