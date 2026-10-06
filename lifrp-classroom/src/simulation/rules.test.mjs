import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY_CONFIG, difficultyFromRoll, getPromptCount } from './difficulty.js';
import { generateBackSeatCandidates, generateFrontSeatSelection } from './seats.js';
import { getDistractionChance, getRoleUses } from './roles.js';
import { getInitialUnlocks, getUnlocksAfterChapter } from './modes.js';
import { getStatusTier, resolveOutcome } from './outcomes.js';
import { applyFailurePolicy, getSnackTargetCount } from '../events/eventRules.js';

test('difficulty distribution and scaling are locked', () => {
  assert.equal(difficultyFromRoll(0.05), 'simple');
  assert.equal(difficultyFromRoll(0.2), 'normal');
  assert.equal(difficultyFromRoll(0.6), 'hard');
  assert.equal(difficultyFromRoll(0.95), 'terror');
  assert.equal(DIFFICULTY_CONFIG.terror.switchSeconds, 3);
  assert.equal(getPromptCount('terror'), 2);
  assert.equal(getSnackTargetCount('terror'), 5);
});

test('seat rules keep DKH unique and allow LZY/WYH together', () => {
  const values = [0.01, 0.01, 0.99, 0.99, 0.99, 0.99];
  let index = 0;
  const result = generateBackSeatCandidates('terror', () => values[index++] ?? 0.99);
  const ids = result.candidates.filter((seat) => seat.special).map((seat) => seat.id);
  assert.ok(ids.includes('LZY'));
  assert.ok(ids.includes('WYH'));
  assert.equal(ids.filter((id) => id === 'DKH').length, 0);
  assert.equal(generateBackSeatCandidates('hard', () => 0).candidates.filter((seat) => seat.id === 'DKH').length, 1);
});

test('roles, unlocks and outcomes follow the approved rules', () => {
  assert.equal(getRoleUses('monitor'), 2);
  assert.equal(getRoleUses('student'), 1);
  assert.equal(getDistractionChance('student', 'terror'), 0.2);
  assert.deepEqual(getInitialUnlocks(), { day: true, chapters: [1], challenge: false, eventCount: 2, dayEventCount: 2, events: ['homework-correction', 'snacking'] });
  assert.equal(getUnlocksAfterChapter(1).challenge, true);
  assert.equal(getUnlocksAfterChapter(5).eventCount, 8);
  assert.equal(getStatusTier(75), '危险');
  assert.equal(resolveOutcome({ eventGoalMet: true, suspicion: 20, pressure: 45, difficulty: 'normal', terrorRouteFailed: false }), 'perfect');
  assert.equal(applyFailurePolicy('hard').chase, true);
});
