import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { DIFFICULTY_CONFIG, pickDifficulty, adjustProbability } from './simulation/difficulty.js';
import { generateBackSeatCandidates, generateFrontSeatSelection, adjustFrontSeat } from './simulation/seats.js';
import { getDistractionChance, getRoleLabel, getRoleUses } from './simulation/roles.js';
import { getInitialUnlocks, getUnlocksAfterChapter } from './simulation/modes.js';
import { clampState, getStatusTier, resolveOutcome, OUTCOME_LABELS } from './simulation/outcomes.js';
import { loadGameState, saveGameState } from './simulation/save.js';
import { applyFailurePolicy, getEventDefinition, getResearchPromptAttempts, getSnackTargetCount } from './events/eventRules.js';
import './ui/styles.css';

const EVENT_ORDER = [
  'homework-correction',
  'snacking',
  'research-question',
  'untaught-topic',
  'copying-suspicion',
  'milk-tea',
  'rain',
  'holiday-homework',
];

const EVENT_DETAILS = {
  'homework-correction': {
    label: '订正作业',
    icon: '⌁',
    text: '课前从作业本里找出被标记的错题，完成订正再交出去。',
    location: '教室 · 课前',
  },
  snacking: {
    label: '上课偷吃',
    icon: '◌',
    text: '观察李方玲的巡视节奏，在视线空档里分多次完成偷吃。',
    location: '教室 · 上课',
  },
  'research-question': {
    label: '研究性问题',
    icon: '?',
    text: '后三排可能被点名。小声提示不可靠，要把线索和推理拼起来。',
    location: '教室 · 后三排',
  },
  'untaught-topic': {
    label: '没讲过的知识点',
    icon: '∴',
    text: '先从板书、课本和同学反应取证，再用多轮礼貌表达请求澄清。',
    location: '教室 · 黑板前',
  },
  'copying-suspicion': {
    label: '抄作业怀疑',
    icon: '≋',
    text: '保留解题痕迹、解释、同学证词和答案差异，拼出完整证据链。',
    location: '教室 · 课间',
  },
  'milk-tea': {
    label: '避免请奶茶',
    icon: '◒',
    text: '判断她到底是不是认真的。她说“受着”之后，先转移她的注意力。',
    location: '走廊 · 课间',
  },
  rain: {
    label: '阻止求雨',
    icon: '⌇',
    text: '调查教室、办公室和同学证词，找到一条能阻止求雨的路线。',
    location: '教室 · 办公室 · 走廊',
  },
  'holiday-homework': {
    label: '假期巨量作业',
    icon: '▦',
    text: '追踪缺页和批注，安排每日作业量与休息，不让压力越过危险线。',
    location: '假期 · 作业桌',
  },
};

const CHAPTER_EVENTS = {
  1: ['homework-correction', 'snacking'],
  2: ['research-question', 'untaught-topic'],
  3: ['copying-suspicion', 'milk-tea'],
  4: ['rain'],
  5: ['holiday-homework'],
};

const MODES = {
  day: { label: '一天生存', description: '在一节课与课间里完成当天目标，安全离开教学楼。' },
  chapters: { label: '多天章节', description: '沿五章多节点主线，逐步解锁李方玲课堂里的异常。' },
  challenge: { label: '随机挑战', description: '从已解锁事件池抽取一组事件，难度始终隐藏。' },
};

const initialUnlocks = getInitialUnlocks();
const app = document.querySelector('#app');
const loader = new GLTFLoader();
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const state = {
  screen: 'menu',
  view: 'map',
  mode: 'chapters',
  playerName: '',
  difficulty: 'normal',
  role: 'student',
  region: 'front',
  seat: null,
  seatSelection: null,
  day: 1,
  chapter: 1,
  currentEvent: 'homework-correction',
  activeEvents: [...initialUnlocks.events],
  unlockedEvents: [...initialUnlocks.events],
  eventStates: {},
  completion: 0,
  suspicion: 12,
  pressure: 18,
  roleUsesRemaining: 1,
  terrorRouteFailed: false,
  switchUntil: 0,
  voiceEnabled: false,
  quality: 'auto',
  notes: [],
  sceneReady: false,
  webglUnavailable: false,
  lastMessage: '先选一个位置，再决定今天要承担什么。',
};

