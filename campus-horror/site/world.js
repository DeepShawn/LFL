export const FLOOR_HEIGHT = 3.6;
export const BUILDINGS = [
  { id: 'admin', name: '行政楼', z: 22, floors: 5, required: null, flag: 'archive' },
  { id: 'lab', name: '实验楼', z: 39, floors: 5, required: 'archive', flag: 'circuit' },
  { id: 'classroom', name: '教学楼', z: 56, floors: 5, required: 'circuit', flag: 'seat' },
  { id: 'dorm', name: '宿舍', z: 77, floors: 1, exteriorFloors: 3, required: 'seat', flag: 'pass' },
  { id: 'canteen', name: '食堂', z: 96, floors: 1, exteriorFloors: 3, required: 'pass', flag: 'name' },
];

export const INVESTIGATIONS = {
  admin: { id: 'adminTrace', title: '旧册移交', answer: ['original', 'forty', 'seventeen'], rooms: ['接待与档案', '移交办公室', '旧名册保管室', '补录核查室', '档案复核室'] },
  lab: { id: 'labTrace', title: '真铃时序', answer: ['short', 'short', 'long', 'latch'], rooms: ['实验分路检修', '线路资料室', '声学实验室', '机械记录室', '校铃校准室'] },
  classroom: { id: 'classTrace', title: '原座位溯源', answer: [40, 17, 3, 1], rooms: ['原班教室', '课表留存室', '座位转存室', '桌沿刻记室', '学籍复核室'] },
};

const rect = (x, z, w, d, kind = 'wall', extra = {}) => ({ x, z, w, d, kind, y: 0, h: 3.3, blocksSight: true, ...extra });
const obj = (id, type, label, x, z, extra = {}) => ({ id, type, label, x, z, floor: 1, y: 0, ...extra });
const inside = (r, x, z, inset = 0) => x >= r.x - r.w / 2 + inset && x <= r.x + r.w / 2 - inset && z >= r.z - r.d / 2 + inset && z <= r.z + r.d / 2 - inset;
const boundary = (w, h, height = 3.3) => [rect(w / 2, 0, w, 1, 'boundary', { h: height }), rect(w / 2, h, w, 1, 'boundary', { h: height }), rect(0, h / 2, 1, h, 'boundary', { h: height }), rect(w, h / 2, 1, h, 'boundary', { h: height })];

function interior(id, label, puzzle, note, floors = 1) {
  const width = floors > 1 ? 40 : 28;
  const objects = [obj(`${id}-exit`, 'exit', '返回校园', 14, 26), obj(`${id}-lamp`, 'lamp', '安全灯 · 检修座', 6, 22), obj(`${id}-water`, 'water', '值夜温水', 9, 23), obj(`${id}-note`, 'note', note, 6, 6, { noteId: id }), obj(`${id}-puzzle`, 'puzzle', puzzle, 22, 6, { puzzleId: id })];
  const scene = { id, buildingId: id, label, width, height: 28, floors, floorHeight: FLOOR_HEIGHT, tint: '#345c53', spawn: { x: 14, z: 24, y: 0, floor: 1, yaw: 0 }, obstacles: boundary(width, 28, floors * FLOOR_HEIGHT), objects, darkZones: [], patrol: [], stairs: [], floorNames: INVESTIGATIONS[id]?.rooms || [label] };
  for (let floor = 1; floor <= floors; floor++) {
    const y = (floor - 1) * FLOOR_HEIGHT;
    scene.obstacles.push(rect(13, 10, 1, 11, 'wall', { y, floor }), rect(13, 21, 1, 4, 'wall', { y, floor }), rect(21, 13, 7, 1, 'wall', { y, floor }), rect(5, 13, 4, 1, 'wall', { y, floor }));
    if (floors > 1) scene.obstacles.push(rect(28, 11, 1, 22, 'wall', { y, floor }), rect(28, 27, 1, 2, 'wall', { y, floor }));
    scene.darkZones.push(rect(21, 6, 12, 9, 'dark', { floor, y }));
    for (const p of [{ x: 21, z: 7 }, { x: 25, z: 20 }, { x: 16, z: 18 }, { x: 8, z: 18 }, { x: 7, z: 7 }]) scene.patrol.push({ ...p, y, floor });
    if (floor > 1) {
      objects.push(obj(`${id}-f${floor}-note`, 'note', `${floor}F · ${scene.floorNames[floor - 1]}记录`, 6, 6, { floor, y, noteId: `${id}-${floor}` }));
      objects.push(obj(`${id}-f${floor}-lamp`, 'lamp', `${floor}F安全灯 · 检修座`, 6, 22, { floor, y }));
      if (floor === 3) objects.push(obj(`${id}-f3-water`, 'water', '备用温水', 9, 23, { floor, y }));
      if (floor === 5) objects.push(obj(`${id}-trace`, 'investigation', `${INVESTIGATIONS[id].title} · 复核台`, 22, 6, { floor, y, investigationId: id }));
      else objects.push(obj(`${id}-f${floor}-evidence`, 'evidence', `${floor}F · 查看实物证据`, 22, 6, { floor, y, noteId: `${id}-${floor}` }));
    }
    if (floor < floors) scene.stairs.push({ from: floor, to: floor + 1, y, rise: FLOOR_HEIGHT, lower: { x: 31.5, z: 23, y }, middleA: { x: 31.5, z: 6.5, y: y + FLOOR_HEIGHT / 2 }, middleB: { x: 36.5, z: 6.5, y: y + FLOOR_HEIGHT / 2 }, upper: { x: 36.5, z: 23, y: y + FLOOR_HEIGHT } });
  }
  if (floors > 1) for (const x of [29.8, 33.2, 34.8, 38.2]) scene.obstacles.push(rect(x, 15, .16, 13.6, 'stair-guard', { h: floors * FLOOR_HEIGHT, blocksSight: false }));
  return scene;
}

