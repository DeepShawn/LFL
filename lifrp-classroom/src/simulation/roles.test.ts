import { describe, expect, it } from 'vitest';
import { getRoleUses, getDistractionChance, useRoleAbility } from './roles';

describe('class roles', () => {
  it('assigns approved daily cooperation counts', () => {
    expect(getRoleUses('monitor')).toBe(2);
    expect(getRoleUses('chemistry-rep')).toBe(1);
    expect(getRoleUses('student')).toBe(1);
  });

  it('applies difficulty modifiers to cooperation chances', () => {
    expect(getDistractionChance('monitor', 'normal')).toBe(0.8);
    expect(getDistractionChance('chemistry-rep', 'simple')).toBe(0.7);
    expect(getDistractionChance('student', 'terror')).toBe(0.2);
  });

  it('spends one daily use without going below zero', () => {
    expect(useRoleAbility('monitor', 2)).toEqual({ remaining: 1, used: true });
    expect(useRoleAbility('student', 0)).toEqual({ remaining: 0, used: false });
  });
});