const runtime = {
  renderer: null,
  scene: null,
  perspectiveCamera: null,
  mapCamera: null,
  camera: null,
  world: null,
  player: null,
  yaw: 0,
  pitch: 0,
  keys: new Set(),
  touch: { x: 0, y: 0, active: false },
  lookTouch: { x: 0, y: 0, active: false },
  mapMarkers: [],
  clockHandle: 0,
  rain: null,
  ambience: null,
  eventsRoot: null,
  listenersBound: false,
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function announce(message, tone = 'neutral') {
  state.lastMessage = message;
  const toast = document.querySelector('#toast');
  if (toast) {
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.remove('show');
    requestAnimationFrame(() => toast.classList.add('show'));
  }
  if (state.voiceEnabled) speak(message, tone === 'danger' ? 'teacher' : 'student');
}

function speak(text, role = 'student') {
  if (!state.voiceEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = role === 'teacher' ? 0.88 : 1;
  utterance.pitch = role === 'teacher' ? 0.72 : 1.02;
  window.speechSynthesis.speak(utterance);
}

function currentEvents() {
  if (state.mode === 'chapters') return CHAPTER_EVENTS[state.chapter] || EVENT_ORDER.slice(0, 2);
  if (state.mode === 'day') return state.activeEvents;
  return state.activeEvents;
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

function setScreen(screen) {
  state.screen = screen;
  renderApp();
}

function newStateFromSave(saved) {
  if (!saved) return;
  Object.assign(state, saved, { screen: 'play' });
  state.notes = Array.isArray(saved.notes) ? saved.notes : [];
  if (!state.seat) assignSeat(state.region, true);
  announce('已恢复上次留下的课堂记录。', 'quiet');
}

function saveNow() {
  if (state.screen !== 'play') return;
  const serializable = { ...state, screen: 'play', sceneReady: false };
  saveGameState(serializable, window.localStorage);
}

function chooseMode(mode) {
  if (mode === 'challenge' && !getUnlocksAfterChapter(state.chapter - 1).challenge) {
    announce('随机挑战还没有开放。先完成第一章。', 'warning');
    return;
  }
  state.mode = mode;
  state.chapter = mode === 'chapters' ? Math.max(1, state.chapter) : 1;
  state.activeEvents = mode === 'challenge'
    ? shuffle([...state.unlockedEvents]).slice(0, Math.min(4, state.unlockedEvents.length))
    : state.unlockedEvents.slice(0, Math.min(mode === 'day' ? 3 : 2, state.unlockedEvents.length));
  state.currentEvent = currentEvents()[0] || 'homework-correction';
  state.eventStates = {};
  state.completion = 0;
  state.suspicion = 12;
  state.pressure = 18;
  state.terrorRouteFailed = false;
  state.notes = [];
  renderApp();
}

function pickDifficultyForRun() {
  state.difficulty = pickDifficulty();
  state.switchUntil = 0;
}

function startGame() {
  const saved = loadGameState(window.localStorage, 'chapters');
  if (saved && !document.querySelector('#player-name')?.value.trim() && saved.mode === 'chapters') {
    Object.assign(state, saved, { screen: 'play' });
    state.activeEvents = Array.isArray(saved.activeEvents) && saved.activeEvents.length ? saved.activeEvents : (CHAPTER_EVENTS[state.chapter] || state.unlockedEvents.slice(0, 2));
    announce('已恢复上次留下的课堂记录。', 'quiet');
    renderApp();
    setTimeout(() => focusPlayfield(), 50);
    return;
  }
  state.playerName = document.querySelector('#player-name')?.value.trim() || '无名同学';
  state.region = document.querySelector('input[name="region"]:checked')?.value || 'front';
  state.role = document.querySelector('#role-select')?.value || 'student';
  pickDifficultyForRun();
  state.unlockedEvents = getUnlocksAfterChapter(state.chapter - 1).events;
  state.activeEvents = state.mode === 'challenge'
    ? shuffle([...state.unlockedEvents]).slice(0, Math.min(4, state.unlockedEvents.length))
    : state.mode === 'day'
      ? state.unlockedEvents.slice(0, 3)
      : CHAPTER_EVENTS[state.chapter] || state.unlockedEvents.slice(0, 2);
  state.currentEvent = currentEvents()[0] || 'homework-correction';
  state.eventStates = {};
  state.completion = 0;
  state.suspicion = state.region === 'back' ? 24 : 12;
  state.pressure = state.difficulty === 'terror' ? 32 : 18;
  state.roleUsesRemaining = getRoleUses(state.role);
  state.notes = [];
  assignSeat(state.region);
  state.screen = 'seat-select';
  announce('课前铃还没有响。先确认自己的位置。', 'quiet');
  renderApp();
}

function assignSeat(region, restore = false) {
  if (region === 'front') {
    const selection = generateFrontSeatSelection();
    state.seatSelection = selection;
    state.seat = selection.assigned;
  } else {
    const selection = generateBackSeatCandidates(state.difficulty);
    state.seatSelection = selection;
    state.seat = selection.candidates[0];
    if (!restore) state.notes.push('后三排候选已经出现。名字都没有解释。');
  }
}

function applySeat(seat) {
  state.seat = seat;
  if (seat.special === 'attention') state.suspicion = clampState(state.suspicion + 12);
  if (seat.special === 'anomaly') state.pressure = clampState(state.pressure + 12);
  if (seat.special === 'immune') announce('这个位置没有任何负面效果能碰到你，但目标仍然要自己完成。', 'quiet');
  state.notes.push(`已选择座位 ${seat.id}`);
  state.screen = 'play';
  saveNow();
  renderApp();
  setTimeout(() => focusPlayfield(), 50);
}

function switchView() {
  if (Date.now() < state.switchUntil) return;
  state.switchUntil = Date.now() + DIFFICULTY_CONFIG[state.difficulty].switchSeconds * 1000;
  const target = state.view === 'map' ? 'first-person' : 'map';
  state.view = target;
  announce(target === 'map' ? '视线拉高。座位与走廊的关系重新显出来。' : '视线落回眼前。你听见了远处的脚步。', 'quiet');
  updateCamera();
  renderHudOnly();
}

function openEvent(eventId) {
  if (!state.unlockedEvents.includes(eventId) && state.mode !== 'chapters') {
    announce('这项记录还没有出现在你的课表里。', 'warning');
    return;
  }
  state.currentEvent = eventId;
  renderApp();
}

function markEventSuccess(eventId, message = '这一项暂时处理好了。') {
  state.eventStates[eventId] = 'success';
  state.completion = Math.min(100, Math.round((Object.values(state.eventStates).filter((value) => value === 'success').length / currentEvents().length) * 100));
  state.pressure = clampState(state.pressure - 4);
  announce(message, 'success');
  saveNow();
  renderApp();
  completeChapterIfReady();
}

function failEvent(eventId, message = '这项事情没有按计划结束。') {
  state.eventStates[eventId] = 'failed';
  const penalty = applyFailurePolicy(state.difficulty);
  if (state.seat?.special !== 'immune') {
    state.suspicion = clampState(state.suspicion + penalty.suspicion);
    state.pressure = clampState(state.pressure + penalty.pressure);
  }
  if (penalty.chase) state.terrorRouteFailed = true;
  announce(message, state.difficulty === 'terror' ? 'danger' : 'warning');
  saveNow();
  renderApp();
}

function actionResult(ok, successMessage, failureMessage, eventId = state.currentEvent) {
  if (ok) markEventSuccess(eventId, successMessage);
  else failEvent(eventId, failureMessage);
}

function runEventAction(action) {
  const id = state.currentEvent;
  if (id === 'homework-correction') {
    const options = ['检查红笔批注', '翻到最后一页', '对照同学答案'];
    const current = Number(state.eventStates['homework-step'] || 0);
    if (action === 'inspect') {
      state.eventStates['homework-step'] = current + 1;
      state.notes.push(current === 0 ? '红笔批注藏在第二道题旁边。' : '最后一页有一道被圈起的研究题。');
      announce(current === 0 ? '批注藏在第二道题旁边。' : '最后一页有一道被圈起的研究题。', 'quiet');
    } else if (action === 'correct') {
      if (current >= 2) markEventSuccess(id, '订正完成。李方玲把作业本收走了。');
      else failEvent(id, '你没有找全被标记的错题，作业本被扣下。');
    } else if (options.length) {
      state.eventStates['homework-step'] = current + 1;
      announce('你又翻了一页。', 'quiet');
    }
    renderApp();
    return;
  }

  if (id === 'snacking') {
    if (action === 'snack') {
      const eaten = Number(state.eventStates['snack-count'] || 0) + 1;
      const base = state.role === 'monitor' ? 0.8 : state.role === 'chemistry-rep' ? 0.6 : 0.4;
      const safe = Math.random() < adjustProbability(base, state.difficulty);
      if (!safe && state.seat?.special !== 'immune') state.suspicion = clampState(state.suspicion + 9);
      state.eventStates['snack-count'] = eaten;
      if (eaten >= getSnackTargetCount(state.difficulty)) markEventSuccess(id, '最后一口咽下去了。李方玲的粉笔声盖住了包装袋。');
      else announce(safe ? `安全窗口成立。已完成 ${eaten}/${getSnackTargetCount(state.difficulty)} 次。` : `视线扫过来了。已完成 ${eaten}/${getSnackTargetCount(state.difficulty)} 次，怀疑度上升。`, safe ? 'success' : 'warning');
    } else if (action === 'distract') {
      if (state.roleUsesRemaining <= 0) announce('今天能请求的协作已经用完了。', 'warning');
      else {
        state.roleUsesRemaining -= 1;
        const success = Math.random() < getDistractionChance(state.role, state.difficulty);
        if (state.seat?.special !== 'immune') state.suspicion = clampState(state.suspicion + 4);
        announce(success ? '同学把话题接走了，窗口短暂打开。' : '干扰太明显了，李方玲看了过来。', success ? 'success' : 'warning');
      }
    }
    saveNow();
    renderApp();
    return;
  }

  if (id === 'research-question') {
    const attempts = Number(state.eventStates['research-attempts'] || 0);
    const prompts = Number(state.eventStates['research-prompts'] || 0);
    if (action === 'listen') {
      if (prompts >= getResearchPromptAttempts(state.difficulty)) announce('没有更多小声提示了。你只能靠自己的推理。', 'warning');
      else {
        state.eventStates['research-prompts'] = prompts + 1;
        const heard = Math.random() < 0.05;
        const stopped = Math.random() < 0.5;
        announce(stopped ? '李方玲敲了敲讲台：“不要转身。”' : heard ? '你听清了一个关键词。' : '耳语贴着桌面过去，没有听清。', stopped ? 'danger' : heard ? 'success' : 'quiet');
      }
    } else if (action === 'answer') {
      const heardByTeacher = Math.random() >= 0.65;
      if (!heardByTeacher) announce('后三排的回答没有传到讲台。你需要重复。', 'warning');
      else if (Math.random() < 0.58) markEventSuccess(id, '李方玲听见了你的回答，课堂暂时安静下来。');
      else if (attempts + 1 >= 2) failEvent(id, '这次她听清了，但答案还是错的。');
      else announce('她听清了，但答案不对。你还有一次机会。', 'warning');
      state.eventStates['research-attempts'] = attempts + 1;
    } else if (action === 'reason') {
      const success = prompts > 0 || Math.random() < 0.42;
      actionResult(success, '你把课堂线索拼成了一个能站得住的答案。', '推理缺了一块，李方玲开始追问。', id);
    }
    saveNow();
    renderApp();
    return;
  }

  if (id === 'untaught-topic') {
    const evidence = Number(state.eventStates['topic-evidence'] || 0);
    if (action === 'evidence') {
      state.eventStates['topic-evidence'] = Math.min(3, evidence + 1);
      announce(['板书上没有这个式子。', '课本页码对不上。', '同学也在摇头。'][evidence] || '证据已经够了。', 'quiet');
    } else if (action === 'speak') {
      const rounds = Number(state.eventStates['topic-rounds'] || 0);
      if (evidence >= 2 && rounds >= 1) markEventSuccess(id, '你把事实、请求澄清和愿意学习说完整了。');
      else {
        state.eventStates['topic-rounds'] = rounds + 1;
        state.pressure = clampState(state.pressure + 7);
        announce(rounds === 0 ? '“老师，我想确认一下，这个知识点我们之前讲过吗？”' : '“如果已经讲过，能不能请您指出对应页码？”', 'quiet');
      }
    }
    saveNow();
    renderApp();
    return;
  }

  if (id === 'copying-suspicion') {
    const evidence = new Set((state.eventStates['copy-evidence'] || '').split('|').filter(Boolean));
    if (action.startsWith('evidence:')) evidence.add(action.slice(8));
    state.eventStates['copy-evidence'] = [...evidence].join('|');
    if (evidence.size >= 4) markEventSuccess(id, '四条证据彼此对得上，李方玲没有继续追问。');
    else announce(`证据链 ${evidence.size}/4：还缺一块能让解释站住的东西。`, 'quiet');
    saveNow();
    renderApp();
    return;
  }

  if (id === 'milk-tea') {
    if (action === 'evidence') {
      const evidence = Number(state.eventStates['tea-evidence'] || 0) + 1;
      state.eventStates['tea-evidence'] = Math.min(2, evidence);
      announce(evidence === 1 ? '同学说她已经点过一次了。' : '她把“受着”说得很慢，像是在等你答应。', 'quiet');
    } else if (action === 'divert') {
      const evidence = Number(state.eventStates['tea-evidence'] || 0);
      const success = evidence >= 1 && Math.random() < adjustProbability(0.7, state.difficulty);
      actionResult(success, '她被办公室门口的动静带走了注意力，忘了奶茶。', '她想起来了。走廊尽头传来脚步声。', id);
    } else if (action === 'route') {
      const success = Math.random() < adjustProbability(0.58, state.difficulty);
      actionResult(success, '你沿着办公室外侧绕开了送奶茶的路线。', '你在拐角被叫住了。', id);
    }
    saveNow();
    renderApp();
    return;
  }

  if (id === 'rain') {
    const evidence = new Set((state.eventStates['rain-evidence'] || '').split('|').filter(Boolean));
    if (action.startsWith('evidence:')) {
      evidence.add(action.slice(8));
      state.eventStates['rain-evidence'] = [...evidence].join('|');
      announce(`求雨调查证据 ${evidence.size}/3 已记录。`, 'quiet');
    } else if (action.startsWith('intervene:')) {
      const success = evidence.size >= 1 && Math.random() < adjustProbability(0.76, state.difficulty);
      actionResult(success, '你抓住了证据之间的缝隙，求雨安排被迫暂停。', state.difficulty === 'terror' ? '雨声突然贴近，走廊尽头亮起了不该亮的灯。' : '你没有及时说服任何人，体育课的铃声被雨声盖住了。', id);
    }
    saveNow();
    renderApp();
    return;
  }

  if (id === 'holiday-homework') {
    const pages = Number(state.eventStates['holiday-pages'] || 0);
    if (action === 'track') {
      state.eventStates['holiday-pages'] = Math.min(5, pages + 1);
      announce(`找到第 ${Math.min(5, pages + 1)} 组作业线索。`, 'quiet');
    } else if (action === 'study') {
      state.eventStates['holiday-pages'] = Math.min(5, pages + 1);
      state.pressure = clampState(state.pressure + 9);
      announce('题目完成了，但眼睛开始发酸。', 'warning');
    } else if (action === 'rest') {
      state.pressure = clampState(state.pressure - 13);
      announce('你把笔放下，听了一会儿窗外的风。', 'success');
    } else if (action === 'submit') {
      actionResult(pages >= 5 && state.pressure < 100, '最后一页也订正完了。假期没有留下空白。', '还有题目或缺页没有处理完。', id);
    }
    saveNow();
    renderApp();
  }
}

function completeChapterIfReady() {
  const events = currentEvents();
  if (state.mode !== 'chapters' || !events.every((eventId) => state.eventStates[eventId] === 'success')) return;
  if (state.chapter < 5) {
    const chapter = state.chapter;
    state.chapter += 1;
    state.unlockedEvents = getUnlocksAfterChapter(state.chapter - 1).events;
    state.currentEvent = CHAPTER_EVENTS[state.chapter]?.[0] || 'holiday-homework';
    state.completion = 0;
    announce(`第 ${chapter} 章结束。下一天的课表已经压在桌角。`, 'success');
    saveNow();
    renderApp();
  } else {
    const outcome = resolveOutcome({
      eventGoalMet: true,
      suspicion: state.suspicion,
      pressure: state.pressure,
      difficulty: state.difficulty,
      terrorRouteFailed: state.terrorRouteFailed,
    });
    state.outcome = outcome;
    state.screen = 'ending';
    renderApp();
  }
}

function setupScene() {
  const canvas = document.querySelector('#game-canvas');
  if (!canvas) return;
  if (state.webglUnavailable) {
    showWebGLFallback(canvas);
    return;
  }
  if (runtime.renderer && runtime.renderer.domElement === canvas) return;
  if (runtime.renderer && runtime.renderer.domElement !== canvas) {
    runtime.renderer.dispose();
    runtime.renderer = null;
  }
  if (!supportsWebGL(canvas)) {
    state.webglUnavailable = true;
    showWebGLFallback(canvas);
    return;
  }
  try {
    runtime.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch {
    state.webglUnavailable = true;
    showWebGLFallback(canvas);
    return;
  }
  runtime.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  runtime.renderer.shadowMap.enabled = true;
  runtime.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  runtime.renderer.outputColorSpace = THREE.SRGBColorSpace;
  runtime.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  runtime.renderer.toneMappingExposure = 0.9;

  runtime.scene = new THREE.Scene();
  runtime.scene.background = new THREE.Color(0x090d12);
  runtime.scene.fog = new THREE.FogExp2(0x151b22, 0.018);
  runtime.scene.add(new THREE.HemisphereLight(0x8795a3, 0x161116, 1.45));
  const moon = new THREE.DirectionalLight(0x9da9ba, 2.2);
  moon.position.set(-6, 11, 4);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  runtime.scene.add(moon);
  const warm = new THREE.PointLight(0xb87854, 14, 9, 2);
  warm.position.set(0, 2.9, 1.2);
  runtime.scene.add(warm);

  runtime.perspectiveCamera = new THREE.PerspectiveCamera(65, 1, 0.1, 100);
  runtime.perspectiveCamera.position.set(0, 1.65, 5.8);
  runtime.mapCamera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 100);
  runtime.mapCamera.position.set(0, 11, 8);
  runtime.mapCamera.lookAt(0, 0, 0);
  runtime.camera = runtime.mapCamera;

  runtime.eventsRoot = new THREE.Group();
  runtime.scene.add(runtime.eventsRoot);
  addAtmosphere();
  loadSchoolScene();
  if (!runtime.listenersBound) {
    window.addEventListener('resize', resizeRenderer);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', (event) => runtime.keys.delete(event.code));
    window.addEventListener('pointermove', onPointerMove);
    runtime.listenersBound = true;
  }
  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  requestAnimationFrame(renderLoop);
}

function supportsWebGL(canvas) {
  try {
    const context = canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    return Boolean(context);
  } catch {
    return false;
  }
}

function showWebGLFallback(canvas) {
  canvas.classList.add('webgl-fallback-canvas');
  const sceneLayer = canvas.closest('.scene-layer');
  if (!sceneLayer || sceneLayer.querySelector('.scene-fallback')) return;
  sceneLayer.append(el('div', { class: 'scene-fallback' }, [
    el('div', { class: 'fallback-grid' }),
    el('div', { class: 'fallback-copy' }, [
      el('span', { class: 'section-kicker', text: '低图形模式' }),
      el('strong', { text: '地图与事件仍可继续' }),
      el('span', { text: '当前浏览器没有可用 WebGL，已保留课堂路线、座位与全部解谜操作。' }),
    ]),
  ]));
}

function addAtmosphere() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    new THREE.MeshStandardMaterial({ color: 0x131820, roughness: 0.92, metalness: 0.03 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.05;
  floor.receiveShadow = true;
  runtime.scene.add(floor);
  const haze = new THREE.Mesh(
    new THREE.CircleGeometry(8, 48),
    new THREE.MeshBasicMaterial({ color: 0x27313d, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  haze.rotation.x = -Math.PI / 2;
  haze.position.set(0, 0.01, 2);
  runtime.scene.add(haze);
}

function loadSchoolScene() {
  loader.load('/assets/models/optimized/school_scene.glb', (gltf) => {
    runtime.world = gltf.scene;
    runtime.world.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        if (object.material) {
          object.material.roughness = Math.max(object.material.roughness ?? 0.72, 0.68);
          object.material.envMapIntensity = 0.3;
        }
      }
    });
    runtime.world.position.set(0, 0, 6);
    runtime.scene.add(runtime.world);
    addInteractiveMarkers();
    state.sceneReady = true;
    renderHudOnly();
  }, undefined, () => {
    state.sceneReady = true;
    announce('场景资源没有完整载入，已切换到低模课堂空间。', 'warning');
  });
}

function addInteractiveMarkers() {
  const markers = [
    { id: 'blackboard', name: '黑板线索', position: [-1.8, 1.9, 1.3], color: 0x91b9bd },
    { id: 'office', name: '办公室方向', position: [6.8, 1.1, 11], color: 0xb67b64 },
    { id: 'corridor', name: '走廊脚步', position: [-5.3, 1.1, 8], color: 0x9b87ad },
    { id: 'desk', name: '作业本', position: [0.8, 0.9, 4.1], color: 0xd0a66b },
  ];
  runtime.mapMarkers = markers.map((marker) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 12),
      new THREE.MeshBasicMaterial({ color: marker.color, transparent: true, opacity: 0.88 }),
    );
    mesh.position.set(...marker.position);
    mesh.userData = marker;
    runtime.eventsRoot.add(mesh);
    return mesh;
  });
}

function onCanvasPointerDown(event) {
  if (state.view !== 'map' || !runtime.renderer || !runtime.camera) return;
  const rect = runtime.renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, runtime.camera);
  const hit = raycaster.intersectObjects(runtime.mapMarkers, false)[0];
  if (hit?.object.userData) {
    const marker = hit.object.userData;
    announce(`${marker.name}：切换到对应事件查看线索。`, 'quiet');
    if (marker.id === 'blackboard') openEvent('untaught-topic');
    if (marker.id === 'office') openEvent('rain');
    if (marker.id === 'desk') openEvent('homework-correction');
    if (marker.id === 'corridor') openEvent('milk-tea');
  }
}