export const SCENES = {
  campus: {
    id: 'campus', label: '夜间校园', width: 48, height: 112, floors: 1, floorHeight: FLOOR_HEIGHT, tint: '#263749', spawn: { x: 19, z: 10, y: 0, floor: 1, yaw: Math.PI }, stairs: [], floorNames: ['校园道路'],
    obstacles: [...boundary(48, 112), ...BUILDINGS.map(b => rect(33, b.z, 17, 11, 'building', { buildingId: b.id, h: (b.exteriorFloors || b.floors) * FLOOR_HEIGHT })), rect(8, 29, 5, 5, 'tree', { h: 5 }), rect(8, 48, 5, 5, 'tree', { h: 5 }), rect(8, 65, 5, 5, 'tree', { h: 5 }), rect(9, 88, 6, 5, 'tree', { h: 5 }), rect(18, 67, 4, 3, 'planter', { h: .65 })],
    darkZones: [rect(14, 60, 18, 16, 'dark', { floor: 1 }), rect(13, 89, 18, 14, 'dark', { floor: 1 })],
    patrol: [{ x: 16, z: 95 }, { x: 20, z: 72 }, { x: 15, z: 53 }, { x: 20, z: 30 }, { x: 12, z: 15 }].map(p => ({ ...p, y: 0, floor: 1 })),
    objects: [obj('gate', 'gate', '北门 · 旧凭核验', 19, 4), obj('campus-lamp', 'lamp', '北门安全灯', 12, 12), obj('campus-note', 'note', '校园旧示意图', 21, 12, { noteId: 'campus' }), ...BUILDINGS.map(b => obj(`enter-${b.id}`, 'entrance', b.name, 23, b.z, { target: b.id, required: b.required }))],
  },
  admin: interior('admin', '行政楼', '档案台 · 建筑木牌', '旧册背面的压痕', 5),
  lab: interior('lab', '实验楼', '检修柜 · 三条线路', '检修记录与机械校铃', 5),
  classroom: interior('classroom', '教学楼', '教室 · 寻回第17座', '原始座位表', 5),
  dorm: interior('dorm', '宿舍', '储物柜 · 拼合签离联', '留在门内的便条'),
  canteen: interior('canteen', '食堂', '归名桌 · 第四十一只碗', '归名口诀'),
  tutorial: interior('tutorial', '入夜演习', '练习台 · 检查纸背', '夜行入门'),
};
SCENES.admin.objects.push(obj('total-control', 'control', '广播总控 · 终止重复点名', 19, 19));
SCENES.lab.objects.push(obj('mechanical-bell', 'bell', '机械校铃与门闩', 18, 15));
SCENES.dorm.objects.push(obj('voice-door', 'voice', '门外的声音', 24, 19));
SCENES.canteen.objects.push(obj('return-echoes', 'echoes', '归还其余三十九道回声', 19, 7));
SCENES.tutorial.objects.push(obj('training-shadow', 'training', '演练：点名者与遮挡', 20, 19));
SCENES.tutorial.darkZones = [];

