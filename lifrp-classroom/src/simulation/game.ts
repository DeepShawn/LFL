import { DIFFICULTY_CONFIG, adjustProbability } from './difficulty.js';
import { getDistractionChance, getRoleUses } from './roles.js';
import { getUnlocksAfterChapter } from './modes.js';
import { applyFailurePolicy, getSnackTargetCount } from '../events/eventRules.js';

export type Difficulty = 'simple' | 'normal' | 'hard' | 'terror';
export type Room = 'classroom' | 'corridor' | 'office';
export type EventResult = 'success' | 'failed' | 'pending';
export type Outcome = 'perfect' | 'ordinary' | 'bad' | 'terror';
export type ActionResult = { message: string; tone: 'quiet' | 'success' | 'warning' | 'danger' };
export type GameAction = { id: string; label: string; disabled?: boolean };

export interface GameOptions {
  name: string;
  mode: 'day' | 'chapters' | 'challenge';
  role: 'monitor' | 'chemistry-rep' | 'student';
  region: 'front' | 'back';
  seat: { id: string; row: number; column: number; special: string | null };
  difficulty: Difficulty;
  unlockedChapter: number;
}

export const EVENT_DETAILS = {
  'homework-correction': { label: '订正作业', icon: '⌁', text: '找到两道红笔错题，分别选择订正答案，再交出作业本。', location: '教室 · 作业本', room: 'classroom' },
  snacking: { label: '上课偷吃', icon: '◌', text: '老师回头时停手，等板书或同学协作打开安全窗口，再吃下一口。', location: '教室 · 座位', room: 'classroom' },
  'research-question': { label: '研究性问题', icon: '?', text: '比较粉末和块状碳酸钙的实验，利用板书和实验记录推理，不靠猜测。', location: '教室 · 黑板与实验记录', room: 'classroom' },
  'untaught-topic': { label: '没讲过的知识点', icon: '∴', text: '集齐板书、课本、同学三项证据，依次陈述事实、请求澄清、表达学习意愿。', location: '教室 · 黑板前', room: 'classroom' },
  'copying-suspicion': { label: '抄作业怀疑', icon: '≋', text: '保留草稿、说明方法、询问证人，并比较正确解答中的推理差异。', location: '教室 · 走廊', room: 'classroom' },
  'milk-tea': { label: '避免请奶茶', icon: '◒', text: '核对证词和订单，判断“受着”的真实意图；转移注意力失败后走路线躲避。', location: '走廊 · 办公室', room: 'corridor' },
  rain: { label: '阻止求雨', icon: '⌇', text: '先集齐教室、办公室、同学三项证据，再选择对话、物品或组织路线。', location: '教室 · 办公室 · 走廊', room: 'classroom' },
  'holiday-homework': { label: '假期巨量作业', icon: '▦', text: '三天每天四个时段，追踪五组缺页并实际完成五组题，休息也占时间。', location: '教室 · 假期作业桌', room: 'classroom' },
} as const;

export type EventId = keyof typeof EVENT_DETAILS;

export const CHAPTER_EVENTS: Record<number, EventId[]> = {
  1: ['homework-correction', 'snacking'],
  2: ['research-question', 'untaught-topic'],
  3: ['copying-suspicion', 'milk-tea'],
  4: ['rain'],
  5: ['holiday-homework'],
};

interface TimedEvent { remaining: number }

export interface EventData {
  'homework-correction': TimedEvent & { marked: string[]; answers: Partial<Record<'q2' | 'q5', string>> };
  snacking: TimedEvent & {
    eaten: number; target: number; watching: boolean; watchRemaining: number;
    watchDuration: number; safeDuration: number; safeRemaining: number; biteRemaining: number;
  };
  'research-question': TimedEvent & { question: string; evidence: string[]; whispers: number; heardWrong: number };
  'untaught-topic': TimedEvent & { evidence: string[]; round: number; sentences: string[] };
  'copying-suspicion': TimedEvent & { evidence: string[]; explanation: string | null; difference: string | null };
  'milk-tea': TimedEvent & { evidence: string[]; stage: 'investigating' | 'judged' | 'evasion'; routeStarted: boolean };
  rain: TimedEvent & { evidence: string[]; route: 'dialogue' | 'item' | 'organize' | null };
  'holiday-homework': TimedEvent & {
    day: number; slotsRemaining: number; schedule: 'balanced' | 'focused' | null;
    rested: boolean; found: number[]; completed: number[];
  };
}

export interface GameState extends Omit<GameOptions, 'unlockedChapter'> {
  chapter: number;
  day: number;
  currentEvent: EventId;
  events: string[];
  results: Record<string, EventResult>;
  data: EventData;
  suspicion: number;
  pressure: number;
  completion: number;
  roleUses: number;
  elapsed: number;
  eventRemaining: number;
  view: 'map' | 'first-person';
  switchRemaining: number;
  phase: 'playing' | 'chase' | 'between' | 'ending';
  outcome: Outcome | null;
  position: { x: number; z: number };
  room: Room;
  // distance is owned by the renderer; tick only advances remaining (seconds).
  chase: null | { remaining: number; distance: number; goalRoom: 'corridor' | 'office' };
  history: string[];
  maxUnlockedChapter: number;
  allPerfect: boolean;
}

