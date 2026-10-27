interface CoverPost {
  slug: string;
  cover?: string;
}

/** Share one allocation across all lists on a page; author-selected covers always win. */
export function selectPostCovers(posts: readonly CoverPost[], pool: readonly string[]): Map<string, string> {
  const covers = [...new Set(pool.filter((cover) => cover.trim()))];
  const assignments = new Map<string, string>();
  const usage = new Map(covers.map((cover) => [cover, 0]));

  // Reserve explicit covers before drawing, including those in a later list.
  for (const post of posts) {
    if (!post.cover || assignments.has(post.slug)) continue;
    assignments.set(post.slug, post.cover);
    if (usage.has(post.cover)) usage.set(post.cover, usage.get(post.cover)! + 1);
  }

  for (const post of posts) {
    if (assignments.has(post.slug) || !covers.length) continue;
    const minimum = Math.min(...usage.values());
    const candidates = covers.filter((cover) => usage.get(cover) === minimum);
    const cover = candidates[Math.floor(Math.random() * candidates.length)]!;
    assignments.set(post.slug, cover);
    usage.set(cover, minimum + 1);
  }
  return assignments;
}
