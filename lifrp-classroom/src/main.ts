import { createGame, act, tick, advance, getActions, getObjectives, EVENT_DETAILS, type GameAction, type GameState } from './simulation/game';
import { generateBackSeatCandidates, generateFrontSeatSelection, adjustFrontSeat } from './simulation/seats.js';
import { pickDifficulty, DIFFICULTY_CONFIG } from './simulation/difficulty.js';
import { getStatusTier, OUTCOME_LABELS } from './simulation/outcomes.js';
import type { WorldRenderer, Room, InteractionPrompt } from './render/WorldRenderer';
import type { Quality } from './render/qualityProfiles';
import { AudioSystem } from './audio/AudioSystem';
import './ui/styles.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const audio = new AudioSystem();
const SAVE = 'lifrp-classroom:v2:';
const ROOM_NAMES = { classroom: '教室', corridor: '走廊', office: '办公室' };
const MODE_NAMES = { day: '一天生存', chapters: '多天章节', challenge: '随机挑战' };
const ROLE_NAMES = { student: '普通同学', monitor: '班长', 'chemistry-rep': '化学课代表' };
let game: GameState | null = null;
let world: WorldRenderer | null = null;
let screen: 'menu' | 'seats' | 'play' = 'menu';
let selectedMode: GameState['mode'] = 'chapters';
let highestChapter = 1;
let quality: Quality = 'auto';
let panelOpen = true;
let lastStatusSecond = -1;
let lastSaveSecond = -1;
let gameGeneration = 0;
let notice = '';
let storedNotice = '';
let playerName = '';
let activePrompt: InteractionPrompt | null = null;
try {
  highestChapter = Math.max(1, Math.min(6, Number(localStorage.getItem(`${SAVE}progress`)) || 1));
  const settings = JSON.parse(localStorage.getItem(`${SAVE}settings`) || '{}');
  quality = ['auto', 'high', 'medium', 'low'].includes(settings.quality) ? settings.quality : 'auto';
  audio.speech = settings.speech === true;
  audio.sound = settings.sound !== false;
  playerName = localStorage.getItem(`${SAVE}player-name`) || '';
} catch { storedNotice = '本地存储暂不可用，本次可以游玩，但无法保证刷新后恢复。'; }

function element<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === undefined || value === null) continue;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'class') node.className = String(value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else node.setAttribute(key, String(value));
  }
  node.append(...children);
  return node;
}
function button(text: string, action: () => void, cls = 'action-button', id?: string) {
  return element('button', { type: 'button', class: cls, text, onclick: action, 'data-action': id });
}
function say(text: string, tone: 'quiet' | 'success' | 'warning' | 'danger' = 'quiet') {
  notice = text;
  const node = document.querySelector<HTMLElement>('#toast');
  if (node) { node.textContent = text; node.dataset.tone = tone; }
  audio.cue(tone);
  audio.say(text, tone === 'danger' ? 'teacher' : text.includes('同学') ? 'student' : 'narrator');
}
function save() {
  if (!game || screen !== 'play') return;
  try {
    localStorage.setItem(`${SAVE}${game.mode}`, JSON.stringify({ version: 2, game }));
    highestChapter = Math.max(highestChapter, game.maxUnlockedChapter);
    localStorage.setItem(`${SAVE}progress`, String(highestChapter));
  } catch { say('浏览器拒绝保存；不要刷新本页，以免丢失本局进度。', 'warning'); }
}
function savedGame(mode: GameState['mode']): GameState | null {
  try {
    const saved = JSON.parse(localStorage.getItem(`${SAVE}${mode}`) || 'null');
    if (saved?.version !== 2 || !saved.game || saved.game.mode !== mode) return null;
    if (!Array.isArray(saved.game.events) || !saved.game.position || !['simple', 'normal', 'hard', 'terror'].includes(saved.game.difficulty)) return null;
    return saved.game;
  } catch { return null; }
}
function settingsSave() {
  try { localStorage.setItem(`${SAVE}settings`, JSON.stringify({ quality, speech: audio.speech, sound: audio.sound })); } catch { /* Private browsing may disable storage. */ }
}