const EVENT_IDS = Object.keys(EVENT_DETAILS) as EventId[];
const ROOM_LABELS: Record<Room, string> = { classroom: '教室', corridor: '走廊', office: '办公室' };
const POLITE_SENTENCES = [
  '老师，我核对了板书、课本和同学记录，没有找到这个知识点。',
  '能否请您指出对应页码，或者再解释一下这个式子的来历？',
  '谢谢老师，我愿意补学，并把理解过程和订正一起交给您。',
];
const POLITE_IDS = ['speak:fact', 'speak:clarify', 'speak:learn'];

function immune(state: GameState) {
  return state.seat.id === 'DKH' || state.seat.special === 'immune';
}

function attention(state: Pick<GameState, 'seat'>) {
  return state.seat.id === 'LZY' || state.seat.special === 'attention' ? 1.4 : 1;
}

function anomaly(state: Pick<GameState, 'seat'>) {
  return state.seat.id === 'WYH' || state.seat.special === 'anomaly' ? 1.35 : 1;
}

function report(state: GameState, message: string, tone: ActionResult['tone'] = 'quiet'): ActionResult {
  if (state.phase === 'ending' && (state.outcome === 'bad' || state.outcome === 'terror') && tone !== 'danger') {
    return { message: state.history[state.history.length - 1], tone: 'danger' };
  }
  state.history.push(message);
  if (state.history.length > 80) state.history.shift();
  return { message, tone };
}

function unchanged(message: string): ActionResult {
  return { message, tone: 'quiet' };
}

function finishRun(state: GameState, outcome: Outcome, message: string) {
  state.phase = 'ending';
  state.outcome = outcome;
  state.chase = null;
  report(state, message, outcome === 'bad' || outcome === 'terror' ? 'danger' : 'success');
}

function checkDanger(state: GameState) {
  if (state.phase === 'ending' || immune(state)) return false;
  if (state.suspicion < 100 && state.pressure < 100) return false;
  finishRun(state, 'bad', '怀疑或心理压力已到极限，这一天到此结束。');
  return true;
}

function changeStress(state: GameState, suspicion: number, pressure: number, scale = true) {
  const factor = scale ? DIFFICULTY_CONFIG[state.difficulty].stateMultiplier : 1;
  if (!immune(state)) {
    state.suspicion = Math.min(100, Math.max(0, state.suspicion + suspicion * factor * attention(state)));
    state.pressure = Math.min(100, Math.max(0, state.pressure + pressure * factor * anomaly(state)));
    checkDanger(state);
  }
}

function updateCompletion(state: GameState) {
  state.completion = Math.round(state.events.filter((id) => state.results[id] === 'success').length / state.events.length * 100);
}

function settle(state: GameState) {
  updateCompletion(state);
  if (state.phase !== 'playing' || !state.events.every((id) => state.results[id] !== 'pending')) return;
  state.allPerfect = state.allPerfect && state.events.every((id) => state.results[id] === 'success') && state.suspicion < 50 && state.pressure < 50;
  if (state.mode === 'chapters' && state.chapter < 5) {
    state.phase = 'between';
    state.maxUnlockedChapter = Math.max(state.maxUnlockedChapter, state.chapter + 1);
    report(state, `第${state.chapter}章已结束。无论成功或失误，都可以继续下一天。`);
  } else {
    const danger = !immune(state) && (state.suspicion >= 75 || state.pressure >= 75);
    finishRun(state, danger ? 'bad' : state.allPerfect ? 'perfect' : 'ordinary', danger ? '目标已经结算，但危险状态把你留在了课堂记录里。' : state.allPerfect ? '全部目标妥善完成，你平静地走出了教学楼。' : '有些事情留下了遗憾，但你已经安全结束这段经历。');
  }
}

function succeed(state: GameState, message: string): ActionResult {
  state.results[state.currentEvent] = 'success';
  state.eventRemaining = 0;
  state.data[state.currentEvent].remaining = 0;
  state.pressure = Math.max(0, state.pressure - 4);
  const result = report(state, message, 'success');
  settle(state);
  return result;
}

function startChase(state: GameState, goalRoom: 'corridor' | 'office') {
  if (immune(state)) return;
  state.chase = {
    remaining: 30 * DIFFICULTY_CONFIG[state.difficulty].timeMultiplier / anomaly(state),
    distance: 5 / anomaly(state),
    goalRoom,
  };
  state.phase = 'chase';
  state.view = 'first-person';
  state.switchRemaining = 0;
  report(state, `脚步追上来了！请实际跑到${ROOM_LABELS[goalRoom]}的安全点。`, 'danger');
}

function fail(state: GameState, message: string): ActionResult {
  if (immune(state)) return report(state, `${message} DKH挡住了负面后果，但还需要自己完成目标。`, 'quiet');
  state.results[state.currentEvent] = 'failed';
  state.allPerfect = false;
  state.eventRemaining = 0;
  state.data[state.currentEvent].remaining = 0;
  const penalty = applyFailurePolicy(state.difficulty);
  const result = report(state, message, penalty.chase ? 'danger' : 'warning');
  changeStress(state, penalty.suspicion, penalty.pressure, false);
  updateCompletion(state);
  if (state.phase === 'ending') return result;
  if (penalty.chase) startChase(state, state.room === 'corridor' ? 'office' : 'corridor');
  else settle(state);
  return result;
}

function caught(state: GameState): ActionResult {
  if (state.phase !== 'chase' || immune(state)) return unchanged('现在没有需要判定的追逐碰撞。');
  if (state.difficulty === 'simple' || state.difficulty === 'normal') {
    state.chase = null;
    state.phase = 'playing';
    return fail(state, '你在绕行途中被叫住，奶茶事件未能完成，但可以继续其他目标。');
  }
  if (state.results[state.currentEvent] === 'pending') state.results[state.currentEvent] = 'failed';
  state.allPerfect = false;
  updateCompletion(state);
  finishRun(state, state.difficulty === 'terror' ? 'terror' : 'bad', '你没能抵达安全点，身后的脚步停在了面前。');
  return { message: state.history[state.history.length - 1], tone: 'danger' };
}