function onKeyDown(event) {
  runtime.keys.add(event.code);
  if (event.code === 'KeyV' && state.screen === 'play') switchView();
  if (event.code === 'KeyE' && state.screen === 'play') {
    if (state.view === 'map') announce('点击地图上的发光点可以调查附近线索。', 'quiet');
    else announce('你伸手碰到了一张冷掉的讲义。', 'quiet');
  }
}

function updateCamera() {
  if (!runtime.perspectiveCamera || !runtime.mapCamera) return;
  runtime.camera = state.view === 'map' ? runtime.mapCamera : runtime.perspectiveCamera;
  document.querySelector('#game-shell')?.classList.toggle('is-map', state.view === 'map');
  document.querySelector('#game-shell')?.classList.toggle('is-first-person', state.view === 'first-person');
}

function updateMovement(delta) {
  if (state.view !== 'first-person' || !runtime.perspectiveCamera || Date.now() < state.switchUntil) return;
  const speed = 2.2 * delta;
  const forward = new THREE.Vector3(Math.sin(runtime.yaw), 0, Math.cos(runtime.yaw));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const move = new THREE.Vector3();
  if (runtime.keys.has('KeyW') || runtime.keys.has('ArrowUp')) move.add(forward);
  if (runtime.keys.has('KeyS') || runtime.keys.has('ArrowDown')) move.sub(forward);
  if (runtime.keys.has('KeyD') || runtime.keys.has('ArrowRight')) move.add(right);
  if (runtime.keys.has('KeyA') || runtime.keys.has('ArrowLeft')) move.sub(right);
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed);
    runtime.perspectiveCamera.position.add(move);
    runtime.perspectiveCamera.position.y = 1.65;
    runtime.perspectiveCamera.position.x = THREE.MathUtils.clamp(runtime.perspectiveCamera.position.x, -9, 9);
    runtime.perspectiveCamera.position.z = THREE.MathUtils.clamp(runtime.perspectiveCamera.position.z, -2, 25);
  }
  runtime.perspectiveCamera.rotation.order = 'YXZ';
  runtime.perspectiveCamera.rotation.y = runtime.yaw;
  runtime.perspectiveCamera.rotation.x = runtime.pitch;
}

