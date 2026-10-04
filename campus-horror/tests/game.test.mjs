import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, updateGame, toggleView, performAction, enterScene, canSave, triggerEncounter } from '../site/game.js';
import { SCENES, BUILDINGS, canOccupy, hasLineOfSight, nextPathPoint } from '../site/world.js';
import { changeSanity, updateSanity, rewardClue, drinkWater, sanityEffects } from '../site/sanity.js';
import { SaveStore, validateState } from '../site/storage.js';

const storage = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }; };
function inScene(s, id) { s.enemy.active = false; s.pendingEncounter = null; enterScene(s, id); }
function solve(s, id, answer) { const r = performAction(s, 'solve', { id, answer }); assert.equal(r.ok, true, r.message); }
function campaign(mode) {
  const s = createGame(mode);
  inScene(s, 'admin'); solve(s, 'archive', BUILDINGS.map(b => b.id));
  inScene(s, 'lab'); solve(s, 'circuit', [true, true, false]);
  inScene(s, 'classroom'); solve(s, 'seat', 17);
  inScene(s, 'dorm'); solve(s, 'pass', ['a', 'b', 'c']);
  inScene(s, 'canteen'); solve(s, 'name', { archive: true, pass: true, bowl: 41 });
  return s;
}

test('SAN boundaries, loss multiplier, tutorial protection and audio range', () => {
  const easy = createGame('easy'), hard = createGame('hard'), tutorial = createGame('tutorial');
  updateSanity(easy, 10, { threatened: true }); updateSanity(hard, 10, { threatened: true });
  assert.equal(easy.player.san, 83); assert.equal(hard.player.san, 74.5);
  changeSanity(easy, -1000); assert.equal(easy.status, 'failed');
  changeSanity(tutorial, -1000); assert.equal(tutorial.player.san, 15); assert.equal(tutorial.status, 'playing');
  assert.ok(sanityEffects(10).darkness > sanityEffects(90).darkness);
});

test('all three SAN recovery methods are bounded and rewards cannot repeat', () => {
  const s = createGame('hard'); s.player.san = 30;
  updateSanity(s, 30, { resting: true }); assert.equal(s.player.san, 60);
  assert.equal(rewardClue(s, 'record'), true); assert.equal(s.player.san, 66);
  assert.equal(rewardClue(s, 'record'), false); assert.equal(s.player.san, 66);
  s.inventory.water = 1; assert.equal(drinkWater(s, true).ok, false); assert.equal(s.inventory.water, 1);
  assert.equal(drinkWater(s, false).ok, true); assert.equal(s.player.san, 86); assert.equal(s.inventory.water, 0);
  updateSanity(s, 20, { resting: true }); assert.equal(s.player.san, 86);
});

test('view switching preserves position, stamina, SAN and enemy while chasing', () => {
  const s = createGame(); triggerEncounter(s, 'test');
  const p = structuredClone(s.player), e = structuredClone(s.enemy);
  for (let i = 0; i < 101; i++) toggleView(s);
  assert.deepEqual(s.player, p); assert.deepEqual(s.enemy, e); assert.equal(s.view, '2d');
  assert.equal(canSave(s), false);
});

test('all reachable objects and spawns have valid collision-free routes', () => {
  for (const scene of Object.values(SCENES)) {
    assert.ok(canOccupy(scene, scene.spawn.x, scene.spawn.z), scene.id + ' spawn');
    for (const o of scene.objects) {
      assert.ok(canOccupy(scene, o.x, o.z), `${scene.id}:${o.id}`);
      let pos = { ...scene.spawn };
      for (let i = 0; i < 600 && Math.hypot(o.x - pos.x, o.z - pos.z) > 1.1; i++) {
        const p = nextPathPoint(scene, pos, o), dx = p.x - pos.x, dz = p.z - pos.z, len = Math.hypot(dx, dz);
        if (len < .01) break;
        const step = Math.min(len, .5); pos.x += dx / len * step; pos.z += dz / len * step;
      }
      assert.ok(Math.hypot(o.x - pos.x, o.z - pos.z) < 1.2, `unreachable ${scene.id}:${o.id}`);
    }
  }
});

test('collision and sight blocking work in both view inputs', () => {
  const s = createGame('tutorial');
  assert.equal(hasLineOfSight(SCENES.tutorial, 10, 10, 17, 10), false);
  for (const view of ['2d', '3d']) {
    s.view = view; Object.assign(s.player, { x: 12, z: 10, yaw: 0 });
    for (let i = 0; i < 30; i++) updateGame(s, { x: 1 }, .05);
    assert.ok(s.player.x < 12.3);
  }
});