function showMenu() {
  save();
  gameGeneration++;
  world?.dispose(); world = null;
  audio.pause();
  screen = 'menu';
  const name = element('input', { id: 'player-name', maxlength: 18, placeholder: '输入称呼（只保存在本机）', autocomplete: 'nickname', value: playerName });
  const role = element('select', { id: 'role-select' }, Object.entries(ROLE_NAMES).map(([value, label]) => element('option', { value, text: label })));
  const modeList = element('div', { class: 'mode-list' });
  const selectionSummary = element('div', { class: 'selection-summary', role: 'status', 'aria-live': 'polite' });
  const resume = button('继续当前模式存档', () => { const saved = savedGame(selectedMode); if (saved) { game = saved; void enterPlay(); } }, 'secondary-button', 'continue');
  const descriptions = { chapters: '五章课堂与多日假期，逐步展开全部事件。', day: '完成一天的课表，带着作业安全离校。', challenge: '第一章之后解锁，每局固定一组随机事件。' };
  const refreshSummary = () => {
    const region = app.querySelector<HTMLInputElement>('input[name=region]:checked')?.value === 'back' ? '后三排' : '前三排';
    const roleLabel = ROLE_NAMES[role.value as GameState['role']];
    const modeLabel = MODE_NAMES[selectedMode];
    selectionSummary.replaceChildren(
      element('span', { class: 'summary-label', text: '本次登记' }),
      element('strong', { text: `${region} · ${roleLabel}` }),
      element('span', { text: `${modeLabel} · 下一步确认具体座位` }),
    );
  };
  const refreshModes = () => {
    modeList.replaceChildren(...(Object.keys(MODE_NAMES) as GameState['mode'][]).map((mode, index) => {
      const node = button('', () => { selectedMode = mode; refreshModes(); }, `mode-card ${mode === selectedMode ? 'selected' : ''}`);
      node.disabled = mode === 'challenge' && highestChapter < 2;
      node.setAttribute('aria-pressed', String(mode === selectedMode));
      node.append(element('span', { class: 'mode-index', text: `0${index + 1}` }), element('strong', { text: MODE_NAMES[mode] }), element('span', { class: 'mode-description', text: node.disabled ? '完成第一章后开放' : descriptions[mode] }));
      return node;
    }));
    resume.disabled = !savedGame(selectedMode);
    refreshSummary();
  };
  refreshModes();
  role.addEventListener('change', refreshSummary);
  name.addEventListener('input', () => { playerName = name.value.trim(); });
  const start = () => {
    const region = app.querySelector<HTMLInputElement>('input[name=region]:checked')!.value as GameState['region'];
    playerName = name.value.trim() || '无名同学';
    try { localStorage.setItem(`${SAVE}player-name`, playerName); } catch { /* Private browsing may disable storage. */ }
    const options = { name: name.value.trim() || '无名同学', mode: selectedMode, role: role.value as GameState['role'], region, difficulty: pickDifficulty() as GameState['difficulty'], unlockedChapter: highestChapter };
    screen = 'seats';
    showSeats(options);
  };
  const panel = element('form', { class: 'menu-panel', onsubmit: (e: Event) => { e.preventDefault(); start(); } }, [
    element('div', { class: 'section-kicker', text: '课前登记 / CLASS REGISTER' }),
    element('label', { for: 'player-name', class: 'field-label', text: '你的姓名' }), name,
    element('div', { class: 'field-label', text: '座位区域' }),
    element('div', { class: 'choice-grid' }, ['front', 'back'].map(region => element('label', { class: 'choice-card' }, [
      element('input', { type: 'radio', name: 'region', value: region, checked: region === 'front' }),
      element('strong', { text: region === 'front' ? '前三排' : '后三排' }),
      element('span', { class: 'choice-detail', text: region === 'front' ? '随机分配，可左右调整一次' : '从本局候选位置中选择' }),
    ]))),
    element('label', { class: 'field-label', for: 'role-select', text: '班级身份' }), role,
    element('div', { class: 'field-label', text: '选择模式' }), modeList,
    selectionSummary,
    element('div', { class: 'menu-actions' }, [button('开始新游戏', start, 'primary-button', 'new-game'), resume]),
    element('p', { class: 'menu-note', text: '难度每局隐藏随机；重新开始不会改变其他模式存档。配音默认关闭，可在设置中开启。' }),
    button('设置 / 画质与声音', openSettings, 'text-button'),
    element('p', { class: 'menu-note', text: storedNotice || '本作包含虚构校园异常、追逐与突然音效，可调低音量。' }),
  ]);
  app.replaceChildren(element('main', { class: 'menu-screen' }, [
    element('section', { class: 'menu-hero' }, [
      element('div', { class: 'eyebrow', text: 'LiFrP Classroom / 档案 01' }),
      element('h1', { text: '李方玲的\n化学课' }),
      element('p', { class: 'hero-subtitle', text: '雨前最后一题' }),
      element('p', { class: 'hero-copy', text: '粉笔停下时，不要急着回答。\n先确认那道题，究竟有没有讲过。' }),
      element('div', { class: 'hero-rule' }, [element('span'), element('span'), element('span')]),
      element('p', { class: 'hero-meta', text: '双视角探索 · 隐藏难度 · 五章故事' }),
    ]), panel,
    element('footer', { class: 'menu-footer' }, [element('span', { text: 'LIFRP / 雨前最后一题' }), element('span', { text: '完整版 · WebGL 2' })]),
  ]));
  app.querySelectorAll<HTMLInputElement>('input[name=region]').forEach(input => input.addEventListener('change', refreshSummary));
}

