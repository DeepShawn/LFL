import { describe, expect, it } from 'vitest';
import { applyFailurePolicy, getSnackTargetCount, getResearchPromptAttempts } from './eventRules';

describe('shared event rules', () => {
  it('scales snack targets with difficulty', () => {
    expect(getSnackTargetCount('simple')).toBe(2);
    expect(getSnackTargetCount('normal')).toBe(3);
    expect(getSnackTargetCount('hard')).toBe(4);
    expect(getSnackTargetCount('terror')).toBe(5);
  });

  it('scales research prompts with difficulty', () => {
    expect(getResearchPromptAttempts('simple')).toBe(5);
    expect(getResearchPromptAttempts('terror')).toBe(2);
  });

  it('uses the approved failure severity ladder', () => {
    expect(applyFailurePolicy('simple')).toEqual({ kind: 'continue', suspicion: 0, pressure: 0, chase: false });
    expect(applyFailurePolicy('normal')).toEqual({ kind: 'continue', suspicion: 12, pressure: 10, chase: false });
    expect(applyFailurePolicy('hard').chase).toBe(true);
    expect(applyFailurePolicy('terror').chase).toBe(true);
  });
});