function selectEvent(state: GameState, id: EventId) {
  state.data[state.currentEvent].remaining = state.eventRemaining;
  state.currentEvent = id;
  state.eventRemaining = state.data[id].remaining;
  report(state, `当前目标：${EVENT_DETAILS[id].label}。${EVENT_DETAILS[id].text}`);
}

export function createGame(options: GameOptions, rng: () => number = Math.random): GameState {
  const maxUnlockedChapter = Number.isFinite(options.unlockedChapter) ? Math.max(1, Math.min(5, Math.floor(options.unlockedChapter))) : 1;
  const pool = getUnlocksAfterChapter(maxUnlockedChapter - 1).events as EventId[];
  let events = [...CHAPTER_EVENTS[1]];
  if (options.mode === 'day') events = pool.slice(0, 3);
  if (options.mode === 'challenge') {
    events = [...pool];
    for (let i = events.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [events[i], events[j]] = [events[j], events[i]];
    }
    events = events.slice(0, 4);
  }
  const time = DIFFICULTY_CONFIG[options.difficulty].timeMultiplier;
  const watchDuration = 3 * DIFFICULTY_CONFIG[options.difficulty].attentionMultiplier * attention(options);
  const safeDuration = 4 * time / attention(options);
  const data: EventData = {
    'homework-correction': { remaining: 150 * time, marked: [], answers: {} },
    snacking: { remaining: 150 * time, target: getSnackTargetCount(options.difficulty), eaten: 0, watching: true, watchRemaining: watchDuration, watchDuration, safeDuration, safeRemaining: 0, biteRemaining: 0 },
    'research-question': { remaining: 180 * time, question: '等质量的粉末与块状碳酸钙，分别加入相同且足量的稀盐酸。为什么粉末反应更快？最终二氧化碳总量是否相同？', evidence: [], whispers: 0, heardWrong: 0 },
    'untaught-topic': { remaining: 240 * time, evidence: [], round: 0, sentences: [] },
    'copying-suspicion': { remaining: 240 * time, evidence: [], explanation: null, difference: null },
    'milk-tea': { remaining: 180 * time, evidence: [], stage: 'investigating', routeStarted: false },
    rain: { remaining: 240 * time, evidence: [], route: null },
    'holiday-homework': { remaining: 600 * time, day: 1, slotsRemaining: 4, schedule: null, rested: false, found: [], completed: [] },
  };
  const state: GameState = {
    name: options.name.trim() || '无名同学', mode: options.mode, role: options.role, region: options.region,
    seat: { ...options.seat }, difficulty: options.difficulty,
    chapter: 1, day: 1, currentEvent: events[0], events,
    results: Object.fromEntries(EVENT_IDS.map((id) => [id, 'pending' as EventResult])), data,
    suspicion: (options.region === 'back' ? 24 : 12) + (attention(options) > 1 ? 12 : 0),
    pressure: (options.difficulty === 'terror' ? 32 : 18) + (anomaly(options) > 1 ? 12 : 0),
    completion: 0, roleUses: getRoleUses(options.role), elapsed: 0, eventRemaining: data[events[0]].remaining,
    view: 'map', switchRemaining: 0, phase: 'playing', outcome: null,
    position: { x: (options.seat.column - 3.5) * 1.1, z: (options.seat.row - 3.5) * 1.1 },
    room: 'classroom', chase: null, history: ['课前铃还没有响。先确认当前目标与线索位置。'],
    maxUnlockedChapter, allPerfect: true,
  };
  if (immune(state)) {
    state.suspicion = 0;
    state.pressure = 0;
  }
  return state;
}

export function advance(state: GameState): void {
  if (checkDanger(state) || state.phase !== 'between') return;
  state.chapter += 1;
  state.day += 1;
  state.events = [...CHAPTER_EVENTS[state.chapter]];
  state.currentEvent = state.events[0] as EventId;
  state.eventRemaining = state.data[state.currentEvent].remaining;
  state.roleUses = getRoleUses(state.role);
  state.completion = 0;
  state.switchRemaining = 0;
  state.room = 'classroom';
  state.position = { x: (state.seat.column - 3.5) * 1.1, z: (state.seat.row - 3.5) * 1.1 };
  state.phase = 'playing';
  report(state, `第${state.day}天，第${state.chapter}章。今日协作次数已恢复。`);
}