type StartOptions = Omit<Parameters<typeof createGame>[0], 'seat'>;
function showSeats(options: StartOptions) {
  const selection = options.region === 'front' ? generateFrontSeatSelection() : generateBackSeatCandidates(options.difficulty);
  let front = 'assigned' in selection ? selection : null;
  let selected = front ? front.assigned : ('candidates' in selection ? selection.candidates[0] : null);
  const grid = element('div', { class: 'seat-options' });
  const refresh = () => {
    const seats = front ? [front.assigned, ...(front.adjustmentsRemaining ? front.neighbors : [])] : ('candidates' in selection ? selection.candidates : []);
    grid.replaceChildren(...seats.map(seat => {
      const node = button(seat.id, () => {
        if (front && seat.id !== front.assigned.id) front = adjustFrontSeat(front, seat.id);
        selected = seat; refresh();
      }, `seat-option ${selected?.id === seat.id ? 'selected' : ''}`);
      node.setAttribute('aria-pressed', String(selected?.id === seat.id));
      return node;
    }));
  };
  refresh();
  app.replaceChildren(element('main', { class: 'seat-screen' }, [
    element('div', { class: 'stepper', 'aria-label': '开局步骤' }, [
      element('span', { class: 'done', text: '01 登记' }), element('span', { class: 'current', text: '02 落座' }), element('span', { text: '03 探索' }),
    ]),
    element('div', { class: 'eyebrow', text: '落座 / THE REGISTER' }),
    element('h1', { text: options.region === 'front' ? '前三排' : '后三排' }),
    element('p', { class: 'seat-lede', text: options.region === 'front' ? '已随机安排位置。可以保留原位，或向左右相邻座位调整一次。' : '名单上只有名字。请从本局候选位置中选择。' }), grid,
    element('div', { class: 'seat-footer' }, [button('返回', showMenu, 'text-button'), button('确认座位 · 坐下', () => {
      if (!selected) return;
      game = createGame({ ...options, seat: selected });
      game.position = { x: 0, z: -1.55 + (selected.row - 1 + (selected.row > 3 ? 1 : 0)) * .8 + .45 };
      void enterPlay();
    }, 'primary-button', 'confirm-seat')]),
  ]));
}