function renderLoop() {
  const delta = Math.min(clock.getDelta(), 0.05);
  updateMovement(delta);
  if (runtime.rain) runtime.rain.rotation.y += delta * 0.08;
  if (runtime.renderer && runtime.scene && runtime.camera) runtime.renderer.render(runtime.scene, runtime.camera);
  runtime.clockHandle = requestAnimationFrame(renderLoop);
}

function resizeRenderer() {
  if (!runtime.renderer) return;
  const canvas = runtime.renderer.domElement;
  const width = canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight;
  runtime.renderer.setSize(width, height, false);
  if (runtime.perspectiveCamera) {
    runtime.perspectiveCamera.aspect = width / height;
    runtime.perspectiveCamera.updateProjectionMatrix();
  }
  if (runtime.mapCamera) {
    const aspect = width / height;
    const heightSpan = 12;
    runtime.mapCamera.left = -heightSpan * aspect;
    runtime.mapCamera.right = heightSpan * aspect;
    runtime.mapCamera.top = heightSpan;
    runtime.mapCamera.bottom = -heightSpan;
    runtime.mapCamera.updateProjectionMatrix();
  }
}

function focusPlayfield() {
  setupScene();
  updateCamera();
  resizeRenderer();
}

function renderApp() {
  if (!app) return;
  const currentShell = document.querySelector('#game-shell');
  if (state.screen === 'play' && currentShell && runtime.renderer) {
    const sceneLayer = currentShell.querySelector('.scene-layer');
    const nextShell = renderPlay();
    nextShell.querySelector('.scene-layer').replaceWith(sceneLayer);
    currentShell.replaceWith(nextShell);
    updateCamera();
    resizeRenderer();
    return;
  }
  app.replaceChildren();
  if (state.screen === 'menu') app.append(renderMenu());
  else if (state.screen === 'seat-select') app.append(renderSeatSelection());
  else if (state.screen === 'play') app.append(renderPlay());
  else app.append(renderEnding());
  if (state.screen === 'play') {
    setupScene();
    updateCamera();
    resizeRenderer();
  }
}

