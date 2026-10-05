import { MODES } from './modes.js';
import { BUILDINGS, INVESTIGATIONS, getScene, canOccupy, hasLineOfSight, inDarkZone, nextPathPoint, nearbyObject, moveActor, onStairs, locationLabel, heightAt } from './world.js';
import { changeSanity, updateSanity, rewardClue, drinkWater } from './sanity.js';

const blankEnemy = () => ({ active: false, x: 7, z: 7, y: 0, floor: 1, yaw: 0, mode: 'patrol', timer: 0, lost: 0, patrol: 0, pathTimer: 0, waypoint: null, target: null });
const result = (ok, message, extra = {}) => ({ ok, message, ...extra });

export function createGame(mode = 'easy') {
  if (!MODES[mode]) throw new Error('未知模式');
  const scene = mode === 'tutorial' ? 'tutorial' : 'campus';
  return {
    mode, scene, view: '3d', status: 'playing', elapsed: 0,
    player: { ...getScene(scene).spawn, pitch: 0, san: 100, stamina: 100, flashlight: true },
    flags: {}, inventory: { water: 0, archive: false, pass: false, name: false }, notes: [], collected: [],
    activatedLamps: ['campus-lamp'], visited: [scene], visitedFloors: [`${scene}:1`], enemy: blankEnemy(), enemies: {},
    tutorial: { moved: false, switched: false, light: false, inspected: false, puzzle: false, recovered: false, water: false, escaped: false, retried: false },
    pendingEncounter: null, events: [], bellUntil: 0, checkpointLabel: mode === 'tutorial' ? '入夜演习 · 入口' : '北门 · 入夜', checkpointRequest: true, ending: null, message: '', restTime: 0,
  };
}

export function isThreatened(state) {
  return state.enemy.active && ['alert', 'chase', 'search'].includes(state.enemy.mode);
}

export function canSave(state) {
  return state.status === 'playing' && !state.pendingEncounter && !isThreatened(state) && (!state.enemy.active || Math.hypot(state.enemy.x - state.player.x, state.enemy.z - state.player.z, state.enemy.y - state.player.y) > 10);
}

export function activeLamp(state) {
  return getScene(state.scene).objects.find(o => o.type === 'lamp' && Math.abs(o.y - state.player.y) < .3 && state.activatedLamps.includes(o.id) && Math.hypot(o.x - state.player.x, o.z - state.player.z) < 3 && hasLineOfSight(getScene(state.scene), o.x, o.z, state.player.x, state.player.z, o.y + 1.25, state.player.y + 1.65));
}

export function toggleView(state) {
  state.view = state.view === '3d' ? '2d' : '3d';
  state.tutorial.switched = true;
  return state.view;
}

export function enterScene(state, target) {
  if (isThreatened(state)) return result(false, '翻页声还没有远去。先利用遮挡脱离追踪，再通过门口。');
  const building = BUILDINGS.find(b => b.id === target);
  if (building?.required && !state.flags[building.required]) return result(false, '这里还没有开放。先完成上一栋楼的调查，取得通行线索。');
  if (!getScene(target)) return result(false, '没有这条路。');
  const old = state.scene;
  state.enemies[old] = structuredClone(state.enemy);
  state.scene = target;
  state.enemy = state.enemies[target] ? structuredClone(state.enemies[target]) : blankEnemy();
  Object.assign(state.player, getScene(target).spawn, { pitch: 0 });
  if (target === 'campus') {
    const exit = BUILDINGS.find(b => b.id === old);
    if (exit) Object.assign(state.player, { x: 20, z: exit.z, yaw: Math.PI / 2 });
  }
  if (state.enemy.active && Math.hypot(state.enemy.x - state.player.x, state.enemy.z - state.player.z, state.enemy.y - state.player.y) < 11) {
    const destination = getScene(target), origin = { x: state.player.x, z: state.player.z };
    const choices = [];
    for (let radius = 1; radius <= 12; radius++) for (let step = 0; step < 16; step++) {
      const angle = step * Math.PI / 8, x = origin.x + Math.cos(angle) * radius, z = origin.z + Math.sin(angle) * radius;
      if (heightAt(destination, x, z, 0) === 0 && canOccupy(destination, x, z) && hasLineOfSight(destination, origin.x, origin.z, x, z) && Math.hypot(x - state.enemy.x, z - state.enemy.z, state.enemy.y) > 11) choices.push({ x, z, radius });
    }
    if (choices.length) { state.player.x = choices[0].x; state.player.z = choices[0].z; }
  }
  if (!state.visited.includes(target)) state.visited.push(target);
  if (!state.visitedFloors.includes(`${target}:1`)) state.visitedFloors.push(`${target}:1`);
  if (old === 'canteen' && state.flags.name && !state.events.includes('return')) state.pendingEncounter = 'return';
  state.checkpointLabel = `${getScene(target).label} · 入口`;
  state.checkpointRequest = true;
  return result(true, `抵达${getScene(target).label}。`, { close: true, save: true });
}