// dt and every *Remaining field use seconds; no wall clock or automatic movement.
export function tick(state: GameState, dt: number): boolean {
  if (checkDanger(state)) return true;
  if (!Number.isFinite(dt) || dt <= 0 || state.phase === 'ending' || state.phase === 'between') return false;
  state.elapsed += dt;
  state.switchRemaining = Math.max(0, state.switchRemaining - dt);
  if (state.phase === 'chase' && state.chase) {
    state.chase.remaining = Math.max(0, state.chase.remaining - dt);
    if (state.chase.remaining === 0) caught(state);
    return true;
  }
  if (state.events.includes('snacking') && state.results.snacking === 'pending') {
    const food = state.data.snacking;
    const cycle = food.watchDuration + food.safeDuration;
    const offset = food.watching ? food.watchDuration - food.watchRemaining : cycle - food.watchRemaining;
    const next = (offset + dt) % cycle;
    food.watching = next < food.watchDuration;
    food.watchRemaining = food.watching ? food.watchDuration - next : cycle - next;
    food.safeRemaining = Math.max(0, food.safeRemaining - dt);
    food.biteRemaining = Math.max(0, food.biteRemaining - dt);
  }
  if (!immune(state) && state.results[state.currentEvent] === 'pending') {
    const remaining = state.eventRemaining;
    state.eventRemaining = Math.max(0, remaining - dt);
    state.data[state.currentEvent].remaining = state.eventRemaining;
    if (state.eventRemaining === 0) {
      fail(state, `${EVENT_DETAILS[state.currentEvent].label}的截止时间到了。`);
      if (state.chase && dt > remaining) {
        state.chase.remaining = Math.max(0, state.chase.remaining - (dt - remaining));
        if (state.chase.remaining === 0) caught(state);
      }
    }
  }
  return true;
}

function eventChoices(state: GameState): GameAction[] {
  const inRoom = (room: Room) => state.room === room;
  const choice = (id: string, label: string, enabled = true): GameAction => ({ id, label, disabled: !enabled });
  const clue = (id: string, label: string, room: Room, found: string[]) => choice(`evidence:${id}`, `${label} · ${ROOM_LABELS[room]}`, inRoom(room) && !found.includes(id));
  switch (state.currentEvent) {
    case 'homework-correction': {
      const data = state.data['homework-correction'];
      return [
        ...(state.role === 'chemistry-rep' ? [choice('rep:inspect', '课代表：查看批注登记（消耗今日一次协作）', inRoom('classroom') && state.roleUses > 0 && data.marked.length < 2)] : []),
        choice('inspect:q2', '检查第二题旁的红笔批注', inRoom('classroom') && !data.marked.includes('q2')),
        choice('inspect:q5', '翻到末页检查第五题的红圈', inRoom('classroom') && !data.marked.includes('q5')),
        choice('solve:q2:44', '第二题：CO₂的相对分子质量为12＋16×2＝44', inRoom('classroom') && data.marked.includes('q2') && data.answers.q2 !== '44'),
        choice('solve:q2:32', '第二题：只把两个氧的质量相加，得到32', inRoom('classroom') && data.marked.includes('q2') && data.answers.q2 !== '32'),
        choice('solve:q5:balanced', '第五题：配平为2H₂＋O₂ → 2H₂O', inRoom('classroom') && data.marked.includes('q5') && data.answers.q5 !== 'balanced'),
        choice('solve:q5:unbalanced', '第五题：保持H₂＋O₂ → H₂O不改', inRoom('classroom') && data.marked.includes('q5') && data.answers.q5 !== 'unbalanced'),
        choice('submit', '提交两道订正题', inRoom('classroom') && data.marked.length === 2 && Boolean(data.answers.q2 && data.answers.q5)),
      ];
    }
    case 'snacking': {
      const data = state.data.snacking;
      return [
        choice('snack', data.watching && data.safeRemaining <= 0 && !immune(state) ? '老师正在看这里：冒险吃一口' : '趁安全窗口吃一口', inRoom('classroom') && data.biteRemaining <= 0),
        choice('distract', `请求同学协作（今日剩${state.roleUses}次）`, inRoom('classroom') && state.roleUses > 0),
      ];
    }
    case 'research-question': {
      const data = state.data['research-question'];
      return [
        clue('blackboard', '读板书：质量、酸量和温度的控制条件', 'classroom', data.evidence),
        clue('experiment', '查看粉末与块状碳酸钙的实验记录', 'classroom', data.evidence),
        choice('listen', `听同学耳语（剩${DIFFICULTY_CONFIG[state.difficulty].promptAttempts - data.whispers}次）`, inRoom('classroom') && data.whispers < DIFFICULTY_CONFIG[state.difficulty].promptAttempts),
        choice('answer:surface-area', '回答：粉末接触面积更大，所以更快；等质量最终产气相同', inRoom('classroom') && data.evidence.length === 2),
        choice('answer:more-gas', '回答：粉末颗粒更多，所以最终二氧化碳也更多', inRoom('classroom') && data.evidence.length === 2),
        choice('answer:catalyst', '回答：粉碎产生了催化剂，所以反应更快', inRoom('classroom') && data.evidence.length === 2),
      ];
    }
    case 'untaught-topic': {
      const data = state.data['untaught-topic'];
      return [
        clue('blackboard', '核对黑板上实际讲过的公式', 'classroom', data.evidence),
        clue('textbook', '核对课本页码和教学进度', 'classroom', data.evidence),
        clue('witness', '向同学核对笔记', 'corridor', data.evidence),
        ...POLITE_IDS.map((id, index) => choice(id, POLITE_SENTENCES[index], inRoom('classroom') && data.evidence.length === 3 && data.round === index)),
      ];
    }
    case 'copying-suspicion': {
      const data = state.data['copying-suspicion'];
      return [
        clue('work', '保留带时间顺序的解题草稿', 'classroom', data.evidence),
        clue('witness', '询问见过独立作答的同学', 'corridor', data.evidence),
        choice('explain:method', '解释：先按守恒列式，再代入数据检验单位', inRoom('classroom') && data.evidence.includes('work') && !data.explanation),
        choice('difference:reasoning', '对照：结论相同，但我的守恒列式与同学的比例推导不同', inRoom('classroom') && data.evidence.includes('work') && !data.difference),
        choice('difference:wrong-answer', '把正确结果改错，声称答案不同就没抄', inRoom('classroom') && !data.difference),
        choice('submit', '提交四项独立证据和解题说明', inRoom('classroom') && data.evidence.length === 4),
      ];
    }
    case 'milk-tea': {
      const data = state.data['milk-tea'];
      return [
        clue('witness', '问同学她说“受着”时的语气', 'corridor', data.evidence),
        clue('order', '核对桌上的奶茶订单与付款便条', 'office', data.evidence),
        choice('judge:serious', '判断：订单和语气都表明她确实在等我付款', inRoom('corridor') && data.evidence.length === 2 && data.stage === 'investigating'),
        choice('judge:joking', '判断：她只是随口开玩笑，不会追问', inRoom('corridor') && data.evidence.length === 2 && data.stage === 'investigating'),
        choice('divert', '用办公室待签的材料转移她的注意力', inRoom('corridor') && data.stage === 'judged'),
        choice('route', '启动绕行：沿走廊到办公室安全点', inRoom('corridor') && data.stage === 'evasion' && !data.routeStarted),
        ...(immune(state) && data.routeStarted ? [choice('escape', '确认已抵达办公室安全点', inRoom('office'))] : []),
      ];
    }
    case 'rain': {
      const data = state.data.rain;
      const ready = data.evidence.length === 3;
      return [
        clue('classroom', '查看班级体育课表与求雨便条', 'classroom', data.evidence),
        clue('office', '查办公室审批记录', 'office', data.evidence),
        clue('witness', '听负责值日同学的证词', 'corridor', data.evidence),
        choice('intervene:dialogue', '出示证据，与当事人对话撤回安排', ready && inRoom('corridor')),
        choice('intervene:item', '按证据撤下教室里的未批准求雨道具', ready && inRoom('classroom')),
        choice('intervene:organize', '向办公室提交材料，申请按课表上课', ready && inRoom('office')),
      ];
    }
    case 'holiday-homework': {
      const data = state.data['holiday-homework'];
      const slot = inRoom('classroom') && data.schedule !== null && data.slotsRemaining > 0;
      return [
        choice('schedule:balanced', '安排今日：劳逸结合，每组压力较低，可休息一次', inRoom('classroom') && data.schedule === null),
        choice('schedule:focused', '安排今日：集中做题，不安排休息', inRoom('classroom') && data.schedule === null),
        choice('track', '花一个时段找下一组缺页（不是完成题目）', slot && data.found.length < 5),
        choice('study', '花一个时段完成已找到的一组题', slot && data.found.some((page) => !data.completed.includes(page))),
        choice('rest', '花一个时段休息（今日限一次）', slot && data.schedule === 'balanced' && !data.rested),
        choice('holiday:next-day', data.day < 3 ? '结束今天，进入假期下一天' : '结束第三天并接受作业检查', inRoom('classroom') && data.schedule !== null),
        choice('submit', '提交五组已找到且已完成的作业', inRoom('classroom') && data.found.length === 5 && data.completed.length === 5),
      ];
    }
  }
}