function renderMenu() {
  const saved = loadGameState(window.localStorage, 'chapters');
  const unlocks = getUnlocksAfterChapter(state.chapter - 1);
  const modeCards = Object.entries(MODES).map(([id, mode]) => {
    const locked = id === 'challenge' && !unlocks.challenge;
    return el('button', {
      class: `mode-card ${state.mode === id ? 'selected' : ''} ${locked ? 'locked' : ''}`,
      disabled: locked,
      onclick: () => chooseMode(id),
    }, [
      el('span', { class: 'mode-index', text: id === 'day' ? '01' : id === 'chapters' ? '02' : '03' }),
      el('span', { class: 'mode-name', text: locked ? `${mode.label} · 未解锁` : mode.label }),
      el('span', { class: 'mode-description', text: mode.description }),
    ]);
  });
  const regionChoices = [
    { id: 'front', label: '前三排', detail: '更接近黑板，李方玲的视线更规律。' },
    { id: 'back', label: '后三排', detail: '候选座位数量随难度变化，可能出现 LZY / WYH / DKH。' },
  ];
  return el('main', { class: 'menu-screen' }, [
    el('section', { class: 'menu-hero' }, [
      el('div', { class: 'eyebrow', text: 'LiFrP Classroom · 01' }),
      el('h1', { text: '李方玲的化学课' }),
      el('p', { class: 'hero-subtitle', text: '雨前最后一题' }),
      el('p', { class: 'hero-copy', text: '每一次铃响以前，你都要先判断：她今天到底想让谁留下。' }),
      el('div', { class: 'hero-rule' }, [el('span'), el('span'), el('span')]),
    ]),
    el('section', { class: 'menu-panel' }, [
      el('div', { class: 'section-kicker', text: '开始一局' }),
      el('label', { class: 'field-label', for: 'player-name', text: '你的姓名' }),
      el('input', { id: 'player-name', class: 'name-input', maxlength: '18', placeholder: '写下名字，课堂会这样称呼你' }),
      el('div', { class: 'section-kicker spaced', text: '先选择所在区域' }),
      el('div', { class: 'choice-grid' }, regionChoices.map((choice) => el('label', { class: 'choice-card' }, [
        el('input', { type: 'radio', name: 'region', value: choice.id, checked: choice.id === 'front' ? 'checked' : undefined }),
        el('span', { class: 'choice-title', text: choice.label }),
        el('span', { class: 'choice-detail', text: choice.detail }),
      ]))),
      el('label', { class: 'field-label spaced', for: 'role-select', text: '班级身份' }),
      el('select', { id: 'role-select', class: 'role-select' }, [
        el('option', { value: 'student', text: '普通同学 · 不引人注意' }),
        el('option', { value: 'monitor', text: '班长 · 每天两次组织干扰' }),
        el('option', { value: 'chemistry-rep', text: '化学课代表 · 查看作业批注' }),
      ]),
      el('div', { class: 'section-kicker spaced', text: '选择模式' }),
      el('div', { class: 'mode-list' }, modeCards),
      el('div', { class: 'menu-actions' }, [
        el('button', { class: 'primary-button', onclick: startGame, text: saved ? '继续进入课堂' : '进入课堂' }),
        el('button', { class: 'text-button', onclick: () => openGuide(), text: '查看规则与完整攻略' }),
      ]),
      el('div', { class: 'menu-note', text: '难度每次进入游戏时隐藏随机。2D 与 3D 可在课堂内切换，切换会消耗时间。' }),
    ]),
    el('footer', { class: 'menu-footer' }, [
      el('span', { text: 'Y-up · GLB school scene' }),
      el('span', { text: '默认关闭配音 · 支持全屏' }),
    ]),
  ]);
}