export function triggerEncounter(state, id) {
  if (state.events.includes(id) && id !== 'training') return;
  if (!state.events.includes(id)) state.events.push(id);
  const scene = getScene(state.scene);
  const options = scene.patrol.filter(p => p.floor === state.player.floor && canOccupy(scene, p.x, p.z, .36, p.y) && Math.hypot(p.x - state.player.x, p.z - state.player.z) > 10);
  const spawn = options.find(p => !hasLineOfSight(scene, p.x, p.z, state.player.x, state.player.z, p.y + 1.65, state.player.y + 1.65)) || options[0] || scene.patrol[0];
  state.enemy = { ...blankEnemy(), ...spawn, active: true, mode: 'alert', timer: 2.5, target: { x: state.player.x, z: state.player.z, y: state.player.y } };
  state.message = '【翻页声】远处有人合上了点名册。绕过墙角，熄灯，保持安静。';
  changeSanity(state, state.mode === 'tutorial' ? -25 : -8 * MODES[state.mode].drain);
}

function updateEnemy(state, dt, running) {
  const e = state.enemy;
  if (!e.active) return;
  const scene = getScene(state.scene), p = state.player, mode = MODES[state.mode];
  const distance = Math.hypot(e.x - p.x, e.z - p.z, e.y - p.y);
  const line = hasLineOfSight(scene, e.x, e.z, p.x, p.z, e.y + 1.65, p.y + 1.5);
  const hearing = Math.abs(e.y - p.y) < .4 || (onStairs(scene, e) && onStairs(scene, p));
  const detected = (line && distance < (p.flashlight ? 10 : 4.2)) || (running && hearing && distance < 6.5);
  if (e.mode === 'alert') {
    e.timer -= dt;
    if (e.timer <= 0) { e.mode = 'chase'; e.lost = 0; }
    return;
  }
  if (detected) { e.mode = 'chase'; e.lost = 0; e.target = { x: p.x, z: p.z, y: p.y }; }
  else if (e.mode === 'chase') {
    e.lost += dt;
    if (e.lost > 1.6) { e.mode = 'search'; e.timer = mode.searchTime; }
  } else if (e.mode === 'search') {
    e.timer -= dt;
    if (e.timer <= 0) {
      e.mode = 'patrol'; e.target = null;
      state.message = '翻页声渐远。你暂时脱离了追踪。';
      if (state.mode === 'tutorial') { state.tutorial.escaped = true; e.active = false; state.checkpointRequest = true; return; }
    }
  }
  let destination = e.target;
  if (e.mode === 'patrol') {
    const route = scene.patrol.filter(point => point.floor === e.floor);
    destination = route[e.patrol % route.length];
    if (Math.hypot(e.x - destination.x, e.z - destination.z, e.y - destination.y) < 0.7) { e.patrol++; destination = route[e.patrol % route.length]; }
  }
  if (destination) {
    e.pathTimer -= dt;
    if (e.pathTimer <= 0 || !e.waypoint || Math.hypot(e.waypoint.x - e.x, e.waypoint.z - e.z) < 0.3) {
      e.waypoint = nextPathPoint(scene, e, destination); e.pathTimer = 0.45;
    }
    const dx = e.waypoint.x - e.x, dz = e.waypoint.z - e.z, len = Math.hypot(dx, dz);
    if (len > 0.1) {
      const speed = mode.enemySpeed * (e.mode === 'patrol' ? 0.5 : 1);
      const step = Math.min(len, speed * dt);
      moveActor(scene, e, dx / len * step, dz / len * step, 0.36);
      e.yaw = Math.atan2(-dx, -dz);
    }
  }
  if (Math.hypot(e.x - p.x, e.z - p.z, e.y - p.y) < 0.85 && line) {
    if (state.mode === 'tutorial') {
      e.active = false; Object.assign(p, scene.spawn); state.message = '演习暂停：先走到墙角后，再关灯。可以回演练点重试，不损失进度。';
    } else { state.status = 'failed'; state.failure = '点名册在你面前合上了。下一次，先打断它的视线。'; }
  }
}

