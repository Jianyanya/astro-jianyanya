import type { APIRoute } from 'astro';
import { getRuntime } from '../../../../server/lingyue';
import { PublicError } from '../../../../server/lingyue/limits';

export const prerender = false;
const route: APIRoute = async ({ request }) => {
  try {
    const env = { ...import.meta.env, ...process.env };
    if (import.meta.env.DEV) env.SITE_ORIGIN = new URL(request.url).origin;
    return await getRuntime(env).auth.handle(request);
  } catch (error) {
    return Response.json(
      { message: error instanceof PublicError ? error.message : '登录没接上，稍后再试试喵~' },
      {
        status: error instanceof PublicError ? error.status : 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
};
export const GET = route;
export const POST = route;
