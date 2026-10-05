import { createGame, updateGame, performAction, interactionTarget, isThreatened, canSave, activeLamp, tutorialComplete } from './game.js';
import { getScene, locationLabel } from './world.js';
import { DEFAULT_SETTINGS, MODES } from './modes.js';
import { sanityEffects } from './sanity.js';
import { SaveStore, snapshot } from './storage.js';
import { Interactions } from './interactions.js';
import { INTRO, ENDINGS, objective } from './story.js';
import { Renderer2D } from './renderer-2d.js';
import { GameAudio } from './audio.js';

const $ = id => document.getElementById(id);
const system = $('system-dialog'), paper = $('interaction-dialog');
const audio = new GameAudio();
const r2 = new Renderer2D($('view-2d'));
const minimap = new Renderer2D($('minimap-canvas'), { mini: true });
let minimapCollapsed = matchMedia('(max-height: 680px)').matches;
let minimapDrawAt = 0, renderFault = false;
let r3 = null, webglError = null, state = null, lastFrame = 0, lastSave = 0, paused = true, modalType = '';
let memoryCheckpoint = null, messageUntil = 0, toastTimer, pendingBell = false;
let settings = { ...DEFAULT_SETTINGS, reducedEffects: matchMedia('(prefers-reduced-motion: reduce)').matches };
const scope = new URL('.', location.href).pathname;
let storage;
try { storage = localStorage; } catch { storage = { getItem() { throw Error('存储不可用'); }, setItem() { throw Error('存储不可用'); } }; }
const store = new SaveStore(storage, scope);
try {
  const saved = JSON.parse(storage.getItem(`campus-settings:${scope}`) || 'null');
  if (saved) {
    for (const k of ['muted', 'reducedEffects']) if (typeof saved[k] === 'boolean') settings[k] = saved[k];
    if (typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1) settings.volume = saved.volume;
    if (['low', 'standard'].includes(saved.quality)) settings.quality = saved.quality;
  }
} catch {}
const keys = new Set();
const pointer = { x: 0, z: 0, turn: 0, pitch: 0, sprint: false, rest: false };

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, fn, className) { const b = el('button', text, className); b.type = 'button'; b.addEventListener('click', fn); return b; }
function toast(text) {
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5200);
}
function clearInput() { keys.clear(); Object.assign(pointer, { x: 0, z: 0, turn: 0, pitch: 0, sprint: false, rest: false }); $('joystick-knob').style.transform = ''; }
function pauseWorld() { paused = true; clearInput(); audio.pause(); if (document.pointerLockElement) document.exitPointerLock(); }
function resumeWorld() {
  if (!state || state.status !== 'playing' || system.open || paper.open || document.hidden) return;
  paused = false; lastFrame = performance.now(); audio.resume();
}
function showSystem(title, lines = [], actions = []) {
  pauseWorld();
  const content = $('system-content'); content.replaceChildren(el('h2', title));
  for (const line of lines) content.append(el('p', line));
  const controls = el('div', undefined, 'dialog-actions');
  for (const a of actions) controls.append(button(a.text, a.fn, a.primary ? 'primary' : ''));
  content.append(controls);
  if (!system.open) system.showModal();
}
function closeSystem() { modalType = ''; system.close(); resumeWorld(); }
system.addEventListener('close', resumeWorld);
system.addEventListener('cancel', event => {
  event.preventDefault();
  if (state?.status === 'playing' && !['intro', 'unsupported'].includes(modalType)) closeSystem();
  else if (!state) closeSystem();
});
paper.addEventListener('close', () => { clearInput(); resumeWorld(); });

