/** Elliptical rings keep nodes legible on phones; additional friends grow new rings. */
export function layoutFriendNetwork(count: number, width: number) {
  const rings = Math.max(1, Math.ceil((Math.sqrt(9 + 2 * count) - 3) / 2));
  const height = Math.max(580, 280 + rings * 300);
  const cx = width / 2;
  const cy = height / 2;
  const nodes: { x: number; y: number }[] = [];
  let remaining = count;
  for (let ring = 0; remaining > 0; ring++) {
    const size = Math.min(remaining, 8 + ring * 4);
    const rx = Math.min(width * (0.29 + ring * 0.045), width / 2 - 62);
    const ry = 190 + ring * 150;
    for (let i = 0; i < size; i++) {
      const angle = size === 1 ? -Math.PI / 5 : -Math.PI / 2 + (i * Math.PI * 2) / size + ring * 0.2;
      nodes.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry });
    }
    remaining -= size;
  }
  return { width, height, cx, cy, nodes };
}
