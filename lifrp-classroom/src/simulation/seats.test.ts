import { describe, expect, it } from 'vitest';
import { generateBackSeatCandidates, generateFrontSeatSelection } from './seats';

describe('seat selection', () => {
  it('offers the difficulty-sized candidate pool in the back rows', () => {
    const result = generateBackSeatCandidates('terror', () => 0.9);
    expect(result.candidates).toHaveLength(5);
    expect(result.candidates.every((seat) => seat.region === 'back')).toBe(true);
  });

  it('allows LZY and WYH to coexist while keeping DKH unique', () => {
    const values = [0.01, 0.01, 0.01, 0.99, 0.99, 0.99];
    let index = 0;
    const result = generateBackSeatCandidates('terror', () => values[index++] ?? 0.9);
    const specialIds = result.candidates.filter((seat) => seat.special).map((seat) => seat.id);
    expect(specialIds).toContain('LZY');
    expect(specialIds).toContain('WYH');
    expect(specialIds.filter((id) => id === 'DKH')).toHaveLength(0);
  });

  it('creates at most one DKH candidate at the approved one percent chance', () => {
    const result = generateBackSeatCandidates('hard', () => 0);
    expect(result.candidates.filter((seat) => seat.id === 'DKH')).toHaveLength(1);
  });

  it('gives front rows one adjacent adjustment and no special positions', () => {
    const result = generateFrontSeatSelection(() => 0.1);
    expect(result.assigned.region).toBe('front');
    expect(result.neighbors.length).toBeGreaterThan(0);
    expect(result.neighbors.every((seat) => !seat.special)).toBe(true);
    expect(result.adjustmentsRemaining).toBe(1);
  });
});