async function enterPlay() {
  if (!game) return;
  screen = 'play'; panelOpen = true;
  activePrompt = null;
  const generation = ++gameGeneration;
  world?.dispose(); world = null;
  await audio.unlock().catch(() => {});
  const canvas = element('canvas', { id: 'game-canvas', 'aria-label': '校园探索场景', tabindex: 0 });
  const panel = element('section', { class: 'event-drawer', id: 'event-drawer', 'aria-label': '当前事件' });
  const interactionHub = element('aside', { class: 'interaction-hub', id: 'interaction-hub', 'aria-label': '场景交互', 'aria-live': 'polite' });
  app.replaceChildren(element('main', { id: 'game-shell', class: 'game-shell' }, [
    element('div', { class: 'scene-layer' }, [canvas]),
    element('header', { class: 'hud-top' }, [
      element('div', { class: 'hud-brand' }, [element('span', { class: 'hud-mark', text: 'LF' }), element('span', { id: 'chapter-label' })]),
      element('nav', { class: 'hud-actions', 'aria-label': '游戏工具' }, [
        button('3D', switchView, 'icon-button', 'view'),
        button('事件', () => { panelOpen = !panelOpen; panel.hidden = !panelOpen; updateHud(); }, 'icon-button', 'panel'),
        button('记录', openJournal, 'icon-button', 'journal'),
        button('帮助', openHelp, 'icon-button', 'help'),
        button('全屏', () => void fullScreen(), 'icon-button', 'fullscreen'),
        button('设置', openSettings, 'icon-button', 'settings'),
      ]),
    ]),
    element('aside', { class: 'objective-cluster' }, [
      element('span', { class: 'section-kicker', id: 'room-label' }), element('h2', { id: 'objective-title' }),
      element('div', { class: 'completion-meter' }, [
        element('div', { class: 'meter-header' }, [element('span', { text: '今日进度' }), element('strong', { id: 'completion-label', text: '0%' })]),
        element('div', { class: 'meter-track' }, [element('span', { id: 'completion-meter-fill' })]),
      ]),
      element('div', { class: 'status-row' }, ['完成', '怀疑', '心理'].map((label, i) => element('div', { class: 'status-pill' }, [element('span', { class: 'status-label', text: label }), element('strong', { id: `status-${i}` })]))),
      element('span', { class: 'view-chip', id: 'view-label' }),
    ]),
    element('div', { class: 'event-rail', id: 'event-rail', 'aria-label': '当前课表' }),
    element('div', { id: 'scene-status', class: 'scene-status', role: 'status' }),
    element('div', { class: 'crosshair', 'aria-hidden': true }), panel, interactionHub,
    element('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite', text: notice }),
    element('div', { class: 'control-hint', text: 'WASD 移动 · 拖拽转向 · E 场景交互 · V 切换视角 · I 事件面板' }),
    element('div', { class: 'mobile-controls' }, [
      element('div', { id: 'joystick', class: 'virtual-stick', role: 'group', 'aria-label': '移动摇杆' }, [element('span', { class: 'stick-knob' })]),
      button('交互', () => world?.interact(), 'touch-interact', 'interact'),
    ]),
  ]));
  renderEvent(); updateHud(); save();
  try {
    const { WorldRenderer } = await import('./render/WorldRenderer');
    if (generation !== gameGeneration || screen !== 'play') return;
    world = new WorldRenderer(canvas, quality);
    world.onStatus = text => { const node = document.querySelector('#scene-status'); if (node) { node.textContent = text; (node as HTMLElement).hidden = !text; } };
    world.onRoom = room => {
      if (!game || !world) return;
      if (game.phase === 'chase') {
        game.room = room;
        game.position = world.spawn(room);
        void world.load(room).then(() => world?.resize());
        doAction('escape');
      } else doAction(`go:${room}`);
    };
    world.onView = switchView;
    world.onInteractionPrompt = prompt => { activePrompt = prompt; renderInteractionHub(); };
    world.onInteract = prompt => {
      activePrompt = prompt || activePrompt;
      const contextual = activePrompt ? getContextualActions(activePrompt) : [];
      const next = contextual.find(action => !action.disabled);
      if (next) { doAction(next.id); return; }
      panelOpen = true;
      panel.hidden = false;
      renderInteractionHub();
      say(activePrompt ? `${activePrompt.label}：从下方选择要执行的行动。` : '靠近场景中的金色标记，再按 E 进行交互。');
      document.querySelector<HTMLButtonElement>('#interaction-hub button:not(:disabled)')?.focus({ preventScroll: true });
    };
    world.onCaught = () => doAction('caught');
    world.onTick = dt => {
      if (!game || screen !== 'play') return;
      const before = game.phase;
      tick(game, dt);
      const second = Math.floor(game.elapsed);
      if (second !== lastStatusSecond) { updateHud(); refreshTimedEvent(); lastStatusSecond = second; }
      if (game.phase !== before) { say(game.history.at(-1) || '课堂状态发生变化。', game.phase === 'chase' ? 'danger' : 'quiet'); renderEvent(); save(); }
      if (second !== lastSaveSecond && second % 10 === 0) { save(); lastSaveSecond = second; }
    };
    bindJoystick();
    await world.load(game.room);
    if (generation !== gameGeneration) return;
    world.resize(); world.start(game);
  } catch (error) {
    const node = document.querySelector('#scene-status');
    if (node) { node.textContent = `无法启动 3D：${error instanceof Error ? error.message : String(error)}`; (node as HTMLElement).hidden = false; }
  }
}

