import { MODES, SAVE_VERSION } from './modes.js';
import { getScene, canOccupy } from './world.js';
import { canSave } from './game.js';

const number = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const strings = value => Array.isArray(value) && value.length < 500 && value.every(s => typeof s === 'string' && s.length < 120);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const bools = value => record(value) && Object.entries(value).length < 100 && Object.values(value).every(v => typeof v === 'boolean');

export function validateState(s, mode) {
  if (!record(s) || s.mode !== mode || !MODES[mode] || !getScene(s.scene) || !['2d', '3d'].includes(s.view) || s.status !== 'playing') return false;
  const p = s.player, e = s.enemy;
  if (!record(p) || !number(p.x, 0, 120) || !number(p.z, 0, 120) || !number(p.yaw, -1e9, 1e9) || !number(p.pitch, -1.2, 1.2) || !number(p.san, 0.01, 100) || !number(p.stamina, 0, 100) || typeof p.flashlight !== 'boolean') return false;
  if (!canOccupy(getScene(s.scene), p.x, p.z, 0.3)) return false;
  if (!record(e) || typeof e.active !== 'boolean' || !['patrol', 'alert', 'chase', 'search'].includes(e.mode) || !number(e.x, 0, 120) || !number(e.z, 0, 120)) return false;
  if (!['timer', 'lost', 'patrol', 'pathTimer', 'yaw'].every(k => number(e[k], -1e9, 1e9))) return false;
  const validEnemy = en => record(en) && typeof en.active === 'boolean' && ['patrol', 'alert', 'chase', 'search'].includes(en.mode) && ['x', 'z', 'timer', 'lost', 'patrol', 'pathTimer', 'yaw'].every(k => number(en[k], -1e9, 1e9)) && [en.target, en.waypoint].every(p => p === null || (record(p) && number(p.x, 0, 120) && number(p.z, 0, 120)));
  if (!validEnemy(e) || !record(s.enemies) || !Object.entries(s.enemies).every(([id, en]) => getScene(id) && validEnemy(en))) return false;
  if (!bools(s.flags) || !bools(s.tutorial) || !record(s.inventory) || !Number.isInteger(s.inventory.water) || !number(s.inventory.water, 0, 100)) return false;
  if (!['moved', 'switched', 'light', 'inspected', 'puzzle', 'recovered', 'water', 'escaped', 'retried'].every(k => typeof s.tutorial[k] === 'boolean')) return false;
  if (!number(s.bellUntil, 0, 1e10)) return false;
  if (!['archive', 'pass', 'name'].every(k => typeof s.inventory[k] === 'boolean' && s.inventory[k] === Boolean(s.flags[k]))) return false;
  if (!['notes', 'collected', 'activatedLamps', 'visited', 'events'].every(k => strings(s[k]))) return false;
  if (!number(s.elapsed, 0, 1e10) || !number(s.restTime, 0, 1e10) || typeof s.checkpointLabel !== 'string' || s.checkpointLabel.length > 120) return false;
  if (s.pendingEncounter !== null && !['lab', 'classroom', 'return', 'voice', 'training'].includes(s.pendingEncounter)) return false;
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
      if (data.version !== SAVE_VERSION) return { ok: false, error: '存档版本不兼容。可明确选择新游戏，原记录不会自动覆盖。' };
      if (data.mode !== mode || !Number.isFinite(data.savedAt) || !validateState(data.auto, mode) || !validateState(data.checkpoint, mode)) return { ok: false, error: '存档损坏，无法安全恢复。请选择重新开始，不会静默清空。' };
      return { ok: true, data };
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
    return { ok: true, state, savedAt: saved.data.savedAt };
  }
}
