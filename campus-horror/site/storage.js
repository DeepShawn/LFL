import { MODES, SAVE_VERSION } from './modes.js';
import { getScene, canOccupy, heightAt, getFloor } from './world.js';
import { canSave } from './game.js';

const number = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const strings = value => Array.isArray(value) && value.length < 500 && value.every(s => typeof s === 'string' && s.length < 120);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const bools = value => record(value) && Object.entries(value).length < 100 && Object.values(value).every(v => typeof v === 'boolean');

export function validateState(s, mode) {
  if (!record(s) || s.mode !== mode || !MODES[mode] || !getScene(s.scene) || !['2d', '3d'].includes(s.view) || s.status !== 'playing') return false;
  const p = s.player, e = s.enemy;
  if (!record(p) || !number(p.x, 0, 120) || !number(p.z, 0, 120) || !number(p.yaw, -1e9, 1e9) || !number(p.pitch, -1.2, 1.2) || !number(p.san, 0.01, 100) || !number(p.stamina, 0, 100) || typeof p.flashlight !== 'boolean') return false;
  const scene = getScene(s.scene);
  if (!number(p.y, 0, (scene.floors - 1) * scene.floorHeight + .01) || p.floor !== getFloor(scene, p.y)) return false;
  const surface = heightAt(scene, p.x, p.z, p.y);
  if (surface === null || Math.abs(surface - p.y) > .04 || !canOccupy(scene, p.x, p.z, 0.3, p.y)) return false;
  if (!record(e) || typeof e.active !== 'boolean' || !['patrol', 'alert', 'chase', 'search'].includes(e.mode) || !number(e.x, 0, 120) || !number(e.z, 0, 120)) return false;
  if (!['timer', 'lost', 'patrol', 'pathTimer', 'yaw'].every(k => number(e[k], -1e9, 1e9))) return false;
  const validEnemy = en => record(en) && number(en.y, 0, 15) && Number.isInteger(en.floor) && number(en.floor, 1, 5) && typeof en.active === 'boolean' && ['patrol', 'alert', 'chase', 'search'].includes(en.mode) && ['x', 'z', 'timer', 'lost', 'patrol', 'pathTimer', 'yaw'].every(k => number(en[k], -1e9, 1e9)) && [en.target, en.waypoint].every(p => p === null || (record(p) && number(p.x, 0, 120) && number(p.z, 0, 120) && number(p.y, 0, 15)));
  if (!validEnemy(e) || !record(s.enemies) || !Object.entries(s.enemies).every(([id, en]) => getScene(id) && validEnemy(en))) return false;
  if (!bools(s.flags) || !bools(s.tutorial) || !record(s.inventory) || !Number.isInteger(s.inventory.water) || !number(s.inventory.water, 0, 100)) return false;
  if (!['moved', 'switched', 'light', 'inspected', 'puzzle', 'recovered', 'water', 'escaped', 'retried'].every(k => typeof s.tutorial[k] === 'boolean')) return false;
  if (!number(s.bellUntil, 0, 1e10)) return false;
  if (!['archive', 'pass', 'name'].every(k => typeof s.inventory[k] === 'boolean' && s.inventory[k] === Boolean(s.flags[k]))) return false;
  if (!['notes', 'collected', 'activatedLamps', 'visited', 'visitedFloors', 'events'].every(k => strings(s[k]))) return false;
  if (!number(s.elapsed, 0, 1e10) || !number(s.restTime, 0, 1e10) || typeof s.checkpointLabel !== 'string' || s.checkpointLabel.length > 120) return false;
  if (s.pendingEncounter !== null && !['lab', 'classroom', 'return', 'voice', 'training', 'admin-upper', 'lab-upper', 'classroom-upper'].includes(s.pendingEncounter)) return false;
  if ((mode === 'tutorial') !== (s.scene === 'tutorial')) return false;
  return true;
}

export function snapshot(state) {
  const copy = structuredClone(state);
  copy.checkpointRequest = false;
  copy.message = '';
  copy.restTime = 0;
  return copy;
}

