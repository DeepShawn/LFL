import { adjustProbability } from './difficulty.js';

const ROLE_USES = {
  monitor: 2,
  'chemistry-rep': 1,
  student: 1,
};

const BASE_CHANCES = {
  monitor: 0.8,
  'chemistry-rep': 0.6,
  student: 0.4,
};

export function getRoleUses(role) {
  return ROLE_USES[role];
}

export function getDistractionChance(role, difficulty) {
  return adjustProbability(BASE_CHANCES[role], difficulty);
}

export function useRoleAbility(role, remaining) {
  if (remaining <= 0) return { remaining: 0, used: false };
  return { remaining: Math.max(0, remaining - 1), used: true };
}

export function getRoleLabel(role) {
  return {
    monitor: '班长',
    'chemistry-rep': '化学课代表',
    student: '普通同学',
  }[role];
}
