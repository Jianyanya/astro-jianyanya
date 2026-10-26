import { getCollection } from 'astro:content';
import { getPostLocale, getPostSlug } from '@lib/content/locale';
import { isPostSourcePublic } from '@lib/content/post-source';
import { encodeSlug } from '@lib/url';
import type { APIRoute } from 'astro';
import { localizedPath } from '@/i18n';
import { localeList } from '@/i18n/config';

export async function getSnapshot() {
  const posts = await getCollection('blog');
  const documents = posts
    .filter((post) => isPostSourcePublic(post.data, post.body, true) && localeList.includes(getPostLocale(post)))
    .map((post) => ({
      id: post.id,
      title: post.data.title,
      url: localizedPath(`/post/${encodeSlug(getPostSlug(post))}`, getPostLocale(post)),
      locale: getPostLocale(post),
      tags: [...(post.data.tags ?? []), ...(post.data.categories?.flat() ?? [])],
      body: post.body ?? '',
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { schema: 1 as const, documents };
}
export const GET: APIRoute = async () => {
  if (import.meta.env.DEV) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(await getSnapshot()), { headers: { 'Content-Type': 'application/json' } });
};
