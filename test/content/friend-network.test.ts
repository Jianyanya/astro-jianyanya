import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutFriendNetwork } from '../../src/lib/friend-network.js';

test('empty/single-friend graphs contain only configured nodes, centered around the site', () => {
  assert.deepEqual(layoutFriendNetwork(0, 800).nodes, []);
  const graph = layoutFriendNetwork(1, 800);
  assert.equal(graph.nodes.length, 1);
  const node = graph.nodes[0];
  assert.ok(node);
  assert.ok(node.x > graph.cx);
  assert.ok(node.y < graph.cy);
});

test('rings retain every friend and keep avatars and lower labels inside desktop and mobile stages', () => {
  for (const width of [300, 800]) {
    for (const count of [1, 8, 9, 20, 36]) {
      const graph = layoutFriendNetwork(count, width);
      assert.equal(graph.nodes.length, count);
      assert.equal(new Set(graph.nodes.map(({ x, y }) => `${x},${y}`)).size, count);
      for (const node of graph.nodes) {
        assert.ok(node.x >= 34 && node.x <= width - 34);
        assert.ok(node.y >= 34 && node.y <= graph.height - 78);
      }
    }
  }
});