function migrateV1(state) {
  const s = structuredClone(state), scene = getScene(s.scene);
  if (!scene || !record(s.player) || !record(s.enemy) || !record(s.enemies)) throw Error('旧存档结构不完整');
  const ground = (body, area) => {
    if (!number(body.x, 0, 120) || !number(body.z, 0, 120)) throw Error('旧坐标无效');
    body.y = 0; body.floor = 1;
    if (!canOccupy(area, body.x, body.z, .4, 0) || heightAt(area, body.x, body.z, 0) === null) {
      const origin = { x: body.x, z: body.z }; let found = false;
      for (let radius = .5; radius <= 5 && !found; radius += .5) for (let step = 0; step < 16; step++) {
        const x = origin.x + Math.cos(step * Math.PI / 8) * radius, z = origin.z + Math.sin(step * Math.PI / 8) * radius;
        if (canOccupy(area, x, z, .4, 0) && heightAt(area, x, z, 0) === 0) { body.x = x; body.z = z; found = true; break; }
      }
      if (!found) throw Error('旧坐标无法迁移');
    }
    for (const key of ['target', 'waypoint']) if (body[key]) body[key].y = 0;
  };
  ground(s.player, scene); ground(s.enemy, scene);
  for (const [id, enemy] of Object.entries(s.enemies)) { if (!getScene(id)) throw Error('旧场景不存在'); ground(enemy, getScene(id)); }
  s.visitedFloors = s.visited.map(id => `${id}:1`);
  return s;
}

export class SaveStore {
  constructor(storage, scope = '/') {
    this.storage = storage;
    this.prefix = `campus-night:${scope}:`;
  }
  key(mode) { return `${this.prefix}${mode}`; }
  read(mode) {
    try {
      const raw = this.storage.getItem(this.key(mode));
      if (!raw) return { ok: true, data: null };
      if (raw.length > 1000000) return { ok: false, error: '存档体积异常，未覆盖原有数据。' };
      const data = JSON.parse(raw);
      let legacyRaw = null;
      if (data.version === 1) {
        legacyRaw = raw;
        data.auto = migrateV1(data.auto); data.checkpoint = migrateV1(data.checkpoint); data.version = SAVE_VERSION;
      }
      if (data.version !== SAVE_VERSION) return { ok: false, error: '存档版本不兼容。可明确选择新游戏，原记录不会自动覆盖。' };
      if (data.mode !== mode || !Number.isFinite(data.savedAt) || !validateState(data.auto, mode) || !validateState(data.checkpoint, mode)) return { ok: false, error: '存档损坏，无法安全恢复。请选择重新开始，不会静默清空。' };
      return { ok: true, data, legacyRaw };
    } catch {
      return { ok: false, error: '无法读取本地存档：浏览器可能限制了存储，或记录已损坏。' };
    }
  }
  save(state, checkpoint = false, replace = false) {
    if (!canSave(state)) return { ok: false, skipped: true, error: '当前不安全，保留上一次安全存档。' };
    const current = replace ? { ok: true, data: null } : this.read(state.mode);
    if (!current.ok) return current;
    const auto = snapshot(state);
    const data = { version: SAVE_VERSION, mode: state.mode, savedAt: Date.now(), auto, checkpoint: checkpoint || !current.data ? snapshot(state) : current.data.checkpoint };
    if (!validateState(data.auto, state.mode) || !validateState(data.checkpoint, state.mode)) return { ok: false, error: '当前进度未通过完整性检查，已保留上一次存档。' };
    try {
      if (current.legacyRaw && !this.storage.getItem(`${this.key(state.mode)}:v1-backup`)) this.storage.setItem(`${this.key(state.mode)}:v1-backup`, current.legacyRaw);
      this.storage.setItem(this.key(state.mode), JSON.stringify(data));
      return { ok: true, data };
    } catch {
      return { ok: false, error: '自动保存失败：本地存储不可用或空间不足。本次进度仅留在当前页面。' };
    }
  }
  restore(mode, checkpoint = false) {
    const saved = this.read(mode);
    if (!saved.ok || !saved.data) return { ok: false, error: saved.error || '这个模式还没有存档。' };
    const state = structuredClone(checkpoint ? saved.data.checkpoint : saved.data.auto);
    state.checkpointRequest = false;
    if (checkpoint && mode === 'tutorial') state.tutorial.retried = true;
    return { ok: true, state, savedAt: saved.data.savedAt, migrated: !!saved.legacyRaw };
  }
}