export function updateGame(state, input, dt) {
  if (state.status !== 'playing') return;
  dt = Math.min(Math.max(dt, 0), 0.05);
  state.elapsed += dt;
  if (state.pendingEncounter) { const id = state.pendingEncounter; state.pendingEncounter = null; triggerEncounter(state, id); }
  const p = state.player, scene = getScene(state.scene);
  p.yaw += input.turn || 0;
  p.pitch = Math.max(-1.1, Math.min(1.1, p.pitch + (input.pitch || 0)));
  let dx = input.x || 0, dz = input.z || 0;
  const magnitude = Math.hypot(dx, dz);
  if (magnitude > 1) { dx /= magnitude; dz /= magnitude; }
  if (state.view === '3d') {
    const x = dx * Math.cos(p.yaw) + dz * Math.sin(p.yaw);
    dz = -dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw); dx = x;
  } else if (magnitude > 0.1) p.yaw = Math.atan2(-dx, -dz);
  const running = !!input.sprint && magnitude > 0.1 && p.stamina > 3;
  const speed = running ? 5.5 : 3.3;
  const before = { x: p.x, z: p.z };
  const previousFloor = p.floor;
  moveActor(scene, p, dx * speed * dt, dz * speed * dt, 0.34);
  const floorKey = `${state.scene}:${p.floor}`;
  if (!onStairs(scene, p) && !state.visitedFloors.includes(floorKey)) {
    state.visitedFloors.push(floorKey);
    state.checkpointLabel = `${locationLabel(state)} · 楼梯平台`;
    state.checkpointRequest = true;
    state.message = `${p.floor}F · ${scene.floorNames[p.floor - 1]}。调查属于可选溯源，不影响一层主线。`;
  }
  if (previousFloor !== p.floor) state.restTime = 0;
  const moved = Math.hypot(p.x - before.x, p.z - before.z) > 0.001;
  if (moved) state.tutorial.moved = true;
  p.stamina = Math.max(0, Math.min(100, p.stamina + (running ? -21 : 15) * dt));
  updateEnemy(state, dt, running);
  const threatened = isThreatened(state);
  const resting = !!input.rest && !moved && !!activeLamp(state) && !threatened;
  const priorSan = p.san;
  updateSanity(state, dt, { threatened, dark: inDarkZone(scene, p) && !p.flashlight && !activeLamp(state), resting });
  if (resting) {
    state.restTime += dt;
    if (p.san > priorSan) state.tutorial.recovered = true;
  } else state.restTime = 0;
}

function puzzleComplete(state, id) {
  if (state.flags[id]) return result(true, '这处线索已经核实，不会重复发放奖励。');
  state.flags[id] = true;
  rewardClue(state, `puzzle-${id}`);
  if (id === 'archive') state.inventory.archive = true;
  if (id === 'pass') state.inventory.pass = true;
  if (id === 'name') state.inventory.name = true;
  if (id === 'circuit') { state.pendingEncounter = 'lab'; state.bellUntil = state.elapsed + 2.3; }
  if (id === 'seat') state.pendingEncounter = 'classroom';
  if (id === 'tutorial') { state.tutorial.puzzle = true; state.player.san = Math.min(state.player.san, 55); }
  if (['circuit', 'seat', 'pass', 'name', 'tutorial'].includes(id) || state.mode === 'easy') {
    state.checkpointLabel = `${getScene(state.scene).label} · 线索已核验`;
    state.checkpointRequest = true;
  }
  const messages = {
    archive: '档案柜打开。取得原册与检修钥匙：第17行是你，第41行没有旧压痕。前往实验楼。',
    circuit: '灯与旧铃恢复，本楼广播断开。铃槌：短、短、长；机械门闩抬起。远处传来翻页声……',
    seat: '第三排第一座。取得宿舍检索牌和柜钥匙。走廊开始点名，离开前先观察退路。',
    pass: '旧联拼合：林舟，17号，已于22:17签离。取得旧签离联。前往食堂取回姓名条。',
    name: '册外一碗倒扣。取回17号姓名条；原册与旧联已收回。可归还其余回声，也可先离开。',
    power: '校铃保留，照明保留，重复广播总路已断开。北门仍凭旧联与旧名核验。',
    tutorial: '你认出了真实压痕。现在SAN降至55用于演示，请去启用安全灯并定神，再喝一份温水。',
  };
  return result(true, messages[id], { save: true, close: true, bell: id === 'circuit' });
}

