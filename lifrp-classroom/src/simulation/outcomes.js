export function clampState(value) {
  return Math.min(100, Math.max(0, value));
}

export function getStatusTier(value) {
  if (value < 25) return '平稳';
  if (value < 50) return '注意';
  if (value < 75) return '紧张';
  return '危险';
}

export function resolveOutcome({ eventGoalMet, suspicion, pressure, difficulty, terrorRouteFailed }) {
  if (difficulty === 'terror' && terrorRouteFailed) return 'terror';
  if (suspicion >= 100 || pressure >= 100) return 'bad';
  if (eventGoalMet && suspicion < 50 && pressure < 50) return 'perfect';
  if (eventGoalMet) return 'ordinary';
  return 'bad';
}

export const OUTCOME_LABELS = {
  perfect: '完美结局',
  ordinary: '普通成功',
  bad: '坏结局',
  terror: '恐怖结局',
};