function doAction(action: string) {
  if (!game) return;
  const oldRoom = game.room;
  const result = act(game, action);
  say(result.message, result.tone);
  if (game.room !== oldRoom && world) {
    game.position = world.spawn(game.room);
    void world.load(game.room).then(() => world?.resize());
  }
  updateHud(); renderEvent(); save();
}
function switchView() {
  if (!game || game.switchRemaining > 0) return;
  doAction('switch-view');
}
function details(id: string) {
  const entry = EVENT_DETAILS[id as keyof typeof EVENT_DETAILS];
  return entry;
}
function updateHud() {
  if (!game || screen !== 'play') return;
  const set = (id: string, text: string) => { const node = document.getElementById(id); if (node && node.textContent !== text) node.textContent = text; };
  set('chapter-label', `${MODE_NAMES[game.mode]} · 第 ${game.chapter} 章 / 第 ${game.day} 天 · ${game.name}`);
  set('room-label', `${ROOM_NAMES[game.room]} / ${game.seat.id} · ${ROLE_NAMES[game.role]}`);
  set('objective-title', details(game.currentEvent)?.label || game.currentEvent);
  set('status-0', game.completion >= 100 ? '已达标' : game.completion >= 75 ? '接近' : game.completion >= 25 ? '进行中' : '待完成');
  set('status-1', getStatusTier(game.suspicion)); set('status-2', getStatusTier(game.pressure));
  set('view-label', game.switchRemaining > 0 ? '切换中 · 无法移动' : game.phase === 'chase' ? `追逐 · 前往${ROOM_NAMES[game.chase!.goalRoom]}` : `${game.view === 'map' ? '斜俯视地图' : '第一人称'} · ${Math.ceil(game.eventRemaining)} 秒`);
  set('completion-label', `${Math.round(game.completion)}%`);
  const completionFill = document.getElementById('completion-meter-fill');
  if (completionFill) completionFill.style.width = `${Math.max(0, Math.min(100, game.completion))}%`;
  const switchButton = document.querySelector<HTMLButtonElement>('[data-action=view]');
  if (switchButton) { switchButton.textContent = game.view === 'map' ? '3D' : '2D'; switchButton.disabled = game.switchRemaining > 0; switchButton.setAttribute('aria-label', `切换到${game.view === 'map' ? '第一人称' : '斜俯视地图'}`); }
  const panelButton = document.querySelector<HTMLButtonElement>('[data-action=panel]');
  panelButton?.setAttribute('aria-expanded', String(panelOpen));
  document.querySelector('#game-shell')?.classList.toggle('is-first-person', game.view === 'first-person');
  document.querySelector('#game-shell')?.classList.toggle('is-chase', game.phase === 'chase');
  for (let i = 1; i <= 2; i++) document.getElementById(`status-${i}`)?.parentElement?.setAttribute('data-tier', String(Math.min(3, Math.floor((i === 1 ? game.suspicion : game.pressure) / 25))));
}
function contextualActionPool(): GameAction[] {
  if (!game) return [];
  return getActions(game).filter(action => !action.id.startsWith('event:') && !action.id.startsWith('go:') && action.id !== 'switch-view');
}
function getContextualActions(prompt: InteractionPrompt): GameAction[] {
  const actions = contextualActionPool();
  if (!prompt.actionIds.length) return [];
  return prompt.actionIds.map(id => actions.find(action => action.id === id)).filter((action): action is GameAction => Boolean(action));
}
function renderInteractionHub() {
  const hub = document.querySelector<HTMLElement>('#interaction-hub');
  if (!hub || !game) return;
  if (game.phase === 'ending') { hub.hidden = true; return; }
  hub.hidden = false;
  const actions = activePrompt ? getContextualActions(activePrompt) : [];
  const routes = getActions(game).filter(action => action.id.startsWith('go:') && !action.disabled);
  const title = activePrompt ? activePrompt.label : '场景交互';
  const hint = activePrompt ? activePrompt.hint : '靠近场景标记后按 E；也可以点击此处选择当前目标的行动。';
  hub.replaceChildren(
    element('div', { class: 'interaction-kicker', text: activePrompt ? '附近目标 / NEARBY' : '交互系统 / CONTEXT' }),
    element('div', { class: 'interaction-title', text: title }),
    element('p', { class: 'interaction-hint', text: hint }),
    actions.length ? element('div', { class: 'interaction-actions' }, actions.slice(0, 4).map(action => {
      const node = button(action.label, () => doAction(action.id), `interaction-action ${action.disabled ? 'is-disabled' : ''}`, action.id);
      node.disabled = Boolean(action.disabled);
      return node;
    })) : element('p', { class: 'interaction-empty', text: activePrompt ? '当前目标暂时没有可执行行动；先完成事件面板中的前置目标。' : '移动到金色场景标记附近开始调查。' }),
    routes.length ? element('div', { class: 'interaction-routes' }, [element('span', { text: '前往' }), ...routes.map(action => button(action.label, () => doAction(action.id), 'route-action', action.id))]) : element('span'),
  );
}
function renderEvent() {
  if (!game || screen !== 'play') return;
  const g = game;
  const rail = document.querySelector('#event-rail');
  rail?.replaceChildren(...g.events.map((id, index) => {
    const item = button(`${String(index + 1).padStart(2, '0')} · ${details(id)?.label || id}`, () => doAction(`event:${id}`), `event-chip ${g.currentEvent === id ? 'active' : ''} ${g.results[id]}`);
    item.disabled = g.phase !== 'playing';
    return item;
  }));
  const panel = document.querySelector<HTMLElement>('#event-drawer');
  if (!panel) return;
  if (g.phase === 'ending') {
    world?.stop();
    panelOpen = true;
    panel.replaceChildren(element('div', { class: 'section-kicker', text: '结局 / FINAL RECORD' }), element('h3', { text: OUTCOME_LABELS[g.outcome || 'bad'] }),
      element('p', { text: endingText(g.outcome) }),
      button('返回主菜单', showMenu, 'primary-button', 'home'));
  } else if (g.phase === 'between') {
    panelOpen = true;
    panel.replaceChildren(element('div', { class: 'section-kicker', text: '课表已结算' }), element('h3', { text: `第 ${g.chapter} 章结束` }),
      element('p', { text: '记录已保存。下一天会恢复职务协作次数，难度与座位保持不变。' }),
      button('继续下一章', () => { advance(g); updateHud(); renderEvent(); save(); if (world) { g.position = { x: 0, z: -1.55 + (g.seat.row - 1 + (g.seat.row > 3 ? 1 : 0)) * .8 + .45 }; void world.load(g.room); world.start(g); } }, 'primary-button', 'advance'));
  } else {
    const objectives = getObjectives(g);
    panel.replaceChildren(element('div', { class: 'drawer-rule' }),
      element('div', { class: 'event-heading' }, [element('div', { class: 'event-title-wrap' }, [element('span', { class: 'event-index', text: `事件 ${String(g.events.indexOf(g.currentEvent) + 1).padStart(2, '0')} / ${String(g.events.length).padStart(2, '0')}` }), element('h3', { text: details(g.currentEvent)?.label || g.currentEvent })]), button('收起', () => { panelOpen = false; panel.hidden = true; updateHud(); }, 'text-button')]),
      element('ul', { class: 'objectives' }, objectives.map(text => element('li', { text }))),
      element('p', { class: 'event-summary', text: `今日协作剩余 ${g.roleUses} 次；靠近场景目标后，使用下方交互卡片完成调查。` }));
  }
  panel.hidden = !panelOpen;
  renderInteractionHub();
}
function refreshTimedEvent() {
  if (!game || !['playing', 'chase'].includes(game.phase)) return;
  const list = document.querySelector('.objectives');
  list?.replaceChildren(...getObjectives(game).map(text => element('li', { text })));
  renderInteractionHub();
}