for (const scene of Object.values(SCENES)) {
  for (const object of scene.objects) {
    if (['note', 'puzzle', 'control', 'bell', 'investigation', 'evidence'].includes(object.type)) scene.obstacles.push(rect(object.x, object.z, .9, .8, 'table', { y: object.y, h: .78, floor: object.floor, objectId: object.id }));
    if (object.type === 'lamp') scene.obstacles.push(rect(object.x, object.z, .32, .32, 'lamp-post', { y: object.y, h: 1.3, floor: object.floor, blocksSight: false, objectId: object.id }));
  }
}

export const getScene = id => SCENES[id];
export const getFloor = (scene, y = 0) => Math.max(1, Math.min(scene.floors, Math.floor((y + .03) / FLOOR_HEIGHT) + 1));
export const onStairs = (scene, body) => scene.floors > 1 && body.x >= 29.5 && body.z < 22;
export const floorObjects = (scene, body) => scene.objects.filter(o => Math.abs(o.y - (body.y || 0)) < .45);
export const locationLabel = state => `${getScene(state.scene).label}${getScene(state.scene).floors > 1 ? ` · ${state.player.floor}F${onStairs(getScene(state.scene), state.player) ? '楼梯间' : ''}` : ''}`;

export function surfaceHeights(scene, x, z) {
  if (x < .5 || z < .5 || x > scene.width - .5 || z > scene.height - .5) return [];
  if (scene.floors === 1) return [0];
  if (x < 28.5 || z >= 22) return Array.from({ length: scene.floors }, (_, i) => i * FLOOR_HEIGHT);
  const heights = [];
  for (const s of scene.stairs) {
    if (x >= 30 && x <= 38 && z >= 5 && z <= 8) heights.push(s.y + FLOOR_HEIGHT / 2);
    else if (x >= 30 && x <= 33 && z >= 8 && z <= 22) heights.push(s.y + (22 - z) / 14 * FLOOR_HEIGHT / 2);
    else if (x >= 35 && x <= 38 && z >= 8 && z <= 22) heights.push(s.y + FLOOR_HEIGHT / 2 + (z - 8) / 14 * FLOOR_HEIGHT / 2);
  }
  return heights;
}

export function heightAt(scene, x, z, nearY = 0) {
  const heights = surfaceHeights(scene, x, z).sort((a, b) => Math.abs(a - nearY) - Math.abs(b - nearY));
  return heights.length && Math.abs(heights[0] - nearY) <= .38 ? heights[0] : null;
}

export function canOccupy(scene, x, z, radius = .34, y = 0) {
  if (x < radius + .5 || z < radius + .5 || x > scene.width - radius - .5 || z > scene.height - radius - .5) return false;
  return !scene.obstacles.some(o => y + 1.65 > o.y + .02 && y < o.y + o.h - .02 && inside(o, x, z, -radius));
}

export function moveActor(scene, actor, dx, dz, radius = .34) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .16));
  for (let i = 0; i < steps; i++) {
    for (const [ax, az] of [[dx / steps, 0], [0, dz / steps]]) {
      const x = actor.x + ax, z = actor.z + az, y = heightAt(scene, x, z, actor.y || 0);
      if (y !== null && canOccupy(scene, x, z, radius, y)) { actor.x = x; actor.z = z; actor.y = y; }
    }
  }
  actor.floor = getFloor(scene, actor.y || 0);
}

