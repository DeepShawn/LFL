import { describe, expect, it } from 'vitest';
import { getStatusTier, resolveOutcome } from './outcomes';

describe('outcomes', () => {
  it('maps internal values to four visible tiers', () => {
    expect(getStatusTier(0)).toBe('平稳');
    expect(getStatusTier(25)).toBe('注意');
    expect(getStatusTier(50)).toBe('紧张');
    expect(getStatusTier(75)).toBe('危险');
  });

  it('prefers terror failure when the terror route was lost', () => {
    expect(resolveOutcome({
      eventGoalMet: true,
      suspicion: 20,
      pressure: 20,
      difficulty: 'terror',
      terrorRouteFailed: true,
    })).toBe('terror');
  });

  it('returns perfect only when goals are met and both states stay low', () => {
    expect(resolveOutcome({
      eventGoalMet: true,
      suspicion: 20,
      pressure: 45,
      difficulty: 'normal',
      terrorRouteFailed: false,
    })).toBe('perfect');
    expect(resolveOutcome({
      eventGoalMet: false,
      suspicion: 20,
      pressure: 20,
      difficulty: 'normal',
      terrorRouteFailed: false,
    })).toBe('ordinary');
  });
});
