export type Rect = [number, number, number, number];
export interface CollisionRoom { bounds: Rect; obstacles: Rect[] }
export function moveWithinRoom(position: { x: number; z: number }, dx: number, dz: number, room: CollisionRoom) {
  const radius = .18;
  let { x, z } = position;
  const blocked = (px: number, pz: number) => room.obstacles.some(([left, right, back, front]) =>
    px > left - radius && px < right + radius && pz > back - radius && pz < front + radius);
  const count = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / .1));
  for (let i = 0; i < count; i++) {
    const nextX = Math.max(room.bounds[0] + radius, Math.min(room.bounds[1] - radius, x + dx / count));
    if (!blocked(nextX, z)) x = nextX;
    const nextZ = Math.max(room.bounds[2] + radius, Math.min(room.bounds[3] - radius, z + dz / count));
    if (!blocked(x, nextZ)) z = nextZ;
  }
  return { x, z };
}
