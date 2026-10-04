import { MODES } from './modes.js';

export function sanityEffects(san) {
  const stress = 1 - Math.max(0, Math.min(100, san)) / 100;
  return { stress, darkness: 0.07 + stress * 0.42, noise: stress * stress, range: 16 - stress * 5, label: san >= 70 ? '清醒' : san >= 40 ? '不安' : san > 0 ? '失衡' : '失守' };
}

export function changeSanity(state, amount) {
  state.player.san = Math.max(state.mode === 'tutorial' ? 15 : 0, Math.min(100, state.player.san + amount));
  if (state.player.san <= 0) { state.status = 'failed'; state.failure = '杂音盖过了你的呼吸。SAN已耗尽。'; }
}

export function updateSanity(state, dt, { threatened = false, dark = false, resting = false } = {}) {
  const mode = MODES[state.mode];
  if (resting && !threatened) {
    if (state.player.san < mode.lampCap) state.player.san = Math.min(mode.lampCap, state.player.san + mode.lampRate * dt);
    return;
  }
  const drain = threatened ? 1.7 : dark ? 0.35 : 0;
  changeSanity(state, -drain * mode.drain * dt);
}

export function rewardClue(state, id) {
  if (state.notes.includes(id)) return false;
  state.notes.push(id);
  changeSanity(state, MODES[state.mode].clueGain);
  return true;
}

export function drinkWater(state, threatened) {
  if (threatened) return { ok: false, message: '先脱离追逐，再停下来喝水。' };
  if (state.inventory.water < 1) return { ok: false, message: '没有温水了。寻找已启用的安全灯，按住“定神”恢复SAN。' };
  if (state.player.san >= 100) {
    if (state.mode === 'tutorial') { state.tutorial.water = true; return { ok: true, message: '饮水操作已学会。SAN已满，这次不消耗温水；受惊后再饮用可恢复SAN。', save: true }; }
    return { ok: false, message: 'SAN已满，无需消耗温水。' };
  }
  state.inventory.water--;
  changeSanity(state, MODES[state.mode].waterGain);
  state.tutorial.water = true;
  return { ok: true, message: `温水让呼吸平稳下来。SAN +${MODES[state.mode].waterGain}。`, save: true };
}
