import { waitUntil } from '@vercel/functions';
import type { APIRoute } from 'astro';
import { getRuntime, handleRequest } from '../../../server/lingyue';

export const prerender = false;
const route: APIRoute = async ({ request }) => {
  try {
    const env = { ...import.meta.env, ...process.env };
    if (import.meta.env.DEV) env.SITE_ORIGIN = new URL(request.url).origin;
    return await handleRequest(request, getRuntime(env), waitUntil);
  } catch {
    return Response.json(
      { message: '我还在准备中，过会儿来找我喵~' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
};
export const GET = route;
export const POST = route;
