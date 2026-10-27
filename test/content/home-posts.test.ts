import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectHomePosts } from '../../src/lib/content/home-posts.js';

const post = (id: string, day: number, categories: string[] | string[][] = [], sticky = false) => ({
  id,
  data: { date: new Date(`2026-10-${String(day).padStart(2, '0')}T10:00:00+08:00`), categories, sticky },
});
const series = [{ categoryName: '周刊' }, { categoryName: '博客建设', highlightOnHome: false }];

test('project and older series posts remain in the newest-first feed; actual highlights and pins stay separate', () => {
  const input = [
    post('old-note', 10),
    post('new-rag', 26, ['周刊']),
    post('pinned', 12, [], true),
    post('new-design', 27, [['项目', '博客建设']]),
    post('new-ann', 27, ['周刊']),
  ];
  const result = selectHomePosts(input, series);
  assert.deepEqual(
    result.highlightedPosts.map((p) => p.id),
    ['new-ann'],
  );
  assert.deepEqual(
    result.stickyPosts.map((p) => p.id),
    ['pinned'],
  );
  assert.deepEqual(
    result.regularPosts.map((p) => p.id),
    ['new-design', 'new-rag', 'old-note'],
  );
  assert.equal(input[0]!.id, 'old-note', 'sorting must not mutate the content collection');
});

test('one post in multiple highlighted series is displayed once, including when manually pinned', () => {
  const input = [post('both', 27, [['周刊', '博客建设']], true), post('older', 26, ['博客建设'])];
  const result = selectHomePosts(input, [{ categoryName: '周刊' }, { categoryName: '博客建设' }]);
  assert.deepEqual(
    result.highlightedPosts.map((p) => p.id),
    ['both'],
  );
  assert.deepEqual(result.stickyPosts, []);
  assert.deepEqual(
    result.regularPosts.map((p) => p.id),
    ['older'],
  );
});

test('disabled series do not highlight posts, and paginating the shared feed loses or duplicates no articles', () => {
  const input = Array.from({ length: 25 }, (_, index) => post(`post-${index}`, 27 - index, ['周刊']));
  const { regularPosts, highlightedPosts } = selectHomePosts(input, [{ categoryName: '周刊', enabled: false }]);
  assert.deepEqual(highlightedPosts, []);
  const pages = [regularPosts.slice(0, 10), regularPosts.slice(10, 20), regularPosts.slice(20)];
  assert.deepEqual(
    pages.flat().map((p) => p.id),
    input.map((p) => p.id),
  );
  assert.equal(new Set(pages.flat().map((p) => p.id)).size, 25);
});