function renderSeatSelection() {
  const selection = state.seatSelection;
  const candidates = selection?.candidates || [];
  const frontAssigned = selection?.assigned;
  const options = state.region === 'back' ? candidates : [frontAssigned, ...(selection?.neighbors || [])].filter(Boolean);
  return el('main', { class: 'seat-screen' }, [
    el('div', { class: 'eyebrow', text: '座位确认 · 课前还有一点时间' }),
    el('h1', { text: state.region === 'back' ? '后三排候选' : '前三排随机位置' }),
    el('p', { class: 'seat-lede', text: state.region === 'back' ? '候选只显示名称。名字没有解释，解释要到课堂里自己找。' : '系统已经随机分配位置。现在只能向左右相邻座位调整一次。' }),
    el('div', { class: 'seat-options' }, options.map((seat) => el('button', {
      class: `seat-option ${state.seat?.id === seat.id ? 'selected' : ''}`,
      onclick: () => { state.seat = seat; renderApp(); },
    }, [
      el('span', { class: 'seat-code', text: seat.id }),
      el('span', { class: 'seat-meta', text: seat.special ? '特殊位置候选' : `第 ${seat.row} 排 · 第 ${seat.column} 列` }),
    ]))),
    el('div', { class: 'seat-footer' }, [
      el('span', { class: 'seat-role', text: `${getRoleLabel(state.role)} · 难度已隐藏` }),
      el('button', { class: 'primary-button', onclick: () => applySeat(state.seat), text: '坐下' }),
    ]),
  ]);
}