test('puzzle errors do not consume key items or lock endings', () => {
  const s = createGame(); inScene(s, 'admin');
  const bad = performAction(s, 'solve', { id: 'archive', answer: [] }); assert.equal(bad.ok, false);
  assert.deepEqual(s.inventory, { water: 0, archive: false, pass: false, name: false });
  assert.equal(enterScene(s, 'canteen').ok, false);
  assert.equal(performAction(s, 'gate', { choice: 'leave' }).ok, false);
});

for (const mode of ['easy', 'hard']) {
  for (const echoes of [false, true]) for (const power of [false, true]) for (const sign of [false, true]) {
    test(`${mode} campaign endings echoes=${echoes} power=${power} sign=${sign}`, () => {
      const s = campaign(mode);
      if (echoes) assert.equal(performAction(s, 'echoes', { answer: [1, 8, 32] }).ok, true);
      if (power) { inScene(s, 'admin'); solve(s, 'power', [true, true, false]); }
      inScene(s, 'campus'); s.pendingEncounter = null;
      assert.equal(performAction(s, 'gate', { choice: sign ? 'sign' : 'leave' }).ok, true);
      assert.equal(s.ending, sign ? 'bad' : echoes && power ? 'true' : 'normal');
      assert.equal(s.inventory.archive, true); assert.equal(s.inventory.pass, true); assert.equal(s.inventory.name, true);
    });
  }
}

test('full snapshot rewind avoids duplicate supplies and SAN rewards', () => {
  const data = storage(), store = new SaveStore(data, '/repo/'), s = createGame();
  assert.equal(store.save(s, true).ok, true);
  inScene(s, 'admin'); performAction(s, 'water', { id: 'admin-water' }); s.player.san = 50;
  performAction(s, 'drink'); rewardClue(s, 'admin-note');
  assert.equal(store.save(s).ok, true);
  const auto = store.restore('easy').state, cp = store.restore('easy', true).state;
  assert.equal(auto.inventory.water, 1); assert.equal(auto.player.san, 90); assert.ok(auto.collected.includes('admin-water'));
  assert.equal(cp.inventory.water, 0); assert.deepEqual(cp.collected, []); assert.equal(cp.scene, 'campus');
  assert.equal(performAction(auto, 'water', { id: 'admin-water' }).ok, false);
  const before = data.getItem(store.key('easy')); triggerEncounter(auto, 'chase');
  assert.equal(store.save(auto).skipped, true); assert.equal(data.getItem(store.key('easy')), before);
});