function saveNow(checkpoint = false, replace = false) {
  if (!state || !canSave(state)) return;
  if (checkpoint) {
    memoryCheckpoint = snapshot(state);
    state.checkpointRequest = false;
  }
  const saved = store.save(state, checkpoint, replace);
  if (saved.ok) {
    lastSave = state.elapsed;
    $('save-status').textContent = `${checkpoint ? '检查点' : '自动保存'} · ${new Date(saved.data.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  } else if (!saved.skipped) {
    $('save-status').textContent = '保存失败 · 仅保留本页进度';
    if ($('save-status').dataset.error !== saved.error) { toast(saved.error); $('save-status').dataset.error = saved.error; }
  }
}
function applyAction(action, payload) {
  const beforeEncounter = ['solve', 'voice', 'training', 'exit', 'evidence'].includes(action) && canSave(state) ? snapshot(state) : null;
  const r = performAction(state, action, payload);
  if (r.ok) {
    if (state.pendingEncounter && beforeEncounter) {
      beforeEncounter.checkpointLabel = `${locationLabel(beforeEncounter)} · 异常发生前`;
      memoryCheckpoint = beforeEncounter;
      const saved = store.save(beforeEncounter, true);
      if (saved.ok) $('save-status').textContent = '检查点 · 异常发生前';
      else { $('save-status').textContent = '仅本页临时检查点'; toast(saved.error); }
    }
    if (r.bell) pendingBell = true;
    if (state.checkpointRequest && canSave(state)) saveNow(true);
    else if (r.save) saveNow(false);
    if (r.message) { state.message = r.message; messageUntil = performance.now() + 8000; }
    if (r.ending) queueMicrotask(showEnding);
  }
  return r;
}
const interactions = new Interactions(paper, applyAction);

async function prepareRenderers() {
  if (r3 || webglError) return !!r3;
  try {
    const { Renderer3D } = await import('./renderer-3d.js');
    r3 = new Renderer3D($('view-3d'));
    return true;
  } catch (error) {
    webglError = error.message;
    $('boot-status').textContent = '当前浏览器未能启用WebGL2，第一人称不可用。';
    return false;
  }
}
function syncView() {
  $('view-3d').hidden = state.view !== '3d'; $('view-2d').hidden = state.view !== '2d';
  $('minimap-panel').hidden = state.view !== '3d';
  $('minimap-canvas').hidden = minimapCollapsed; $('minimap-legend').hidden = minimapCollapsed;
  $('minimap-toggle').textContent = minimapCollapsed ? '展开' : '收起';
  $('minimap-toggle').setAttribute('aria-expanded', String(!minimapCollapsed));
  minimapDrawAt = 0;
  $('crosshair').hidden = state.view !== '3d';
  $('view-button').textContent = state.view === '3d' ? '切换到2D · V' : '切换到3D · V';
  $('look-hint').textContent = state.view === '3d' ? '拖动画面观察 · 电脑可点击锁定鼠标 · V切换' : 'WASD或摇杆移动 · 墙后不可见 · V切换';
  if (state.view === '2d' && document.pointerLockElement) document.exitPointerLock();
  if (state.view === '3d') r3?.resize(); else r2.resize();
}
async function launch(next, intro = false, replace = false) {
  if (system.open) system.close();
  if (!await audio.start()) toast('音频暂未启用，可继续游玩；请在设置中点击“启用声音”。');
  const has3d = next.view === '2d' || await prepareRenderers();
  if (!has3d && next.view === '3d') {
    modalType = 'unsupported';
    showSystem('第一人称需要WebGL2', ['当前浏览器或设备未能创建3D渲染器。可以换用支持WebGL2的浏览器，或明确选择仅2D游玩；不会以图片冒充3D。'], [
      { text: '仅以2D继续', fn: () => { next.view = '2d'; closeSystem(); activate(next, intro, replace); } },
      { text: '返回主菜单', fn: () => { state = null; closeSystem(); refreshSaves(); } },
    ]);
    return;
  }
  activate(next, intro, replace);
}
function activate(next, intro, replace) {
  if (next.mode === 'tutorial' && webglError && next.view === '2d') {
    next.tutorial.switched = true;
    toast('当前设备仅2D可用，已豁免教程的双视角演练；其他教学正常进行。');
  }
  state = next; state.status = 'playing'; lastSave = state.elapsed; messageUntil = 0;
  const existing = store.read(state.mode);
  memoryCheckpoint = existing.ok && existing.data ? structuredClone(existing.data.checkpoint) : snapshot(state);
  $('title-screen').hidden = true; $('game-screen').hidden = false;
  syncView();
  if (replace) saveNow(true, true);
  if (intro) {
    modalType = 'intro';
    const text = state.mode === 'tutorial' ? ['这里是独立的夜行演习，不会覆盖正式模式存档。', 'WASD或左侧摇杆移动；拖动画面转头。V或右下按钮切换视角，E调查，F手电，H温水，按住R定神。', '跟随左上方指引完成每项操作。追逐中可以切视角，但敌人不会因此消失。'] : INTRO;
    showSystem(state.mode === 'tutorial' ? '先学会清醒地走出去' : '旧物领取通知', text, [{ text: '进入校园', primary: true, fn: closeSystem }]);
  } else { modalType = ''; resumeWorld(); }
  updateHUD();
}
function startNew(mode) {
  const prior = store.read(mode);
  if (!prior.ok || prior.data) {
    modalType = 'confirm';
    showSystem('重新开始这一模式？', [prior.ok ? `将覆盖“${MODES[mode].label}”的本机存档，其他模式不受影响。` : prior.error + ' 重新开始将明确替换此模式的旧记录。'], [
      { text: '取消', fn: closeSystem }, { text: '确认重新开始', primary: true, fn: () => launch(createGame(mode), true, true) },
    ]);
  } else launch(createGame(mode), true, true);
}
function refreshSaves() {
  const list = $('save-list'); list.replaceChildren(); let errors = [];
  for (const [mode, config] of Object.entries(MODES)) {
    const saved = store.read(mode);
    if (!saved.ok) { errors.push(`${config.label}：${saved.error}`); continue; }
    if (saved.data) {
      const b = button(`继续 · ${config.label}`, () => {
        const restored = store.restore(mode);
        if (restored.ok) { launch(restored.state); if (restored.migrated) toast('旧版存档已适配到1F；下一次保存前会保留原始v1备份。'); } else toast(restored.error);
      });
      b.dataset.continue = mode;
      b.append(el('small', `${locationLabel(saved.data.auto)} / SAN ${Math.round(saved.data.auto.player.san)} / ${new Date(saved.data.savedAt).toLocaleString('zh-CN')}`));
      list.append(b);
    }
  }
  $('boot-status').textContent = errors.length ? errors.join(' ') : '本机自动存档 · 耳机可选 · 所有声音线索均有文字提示';
}
function toTitle() {
  if (state?.status === 'playing') saveNow(false);
  pauseWorld();
  if (paper.open) paper.close();
  state = null;
  if (system.open) system.close();
  $('title-screen').hidden = false; $('game-screen').hidden = true;
  refreshSaves();
}
function retry() {
  const restored = store.restore(state.mode, true);
  let next = memoryCheckpoint ? structuredClone(memoryCheckpoint) : restored.ok ? restored.state : null;
  if (!next) { toast(restored.error || '没有可用检查点。'); return; }
  if (!restored.ok) toast('使用本页临时检查点；浏览器存储仍不可用。');
  next.view = state.view;
  if (next.mode === 'tutorial') next.tutorial.retried = true;
  if (paper.open) paper.close();
  if (system.open) system.close();
  state = next; lastSave = state.elapsed; state.message = '已回到最近检查点。道具、SAN和机关均恢复到该时刻。'; messageUntil = performance.now() + 6000;
  syncView(); saveNow(false); updateHUD(); resumeWorld();
}
function askRetry() {
  modalType = 'confirm';
  showSystem('从最近检查点重新开始？', [`检查点：${memoryCheckpoint?.checkpointLabel || state.checkpointLabel}。`, '检查点之后取得的道具、使用的温水和解谜进度都会一并回退。不会只恢复SAN而保留新物品。'], [
    { text: '取消', fn: closeSystem }, { text: '确认重试检查点', primary: true, fn: retry },
  ]);
}
function pauseMenu() {
  if (!state || paper.open) return;
  modalType = 'pause'; saveNow(false);
  showSystem('夜行暂停', [`${MODES[state.mode].label} · ${getScene(state.scene).label}`, '暂停期间SAN、敌人和体力均停止变化。'], [
    { text: '继续探索', primary: true, fn: closeSystem }, { text: '从最近检查点重新开始', fn: askRetry },
    { text: '声音与显示', fn: showSettings }, { text: '返回主菜单', fn: toTitle },
  ]);
}
function showEnding() {
  const ending = ENDINGS[state.ending];
  modalType = 'ending'; audio.pause();
  showSystem(ending.title, ending.lines, [{ text: '重返检查点', fn: retry }, { text: '返回主菜单', primary: true, fn: toTitle }]);
  $('system-content').querySelector('h2').classList.add('ending-title');
}
function showFailure() {
  modalType = 'failure';
  showSystem('册页翻回了上一行', [state.failure, '已核实的检查点仍在。重试不会改变你的结局资格。'], [
    { text: '从最近检查点出发', primary: true, fn: retry }, { text: '返回主菜单', fn: toTitle },
  ]);
}
function showSettings() {
  modalType = 'settings';
  showSystem('声音与显示', ['效果强度不改变SAN或敌人难度。静音时仍可通过字幕获取关键线索。']);
  const content = $('system-content');
  for (const [key, label] of [['muted', '静音'], ['reducedEffects', '减弱暗角、杂音与镜头特效']]) {
    const row = el('label', undefined, 'settings-row'); row.append(el('span', label));
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = settings[key];
    input.addEventListener('change', () => { settings[key] = input.checked; persistSettings(); }); row.append(input); content.append(row);
  }
  const volumeRow = el('label', undefined, 'settings-row'); volumeRow.append(el('span', '总音量'));
  const volume = document.createElement('input'); Object.assign(volume, { type: 'range', min: 0, max: 100, value: settings.volume * 100 });
  volume.addEventListener('input', () => { settings.volume = Number(volume.value) / 100; persistSettings(); }); volumeRow.append(volume); content.append(volumeRow);
  const qualityRow = el('label', undefined, 'settings-row'); qualityRow.append(el('span', '画面质量'));
  const quality = document.createElement('select');
  for (const [value, label] of [['standard', '标准'], ['low', '低功耗']]) { const o = el('option', label); o.value = value; quality.append(o); }
  quality.value = settings.quality; quality.addEventListener('change', () => { settings.quality = quality.value; persistSettings(); }); qualityRow.append(quality); content.append(qualityRow);
  content.append(button('启用声音', async () => { const enabled = await audio.start(); audio.pause(); toast(enabled ? '音频将在继续探索后播放。' : '浏览器未允许启用声音，可保持静音游玩。'); }), button('完成设置', closeSystem, 'primary'));
}
function persistSettings() { try { storage.setItem(`campus-settings:${scope}`, JSON.stringify(settings)); } catch { toast('设置只能在本次页面中保留。'); } }
function showAbout() {
  modalType = 'about';
  showSystem('夜行须知', [
    '这是原创架空恐怖故事，不涉及真实学校事故。五栋楼的顺序参考用户提供的校园示意：行政楼、实验楼、教学楼、宿舍、食堂。',
    '电脑：WASD移动，Shift冲刺，鼠标拖动/点击锁定观察，V切换视角，E调查，F手电，H温水，按住R定神，J手记，M地图，Esc暂停。手机：左侧摇杆移动、拖动画面观察，右侧按钮操作。',
    '在安全灯旁按住定神恢复SAN；核实新的真实线索和温水也能恢复。手电开着可避免异常黑暗的SAN消耗，但更容易被点名者看见。',
    '存档仅在当前浏览器的网站存储中。清除网站数据、无痕窗口关闭、换浏览器或设备都可能使记录不可用。追逐中不覆盖安全存档。',
    '部署：将发行ZIP解压，把其中index.html、JS、CSS、vendor和.nojekyll一起上传仓库根目录，在GitHub Settings → Pages选择发布分支与/(root)。不要只上传ZIP，也不要漏传vendor。所有资源均为本地相对路径，无需服务器程序或CDN。',
    '本地预览需HTTP服务；源码项目可运行npm run dev。直接双击HTML的file://方式不作为支持的部署方式。',
  ], [{ text: '知道了', primary: true, fn: closeSystem }]);
}

function interact(kind) {
  if (!state || paused) return;
  if (isThreatened(state)) { toast('翻页声还在附近。先脱离追踪，再调查或打开手记。'); return; }
  if (kind) { pauseWorld(); interactions.open(kind, state, {}); return; }
  const target = interactionTarget(state);
  if (!target) { toast('再靠近一点，留意门牌、桌面和灯座。'); return; }
  if (['entrance', 'exit', 'water'].includes(target.type)) {
    const r = applyAction(target.type === 'entrance' ? 'enter' : target.type, target.type === 'entrance' ? { target: target.target } : { id: target.id });
    toast(r.message); syncView(); return;
  }
  pauseWorld(); interactions.open(target.type, state, target);
}
async function action(action) {
  if (!state || paused) return;
  if (action === 'switch' && state.view === '2d' && renderFault) { toast('3D上下文尚未恢复，请先保持2D视角。'); return; }
  if (action === 'switch' && state.view === '2d' && !r3 && !await prepareRenderers()) { toast('此设备未启用WebGL2，无法切换到真正3D。'); return; }
  const r = applyAction(action);
  if (action === 'switch') syncView();
  toast(r.message);
}

function updateHUD() {
  if (!state) return;
  const effects = sanityEffects(state.player.san), target = interactionTarget(state), lamp = activeLamp(state);
  $('mode-label').textContent = MODES[state.mode].label;
  $('location-label').textContent = locationLabel(state);
  $('minimap-label').textContent = `北 ↑ · ${locationLabel(state)}`;
  $('minimap-panel').dataset.floor = String(state.player.floor);
  $('objective').textContent = objective(state);
  $('san-value').textContent = Math.ceil(state.player.san);
  $('san-label').textContent = effects.label;
  $('san-meter').value = state.player.san; $('stamina-meter').value = state.player.stamina;
  $('water-count').textContent = `温水 ${state.inventory.water}`;
  $('light-button').dataset.active = String(state.player.flashlight);
  $('san-shade').style.setProperty('--shade', effects.darkness * (settings.reducedEffects ? 0.45 : 1));
  $('interaction-prompt').textContent = target && !isThreatened(state) ? `${target.label} · E / 调查` : '';
  $('interact-button').disabled = !target || isThreatened(state);
  $('recovery-hint').textContent = lamp && !isThreatened(state) ? `安全灯下 · 按住定神（上限${MODES[state.mode].lampCap}）` : isThreatened(state) ? '正在被追踪 · 打断视线后保持安静' : state.player.san < 40 ? 'SAN偏低 · 寻找安全灯或饮用温水' : '停步观察，比盲目奔跑更安全';
  if (state.mode === 'tutorial') {
    const lessons = [ ['moved', '移动：WASD或左侧摇杆'], ['switched', '按V或按钮切换视角'], ['light', '切换一次手电'], ['inspected', '找到左上房间便条，翻到纸背'], ['puzzle', '到右上练习台核验压痕'], ['recovered', '回入口左侧安全灯，调查检修后按住定神'], ['water', '取灯旁温水，按H或温水按钮饮用'], ['escaped', '调查右下演练点，利用中间隔墙脱离追踪'], ['retried', '打开暂停菜单，练习从检查点重新开始'] ];
    const next = lessons.find(([key]) => !state.tutorial[key]);
    $('tutorial-progress').textContent = next ? `演习 ${lessons.findIndex(([key]) => key === next[0]) + 1}/${lessons.length} · ${next[1]}` : '所有演习已完成，可以开始正式夜行。';
    $('finish-tutorial').hidden = !tutorialComplete(state);
  } else { $('tutorial-progress').textContent = ''; $('finish-tutorial').hidden = true; }
  if (state.message) { $('subtitles').textContent = state.message; state.message = ''; messageUntil = performance.now() + 7000; }
  if (performance.now() > messageUntil) {
    const e = state.enemy;
    $('subtitles').textContent = isThreatened(state) ? `【${e.mode === 'search' ? '翻页声正在搜索' : '翻页声靠近'}】${e.x < state.player.x ? '左侧' : '右侧'}，${e.z < state.player.z ? '地图上方' : '地图下方'}，${e.floor === state.player.floor ? '同层' : `${e.floor}F`}。可切视角观察，利用墙角遮挡。` : '';
  }
}

function loop(now) {
  const dt = Math.min((now - (lastFrame || now)) / 1000, 0.05); lastFrame = now;
  if (state && !$('game-screen').hidden) {
    if (!paused && !document.hidden && state.status === 'playing') {
      const input = {
        x: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + pointer.x,
        z: (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0) + pointer.z,
        turn: pointer.turn + ((keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0)) * dt * 1.8,
        pitch: pointer.pitch, sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') || pointer.sprint,
        rest: keys.has('KeyR') || pointer.rest,
      };
      pointer.turn = 0; pointer.pitch = 0;
      if (state.checkpointRequest) saveNow(true);
      updateGame(state, input, dt);
      if (state.checkpointRequest) saveNow(true);
      if (state.elapsed - lastSave >= 10) { saveNow(false); if (!canSave(state)) lastSave = state.elapsed - 8; }
      if (state.status === 'failed') showFailure();
    }
    if (!document.hidden) {
      if (state.view === '3d') {
        if (!renderFault) {
          try {
            r3?.render(state, paused ? 0 : dt, settings);
            if (!minimapCollapsed && now >= minimapDrawAt) { minimap.render(state, 0, settings); minimapDrawAt = now + 100; }
          } catch (error) { handleRenderFailure(error.message); }
        }
      } else r2.render(state, paused ? 0 : dt, settings);
      audio.update(state, paused ? 0 : dt, settings);
      if (pendingBell && !paused) { audio.bell?.(); pendingBell = false; }
      updateHUD();
    }
  }
  requestAnimationFrame(loop);
}

for (const b of document.querySelectorAll('[data-new]')) b.addEventListener('click', () => startNew(b.dataset.new));
$('title-settings').addEventListener('click', showSettings); $('about-button').addEventListener('click', showAbout);
$('pause-button').addEventListener('click', pauseMenu);
$('view-button').addEventListener('click', () => action('switch'));
$('light-button').addEventListener('click', () => action('light'));
$('drink-button').addEventListener('click', () => action('drink'));
$('interact-button').addEventListener('click', () => interact());
$('journal-button').addEventListener('click', () => interact('journal'));
$('map-button').addEventListener('click', () => interact('map'));
$('finish-tutorial').addEventListener('click', () => { if (tutorialComplete(state)) toTitle(); });
for (const [id, key] of [['rest-button', 'rest'], ['sprint-button', 'sprint']]) {
  const b = $(id);
  b.addEventListener('pointerdown', e => { if (paused) return; e.preventDefault(); b.setPointerCapture(e.pointerId); pointer[key] = true; });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(event, () => { pointer[key] = false; });
}
window.addEventListener('keydown', event => {
  if (!state || event.target.matches('input,select,textarea')) return;
  if (event.code === 'Escape') { if (!system.open && !paper.open) { event.preventDefault(); pauseMenu(); } return; }
  if (paused) return;
  if (['Space', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  const commands = { KeyV: () => action('switch'), KeyF: () => action('light'), KeyH: () => action('drink'), KeyE: () => interact(), KeyJ: () => interact('journal'), KeyM: () => interact('map') };
  commands[event.code]?.();
});
window.addEventListener('keyup', event => keys.delete(event.code));
let lookPointer = null;
for (const canvas of [$('view-3d'), $('view-2d')]) {
  canvas.addEventListener('pointerdown', e => {
    if (paused || state?.view !== '3d') return;
    lookPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (e.pointerType === 'mouse' && canvas.requestPointerLock) {
      const promise = canvas.requestPointerLock(); promise?.catch?.(() => {});
    } else canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (paused || state?.view !== '3d') return;
    if (document.pointerLockElement === canvas) { pointer.turn -= e.movementX * .003; pointer.pitch -= e.movementY * .003; }
    else if (lookPointer?.id === e.pointerId) {
      pointer.turn -= (e.clientX - lookPointer.x) * .005; pointer.pitch -= (e.clientY - lookPointer.y) * .005;
      lookPointer.x = e.clientX; lookPointer.y = e.clientY;
    }
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { lookPointer = null; });
}
const joystick = $('joystick'); let joyId = null;
function moveJoystick(e) {
  if (e.pointerId !== joyId) return;
  const rect = joystick.getBoundingClientRect(), radius = rect.width * .35;
  let x = (e.clientX - rect.left - rect.width / 2) / radius, z = (e.clientY - rect.top - rect.height / 2) / radius;
  const len = Math.max(1, Math.hypot(x, z)); x /= len; z /= len;
  pointer.x = x; pointer.z = z;
  $('joystick-knob').style.transform = `translate(${x * radius}px,${z * radius}px)`;
}
joystick.addEventListener('pointerdown', e => { if (paused) return; joyId = e.pointerId; joystick.setPointerCapture(e.pointerId); moveJoystick(e); });
joystick.addEventListener('pointermove', moveJoystick);
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) joystick.addEventListener(event, () => { joyId = null; pointer.x = 0; pointer.z = 0; $('joystick-knob').style.transform = ''; });
window.addEventListener('blur', () => { clearInput(); if (state && !paused) pauseMenu(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveNow(false); if (state && !system.open && !paper.open) pauseMenu(); pauseWorld(); } });
window.addEventListener('pagehide', () => saveNow(false));
window.addEventListener('resize', () => { r2.resize(); r3?.resize(); minimap.resize(); minimapDrawAt = 0; });
function handleRenderFailure(message) {
  renderFault = true; webglError = message; pauseWorld();
  if (!state) { $('boot-status').textContent = '3D暂不可用，请重新载入页面。'; return; }
  if (paper.open) paper.close();
  modalType = 'unsupported';
  showSystem('3D画面暂时中断', ['进度保留在本页。图形上下文恢复后可切回3D，也可先用2D继续；存储受限时不要直接刷新。'], [{ text: '切换2D继续', fn: () => { state.view = '2d'; if (state.mode === 'tutorial') state.tutorial.switched = true; syncView(); closeSystem(); } }]);
}
$('view-3d').addEventListener('webglcontextlost', event => { event.preventDefault(); handleRenderFailure('图形上下文丢失'); });
$('view-3d').addEventListener('webglcontextrestored', () => { renderFault = false; webglError = null; r3?.clearScene(); minimapDrawAt = 0; toast('3D图形上下文已恢复，可重新切换视角。'); });
$('minimap-toggle').addEventListener('click', () => { minimapCollapsed = !minimapCollapsed; syncView(); });
const objectivePanel = document.querySelector('.objective-box');
new ResizeObserver(() => {
  if (!state) return;
  const compactPortrait = innerWidth <= 760 && innerHeight > innerWidth;
  $('minimap-panel').style.top = compactPortrait ? `${Math.max(150, Math.ceil(objectivePanel.getBoundingClientRect().bottom + 8))}px` : '';
}).observe(objectivePanel);
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) { lookPointer = null; pointer.turn = 0; pointer.pitch = 0; } });
refreshSaves();
requestAnimationFrame(loop);
