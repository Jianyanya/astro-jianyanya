interface HomePost {
  id: string;
  data: { date: Date; sticky?: boolean; categories?: string[] | string[][] };
}
interface HomeSeries {
  categoryName: string;
  enabled?: boolean;
  highlightOnHome?: boolean;
}

/** Series membership controls highlighting, never exclusion from the chronological feed. */
export function selectHomePosts<T extends HomePost>(posts: readonly T[], series: readonly HomeSeries[]) {
  const sorted = posts.toSorted((a, b) => b.data.date.getTime() - a.data.date.getTime());
  const highlightedPosts: T[] = [];
  const highlightedIds = new Set<string>();
  for (const item of series) {
    if (item.enabled === false || item.highlightOnHome === false) continue;
    const latest = sorted.find((post) => post.data.categories?.flat().includes(item.categoryName));
    if (latest && !highlightedIds.has(latest.id)) {
      highlightedIds.add(latest.id);
      highlightedPosts.push(latest);
    }
  }
  const stickyPosts = sorted.filter((post) => post.data.sticky && !highlightedIds.has(post.id));
  const regularPosts = sorted.filter((post) => !post.data.sticky && !highlightedIds.has(post.id));
  return { highlightedPosts, stickyPosts, regularPosts };
}