test('mode and deployment path isolation, invalid saves and storage failure', () => {
  const data = storage(), a = new SaveStore(data, '/one/'), b = new SaveStore(data, '/two/');
  a.save(createGame('hard'), true); a.save(createGame('tutorial'), true);
  assert.equal(a.read('easy').data, null); assert.equal(b.read('hard').data, null);
  data.setItem(a.key('easy'), '{bad'); assert.equal(a.read('easy').ok, false);
  const raw = data.getItem(a.key('easy')); assert.equal(a.save(createGame()).ok, false); assert.equal(data.getItem(a.key('easy')), raw);
  assert.equal(a.save(createGame(), true, true).ok, true);
  const s = createGame(); s.player.san = NaN; assert.equal(validateState(s, 'easy'), false);
  const denied = new SaveStore({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  assert.equal(denied.read('easy').ok, false); assert.equal(denied.save(createGame(), true, true).ok, false);
});

test('low SAN pending encounter cannot overwrite a safe checkpoint', () => {
  const store = new SaveStore(storage()), s = createGame('hard');
  store.save(s, true); s.player.san = 8; s.pendingEncounter = 'voice';
  assert.equal(store.save(s, true).skipped, true);
  assert.equal(store.restore('hard', true).state.player.san, 100);
});

test('tutorial recovery can finish when healing takes less than 1.5 seconds', () => {
  const s = createGame('tutorial'); Object.assign(s.player, { x: 6, z: 22, san: 99 });
  s.activatedLamps.push('tutorial-lamp');
  for (let i = 0; i < 10; i++) updateGame(s, { rest: true }, .05);
  assert.equal(s.player.san, 100); assert.equal(s.tutorial.recovered, true);
  s.inventory.water = 1; assert.equal(drinkWater(s, false).ok, true);
  assert.equal(s.tutorial.water, true); assert.equal(s.inventory.water, 1);
});

test('returning from buildings does not spawn on a frozen enemy', () => {
  const s = createGame(); s.scene = 'admin'; s.enemies.campus = { ...s.enemy, active: true, x: 20, z: 22 };
  assert.equal(enterScene(s, 'campus').ok, true);
  assert.ok(Math.hypot(s.player.x - 20, s.player.z - 22) > 10);
  updateGame(s, {}, .05); assert.equal(s.status, 'playing');
});

test('checkpoint before encounter can retry the puzzle without saving imminent danger', () => {
  const s = createGame(), store = new SaveStore(storage());
  inScene(s, 'admin'); solve(s, 'archive', BUILDINGS.map(b => b.id)); inScene(s, 'lab');
  assert.equal(store.save(s, true).ok, true);
  solve(s, 'circuit', [true, true, false]); assert.equal(store.save(s, true).skipped, true);
  const loaded = store.restore('easy', true).state;
  assert.equal(loaded.flags.circuit, undefined); assert.equal(loaded.pendingEncounter, null);
  solve(loaded, 'circuit', [true, true, false]); toggleView(loaded); updateGame(loaded, {}, .016);
  assert.equal(loaded.enemy.active, true); assert.ok(loaded.events.includes('lab'));
});

function walkTo(state, x, z) {
  state.view = '2d';
  for (let i = 0; i < 3000; i++) {
    assert.equal(state.status, 'playing', `${state.scene}: ${state.failure}`);
    if (Math.hypot(x - state.player.x, z - state.player.z) < .35) return;
    const target = nextPathPoint(SCENES[state.scene], state.player, { x, z });
    const dx = target.x - state.player.x, dz = target.z - state.player.z, distance = Math.hypot(dx, dz);
    assert.ok(distance > .001, `route stuck in ${state.scene}`);
    updateGame(state, { x: dx / distance, z: dz / distance, sprint: ['alert', 'chase', 'search'].includes(state.enemy.mode) && state.enemy.active }, .05);
  }
  assert.fail(`route timed out in ${state.scene}`);
}

for (const mode of ['easy', 'hard']) test(`${mode} continuous playable route through all buildings and real chase states`, () => {
  const s = createGame(mode);
  const answers = [['archive', BUILDINGS.map(b => b.id)], ['circuit', [true, true, false]], ['seat', 17], ['pass', ['a', 'b', 'c']], ['name', { archive: true, pass: true, bowl: 41 }]];
  for (const [i, building] of BUILDINGS.entries()) {
    s.player.flashlight = true;
    walkTo(s, 22, building.z); assert.equal(performAction(s, 'enter', { target: building.id }).ok, true);
    walkTo(s, 6, 22); performAction(s, 'lamp', { id: building.id + '-lamp', port: 'light' });
    for (let j = 0; j < 400; j++) updateGame(s, { rest: true }, .05);
    walkTo(s, 9, 23); performAction(s, 'water', { id: building.id + '-water' });
    walkTo(s, 6, 6); performAction(s, 'inspect', { id: building.id + '-note' });
    walkTo(s, 22, 6); solve(s, ...answers[i]);
    if (['lab', 'classroom'].includes(building.id)) {
      s.player.flashlight = false;
      for (const point of [[16, 6], [16, 17], [8, 17], [8, 24]]) walkTo(s, ...point);
      for (let j = 0; j < 240; j++) updateGame(s, {}, .05);
      assert.equal(s.enemy.mode, 'patrol');
    }
    if (building.id === 'canteen') { walkTo(s, 19, 7); assert.equal(performAction(s, 'echoes', { answer: [1, 8, 32] }).ok, true); }
    walkTo(s, 14, 26); assert.equal(performAction(s, 'exit').ok, true);
  }
  s.player.flashlight = false;
  for (const point of [[4, 96], [4, 22], [20, 22]]) walkTo(s, ...point);
  assert.equal(performAction(s, 'enter', { target: 'admin' }).ok, true);
  walkTo(s, 19, 19); solve(s, 'power', [true, true, false]);
  walkTo(s, 14, 26); assert.equal(performAction(s, 'exit').ok, true);
  walkTo(s, 19, 4); assert.equal(performAction(s, 'gate', { choice: 'leave' }).ok, true);
  assert.equal(s.ending, 'true');
});

test('complete tutorial movement, evidence, recovery, evasion and checkpoint rehearsal', () => {
  const s = createGame('tutorial');
  walkTo(s, 6, 6); toggleView(s); performAction(s, 'light');
  assert.equal(performAction(s, 'inspect', { id: 'tutorial-note' }).ok, true);
  walkTo(s, 22, 6); solve(s, 'tutorial', 17);
  walkTo(s, 6, 22); performAction(s, 'lamp', { id: 'tutorial-lamp', port: 'light' });
  for (let i = 0; i < 130; i++) updateGame(s, { rest: true }, .05);
  walkTo(s, 9, 23); performAction(s, 'water', { id: 'tutorial-water' }); performAction(s, 'drink');
  walkTo(s, 20, 19); assert.equal(performAction(s, 'training').ok, true);
  s.player.flashlight = false;
  for (const point of [[16, 18], [8, 18], [6, 24]]) walkTo(s, ...point);
  for (let i = 0; i < 220; i++) updateGame(s, {}, .05);
  assert.equal(s.tutorial.escaped, true);
  const store = new SaveStore(storage()); assert.equal(store.save(s, true).ok, true);
  const restored = store.restore('tutorial', true).state;
  assert.equal(Object.values(restored.tutorial).every(Boolean), true);
});
