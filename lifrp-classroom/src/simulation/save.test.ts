import { describe, expect, it } from 'vitest';
import { loadGameState, saveGameState } from './save';
import type { GameState } from './types';

const state: GameState = {
  version: 1,
  playerName: 'Lin',
  mode: 'chapters',
  difficulty: 'hard',
  role: 'student',
  region: 'back',
  seatId: 'LZY',
  day: 2,
  chapter: 2,
  unlockedEvents: ['homework-correction'],
  eventStates: {
    'homework-correction': 'success',
  },
  suspicion: 24,
  pressure: 48,
  completion: 100,
  currentEvent: 'homework-correction',
  view: 'map',
  roleUsesRemaining: 1,
  flags: { terrorRouteFailed: false },
  outcome: null,
};

describe('save data', () => {
  it('round-trips mode state through a storage-like object', () => {
    const storage = new Map<string, string>();
    saveGameState(state, storage);
    expect(loadGameState(storage)).toEqual(state);
  });
});