export function getActions(state: GameState): GameAction[] {
  if (state.phase === 'ending') return [];
  if (state.phase === 'between') return [{ id: 'next', label: '进入下一天并恢复协作次数' }];
  const view: GameAction = { id: 'switch-view', label: state.view === 'map' ? '切换第一人称' : '切换地图视角', disabled: state.switchRemaining > 0 };
  // escape/caught are physical renderer callbacks, not buttons that teleport out of a chase.
  if (state.phase === 'chase') return [view];
  return [
    ...state.events.map((id) => ({ id: `event:${id}`, label: `查看目标：${EVENT_DETAILS[id as EventId].label}`, disabled: id === state.currentEvent })),
    ...(['classroom', 'corridor', 'office'] as const).map((room) => ({ id: `go:${room}`, label: `前往${ROOM_LABELS[room]}`, disabled: state.room === room })),
    view,
    ...(state.results[state.currentEvent] === 'pending' ? eventChoices(state) : [{ id: 'next', label: '查看下一项未处理的目标' }]),
  ];
}

export function act(state: GameState, action: string, rng: () => number = Math.random): ActionResult {
  if (checkDanger(state)) return { message: '怀疑或心理压力已达极限。', tone: 'danger' };
  if (state.phase === 'ending') return unchanged('这段经历已经结束。');
  if (action === 'caught') return caught(state);
  if (action === 'escape') {
    const tea = state.data['milk-tea'];
    const evadingTea = state.currentEvent === 'milk-tea' && state.results['milk-tea'] === 'pending' && tea.routeStarted;
    const goal = state.chase?.goalRoom ?? (immune(state) && evadingTea ? 'office' : null);
    if (!goal || state.room !== goal) return unchanged('还没有实际抵达指定房间的安全点。');
    state.chase = null;
    state.phase = 'playing';
    if (evadingTea) return succeed(state, '你沿路线抵达办公室安全点，避开了奶茶订单。');
    const result = report(state, '你抵达安全点，甩开了追来的脚步。', 'success');
    settle(state);
    return result;
  }
  const selected = getActions(state).find((item) => item.id === action);
  if (!selected || selected.disabled) return unchanged(selected ? `暂时不能执行“${selected.label}”，请先满足目标中的条件。` : '这个动作不属于当前可处理的目标。');
  if (action === 'next') {
    if (state.phase === 'between') {
      advance(state);
      return unchanged(`已进入第${state.day}天。`);
    }
    const next = state.events.find((id) => state.results[id] === 'pending') as EventId | undefined;
    if (next) selectEvent(state, next);
    return unchanged('已显示下一项待处理目标。');
  }
  if (action === 'switch-view') {
    state.view = state.view === 'map' ? 'first-person' : 'map';
    state.switchRemaining = DIFFICULTY_CONFIG[state.difficulty].switchSeconds;
    return report(state, state.view === 'map' ? '地图展开了，房间与目标位置清晰可见。' : '视线回到眼前，注意黑板、门口和脚步。');
  }
  if (action.startsWith('event:')) {
    selectEvent(state, action.slice(6) as EventId);
    return unchanged(`当前目标：${EVENT_DETAILS[state.currentEvent].label}。`);
  }
  if (action.startsWith('go:')) {
    state.room = action.slice(3) as Room;
    state.position = { x: 0, z: 0 };
    return report(state, `你走进了${ROOM_LABELS[state.room]}。坐标以当前房间地面为准。`);
  }

  switch (state.currentEvent) {
    case 'homework-correction': {
      const data = state.data['homework-correction'];
      if (action === 'rep:inspect') {
        state.roleUses -= 1;
        data.marked = ['q2', 'q5'];
        return report(state, '课代表核对了批注登记：第二题要计算CO₂的总相对分子质量；第五题要核对方程式两边的原子数量。仍需自己选择订正并提交。');
      }
      if (action.startsWith('inspect:')) {
        const question = action.slice(8);
        data.marked.push(question);
        return report(state, question === 'q2' ? '第二题有红笔批注：CO₂的相对分子质量要把碳和两个氧都算上，C＝12，O＝16。' : '第五题被圈起：检查H₂＋O₂ → H₂O两边的氢、氧原子数。');
      }
      if (action.startsWith('solve:')) {
        const [, question, answer] = action.split(':');
        data.answers[question as 'q2' | 'q5'] = answer;
        return report(state, `已写下${question === 'q2' ? '第二题' : '第五题'}的订正选择，可以检查后再提交。`);
      }
      return data.answers.q2 === '44' && data.answers.q5 === 'balanced'
        ? succeed(state, '两道题都订正正确，作业本按时交出。')
        : fail(state, '至少一道订正仍不正确，作业本被退回。');
    }
    case 'snacking': {
      const data = state.data.snacking;
      if (action === 'distract') {
        state.roleUses -= 1;
        if (rng() < getDistractionChance(state.role, state.difficulty)) {
          data.safeRemaining = 6 * DIFFICULTY_CONFIG[state.difficulty].timeMultiplier;
          return report(state, `同学接过了话题，获得${data.safeRemaining.toFixed(1)}秒安全窗口。`, 'success');
        }
        changeStress(state, 4, 2);
        return report(state, '协作没有引开她的视线。等老师转向黑板再行动。', 'warning');
      }
      if (data.watching && data.safeRemaining <= 0 && !immune(state)) return fail(state, '包装袋在老师的注视下响了，偷吃被发现。');
      data.eaten += 1;
      data.biteRemaining = 0.85;
      return data.eaten >= data.target
        ? succeed(state, '最后一口已经咽下，包装袋安静地收进了书包。')
        : report(state, `安全吃完一口：${data.eaten}/${data.target}。咽下后再继续。`, 'success');
    }
    case 'research-question': {
      const data = state.data['research-question'];
      if (action.startsWith('evidence:')) {
        const key = action.slice(9);
        data.evidence.push(key);
        return report(state, key === 'blackboard' ? '板书：两份碳酸钙质量相同，稀盐酸均足量，温度相同；唯一改变的是颗粒大小。' : '实验记录：粉末起泡更快，但充分反应后，两组收集到的二氧化碳总量相同。');
      }
      if (action === 'listen') {
        data.whispers += 1;
        const heard = rng() < 0.05;
        const stopped = rng() < 0.5;
        if (stopped) {
          changeStress(state, 3, 2);
          return report(state, '李方玲敲了敲讲台：“不要转身。”提示被打断，但没有消耗答错次数。', 'warning');
        }
        if (heard && data.evidence.length < 2) {
          const key = data.evidence.includes('blackboard') ? 'experiment' : 'blackboard';
          data.evidence.push(key);
          return report(state, key === 'blackboard' ? '听清了：质量、酸量、温度不变，只改变接触面积。' : '听清了：粉末反应更快，但最终产气总量不变。', 'success');
        }
        return report(state, '耳语太轻，没有听清新线索。仍可自己查看板书与实验记录。');
      }
      if (rng() < 0.65) return report(state, '回答没传到讲台，请再说一次；这不消耗答错机会。', 'warning');
      if (action === 'answer:surface-area') return succeed(state, '老师听清了：接触面积改变速率，等质量与足量酸决定最终产气相同。');
      data.heardWrong = Math.min(2, data.heardWrong + 1);
      if (data.heardWrong >= 2) return fail(state, '两次被听清的回答都不正确，追问结束。');
      changeStress(state, 0, 4);
      return report(state, '这次她听清了，但推理不正确。请重新核对接触面积与最终产气量。', 'warning');
    }
    case 'untaught-topic': {
      const data = state.data['untaught-topic'];
      if (action.startsWith('evidence:')) {
        const key = action.slice(9);
        data.evidence.push(key);
        const text: Record<string, string> = { blackboard: '板书只有上一节的内容，没有这个式子。', textbook: '课本进度止于上一页，这个知识点在尚未讲到的章节。', witness: '同学的完整笔记也没有这个知识点，可以作为第三项核对证据。' };
        return report(state, text[key]);
      }
      const sentence = POLITE_SENTENCES[data.round];
      data.sentences.push(sentence);
      data.round += 1;
      return data.round === 3 ? succeed(state, `${sentence} 老师同意先补充讲解，再让你订正。`) : report(state, `${sentence} ${data.round === 1 ? '老师问：“你想让我怎么说明？”' : '老师问：“补讲之后，你愿意自己完成订正吗？”'}`);
    }
    case 'copying-suspicion': {
      const data = state.data['copying-suspicion'];
      if (action === 'submit') return succeed(state, '草稿、方法解释、证词和推理差异彼此吻合，抄作业怀疑解除。');
      if (action === 'difference:wrong-answer') return unchanged('把科学结论改错不能证明独立作答。请比较列式、计算顺序和推导过程。');
      if (action === 'explain:method') {
        data.explanation = '先依据守恒关系列式，再代入数据，最后用单位和数量级核查。';
        data.evidence.push('explain');
        return report(state, data.explanation);
      }
      if (action === 'difference:reasoning') {
        data.difference = '两人的正确结论一致，但我的草稿先列守恒方程，同学先写比例关系；中间推理和独立验算不同。';
        data.evidence.push('difference');
        return report(state, data.difference);
      }
      const key = action.slice(9);
      data.evidence.push(key);
      return report(state, key === 'work' ? '草稿保留了列式、验算和一次自行改正的痕迹。' : '同学证实你在交流答案之前，已经独立完成了草稿。');
    }
    case 'milk-tea': {
      const data = state.data['milk-tea'];
      if (action.startsWith('evidence:')) {
        const key = action.slice(9);
        data.evidence.push(key);
        return report(state, key === 'witness' ? '同学说她慢慢重复“受着”，还确认了奶茶份数，不像玩笑。' : '办公室桌上的订单已经生成，付款便条写着今天，收款人还在等确认。');
      }
      if (action === 'judge:joking') return unchanged('订单已经生成，付款便条和证词都不支持“只是玩笑”。再判断一次。');
      if (action === 'judge:serious') {
        data.stage = 'judged';
        return report(state, '你判断她确实在等付款。现在需要先转移注意力。');
      }
      if (action === 'divert') {
        if (rng() < adjustProbability(0.7, state.difficulty)) return succeed(state, '她转身去处理待签材料，暂时忘了奶茶订单。');
        data.stage = 'evasion';
        return report(state, '她没有被引开。奶茶事件还没失败，改走办公室安全路线。', 'warning');
      }
      data.routeStarted = true;
      startChase(state, 'office');
      return report(state, immune(state) ? 'DKH挡住了追逐后果；仍需自己前往办公室，再确认抵达安全点。' : '绕行开始：请实际到达办公室安全点，不要在走廊停留。', immune(state) ? 'quiet' : 'danger');
    }
    case 'rain': {
      const data = state.data.rain;
      if (action.startsWith('evidence:')) {
        const key = action.slice(9);
        data.evidence.push(key);
        const text: Record<string, string> = { classroom: '课表写着体育课，求雨便条却要求全班留下做化学题。', office: '办公室没有批准占用体育课，申请表的签名栏还是空白。', witness: '值日同学证实道具刚被搬来，求雨安排尚未获得班级同意。' };
        return report(state, text[key]);
      }
      data.route = action.slice(10) as 'dialogue' | 'item' | 'organize';
      const text = { dialogue: '你拿着完整证据协商，对方同意撤回安排。', item: '你按证据撤下未经批准的道具，求雨活动无法继续。', organize: '办公室核实三项材料后，要求恢复正常体育课。' };
      return succeed(state, text[data.route]);
    }
    case 'holiday-homework': {
      const data = state.data['holiday-homework'];
      if (action.startsWith('schedule:')) {
        data.schedule = action.slice(9) as 'balanced' | 'focused';
        return report(state, `假期第${data.day}天的四个时段已安排。${data.schedule === 'balanced' ? '劳逸结合可以降低每组题的压力，并允许一次休息。' : '今天集中处理题目，不安排休息。'}`);
      }
      if (action === 'submit') return succeed(state, '五组缺页已全部找到，五组题也都实际完成，整份作业按时提交。');
      if (action === 'holiday:next-day') {
        tick(state, data.slotsRemaining * 10);
        if (state.phase !== 'playing' || state.results['holiday-homework'] !== 'pending') {
          return { message: state.history[state.history.length - 1], tone: state.chase || state.outcome === 'bad' || state.outcome === 'terror' ? 'danger' : 'warning' };
        }
        if (data.day === 3) return data.completed.length === 5 ? succeed(state, '第三天结束，全部作业通过检查。') : fail(state, '三天已经用完，还有缺页或题目没有处理完。');
        data.day += 1;
        state.day += 1;
        data.slotsRemaining = 4;
        data.schedule = null;
        data.rested = false;
        state.roleUses = getRoleUses(state.role);
        return report(state, `进入假期第${data.day}天：四个新时段，需要重新安排。`);
      }
      tick(state, 10);
      if (state.phase !== 'playing' || state.results['holiday-homework'] !== 'pending') {
        return { message: state.history[state.history.length - 1], tone: state.chase || state.outcome === 'bad' || state.outcome === 'terror' ? 'danger' : 'warning' };
      }
      // DKH freezes deadline budgets, but finding pages and doing the work remain separate objectives.
      if (!immune(state)) data.slotsRemaining -= 1;
      let result: ActionResult;
      if (action === 'track') {
        data.found.push(data.found.length + 1);
        result = report(state, `找到第${data.found.length}组缺页和批注，题目仍未完成。`);
      } else if (action === 'study') {
        const page = data.found.find((item) => !data.completed.includes(item))!;
        data.completed.push(page);
        changeStress(state, 0, data.schedule === 'balanced' ? 6 : 10);
        result = report(state, `第${page}组题已完成并核对。实际完成${data.completed.length}/5组。`, 'success');
      } else {
        data.rested = true;
        state.pressure = Math.max(0, state.pressure - 13);
        result = report(state, '你休息了一个时段，压力下降；今天不能再次休息。', 'success');
      }
      if (state.phase === 'playing' && data.day === 3 && data.slotsRemaining === 0 && data.completed.length < 5) return fail(state, '最后一个时段结束，仍有未完成的作业。');
      return result;
    }
  }
}

