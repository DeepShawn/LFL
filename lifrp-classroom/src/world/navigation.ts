import type { CollisionRoom, Rect } from './collision';

export interface NavigationPoint { x: number; z: number; }

function blocked(x: number, z: number, room: CollisionRoom, radius = .18) {
  if (x < room.bounds[0] + radius || x > room.bounds[1] - radius || z < room.bounds[2] + radius || z > room.bounds[3] - radius) return true;
  return room.obstacles.some(([left, right, back, front]) => x > left - radius && x < right + radius && z > back - radius && z < front + radius);
}

export function segmentClear(from: NavigationPoint, to: NavigationPoint, room: CollisionRoom) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / .12));
  for (let index = 1; index <= steps; index++) {
    const t = index / steps;
    if (blocked(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t, room)) return false;
  }
  return true;
}

/** Returns a short collision-safe path for map clicks, or null if unreachable. */
export function findPath(from: NavigationPoint, to: NavigationPoint, room: CollisionRoom): NavigationPoint[] | null {
  if (segmentClear(from, to, room)) return [to];
  const padding = .34;
  const waypoints: NavigationPoint[] = [from, to];
  for (const [left, right, back, front] of room.obstacles as Rect[]) {
    waypoints.push(
      { x: left - padding, z: back - padding }, { x: right + padding, z: back - padding },
      { x: left - padding, z: front + padding }, { x: right + padding, z: front + padding },
    );
  }
  const nodes = waypoints.filter((point, index) => index < 2 || !blocked(point.x, point.z, room));
  const distances = nodes.map((_, index) => index === 0 ? 0 : Infinity);
  const previous = nodes.map(() => -1);
  const visited = new Set<number>();
  while (visited.size < nodes.length) {
    let current = -1;
    for (let index = 0; index < nodes.length; index += 1) {
      if (!visited.has(index) && (current < 0 || distances[index] < distances[current])) current = index;
    }
    if (current < 0 || !Number.isFinite(distances[current])) break;
    visited.add(current);
    if (current === 1) break;
    for (let next = 0; next < nodes.length; next += 1) {
      if (visited.has(next) || next === current || !segmentClear(nodes[current], nodes[next], room)) continue;
      const length = Math.hypot(nodes[next].x - nodes[current].x, nodes[next].z - nodes[current].z);
      if (distances[current] + length < distances[next]) {
        distances[next] = distances[current] + length;
        previous[next] = current;
      }
    }
  }
  if (!Number.isFinite(distances[1])) return null;
  const path: NavigationPoint[] = [];
  for (let current = 1; current >= 0; current = previous[current]) {
    path.unshift(nodes[current]);
    if (current === 0) break;
  }
  return path.slice(1);
}
