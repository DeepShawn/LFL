import { describe, expect, it } from 'vitest';
import { getInitialUnlocks, getUnlocksAfterChapter } from './modes';

describe('mode progression', () => {
  it('starts day survival and chapter one, but not random challenge', () => {
    expect(getInitialUnlocks()).toEqual({ day: true, chapters: [1], challenge: false });
  });

  it('unlocks challenge after chapter one and all events after chapter five', () => {
    expect(getUnlocksAfterChapter(1).challenge).toBe(true);
    expect(getUnlocksAfterChapter(2).dayEventCount).toBeGreaterThan(1);
    expect(getUnlocksAfterChapter(5).eventCount).toBe(8);
  });
});
