export const BUILDINGS = [
  { id: 'admin', name: '行政楼', z: 22, required: null, flag: 'archive' },
  { id: 'lab', name: '实验楼', z: 39, required: 'archive', flag: 'circuit' },
  { id: 'classroom', name: '教学楼', z: 56, required: 'circuit', flag: 'seat' },
  { id: 'dorm', name: '宿舍', z: 77, required: 'seat', flag: 'pass' },
  { id: 'canteen', name: '食堂', z: 96, required: 'pass', flag: 'name' },
];

const rect = (x, z, w, d, kind = 'wall') => ({ x, z, w, d, kind });
const obj = (id, type, label, x, z, extra = {}) => ({ id, type, label, x, z, ...extra });
const boundary = (w, h) => [rect(w / 2, 0, w, 1), rect(w / 2, h, w, 1), rect(0, h / 2, 1, h), rect(w, h / 2, 1, h)];

function interior(id, label, puzzle, note) {
  const obstacles = [...boundary(28, 28), rect(13, 10, 1, 11), rect(13, 21, 1, 4), rect(21, 13, 7, 1), rect(5, 13, 4, 1)];
  return {
    id, label, width: 28, height: 28, tint: '#345c53', spawn: { x: 14, z: 24, yaw: 0 }, obstacles,
    darkZones: [rect(21, 6, 12, 9)],
    patrol: [{ x: 21, z: 7 }, { x: 25, z: 20 }, { x: 16, z: 18 }, { x: 8, z: 18 }, { x: 7, z: 7 }],
    objects: [
      obj(`${id}-exit`, 'exit', '返回校园', 14, 26),
      obj(`${id}-lamp`, 'lamp', '安全灯 · 检修座', 6, 22),
      obj(`${id}-water`, 'water', '值夜温水', 9, 23),
      obj(`${id}-note`, 'note', note, 6, 6),
      obj(`${id}-puzzle`, 'puzzle', puzzle, 22, 6),
    ],
  };
}

export const SCENES = {
  campus: {
    id: 'campus', label: '夜间校园', width: 48, height: 112, tint: '#263749',
    spawn: { x: 19, z: 10, yaw: Math.PI },
    obstacles: [...boundary(48, 112), ...BUILDINGS.map(b => rect(33, b.z, 17, 11, 'building')),
      rect(8, 29, 5, 5, 'tree'), rect(8, 48, 5, 5, 'tree'), rect(8, 65, 5, 5, 'tree'),
      rect(9, 88, 6, 5, 'tree'), rect(18, 67, 4, 3, 'planter')],
    darkZones: [rect(14, 60, 18, 16), rect(13, 89, 18, 14)],
    patrol: [{ x: 16, z: 95 }, { x: 20, z: 72 }, { x: 15, z: 53 }, { x: 20, z: 30 }, { x: 12, z: 15 }],
    objects: [
      obj('gate', 'gate', '北门 · 旧凭核验', 19, 4),
      obj('campus-lamp', 'lamp', '北门安全灯', 12, 12),
      obj('campus-note', 'note', '校园旧示意图', 21, 12),
      ...BUILDINGS.map(b => obj(`enter-${b.id}`, 'entrance', b.name, 22, b.z, { target: b.id, required: b.required })),
    ],
  },
  admin: interior('admin', '行政楼', '档案台 · 建筑木牌', '旧册背面的压痕'),
  lab: interior('lab', '实验楼', '检修柜 · 三条线路', '检修记录与机械校铃'),
  classroom: interior('classroom', '教学楼', '教室 · 寻回第17座', '原始座位表'),
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

export function getScene(id) {
  return SCENES[id];
}

export function canOccupy(scene, x, z, radius = 0.34) {
  if (x < radius || z < radius || x > scene.width - radius || z > scene.height - radius) return false;
  return !scene.obstacles.some(o => x > o.x - o.w / 2 - radius && x < o.x + o.w / 2 + radius && z > o.z - o.d / 2 - radius && z < o.z + o.d / 2 + radius);
}

export function hasLineOfSight(scene, ax, az, bx, bz) {
  const distance = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(distance * 5));
  for (let i = 1; i < steps; i++) {
    if (!canOccupy(scene, ax + (bx - ax) * i / steps, az + (bz - az) * i / steps, 0.02)) return false;
  }
  return true;
}

export function inDarkZone(scene, player) {
  return scene.darkZones.some(o => Math.abs(player.x - o.x) < o.w / 2 && Math.abs(player.z - o.z) < o.d / 2);
}

export function visibleFrom(scene, player, point, range = 13) {
  return Math.hypot(point.x - player.x, point.z - player.z) <= range && hasLineOfSight(scene, player.x, player.z, point.x, point.z);
}

export function nearbyObject(state) {
  const scene = getScene(state.scene);
  return scene.objects
    .filter(o => Math.hypot(o.x - state.player.x, o.z - state.player.z) < 2.7 && hasLineOfSight(scene, state.player.x, state.player.z, o.x, o.z))
    .sort((a, b) => Math.hypot(a.x - state.player.x, a.z - state.player.z) - Math.hypot(b.x - state.player.x, b.z - state.player.z))[0] || null;
}

function clearBodyPath(scene, from, to) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) * 8));
  for (let i = 1; i <= steps; i++) if (!canOccupy(scene, from.x + (to.x - from.x) * i / steps, from.z + (to.z - from.z) * i / steps, 0.4)) return false;
  return true;
}

export function nextPathPoint(scene, from, to) {
  if (clearBodyPath(scene, from, to)) return to;
  const key = (x, z) => `${x},${z}`;
  const sx = Math.round(from.x), sz = Math.round(from.z), tx = Math.round(to.x), tz = Math.round(to.z);
  const queue = [[sx, sz]], previous = new Map([[key(sx, sz), null]]);
  let found = null;
  for (let i = 0; i < queue.length && i < 6000; i++) {
    const [x, z] = queue[i];
    if (Math.abs(x - tx) + Math.abs(z - tz) <= 1) { found = [x, z]; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, k = key(nx, nz);
      if (!previous.has(k) && canOccupy(scene, nx, nz, 0.4)) {
        previous.set(k, [x, z]); queue.push([nx, nz]);
      }
    }
  }
  if (!found) return from;
  let current = found;
  for (;;) {
    const prev = previous.get(key(...current));
    if (!prev || (prev[0] === sx && prev[1] === sz)) {
      const next = { x: current[0], z: current[1] };
      return clearBodyPath(scene, from, next) ? next : { x: sx, z: sz };
    }
    current = prev;
  }
}
