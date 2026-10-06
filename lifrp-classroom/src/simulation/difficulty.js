export const DIFFICULTY_CONFIG = {
  simple: {
    label: '简单',
    switchSeconds: 1,
    candidateCount: 2,
    timeMultiplier: 1.35,
    attentionMultiplier: 0.75,
    stateMultiplier: 0.75,
    probabilityModifier: 0.1,
    promptAttempts: 5,
  },
  normal: {
    label: '普通',
    switchSeconds: 1.5,
    candidateCount: 3,
    timeMultiplier: 1,
    attentionMultiplier: 1,
    stateMultiplier: 1,
    probabilityModifier: 0,
    promptAttempts: 4,
  },
  hard: {
    label: '困难',
    switchSeconds: 2,
    candidateCount: 4,
    timeMultiplier: 0.8,
    attentionMultiplier: 1.25,
    stateMultiplier: 1.25,
    probabilityModifier: -0.1,
    promptAttempts: 3,
  },
  terror: {
    label: '恐怖',
    switchSeconds: 3,
    candidateCount: 5,
    timeMultiplier: 0.6,
    attentionMultiplier: 1.5,
    stateMultiplier: 1.5,
    probabilityModifier: -0.2,
    promptAttempts: 2,
  },
};

export function difficultyFromRoll(roll) {
  if (roll < 0.1) return 'simple';
  if (roll < 0.4) return 'normal';
  if (roll < 0.8) return 'hard';
  return 'terror';
}

export function getPromptCount(difficulty) {
  return DIFFICULTY_CONFIG[difficulty].promptAttempts;
}

export function getProbabilityModifier(difficulty) {
  return DIFFICULTY_CONFIG[difficulty].probabilityModifier;
}

export function adjustProbability(base, difficulty) {
  const modifier = getProbabilityModifier(difficulty);
  return Math.min(1, Math.max(0, base + modifier));
}

export function pickDifficulty(random = Math.random) {
  return difficultyFromRoll(random());
}
