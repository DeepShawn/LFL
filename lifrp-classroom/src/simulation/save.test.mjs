import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameState, saveGameState } from './save.js';

test('save data round-trips through a storage-like object', () => {
  const storage = new Map();
  const state = { mode: 'chapters', day: 2, suspicion: 24, pressure: 48 };
  saveGameState(state, storage);
  assert.deepEqual(loadGameState(storage, 'chapters'), state);
});