function renderPlay() {
  const eventIds = currentEvents();
  const event = EVENT_DETAILS[state.currentEvent];
  return el('main', { id: 'game-shell', class: `game-shell ${state.view === 'map' ? 'is-map' : 'is-first-person'}` }, [
    el('div', { class: 'scene-layer' }, [el('canvas', { id: 'game-canvas' })]),
    renderHud(eventIds),
    renderEventDrawer(event),
    renderMobileControls(),
    el('div', { id: 'toast', class: 'toast', text: state.lastMessage }),
  ]);
}

function renderHud(eventIds) {
  const event = EVENT_DETAILS[state.currentEvent];
  const switchBusy = Date.now() < state.switchUntil;
  const currentEventStates = Object.fromEntries(eventIds.map((id) => [id, state.eventStates[id] || 'pending']));
  return el('div', { class: 'hud-layer' }, [
    el('header', { class: 'hud-top' }, [
      el('div', { class: 'hud-brand' }, [el('span', { class: 'hud-mark', text: 'LF' }), el('span', { text: `第 ${state.chapter} 章 · ${state.playerName}` })]),
      el('div', { class: 'hud-actions' }, [
        el('button', { class: 'icon-button', title: '切换 2D / 3D', onclick: switchView, text: state.view === 'map' ? '3D' : '2D' }),
        el('button', { class: 'icon-button', title: '全屏', onclick: requestFullscreen, text: '⛶' }),
        el('button', { class: 'icon-button', title: '设置', onclick: openSettings, text: '···' }),
      ]),
    ]),
    el('aside', { class: 'objective-cluster' }, [
      el('div', { class: 'section-kicker', text: '当前课表' }),
      el('h2', { text: event.label }),
      el('p', { text: event.location }),
      el('div', { class: 'status-row' }, [
        statusPill('完成度', state.completion, true),
        statusPill('怀疑', state.suspicion),
        statusPill('心理', state.pressure),
      ]),
      el('div', { class: 'view-chip', text: switchBusy ? '视角切换中 · 时间仍在走' : state.view === 'map' ? '斜俯视地图' : '第一人称探索' }),
    ]),
    el('div', { class: 'event-rail' }, eventIds.map((id, index) => el('button', {
      class: `event-chip ${id === state.currentEvent ? 'active' : ''} ${currentEventStates[id]}`,
      onclick: () => openEvent(id),
    }, [el('span', { class: 'event-chip-index', text: String(index + 1).padStart(2, '0') }), el('span', { text: EVENT_DETAILS[id].label })]))),
    el('div', { class: 'control-hint', text: state.view === 'map' ? '点击发光标记调查 · V 切换视角' : 'WASD 移动 · 鼠标拖拽转向 · E 互动 · V 切换视角' }),
  ]);
}

function statusPill(label, value, completion = false) {
  const display = completion ? `${getStatusTier(value)} · ${Math.round(value)}%` : getStatusTier(value);
  return el('div', { class: `status-pill tier-${getStatusTier(value)}` }, [el('span', { class: 'status-label', text: label }), el('strong', { text: display })]);
}

function renderEventDrawer(event) {
  const details = EVENT_DETAILS[state.currentEvent];
  const body = renderEventBody(state.currentEvent);
  return el('section', { class: 'event-drawer' }, [
    el('div', { class: 'drawer-rule' }),
    el('div', { class: 'event-heading' }, [
      el('div', { class: 'event-icon', text: details.icon }),
      el('div', {}, [el('div', { class: 'section-kicker', text: details.location }), el('h3', { text: details.label })]),
    ]),
    el('p', { class: 'event-summary', text: details.text }),
    body,
  ]);
}

