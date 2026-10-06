import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_CONFIG,
  difficultyFromRoll,
  getProbabilityModifier,
  getPromptCount,
} from './difficulty';

describe('hidden difficulty', () => {
  it('uses the approved challenge-heavy distribution', () => {
    expect(difficultyFromRoll(0.05)).toBe('simple');
    expect(difficultyFromRoll(0.2)).toBe('normal');
    expect(difficultyFromRoll(0.6)).toBe('hard');
    expect(difficultyFromRoll(0.95)).toBe('terror');
  });

  it('keeps the approved view-switch timings and candidate counts', () => {
    expect(DIFFICULTY_CONFIG.simple.switchSeconds).toBe(1);
    expect(DIFFICULTY_CONFIG.normal.switchSeconds).toBe(1.5);
    expect(DIFFICULTY_CONFIG.hard.switchSeconds).toBe(2);
    expect(DIFFICULTY_CONFIG.terror.switchSeconds).toBe(3);
    expect(DIFFICULTY_CONFIG.simple.candidateCount).toBe(2);
    expect(DIFFICULTY_CONFIG.terror.candidateCount).toBe(5);
  });

  it('reduces prompt attempts with higher difficulty', () => {
    expect(getPromptCount('simple')).toBe(5);
    expect(getPromptCount('normal')).toBe(4);
    expect(getPromptCount('hard')).toBe(3);
    expect(getPromptCount('terror')).toBe(2);
  });

  it('applies the shared probability adjustment', () => {
    expect(getProbabilityModifier('simple')).toBe(0.1);
    expect(getProbabilityModifier('normal')).toBe(0);
    expect(getProbabilityModifier('hard')).toBe(-0.1);
    expect(getProbabilityModifier('terror')).toBe(-0.2);
  });
});
