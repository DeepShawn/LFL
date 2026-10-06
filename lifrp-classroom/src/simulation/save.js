const SAVE_PREFIX = 'lifrp-classroom:save:';

export function saveGameState(state, storage = window.localStorage) {
  const key = `${SAVE_PREFIX}${state.mode}`;
  const value = JSON.stringify(state);
  if (typeof storage.setItem === 'function') storage.setItem(key, value);
  else storage.set(key, value);
}

export function loadGameState(storage, mode) {
  if (!storage) return null;
  const key = `${SAVE_PREFIX}${mode}`;
  const raw = typeof storage.getItem === 'function' ? storage.getItem(key) : storage.get(key);
  return raw ? JSON.parse(raw) : null;
}

export function clearGameState(storage, mode) {
  const key = `${SAVE_PREFIX}${mode}`;
  if (typeof storage.removeItem === 'function') storage.removeItem(key);
  else storage.delete(key);
}