function renderEventBody(id) {
  const button = (label, action, tone = '') => el('button', { class: `action-button ${tone}`, onclick: () => runEventAction(action), text: label });
  if (id === 'homework-correction') {
    const steps = Number(state.eventStates['homework-step'] || 0);
    return el('div', { class: 'action-stack' }, [
      el('div', { class: 'progress-copy', text: `错题线索 ${Math.min(2, steps)}/2 · 找全后才能订正` }),
      el('div', { class: 'button-grid' }, [button('翻查批注', 'inspect'), button('完成订正', 'correct', 'accent')]),
    ]);
  }
  if (id === 'snacking') {
    const count = Number(state.eventStates['snack-count'] || 0);
    return el('div', { class: 'action-stack' }, [
      el('div', { class: 'progress-copy', text: `完成 ${count}/${getSnackTargetCount(state.difficulty)} 次 · 协作剩余 ${state.roleUsesRemaining}` }),
      el('div', { class: 'button-grid' }, [button('寻找视线空档', 'snack', 'accent'), button('请求同学干扰', 'distract')]),
    ]);
  }
  if (id === 'research-question') {
    return el('div', { class: 'action-stack' }, [
      el('div', { class: 'progress-copy', text: `提示 ${state.eventStates['research-prompts'] || 0}/${getResearchPromptAttempts(state.difficulty)} · 回答最多两次` }),
      el('div', { class: 'button-grid' }, [button('听同学耳语', 'listen'), button('结合线索推理', 'reason'), button('回答', 'answer', 'accent')]),
    ]);
  }
  if (id === 'untaught-topic') {
    return el('div', { class: 'action-stack' }, [
      el('div', { class: 'progress-copy', text: `取证 ${state.eventStates['topic-evidence'] || 0}/3 · 对话轮次 ${state.eventStates['topic-rounds'] || 0}/2` }),
      el('div', { class: 'button-grid' }, [button('查看课堂证据', 'evidence'), button('礼貌说明', 'speak', 'accent')]),
    ]);
  }
  if (id === 'copying-suspicion') {
    const evidence = new Set((state.eventStates['copy-evidence'] || '').split('|').filter(Boolean));
    return el('div', { class: 'action-stack' }, [
      el('div', { class: 'progress-copy', text: `证据链 ${evidence.size}/4 · 不要让解释前后矛盾` }),
      el('div', { class: 'button-grid' }, [button('保留解题痕迹', 'evidence:work'), button('准备解释', 'evidence:explain'), button('询问同学证词', 'evidence:witness'), button('检查答案差异', 'evidence:difference')]),
    ]);
  }
  if (id === 'milk-tea') {
    return el('div', { class: 'action-stack' }, [
      el('div', { class: 'progress-copy', text: `意图证据 ${state.eventStates['tea-evidence'] || 0}/2 · 先判断，再处理“受着”` }),
      el('div', { class: 'button-grid' }, [button('询问同学', 'evidence'), button('转移她的注意力', 'divert', 'accent'), button('走廊绕行', 'route')]),
    ]);
  }
  if (id === 'rain') {
    const evidence = new Set((state.eventStates['rain-evidence'] || '').split('|').filter(Boolean));
    return el('div', { class: 'action-stack' }, [
      el('div', { class: 'progress-copy', text: `求雨证据 ${evidence.size}/3 · 任一干预路线可以成功` }),
      el('div', { class: 'button-grid' }, [button('查教室线索', 'evidence:classroom'), button('查办公室', 'evidence:office'), button('听同学证词', 'evidence:witness'), button('对话阻止', 'intervene:dialogue'), button('物品干预', 'intervene:item'), button('组织介入', 'intervene:organize')]),
    ]);
  }
  if (id === 'holiday-homework') {
    const pages = Number(state.eventStates['holiday-pages'] || 0);
    return el('div', { class: 'action-stack' }, [
      el('div', { class: 'progress-copy', text: `作业线索 ${pages}/5 · 休息会降低心理压力` }),
      el('div', { class: 'button-grid' }, [button('追踪缺页', 'track'), button('完成一组题', 'study', 'accent'), button('休息', 'rest'), button('提交整份作业', 'submit')]),
    ]);
  }
  return el('div', { class: 'action-stack' }, [button('调查', 'evidence', 'accent')]);
}

function renderMobileControls() {
  return el('div', { class: 'mobile-controls' }, [
    el('div', { class: 'virtual-stick', onpointerdown: (event) => beginTouch(event, 'move') }, [el('span', { text: '移动' })]),
    el('div', { class: 'touch-actions' }, [
      el('button', { onclick: () => switchView(), text: '视角' }),
      el('button', { onclick: () => runEventAction('evidence'), text: '调查' }),
    ]),
  ]);
}

function beginTouch(event, kind) {
  event.currentTarget.setPointerCapture?.(event.pointerId);
  if (kind === 'move') runtime.touch.active = true;
}

function renderEnding() {
  const outcome = state.outcome || 'ordinary';
  const titles = {
    perfect: '铃声终于停了。',
    ordinary: '你安全走出了教学楼。',
    bad: '作业本留在了讲台上。',
    terror: '雨声里，有人叫了你的名字。',
  };
  const copies = {
    perfect: '你没有让任何一条线索散掉。下一次上课以前，记得把证据藏回原处。',
    ordinary: '有些事情没有处理干净，但今天的你确实离开了。',
    bad: '怀疑和压力已经超过了课堂能够容纳的范围。',
    terror: '最危险的不是雨，而是你在雨里听见了第二个脚步声。',
  };
  return el('main', { class: 'ending-screen' }, [
    el('div', { class: 'ending-noise' }),
    el('div', { class: 'eyebrow', text: `结局 · ${OUTCOME_LABELS[outcome]}` }),
    el('h1', { text: titles[outcome] }),
    el('p', { class: 'ending-copy', text: copies[outcome] }),
    el('div', { class: 'ending-stats' }, [
      el('span', { text: `完成度 ${Math.round(state.completion)}%` }),
      el('span', { text: `怀疑 ${getStatusTier(state.suspicion)}` }),
      el('span', { text: `心理 ${getStatusTier(state.pressure)}` }),
    ]),
    el('button', { class: 'primary-button', onclick: () => { state.screen = 'menu'; renderApp(); }, text: '回到主菜单' }),
  ]);
}

function requestFullscreen() {
  document.documentElement.requestFullscreen?.();
}

function openGuide() {
  window.open('./README.md', '_blank', 'noopener');
}

function openSettings() {
  const enabled = window.confirm('开启中文合成配音？默认关闭。');
  state.voiceEnabled = enabled;
  if (enabled) speak('配音已开启。', 'teacher');
  announce(enabled ? '多角色合成配音已开启。' : '配音保持关闭。', 'quiet');
  renderHudOnly();
}

function renderHudOnly() {
  renderApp();
}

function onPointerMove(event) {
  if (state.screen !== 'play' || state.view !== 'first-person' || event.buttons === 0) return;
  runtime.yaw -= event.movementX * 0.002;
  runtime.pitch = THREE.MathUtils.clamp(runtime.pitch - event.movementY * 0.002, -1.2, 1.2);
}

renderApp();
