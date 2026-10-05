export const MODES = {
  tutorial: { label: '新手教程', drain: 0, enemySpeed: 1.5, searchTime: 4, lampRate: 12, lampCap: 100, clueGain: 10, waterGain: 35, waterCount: 2, checkpoints: 'lesson' },
  easy: { label: '简单', drain: 1, enemySpeed: 2.4, searchTime: 5, lampRate: 5, lampCap: 80, clueGain: 10, waterGain: 30, waterCount: 2, checkpoints: 'frequent' },
  hard: { label: '困难', drain: 1.5, enemySpeed: 3.1, searchTime: 9, lampRate: 3, lampCap: 60, clueGain: 6, waterGain: 20, waterCount: 1, checkpoints: 'chapter' },
};
export const SAVE_VERSION = 2;
export const DEFAULT_SETTINGS = { reducedEffects: false, muted: false, volume: 0.35, quality: 'standard' };
