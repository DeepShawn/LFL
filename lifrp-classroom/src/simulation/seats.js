import { DIFFICULTY_CONFIG } from './difficulty.js';

const FRONT_SEATS = Array.from({ length: 18 }, (_, index) => ({
  id: `F-${String(index + 1).padStart(2, '0')}`,
  region: 'front',
  row: Math.floor(index / 6) + 1,
  column: (index % 6) + 1,
  special: null,
}));

const BACK_SEATS = Array.from({ length: 18 }, (_, index) => ({
  id: `B-${String(index + 1).padStart(2, '0')}`,
  region: 'back',
  row: Math.floor(index / 6) + 4,
  column: (index % 6) + 1,
  special: null,
}));

const SPECIALS = {
  LZY: { id: 'LZY', region: 'back', row: 5, column: 2, special: 'attention' },
  WYH: { id: 'WYH', region: 'back', row: 6, column: 5, special: 'anomaly' },
  DKH: { id: 'DKH', region: 'back', row: 6, column: 3, special: 'immune' },
};

function withSpecial(base, key) {
  const special = SPECIALS[key];
  return { ...base, ...special };
}

export function generateBackSeatCandidates(difficulty, random = Math.random) {
  const count = DIFFICULTY_CONFIG[difficulty].candidateCount;
  const candidates = [];
  const addSpecial = (key) => {
    if (candidates.length < count && !candidates.some((seat) => seat.id === key)) {
      candidates.push(withSpecial(BACK_SEATS[candidates.length], key));
    }
  };

  if (random() < 0.15) addSpecial('LZY');
  if (random() < 0.3) addSpecial('WYH');
  const dkhAppears = random() < 0.01;

  for (const seat of BACK_SEATS) {
    if (candidates.length >= count) break;
    if (!candidates.some((candidate) => candidate.id === seat.id || candidate.row === seat.row && candidate.column === seat.column)) {
      candidates.push({ ...seat });
    }
  }

  if (dkhAppears && candidates.length && !candidates.some((seat) => seat.id === 'DKH')) {
    candidates[candidates.length - 1] = withSpecial(candidates[candidates.length - 1], 'DKH');
  }

  return {
    region: 'back',
    candidates,
    specialEffects: {
      LZY: '提高课堂点名与老师视线压力',
      WYH: '提高异常事件与附近区域影响',
      DKH: '完全免疫负面效果，但不自动完成目标',
    },
  };
}

export function generateFrontSeatSelection(random = Math.random) {
  const assigned = FRONT_SEATS[Math.floor(random() * FRONT_SEATS.length)] ?? FRONT_SEATS[0];
  const neighbors = FRONT_SEATS.filter((seat) => seat.row === assigned.row && Math.abs(seat.column - assigned.column) === 1);
  return { region: 'front', assigned, neighbors, adjustmentsRemaining: 1 };
}

export function adjustFrontSeat(selection, seatId) {
  if (selection.adjustmentsRemaining < 1) return selection;
  if (!selection.neighbors.some((seat) => seat.id === seatId)) return selection;
  const next = selection.neighbors.find((seat) => seat.id === seatId);
  return { ...selection, assigned: next, adjustmentsRemaining: 0 };
}
