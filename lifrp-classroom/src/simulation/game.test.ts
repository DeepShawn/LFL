import { describe, expect, it } from 'vitest';
import {
  act, advance, CHAPTER_EVENTS, createGame, EVENT_DETAILS, getActions, getObjectives, tick,
  type EventId, type GameOptions, type GameState,
} from './game';

const options: GameOptions = {
  name: '测试同学', mode: 'chapters', role: 'monitor', region: 'front',
  seat: { id: 'F-01', row: 1, column: 1, special: null },
  difficulty: 'normal', unlockedChapter: 1,
};
const low = () => 0;
const high = () => 0.99;
const make = (overrides: Partial<GameOptions> = {}) => createGame({ ...options, ...overrides }, low);

function go(state: GameState, room: GameState['room']) {
  act(state, `go:${room}`, low);
  expect(state.room).toBe(room);
}

function evidence(state: GameState, ids: string[], room: GameState['room'] = 'classroom') {
  go(state, room);
  for (const id of ids) act(state, `evidence:${id}`, low);
}

function complete(state: GameState, id: EventId) {
  act(state, `event:${id}`, low);
  switch (id) {
    case 'homework-correction':
      go(state, 'classroom');
      for (const action of ['inspect:q2', 'inspect:q5', 'solve:q2:44', 'solve:q5:balanced', 'submit']) act(state, action, low);
      break;
    case 'snacking':
      go(state, 'classroom');
      for (let i = 0; i < 20 && state.results[id] === 'pending'; i += 1) {
        const food = state.data.snacking;
        if (food.biteRemaining > 0) tick(state, food.biteRemaining);
        if (food.watching && food.safeRemaining <= 0) tick(state, food.watchRemaining + 0.001);
        act(state, 'snack', low);
      }
      break;
    case 'research-question':
      evidence(state, ['blackboard', 'experiment']);
      act(state, 'answer:surface-area', high);
      break;
    case 'untaught-topic':
      evidence(state, ['blackboard', 'textbook']);
      evidence(state, ['witness'], 'corridor');
      go(state, 'classroom');
      for (const action of ['speak:fact', 'speak:clarify', 'speak:learn']) act(state, action, low);
      break;
    case 'copying-suspicion':
      evidence(state, ['work']);
      evidence(state, ['witness'], 'corridor');
      go(state, 'classroom');
      for (const action of ['explain:method', 'difference:reasoning', 'submit']) act(state, action, low);
      break;
    case 'milk-tea':
      evidence(state, ['witness'], 'corridor');
      evidence(state, ['order'], 'office');
      go(state, 'corridor');
      act(state, 'judge:serious', low);
      act(state, 'divert', low);
      break;
    case 'rain':
      evidence(state, ['classroom']);
      evidence(state, ['office'], 'office');
      evidence(state, ['witness'], 'corridor');
      act(state, 'intervene:dialogue', low);
      break;
    case 'holiday-homework':
      go(state, 'classroom');
      act(state, 'schedule:balanced', low);
      for (const action of ['track', 'study', 'track', 'study', 'holiday:next-day', 'schedule:balanced', 'track', 'study', 'track', 'study', 'holiday:next-day', 'schedule:balanced', 'rest', 'track', 'study', 'submit']) act(state, action, low);
      break;
  }
  expect(state.results[id], `${id}: ${state.history.at(-1)}`).toBe('success');
}

function enter(id: EventId, overrides: Partial<GameOptions> = {}) {
  const state = make(overrides);
  for (let chapter = 1; chapter < 5 && !state.events.includes(id); chapter += 1) {
    for (const event of state.events) complete(state, event as EventId);
    expect(state.phase).toBe('between');
    advance(state);
  }
  expect(state.events).toContain(id);
  act(state, `event:${id}`, low);
  return state;
}

function research(overrides: Partial<GameOptions> = {}) {
  const state = enter('research-question', overrides);
  evidence(state, ['blackboard', 'experiment']);
  return state;
}

function tea(overrides: Partial<GameOptions> = {}) {
  const state = enter('milk-tea', overrides);
  evidence(state, ['witness'], 'corridor');
  evidence(state, ['order'], 'office');
  go(state, 'corridor');
  act(state, 'judge:serious', low);
  return state;
}

const immuneSeat = { id: 'DKH', row: 6, column: 3, special: 'immune' };