export function hasLineOfSight(scene, ax, az, bx, bz, ay = 1.65, by = 1.2) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az, by - ay) * 6));
  let lastY = ay, lastX = ax, lastZ = az;
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + (by - ay) * t;
    if (scene.obstacles.some(o => o.blocksSight && y > o.y && y < o.y + o.h && inside(o, x, z))) return false;
    if (scene.floors > 1 && (x <= 28.5 || z >= 22)) {
      for (let floor = 1; floor < scene.floors; floor++) {
        const slab = floor * FLOOR_HEIGHT;
        if (Math.min(lastY, y) <= slab && Math.max(lastY, y) >= slab) return false;
      }
    }
    if (scene.floors > 1 && x >= 30 && x <= 38 && z >= 5 && z < 22 && lastX >= 30 && lastX <= 38 && lastZ >= 5 && lastZ < 22) {
      const before = surfaceHeights(scene, lastX, lastZ), after = surfaceHeights(scene, x, z);
      if (before.length === after.length && before.some((h, index) => (lastY - h) * (y - after[index]) <= 0)) return false;
    }
    lastY = y; lastX = x; lastZ = z;
  }
  return true;
}

export const inDarkZone = (scene, player) => scene.darkZones.some(o => o.floor === player.floor && inside(o, player.x, player.z));
export const visibleFrom = (scene, player, point, range = 13) => Math.hypot(point.x - player.x, point.z - player.z, (point.y || 0) - (player.y || 0)) <= range && hasLineOfSight(scene, player.x, player.z, point.x, point.z, (player.y || 0) + 1.65, (point.y || 0) + (point.type ? 1 : 1.3));

export function nearbyObject(state) {
  const scene = getScene(state.scene);
  return scene.objects.filter(o => Math.abs(o.y - state.player.y) < .5 && visibleFrom(scene, state.player, o, 2.7) && !(o.type === 'water' && state.collected.includes(o.id)))
    .sort((a, b) => Math.hypot(a.x - state.player.x, a.z - state.player.z) - Math.hypot(b.x - state.player.x, b.z - state.player.z))[0] || null;
}

function clearBodyPath(scene, from, to) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) * 8));
  let y = from.y || 0;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * i / steps, z = from.z + (to.z - from.z) * i / steps;
    y = heightAt(scene, x, z, y);
    if (y === null || !canOccupy(scene, x, z, .4, y)) return false;
  }
  return Math.abs(y - (to.y || 0)) < .3;
}

const graphs = new Map();
function navigation(scene) {
  if (graphs.has(scene.id)) return graphs.get(scene.id);
  const nodes = [], cells = new Map();
  for (let x = 1; x < scene.width; x++) for (let z = 1; z < scene.height; z++) {
    const cell = [];
    for (const y of surfaceHeights(scene, x, z)) if (canOccupy(scene, x, z, .4, y)) { const n = { x, z, y, index: nodes.length, edges: [] }; nodes.push(n); cell.push(n); }
    cells.set(`${x},${z}`, cell);
  }
  for (const n of nodes) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const m of cells.get(`${n.x + dx},${n.z + dz}`) || []) if (Math.abs(m.y - n.y) < .35 && clearBodyPath(scene, n, m)) n.edges.push(m.index);
  }
  const graph = { nodes, cells }; graphs.set(scene.id, graph); return graph;
}

export function nextPathPoint(scene, from, to) {
  if (clearBodyPath(scene, from, to)) return to;
  const { nodes, cells } = navigation(scene);
  const closest = body => {
    const candidates = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const n of cells.get(`${Math.round(body.x) + dx},${Math.round(body.z) + dz}`) || []) {
      if (Math.abs(n.y - (body.y || 0)) < .4 && clearBodyPath(scene, body, n)) candidates.push(n);
    }
    return candidates.sort((a, b) => Math.hypot(a.x - body.x, a.z - body.z, a.y - (body.y || 0)) - Math.hypot(b.x - body.x, b.z - body.z, b.y - (body.y || 0)))[0];
  };
  const start = closest(from), end = closest(to);
  if (!start || !end) return from;
  const previous = new Int32Array(nodes.length).fill(-2), queue = [start.index]; previous[start.index] = -1;
  for (let i = 0; i < queue.length; i++) {
    const index = queue[i]; if (index === end.index) break;
    for (const neighbor of nodes[index].edges) if (previous[neighbor] === -2) { previous[neighbor] = index; queue.push(neighbor); }
  }
  if (previous[end.index] === -2) return from;
  let index = end.index;
  while (previous[index] >= 0 && previous[index] !== start.index) index = previous[index];
  const next = nodes[index];
  return clearBodyPath(scene, from, next) ? { x: next.x, z: next.z, y: next.y } : { x: start.x, z: start.z, y: start.y };
}