function endingText(outcome: GameState['outcome']) {
  return { perfect: '铃声终于停了。目标全部完成，怀疑与压力都没有越过警戒。你带走了自己的作业本。', ordinary: '你安全走出了教学楼。有些课堂失误留在了记录中，但这一天结束了。', bad: '作业本留在了讲台上。怀疑或压力抵达极限，今天没能安全离开。', terror: '雨声里，有人叫了你的名字。你没有在追逐结束前找到出口。' }[outcome || 'bad'];
}
function bindJoystick() {
  const stick = document.querySelector<HTMLElement>('#joystick');
  if (!stick) return;
  const knob = stick.querySelector<HTMLElement>('.stick-knob')!;
  let pointer: number | null = null;
  const move = (e: PointerEvent) => {
    if (pointer !== e.pointerId || !world) return;
    const rect = stick.getBoundingClientRect();
    let x = (e.clientX - rect.left - rect.width / 2) / 28, z = (e.clientY - rect.top - rect.height / 2) / 28;
    const size = Math.hypot(x, z); if (size > 1) { x /= size; z /= size; }
    world.input.x = x; world.input.z = z;
    knob.style.transform = `translate(${x * 23}px, ${z * 23}px)`;
  };
  stick.onpointerdown = e => { e.preventDefault(); pointer = e.pointerId; stick.setPointerCapture(e.pointerId); move(e); };
  stick.onpointermove = move;
  const reset = () => { pointer = null; if (world) world.input.x = world.input.z = 0; knob.style.transform = ''; };
  stick.onpointerup = reset; stick.onpointercancel = reset; stick.onlostpointercapture = reset;
}
function dialog(title: string, children: Node[]) {
  world?.stop(); audio.pause();
  const node = element('dialog', { class: 'settings-dialog' }, [element('h2', { text: title }), ...children]);
  const close = () => node.close();
  node.append(button('关闭', close, 'primary-button'));
  node.onclose = () => { node.remove(); if (game && screen === 'play') { world?.start(game); audio.resume(); } };
  app.append(node); node.showModal();
}
function openSettings() {
  const qualitySelect = element('select', { 'aria-label': '画质', onchange: (e: Event) => { quality = (e.target as HTMLSelectElement).value as Quality; settingsSave(); void world?.setQuality(quality); } },
    [['auto', '自动'], ['high', '高 · 桌面精细'], ['medium', '中 · 移动标准'], ['low', '低 · 优先帧率']].map(([value, label]) => element('option', { value, text: label, selected: quality === value })));
  const voice = element('input', { type: 'checkbox', checked: audio.speech, onchange: (e: Event) => { audio.speech = (e.target as HTMLInputElement).checked; settingsSave(); if (!audio.speech && 'speechSynthesis' in window) speechSynthesis.cancel(); } });
  const sound = element('input', { type: 'checkbox', checked: audio.sound, onchange: (e: Event) => { audio.setSound((e.target as HTMLInputElement).checked); settingsSave(); } });
  dialog('设置', [element('label', { class: 'settings-row' }, ['画质', qualitySelect]), element('label', { class: 'settings-row' }, ['台词配音（默认关闭）', voice]), element('label', { class: 'settings-row' }, ['环境声音', sound]),
    element('p', { text: '不同设备的中文语音由系统提供；缺少中文声线时请安装系统中文语音包。设置期间游戏暂停。' }),
    button('重新载入场景', () => { if (game) { document.querySelector<HTMLDialogElement>('dialog')?.close(); void enterPlay(); } }, 'secondary-button'),
    button('保存并返回菜单', () => { document.querySelector<HTMLDialogElement>('dialog')?.close(); showMenu(); }, 'text-button')]);
}
function openJournal() {
  if (!game) return;
  dialog('课堂记录', [element('ol', { class: 'journal' }, game.history.slice(-40).map(text => element('li', { text }))),
    element('p', { text: '操作：WASD / 左侧摇杆移动，拖动画面转向，E / 交互按钮调查。俯视点击地面移动，走近金色门标记后交互。' })]);
}
function openHelp() {
  dialog('操作指南', [
    element('div', { class: 'shortcut-grid' }, [
      element('span', { text: '移动' }), element('strong', { text: 'WASD / 方向键' }),
      element('span', { text: '视角' }), element('strong', { text: 'V 或顶部按钮' }),
      element('span', { text: '交互' }), element('strong', { text: 'E / 交互按钮' }),
      element('span', { text: '事件面板' }), element('strong', { text: 'I / 事件按钮' }),
      element('span', { text: '地图移动' }), element('strong', { text: '俯视图点击地面' }),
    ]),
    element('p', { text: '接近金色门标记后交互即可进入相邻房间。追逐阶段必须实际走到目标房间，不能用事件面板跳转。' }),
  ]);
}
async function fullScreen() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else say('此浏览器不支持网页全屏；可横屏游玩或添加到主屏幕。'); }
  catch { say('浏览器未允许全屏，请直接横屏游玩。'); }
}
window.addEventListener('pagehide', () => { save(); world?.stop(); audio.pause(); });
window.addEventListener('pageshow', () => { if (game && screen === 'play') world?.start(game); });
window.addEventListener('keydown', event => {
  if (screen !== 'play' || event.repeat || (event.target as HTMLElement).closest('input,select,textarea,dialog')) return;
  if (event.code === 'KeyI') {
    panelOpen = !panelOpen;
    const panel = document.querySelector<HTMLElement>('#event-drawer');
    if (panel) panel.hidden = !panelOpen;
    updateHud();
  }
});
Object.defineProperty(window, '__lifrp', { value: {
  metrics: () => world?.metrics() || { loaded: false, webgl: null },
  snapshot: () => game ? JSON.parse(JSON.stringify(game)) : null,
  resetMetrics: () => world?.monitor.reset(),
}, configurable: false });
showMenu();