export function performAction(state, action, payload = {}) {
  if (state.status !== 'playing') return result(false, '当前不能操作。');
  if (action === 'drink') return drinkWater(state, isThreatened(state));
  if (action === 'light') { state.player.flashlight = !state.player.flashlight; state.tutorial.light = true; return result(true, state.player.flashlight ? '手电已开启。' : '手电已关闭。'); }
  if (action === 'switch') { toggleView(state); return result(true, state.view === '3d' ? '第一人称视角' : '2D俯视视角'); }
  if (isThreatened(state)) return result(false, '先利用遮挡脱离追踪，再操作物件。');
  const scene = getScene(state.scene);
  if (action === 'enter') return enterScene(state, payload.target);
  if (action === 'exit') {
    if (state.mode === 'tutorial') return result(false, '完成演练后，使用左上方“完成教程”返回模式选择。');
    if (state.player.floor !== 1 || state.player.y > .3) return result(false, '出口位于1F，请沿楼梯下楼。');
    return enterScene(state, 'campus');
  }
  if (action === 'inspect') {
    const note = scene.objects.find(o => o.type === 'note' && o.id === payload.id);
    if (!note || Math.abs(note.y - state.player.y) > .5) return result(false, '请在这份记录所在的楼层核验。');
    const gained = rewardClue(state, payload.id, note.floor === 1);
    state.tutorial.inspected = true;
    if (state.mode === 'tutorial') state.checkpointRequest = true;
    return result(true, gained ? (note.floor === 1 ? '已核验旧痕，记录进入手记。SAN恢复。' : '楼层记录已收入手记。核对本层实物后，去5F完成整条溯源可获得一次SAN奖励。') : '已记录这条线索。', { save: true });
  }
  if (action === 'water') {
    const object = scene.objects.find(o => o.type === 'water' && o.id === payload.id);
    if (!object || Math.abs(object.y - state.player.y) > .5 || state.collected.includes(object.id)) return result(false, '这里没有可拾取的温水，或已经取走。');
    state.collected.push(object.id); state.inventory.water += MODES[state.mode].waterCount;
    return result(true, `获得温水 ×${MODES[state.mode].waterCount}。需要时按H饮用。`, { save: true });
  }
  if (action === 'lamp') {
    const object = scene.objects.find(o => o.type === 'lamp' && o.id === payload.id);
    if (!object || Math.abs(object.y - state.player.y) > .5) return result(false, '没有找到本层的灯座。');
    if (payload.port !== 'light') return result(false, '这接到了广播支路。按照插头刻字，连接“照明检修”。');
    if (!state.activatedLamps.includes(object.id)) state.activatedLamps.push(object.id);
    state.checkpointLabel = `${locationLabel(state)} · 安全灯`;
    state.checkpointRequest = true;
    return result(true, '安全灯亮了。关闭面板后，在灯下停步并按住R或“定神”恢复SAN。', { save: true, close: true });
  }
  if (action === 'evidence') {
    const object = scene.objects.find(o => o.type === 'evidence' && o.id === payload.id);
    if (!object || Math.abs(object.y - state.player.y) > .5) return result(false, '请到对应楼层检查实物。');
    const fresh = rewardClue(state, object.id, false);
    const encounter = fresh && object.floor === 4 && !state.enemy.active;
    if (encounter) state.pendingEncounter = `${state.scene}-upper`;
    return result(true, fresh ? `实物旧刻已记录。纸面与实物要同时核对。${encounter ? '四层走廊传来翻页声；关闭面板后利用遮挡脱离追踪。' : '收齐2—4F证据后，到5F复核台完成溯源。'}` : '实物证据已在手记中，不会重复触发异常。', { save: true, close: true });
  }
  if (action === 'investigation') {
    const investigation = INVESTIGATIONS[payload.building];
    if (!investigation || state.scene !== payload.building || state.player.floor !== 5 || Math.abs(state.player.y - 14.4) > .3) return result(false, '请到本楼5F复核台完成调查。');
    if (state.flags[investigation.id]) return result(true, '本楼溯源已完成，SAN奖励只结算一次。');
    const required = [2, 3, 4].flatMap(f => [`${state.scene}-f${f}-note`, `${state.scene}-f${f}-evidence`]);
    if (!required.every(id => state.notes.includes(id))) return result(false, '尚未收齐2—4F的纸背与实物证据。每层两项，手记可查缺漏。');
    if (JSON.stringify(payload.answer) !== JSON.stringify(investigation.answer)) return result(false, '这与旧痕不一致。查看证据与提示后可重新核验，不消耗物品。');
    state.flags[investigation.id] = true;
    rewardClue(state, `investigation-${state.scene}`);
    state.checkpointLabel = `${locationLabel(state)} · 溯源完成`; state.checkpointRequest = true;
    return result(true, '本楼溯源完成，SAN恢复。它能重写墨迹，却不能替你改变旧痕。支线不增加结局门槛。', { save: true, close: true });
  }
  if (action === 'solve') {
    if (state.player.floor !== 1 || state.player.y > .3) return result(false, '原主线谜题位于1F，请先下楼。');
    const expected = { archive: 'admin', circuit: 'lab', seat: 'classroom', pass: 'dorm', name: 'canteen', power: 'admin', tutorial: 'tutorial' };
    if (expected[payload.id] !== state.scene) return result(false, '请在对应物件前操作。');
    if (payload.id === 'power' && !state.flags.name) return result(false, '总控需要原册与姓名条核对；先完成五栋楼的调查。');
    const a = payload.answer;
    let correct = false;
    switch (payload.id) {
      case 'archive': correct = JSON.stringify(a) === JSON.stringify(BUILDINGS.map(b => b.id)); break;
      case 'circuit': case 'power': correct = JSON.stringify(a) === '[true,true,false]'; break;
      case 'seat': case 'tutorial': correct = a === 17; break;
      case 'pass': correct = JSON.stringify(a) === '["a","b","c"]'; break;
      case 'name': correct = a?.archive === true && a?.pass === true && a?.bowl === 41 && state.inventory.archive && state.inventory.pass; break;
    }
    if (!correct) return result(false, '旧痕与这次操作不一致。没有消耗物品，可以查看提示后重新排列。');
    return puzzleComplete(state, payload.id);
  }
  if (action === 'echoes') {
    if (state.scene !== 'canteen' || state.player.floor !== 1 || !state.flags.name) return result(false, '先完成归名，拿回自己的姓名条。');
    if (JSON.stringify(payload.answer) !== '[1,8,32]') return result(false, '按声条背面的旧册号归位，不要只看正面的姓名。');
    state.flags.echoes = true;
    return result(true, '三十九道旧应答归回原册。还要在行政楼关闭重复播送，它们才能散场。', { close: true, save: true });
  }
  if (action === 'gate') {
    if (state.scene !== 'campus' || state.player.y > .3) return result(false, '请回到北门核验。');
    if (!state.flags.name || !state.flags.pass) return result(false, '旧联证离校，旧名验本人。你仍需找到旧签离联和自己的姓名条。');
    if (!['leave', 'sign'].includes(payload.choice)) return result(false, '请选择如何离校。');
    state.ending = payload.choice === 'sign' ? 'bad' : state.flags.echoes && state.flags.power ? 'true' : 'normal';
    state.status = 'ending';
    return result(true, '最后一遍点名结束了。', { close: true, ending: true });
  }
  if (action === 'voice') {
    if (state.scene !== 'dorm') return result(false, '这里没有那扇门。');
    if (payload.choice === 'open' && !state.events.includes('voice')) {
      state.pendingEncounter = 'voice'; state.checkpointRequest = true;
      return result(true, '门开了。门外没有第二个你，只有展开的点名册。', { close: true, save: true });
    }
    return result(true, payload.choice === 'verify' ? '“纸背写着什么？”门外沉默了。它只能重复你的名字。' : '你没有再回答。门把慢慢松开。');
  }
  if (action === 'bell') {
    if (state.flags.circuit) state.bellUntil = state.elapsed + 2.3;
    return result(true, state.flags.circuit ? '实体铃槌：短、短、长。关闭面板观察机械动作；门闩保持抬起。' : '铃槌没有动。先恢复机械校铃的线路。', { bell: !!state.flags.circuit });
  }
  if (action === 'training') {
    if (state.mode !== 'tutorial') return result(false, '不在训练区域。');
    if (!state.tutorial.puzzle || !state.tutorial.recovered || !state.tutorial.water) return result(false, '先完成练习台、灯下定神和喝温水。');
    state.pendingEncounter = 'training'; state.checkpointRequest = true;
    return result(true, '绕过中间隔墙，关灯后安静等待搜索结束。被找到也可重试。', { close: true, save: true });
  }
  return result(false, '当前物件没有这个操作。');
}

export function interactionTarget(state) {
  const object = nearbyObject(state);
  if (object?.type === 'water' && state.collected.includes(object.id)) return null;
  return object;
}

export function tutorialComplete(state) {
  return Object.values(state.tutorial).every(Boolean);
}