describe('game contract and progression', () => {
  it('ending in the danger tier produces the bad ending even below immediate-failure cap', () => {
    const state = make({ mode: 'day' });
    complete(state, 'homework-correction');
    state.suspicion = 80;
    complete(state, 'snacking');
    expect(state.phase).toBe('ending');
    expect(state.outcome).toBe('bad');
  });

  it('chemistry representative uses one daily inspection to find both correction notes', () => {
    const state = make({ role: 'chemistry-rep' });
    act(state, 'rep:inspect');
    expect(state.data['homework-correction'].marked).toEqual(['q2', 'q5']);
    expect(state.roleUses).toBe(0);
    const before = JSON.stringify(state);
    act(state, 'rep:inspect');
    expect(JSON.stringify(state)).toBe(before);
  });

  it('starts in chapter one even when all chapters are unlocked', () => {
    const state = make({ unlockedChapter: 5, name: '  林同学  ' });
    expect(state).toMatchObject({ name: '林同学', chapter: 1, day: 1, maxUnlockedChapter: 5, currentEvent: 'homework-correction', view: 'map', room: 'classroom', phase: 'playing', outcome: null, completion: 0, allPerfect: true });
    expect(state.events).toEqual(CHAPTER_EVENTS[1]);
    const before = JSON.stringify(state);
    act(state, 'event:holiday-homework');
    act(state, 'event:made-up');
    advance(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it.each(Object.keys(EVENT_DETAILS) as EventId[])('has a real success route for %s', (id) => {
    const state = enter(id);
    complete(state, id);
    expect(state.results[id]).toBe('success');
    expect(getObjectives(state).every((text) => /[\u4e00-\u9fff]/u.test(text))).toBe(true);
  });

  it('advances all five chapters, days and daily abilities without counting old successes', () => {
    const state = make();
    for (let chapter = 1; chapter <= 5; chapter += 1) {
      expect(state.chapter).toBe(chapter);
      expect(state.roleUses).toBe(2);
      expect(state.completion).toBe(0);
      for (const id of state.events) complete(state, id as EventId);
      expect(state.completion).toBe(100);
      if (chapter < 5) {
        expect(state.phase).toBe('between');
        expect(state.maxUnlockedChapter).toBe(chapter + 1);
        const day = state.day;
        state.roleUses = 0;
        advance(state);
        expect(state.day).toBe(day + 1);
      }
    }
    expect(state).toMatchObject({ phase: 'ending', outcome: 'perfect', maxUnlockedChapter: 5 });
  });

  for (const difficulty of ['simple', 'normal', 'hard', 'terror'] as const) {
    for (const seat of [options.seat, { id: 'LZY', row: 5, column: 2, special: 'attention' }, { id: 'WYH', row: 6, column: 5, special: 'anomaly' }, immuneSeat]) {
      it(`${difficulty}/${seat.id} can finish all eight events across five chapters`, () => {
        const state = make({ difficulty, seat });
        for (let chapter = 1; chapter <= 5; chapter += 1) {
          expect(state.chapter).toBe(chapter);
          for (const id of state.events) complete(state, id as EventId);
          if (chapter < 5) advance(state);
        }
        expect(state.phase).toBe('ending');
        expect(['perfect', 'ordinary']).toContain(state.outcome);
        expect(Object.values(state.results).every((result) => result === 'success')).toBe(true);
      });
    }
  }

  it.each(['day', 'challenge'] as const)('%s finishes its own finite target list', (mode) => {
    const state = make({ mode, unlockedChapter: 5 });
    expect(new Set(state.events).size).toBe(state.events.length);
    expect(state.events.length).toBeLessThanOrEqual(mode === 'day' ? 3 : 4);
    for (const id of state.events) complete(state, id as EventId);
    expect(state).toMatchObject({ phase: 'ending', completion: 100, outcome: 'perfect' });
  });

  it('challenge randomness is injected and restricted to unlocked events', () => {
    const first = createGame({ ...options, mode: 'challenge' }, low);
    const same = createGame({ ...options, mode: 'challenge' }, low);
    expect(first).toEqual(same);
    expect(first.events.slice().sort()).toEqual(CHAPTER_EVENTS[1].slice().sort());
  });

  it('completed actions and ended runs are inert', () => {
    const state = make();
    complete(state, 'homework-correction');
    const snapshot = JSON.stringify(state);
    for (const action of ['submit', 'inspect:q2', 'solve:q2:32', 'event:homework-correction']) act(state, action, high);
    expect(JSON.stringify(state)).toBe(snapshot);
    act(state, 'next');
    expect(state.currentEvent).toBe('snacking');
    complete(state, 'snacking');
    advance(state);
    state.suspicion = 100;
    act(state, 'unknown');
    const ended = JSON.stringify(state);
    expect(tick(state, 100)).toBe(false);
    advance(state);
    act(state, 'caught');
    expect(JSON.stringify(state)).toBe(ended);
  });

  it('round-trips pure JSON midway and keeps deterministic ticking and actions', () => {
    const state = make();
    act(state, 'inspect:q2');
    const restored: GameState = JSON.parse(JSON.stringify(state));
    tick(state, 1.25);
    tick(restored, 1.25);
    for (const action of ['solve:q2:44', 'inspect:q5', 'solve:q5:balanced', 'submit']) {
      expect(act(restored, action, low)).toEqual(act(state, action, low));
    }
    expect(restored).toEqual(state);
  });

  it('does not reset a deadline when changing event or view', () => {
    const state = make();
    tick(state, 3);
    const remaining = state.eventRemaining;
    act(state, 'event:snacking');
    act(state, 'event:homework-correction');
    expect(state.eventRemaining).toBe(remaining);
    act(state, 'switch-view');
    expect(state.view).toBe('first-person');
    act(state, 'switch-view');
    expect(state.view).toBe('first-person');
    tick(state, state.switchRemaining);
    act(state, 'switch-view');
    expect(state.view).toBe('map');
  });

  it('rejects nonfinite/nonpositive dt without state changes', () => {
    const state = make();
    const snapshot = JSON.stringify(state);
    for (const dt of [0, -1, NaN, Infinity]) expect(tick(state, dt)).toBe(false);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('evidence and answers, not repeated-button farming', () => {
  it('requires two distinct marked questions, two chosen solutions and submission', () => {
    const state = make();
    act(state, 'inspect:q2');
    act(state, 'inspect:q2');
    act(state, 'solve:q5:balanced');
    act(state, 'submit');
    expect(state.data['homework-correction'].marked).toEqual(['q2']);
    expect(state.data['homework-correction'].answers.q5).toBeUndefined();
    expect(state.results['homework-correction']).toBe('pending');
    act(state, 'inspect:q5');
    act(state, 'solve:q2:32');
    act(state, 'solve:q5:balanced');
    act(state, 'submit');
    expect(state.results['homework-correction']).toBe('failed');
  });

  it('65% unheard answers do not spend the two heard-wrong attempts', () => {
    const state = research();
    for (let i = 0; i < 8; i += 1) act(state, 'answer:more-gas', () => 0.64999);
    expect(state.data['research-question'].heardWrong).toBe(0);
    act(state, 'answer:more-gas', () => 0.65);
    expect(state.data['research-question'].heardWrong).toBe(1);
    act(state, 'answer:surface-area', () => 0.65);
    expect(state.results['research-question']).toBe('success');
  });

  it('fails on exactly two heard-wrong answers, but correct answers never draw a correctness lottery', () => {
    const wrong = research();
    act(wrong, 'answer:catalyst', high);
    expect(wrong.results['research-question']).toBe('pending');
    act(wrong, 'answer:more-gas', high);
    expect(wrong.results['research-question']).toBe('failed');
    const correct = research();
    let draws = 0;
    act(correct, 'answer:surface-area', () => { draws += 1; return 0.9; });
    expect(draws).toBe(1);
    expect(correct.results['research-question']).toBe('success');
  });

  it.each([['simple', 5], ['normal', 4], ['hard', 3], ['terror', 2]] as const)('limits %s whisper attempts to %i', (difficulty, limit) => {
    const state = enter('research-question', { difficulty });
    for (let i = 0; i < limit + 2; i += 1) act(state, 'listen', high);
    expect(state.data['research-question'].whispers).toBe(limit);
    expect(state.data['research-question'].heardWrong).toBe(0);
  });

  it('uses independent 5% heard and 50% stopped whisper checks', () => {
    const state = enter('research-question');
    let values = [0.0499, 0.5];
    act(state, 'listen', () => values.shift() ?? 1);
    expect(state.data['research-question'].evidence).toHaveLength(1);
    values = [0.0499, 0.4999];
    act(state, 'listen', () => values.shift() ?? 1);
    expect(state.data['research-question'].evidence).toHaveLength(1);
    values = [0.05, 0.5];
    act(state, 'listen', () => values.shift() ?? 1);
    expect(state.data['research-question'].evidence).toHaveLength(1);
  });

  it('requires all untaught evidence and three distinct, ordered polite sentence pieces', () => {
    const state = enter('untaught-topic');
    evidence(state, ['blackboard', 'textbook']);
    act(state, 'speak:fact');
    expect(state.data['untaught-topic'].round).toBe(0);
    evidence(state, ['witness'], 'corridor');
    go(state, 'classroom');
    act(state, 'speak:clarify');
    expect(state.data['untaught-topic'].round).toBe(0);
    act(state, 'speak:fact');
    act(state, 'speak:fact');
    expect(state.data['untaught-topic'].round).toBe(1);
    act(state, 'speak:clarify');
    expect(state.results['untaught-topic']).toBe('pending');
    act(state, 'speak:learn');
    expect(state.results['untaught-topic']).toBe('success');
  });

  it('requires four genuine copying evidence items and differences in reasoning, not false science', () => {
    const state = enter('copying-suspicion');
    evidence(state, ['work', 'work', 'invented', 'explain', 'difference']);
    expect(state.data['copying-suspicion'].evidence).toEqual(['work']);
    act(state, 'difference:wrong-answer');
    expect(state.data['copying-suspicion'].evidence).toEqual(['work']);
    act(state, 'explain:method');
    act(state, 'difference:reasoning');
    act(state, 'submit');
    expect(state.results['copying-suspicion']).toBe('pending');
    evidence(state, ['witness'], 'corridor');
    go(state, 'classroom');
    act(state, 'submit');
    expect(state.results['copying-suspicion']).toBe('success');
  });

  it('does not bypass tea evidence or intention judgment', () => {
    const state = enter('milk-tea');
    evidence(state, ['witness'], 'corridor');
    act(state, 'judge:serious');
    act(state, 'divert', low);
    expect(state.results['milk-tea']).toBe('pending');
    evidence(state, ['order'], 'office');
    go(state, 'corridor');
    act(state, 'divert', low);
    expect(state.results['milk-tea']).toBe('pending');
    act(state, 'judge:joking');
    expect(state.data['milk-tea'].stage).toBe('investigating');
    act(state, 'judge:serious');
    act(state, 'divert', low);
    expect(state.results['milk-tea']).toBe('success');
  });

  it('failed tea distraction opens an actual escape route rather than failing the event', () => {
    const state = tea();
    act(state, 'divert', high);
    expect(state.data['milk-tea'].stage).toBe('evasion');
    expect(state.results['milk-tea']).toBe('pending');
    act(state, 'escape');
    expect(state.results['milk-tea']).toBe('pending');
    act(state, 'route');
    expect(state.phase).toBe('chase');
    expect(state.chase?.goalRoom).toBe('office');
    act(state, 'go:office');
    expect(state.room).toBe('corridor');
    act(state, 'escape');
    expect(state.phase).toBe('chase');
    state.room = 'office';
    state.position = { x: 0, z: 0 };
    act(state, 'escape');
    expect(state.results['milk-tea']).toBe('success');
    expect(state.chase).toBeNull();
  });

  it.each(['dialogue', 'item', 'organize'] as const)('rain needs all three distinct evidence items before %s works', (route) => {
    const state = enter('rain');
    evidence(state, ['classroom', 'classroom']);
    const room = route === 'item' ? 'classroom' : route === 'organize' ? 'office' : 'corridor';
    go(state, room);
    act(state, `intervene:${route}`, low);
    expect(state.results.rain).toBe('pending');
    evidence(state, ['office'], 'office');
    evidence(state, ['witness'], 'corridor');
    go(state, room);
    act(state, `intervene:${route}`, high);
    expect(state.results.rain).toBe('success');
  });

  it('gates blackboard and office clues by the actual room and exposes room actions', () => {
    const topic = enter('untaught-topic');
    go(topic, 'office');
    act(topic, 'evidence:blackboard');
    expect(topic.data['untaught-topic'].evidence).toHaveLength(0);
    expect(getActions(topic).find((action) => action.id === 'evidence:blackboard')?.disabled).toBe(true);
    expect(getActions(topic).some((action) => action.id === 'go:classroom')).toBe(true);
    const rain = enter('rain');
    go(rain, 'classroom');
    act(rain, 'evidence:office');
    expect(rain.data.rain.evidence).toHaveLength(0);
    expect(getActions(rain).some((action) => action.id === 'go:office')).toBe(true);
  });
});

describe('teacher windows, cooperation and seats', () => {
  it.each([['simple', 2], ['normal', 3], ['hard', 4], ['terror', 5]] as const)('%s needs %i bites inside timer-driven windows', (difficulty, count) => {
    const state = enter('snacking', { difficulty });
    expect(state.data.snacking.target).toBe(count);
    expect(state.data.snacking.watching).toBe(true);
    tick(state, state.data.snacking.watchRemaining + 0.01);
    expect(state.data.snacking.watching).toBe(false);
    act(state, 'snack');
    act(state, 'snack');
    expect(state.data.snacking.eaten).toBe(1);
    tick(state, state.data.snacking.watchRemaining + 0.01);
    expect(state.data.snacking.watching).toBe(true);
  });

  it('harsher difficulty and LZY shorten safe windows and lengthen attention', () => {
    const easy = enter('snacking', { difficulty: 'simple' });
    const hard = enter('snacking', { difficulty: 'terror' });
    const lzy = enter('snacking', { seat: { id: 'LZY', row: 5, column: 2, special: 'attention' } });
    const normal = enter('snacking');
    expect(hard.data.snacking.watchDuration).toBeGreaterThan(easy.data.snacking.watchDuration);
    expect(hard.data.snacking.safeDuration).toBeLessThan(easy.data.snacking.safeDuration);
    expect(lzy.data.snacking.safeDuration).toBeLessThan(normal.data.snacking.safeDuration);
    expect(lzy.suspicion).toBeGreaterThan(normal.suspicion);
  });

  for (const role of ['monitor', 'chemistry-rep', 'student'] as const) {
    for (const difficulty of ['simple', 'normal', 'hard', 'terror'] as const) {
      it(`${role}/${difficulty} uses the exact additive cooperation probability and a timed safety window`, () => {
        const base = { monitor: 0.8, 'chemistry-rep': 0.6, student: 0.4 }[role];
        const modifier = { simple: 0.1, normal: 0, hard: -0.1, terror: -0.2 }[difficulty];
        const state = enter('snacking', { role, difficulty });
        const failed: GameState = JSON.parse(JSON.stringify(state));
        const uses = role === 'monitor' ? 2 : 1;
        act(state, 'distract', () => base + modifier - 0.00001);
        expect(state.roleUses).toBe(uses - 1);
        expect(state.data.snacking.safeRemaining).toBeGreaterThan(0);
        act(state, 'snack');
        expect(state.data.snacking.eaten).toBe(1);
        tick(state, state.data.snacking.safeRemaining);
        expect(state.data.snacking.safeRemaining).toBe(0);
        act(failed, 'distract', () => base + modifier);
        expect(failed.data.snacking.safeRemaining).toBe(0);
        while (failed.roleUses > 0) act(failed, 'distract', high);
        const snapshot = JSON.stringify(failed);
        act(failed, 'distract', low);
        expect(JSON.stringify(failed)).toBe(snapshot);
      });
    }
  }

  it('DKH suppresses negative state, deadlines, wrong-answer failure and chasing, not objectives', () => {
    const state = research({ seat: immuneSeat, difficulty: 'terror' });
    const { suspicion, pressure, eventRemaining } = state;
    tick(state, 10000);
    expect(state).toMatchObject({ suspicion, pressure, eventRemaining, phase: 'playing', chase: null });
    act(state, 'answer:more-gas', high);
    act(state, 'answer:more-gas', high);
    act(state, 'caught');
    expect(state).toMatchObject({ suspicion, pressure, phase: 'playing', chase: null });
    expect(state.results['research-question']).toBe('pending');
    act(state, 'answer:surface-area', high);
    expect(state.results['research-question']).toBe('success');
  });

  it('DKH still has to reach the milk-tea route goal, without a chase penalty', () => {
    const state = tea({ seat: immuneSeat, difficulty: 'terror' });
    act(state, 'divert', high);
    act(state, 'route');
    expect(state.chase).toBeNull();
    act(state, 'escape');
    expect(state.results['milk-tea']).toBe('pending');
    go(state, 'office');
    act(state, 'escape');
    expect(state.results['milk-tea']).toBe('success');
  });

  it('DKH blocks wrong correction, failed cooperation and stopped whisper penalties without granting goals', () => {
    const correction = make({ seat: immuneSeat, difficulty: 'terror' });
    for (const action of ['inspect:q2', 'inspect:q5', 'solve:q2:32', 'solve:q5:unbalanced', 'submit']) act(correction, action, high);
    expect(correction.results['homework-correction']).toBe('pending');
    expect(correction).toMatchObject({ suspicion: 0, pressure: 0, chase: null, completion: 0 });
    complete(correction, 'homework-correction');
    act(correction, 'event:snacking');
    act(correction, 'distract', high);
    expect(correction).toMatchObject({ suspicion: 0, pressure: 0, chase: null, roleUses: 1 });
    expect(correction.results.snacking).toBe('pending');
    act(correction, 'snack');
    expect(correction.data.snacking.eaten).toBe(1);
    const question = enter('research-question', { seat: immuneSeat, difficulty: 'terror' });
    act(question, 'listen', low);
    expect(question).toMatchObject({ suspicion: 0, pressure: 0, chase: null });
    expect(question.results['research-question']).toBe('pending');
  });

  it('DKH freezes the holiday deadline budget but still requires five pages and five batches', () => {
    const state = enter('holiday-homework', { seat: immuneSeat, difficulty: 'terror' });
    go(state, 'classroom');
    act(state, 'schedule:focused');
    const deadline = state.eventRemaining;
    for (let i = 0; i < 5; i += 1) act(state, 'track');
    expect(state.data['holiday-homework']).toMatchObject({ found: [1, 2, 3, 4, 5], completed: [] });
    expect(state).toMatchObject({ pressure: 0, eventRemaining: deadline, phase: 'playing' });
    act(state, 'submit');
    expect(state.results['holiday-homework']).toBe('pending');
    for (let i = 0; i < 5; i += 1) act(state, 'study');
    expect(state.results['holiday-homework']).toBe('pending');
    act(state, 'submit');
    expect(state).toMatchObject({ phase: 'ending', outcome: 'perfect' });
  });

  it('WYH increases anomalous pressure and the danger of a hard chase', () => {
    const normal = make({ difficulty: 'hard' });
    const wyh = make({ difficulty: 'hard', seat: { id: 'WYH', row: 6, column: 5, special: 'anomaly' } });
    tick(normal, normal.eventRemaining + 1);
    tick(wyh, wyh.eventRemaining + 1);
    expect(wyh.pressure).toBeGreaterThan(normal.pressure);
    expect(wyh.chase!.remaining).toBeLessThan(normal.chase!.remaining);
  });
});

describe('holiday scheduling and failure recovery', () => {
  it('tracking is not work, needs a schedule, and costs finite time slots', () => {
    const state = enter('holiday-homework');
    go(state, 'classroom');
    act(state, 'track');
    expect(state.data['holiday-homework'].found).toHaveLength(0);
    act(state, 'schedule:focused');
    const remaining = state.eventRemaining;
    for (let i = 0; i < 4; i += 1) act(state, 'track');
    expect(state.data['holiday-homework']).toMatchObject({ found: [1, 2, 3, 4], completed: [], slotsRemaining: 0 });
    expect(state.eventRemaining).toBeLessThan(remaining);
    act(state, 'holiday:next-day');
    act(state, 'schedule:focused');
    act(state, 'track');
    act(state, 'submit');
    expect(state.results['holiday-homework']).toBe('pending');
    expect(state.data['holiday-homework'].completed).toHaveLength(0);
  });

  it('rest spends a slot and time and cannot be spammed for recovery', () => {
    const state = enter('holiday-homework');
    go(state, 'classroom');
    act(state, 'schedule:balanced');
    state.pressure = 70;
    const remaining = state.eventRemaining;
    act(state, 'rest');
    expect(state.pressure).toBe(57);
    expect(state.data['holiday-homework'].slotsRemaining).toBe(3);
    expect(state.eventRemaining).toBeLessThan(remaining);
    const snapshot = JSON.stringify(state);
    for (let i = 0; i < 10; i += 1) act(state, 'rest');
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('running out of all three days resolves failure rather than deadlocking', () => {
    const state = enter('holiday-homework');
    go(state, 'classroom');
    for (let i = 0; i < 3; i += 1) {
      act(state, 'schedule:balanced');
      act(state, 'holiday:next-day');
    }
    expect(state.results['holiday-homework']).toBe('failed');
    expect(state.phase).toBe('ending');
    expect(state.outcome).toBe('ordinary');
  });

  it('lets the last available slot finish the final batch before submission', () => {
    const state = enter('holiday-homework');
    go(state, 'classroom');
    const actions = ['schedule:balanced', 'track', 'study', 'track', 'study', 'holiday:next-day', 'schedule:balanced', 'track', 'study', 'rest', 'track', 'holiday:next-day', 'schedule:balanced', 'study', 'rest', 'track', 'study'];
    for (const action of actions) act(state, action, low);
    expect(state.data['holiday-homework']).toMatchObject({ day: 3, slotsRemaining: 0, completed: [1, 2, 3, 4, 5] });
    expect(state.results['holiday-homework']).toBe('pending');
    expect(getActions(state).find((action) => action.id === 'submit')?.disabled).toBe(false);
    act(state, 'submit');
    expect(state.results['holiday-homework']).toBe('success');
  });

  it.each(['track', 'holiday:next-day'])('returns the actual terminal message when %s crosses the deadline', (action) => {
    const state = enter('holiday-homework', { difficulty: 'terror' });
    go(state, 'classroom');
    act(state, 'schedule:focused');
    state.eventRemaining = 1;
    const result = act(state, action);
    expect(['chase', 'ending']).toContain(state.phase);
    expect(result.tone).toBe('danger');
    expect(result.message).toBe(state.history.at(-1));
    expect(state.data['holiday-homework'].found).toHaveLength(0);
  });

  it('does not report a successful study action when its pressure immediately ends the run', () => {
    const state = enter('holiday-homework');
    go(state, 'classroom');
    act(state, 'schedule:focused');
    act(state, 'track');
    state.pressure = 95;
    const result = act(state, 'study');
    expect(state).toMatchObject({ phase: 'ending', outcome: 'bad', pressure: 100 });
    expect(result.tone).toBe('danger');
    expect(result.message).toMatch(/极限|结束/u);
    expect(state.history.at(-1)).toMatch(/极限|结束/u);
  });

  it.each(['simple', 'normal', 'hard', 'terror'] as const)('%s event failure always allows progress or an ending', (difficulty) => {
    const state = make({ difficulty });
    const before = { suspicion: state.suspicion, pressure: state.pressure };
    tick(state, state.eventRemaining + 1);
    expect(state.results['homework-correction']).toBe('failed');
    expect(state.allPerfect).toBe(false);
    if (difficulty === 'simple') expect(state).toMatchObject(before);
    else expect(state.suspicion).toBeGreaterThan(before.suspicion);
    if (difficulty === 'hard' || difficulty === 'terror') {
      expect(state.phase).toBe('chase');
      act(state, 'escape');
      expect(state.phase).toBe('chase');
      state.room = state.chase!.goalRoom;
      act(state, 'escape');
      expect(state.phase).toBe('playing');
    }
    act(state, 'next');
    complete(state, 'snacking');
    expect(state.phase).toBe('between');
    expect(state.completion).toBe(50);
    advance(state);
    expect(state.chapter).toBe(2);
  });

  it.each(['simple', 'normal'] as const)('%s milk-tea evasion failure follows its nonterminal failure policy', (difficulty) => {
    for (const collision of [true, false]) {
      const state = tea({ difficulty });
      const before = { suspicion: state.suspicion, pressure: state.pressure };
      act(state, 'divert', high);
      act(state, 'route');
      if (collision) act(state, 'caught');
      else tick(state, state.chase!.remaining);
      expect(state.results['milk-tea']).toBe('failed');
      expect(state).toMatchObject({ phase: 'playing', chase: null, outcome: null });
      if (difficulty === 'simple') expect(state).toMatchObject(before);
      else expect(state.suspicion).toBeGreaterThan(before.suspicion);
      complete(state, 'copying-suspicion');
      expect(state.phase).toBe('between');
    }
  });

  it.each(['hard', 'terror'] as const)('%s chase collision or timeout ends without auto-escape', (difficulty) => {
    for (const collision of [true, false]) {
      const state = make({ difficulty });
      tick(state, state.eventRemaining + 0.1);
      const distance = state.chase!.distance;
      tick(state, 0.25);
      expect(state.chase!.distance).toBe(distance);
      if (collision) act(state, 'caught');
      else tick(state, state.chase!.remaining);
      expect(state).toMatchObject({ phase: 'ending', outcome: difficulty === 'terror' ? 'terror' : 'bad', chase: null });
    }
  });

  it.each(['suspicion', 'pressure'] as const)('%s at 100 immediately ends through any public mutator', (field) => {
    for (const mutate of [(state: GameState) => act(state, 'inspect:q2'), (state: GameState) => tick(state, 0), advance]) {
      const state = make();
      state[field] = 100;
      mutate(state);
      expect(state).toMatchObject({ phase: 'ending', outcome: 'bad' });
    }
  });

  it('a failed final event settles the chapter after physically escaping', () => {
    const state = enter('milk-tea', { difficulty: 'hard' });
    complete(state, 'copying-suspicion');
    act(state, 'event:milk-tea');
    tick(state, state.eventRemaining);
    expect(state.phase).toBe('chase');
    const snapshot = JSON.stringify(state);
    for (const action of ['event:copying-suspicion', 'next', 'go:office']) act(state, action);
    expect(JSON.stringify(state)).toBe(snapshot);
    state.room = state.chase!.goalRoom;
    act(state, 'escape');
    expect(state).toMatchObject({ phase: 'between', completion: 50, allPerfect: false });
    advance(state);
    expect(state).toMatchObject({ chapter: 4, day: 4, roleUses: 2 });
  });

  it.each(['day', 'challenge'] as const)('%s ends normally with resolved failures rather than waiting for impossible success', (mode) => {
    const state = make({ mode, difficulty: 'simple' });
    for (const id of state.events) {
      act(state, `event:${id}`);
      tick(state, state.eventRemaining);
    }
    expect(state).toMatchObject({ phase: 'ending', outcome: 'ordinary', completion: 0, allPerfect: false });
  });

  it.each(Object.keys(EVENT_DETAILS) as EventId[])('completed %s cannot be farmed for progress or recovery', (id) => {
    const state = enter(id);
    const actions = getActions(state).map((action) => action.id).filter((action) => !action.startsWith('go:') && !action.startsWith('event:') && action !== 'switch-view');
    complete(state, id);
    const snapshot = JSON.stringify(state);
    for (const action of actions) act(state, action, high);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('actions and objectives provide useful Chinese text and all event-specific choices', () => {
    const expected: Record<EventId, string[]> = {
      'homework-correction': ['inspect:q2', 'inspect:q5', 'solve:q2:44', 'solve:q5:balanced', 'submit'],
      snacking: ['snack', 'distract'],
      'research-question': ['evidence:blackboard', 'evidence:experiment', 'answer:surface-area', 'answer:more-gas', 'listen'],
      'untaught-topic': ['evidence:blackboard', 'evidence:textbook', 'evidence:witness', 'speak:fact', 'speak:clarify', 'speak:learn'],
      'copying-suspicion': ['evidence:work', 'evidence:witness', 'explain:method', 'difference:reasoning', 'submit'],
      'milk-tea': ['evidence:witness', 'evidence:order', 'judge:serious', 'divert', 'route'],
      rain: ['evidence:classroom', 'evidence:office', 'evidence:witness', 'intervene:dialogue', 'intervene:item', 'intervene:organize'],
      'holiday-homework': ['schedule:balanced', 'schedule:focused', 'track', 'study', 'rest', 'holiday:next-day', 'submit'],
    };
    for (const id of Object.keys(EVENT_DETAILS) as EventId[]) {
      const state = enter(id);
      const actions = getActions(state);
      expect(new Set(actions.map((action) => action.id)).size).toBe(actions.length);
      for (const action of expected[id]) expect(actions.some((item) => item.id === action), `${id}/${action}`).toBe(true);
      for (const action of actions) expect(action.label).toMatch(/[\u4e00-\u9fff]/u);
      expect(getObjectives(state).length).toBeGreaterThan(0);
    }
  });
});