export function getObjectives(state: GameState): string[] {
  if (state.phase === 'ending') return [`经历已结束：${{ perfect: '完美结局', ordinary: '普通成功', bad: '坏结局', terror: '恐怖结局' }[state.outcome!]}。本轮目标完成度${state.completion}%。`];
  if (state.phase === 'chase' && state.chase) return [`实际移动至${ROOM_LABELS[state.chase.goalRoom]}的安全点，剩余${Math.ceil(state.chase.remaining)}秒。`, state.difficulty === 'hard' || state.difficulty === 'terror' ? '只有抵达安全点才算脱身，被追上或超时都会结束本轮。' : '只有抵达安全点才算脱身；被叫住或超时会使本事件失败，之后仍可继续其他目标。'];
  if (state.phase === 'between') return [`第${state.chapter}章已经处理完，目标完成度${state.completion}%。`, '继续下一天会恢复角色协作次数，失败项目不会阻止章节前进。'];
  if (state.results[state.currentEvent] !== 'pending') return [`${EVENT_DETAILS[state.currentEvent].label}已${state.results[state.currentEvent] === 'success' ? '完成' : '结束但未成功'}。请选择下一项待处理目标。`];
  const deadline = immune(state) ? 'DKH免疫负面状态、截止时间与追逐，但不替你收集证据或完成题目。' : `当前目标剩余${Math.ceil(state.eventRemaining)}秒。`;
  switch (state.currentEvent) {
    case 'homework-correction': {
      const data = state.data['homework-correction'];
      return [`找到两道红笔标记题：${data.marked.length}/2。`, `分别选订正答案（第二题：${data.answers.q2 ?? '未选择'}；第五题：${data.answers.q5 ? '已选择' : '未选择'}），再提交。`, deadline];
    }
    case 'snacking': {
      const data = state.data.snacking;
      return [`安全吃完${data.target}口：${data.eaten}/${data.target}。每口需要时间咽下。`, data.safeRemaining > 0 ? `协作安全窗口还剩${data.safeRemaining.toFixed(1)}秒。` : `${data.watching ? '老师正在巡视，先别动包装袋' : '老师正在板书，现在是安全窗口'}，${data.watchRemaining.toFixed(1)}秒后变化。`, `今日协作剩${state.roleUses}次。`, deadline];
    }
    case 'research-question': {
      const data = state.data['research-question'];
      return [data.question, `板书与实验线索${data.evidence.length}/2；耳语已用${data.whispers}/${DIFFICULTY_CONFIG[state.difficulty].promptAttempts}次。`, `被听清的错误回答${data.heardWrong}/2；没有被听见不会扣机会，正确性由答案决定。`, deadline];
    }
    case 'untaught-topic': {
      const data = state.data['untaught-topic'];
      return [`先收齐板书、课本和走廊同学三项证据：${data.evidence.length}/3。`, `礼貌表达${data.round}/3轮：陈述事实 → 请求页码与澄清 → 表达补学意愿。`, ...data.sentences, deadline];
    }
    case 'copying-suspicion': {
      const data = state.data['copying-suspicion'];
      return [`草稿、方法解释、同学证词、推理差异：${data.evidence.length}/4。`, '比较正确解答的列式与推理过程，不要故意写错科学结论。四项集齐后提交。', ...(data.explanation ? [data.explanation] : []), ...(data.difference ? [data.difference] : []), deadline];
    }
    case 'milk-tea': {
      const data = state.data['milk-tea'];
      return [`走廊证词与办公室订单：${data.evidence.length}/2。`, data.stage === 'investigating' ? '先集齐证据，再判断她是否真的要你付款。' : data.stage === 'judged' ? '已经判断真实意图，尝试转移注意力。' : data.routeStarted ? '沿路线抵达办公室的安全点。' : '转移失败不是事件失败，请启动办公室绕行路线。', deadline];
    }
    case 'rain': return [`教室课表、办公室审批、走廊证词：${state.data.rain.evidence.length}/3，缺一不可。`, '全部取证后任选一条：走廊对话、教室物品干预、办公室组织介入。', deadline];
    case 'holiday-homework': {
      const data = state.data['holiday-homework'];
      return [`假期第${data.day}/3天，今日剩余${data.slotsRemaining}/4个时段；${data.schedule === null ? '请先安排今日计划' : data.schedule === 'balanced' ? '劳逸结合计划' : '集中做题计划'}。`, `找到缺页${data.found.length}/5组，实际做完${data.completed.length}/5组，两项都完成才可提交。`, '追踪、做题、休息各花一个时段；休息每日最多一次，提前结束当天会放弃剩余时段。', deadline];
    }
  }
}
