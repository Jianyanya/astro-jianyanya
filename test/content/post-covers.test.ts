import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectPostCovers } from '../../src/lib/content/post-covers.js';

test('pins and the regular feed share one pool without repeats, even when pool entries are duplicated', () => {
  const posts = Array.from({ length: 11 }, (_, i) => ({ slug: `post-${i}` }));
  const pool = Array.from({ length: 35 }, (_, i) => `/cover-${i}.webp`);
  const assignments = selectPostCovers(posts, [...pool, pool[0]!]);
  const pins = posts.slice(0, 1).map((post) => assignments.get(post.slug));
  const feed = posts.slice(1).map((post) => assignments.get(post.slug));
  assert.equal(new Set([...pins, ...feed]).size, posts.length);
  assert.ok([...assignments.values()].every((cover) => pool.includes(cover)));
});

test('reserve later explicit covers before drawing, and assign repeated posts only once', () => {
  const posts = [{ slug: 'random' }, { slug: 'explicit', cover: '/a' }, { slug: 'random' }];
  const result = selectPostCovers(posts, ['/a', '/b', '/b', '']);
  assert.equal(result.get('explicit'), '/a');
  assert.equal(result.get('random'), '/b');
  assert.equal(result.size, 2);
  assert.equal(posts[0]!.cover, undefined, 'never mutate post metadata');
});

test('recycle evenly only after exhausting the unique pool; an empty pool still preserves explicit covers', () => {
  const posts = Array.from({ length: 10 }, (_, i) => ({ slug: `post-${i}` }));
  const result = selectPostCovers(posts, ['/a', '/b', '/c']);
  const counts = ['/a', '/b', '/c'].map((cover) => [...result.values()].filter((value) => value === cover).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  assert.equal(new Set([...result.values()].slice(0, 3)).size, 3);
  assert.deepEqual(
    [...selectPostCovers([{ slug: 'fixed', cover: '/explicit' }, { slug: 'none' }], [])],
    [['fixed', '/explicit']],
  );
});
