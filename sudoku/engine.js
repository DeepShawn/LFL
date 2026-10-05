export const CELL_COUNT = 81;
export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const ROW_UNITS = Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, column) => row * 9 + column));
const COLUMN_UNITS = Array.from({ length: 9 }, (_, column) => Array.from({ length: 9 }, (_, row) => row * 9 + column));
const BOX_UNITS = Array.from({ length: 9 }, (_, box) => {
  const startRow = Math.floor(box / 3) * 3;
  const startColumn = (box % 3) * 3;
  return Array.from({ length: 9 }, (_, offset) => {
    const row = startRow + Math.floor(offset / 3);
    const column = startColumn + (offset % 3);
    return row * 9 + column;
  });
});

export const UNITS = [
  ...ROW_UNITS.map((cells, index) => ({ type: 'row', index, cells })),
  ...COLUMN_UNITS.map((cells, index) => ({ type: 'column', index, cells })),
  ...BOX_UNITS.map((cells, index) => ({ type: 'box', index, cells })),
];

export function parseGrid(value) {
  if (typeof value !== 'string' || !/^\d{81}$/.test(value)) {
    throw new Error('数独网格必须是 81 位数字字符串');
  }
  return [...value].map(Number);
}

export function cloneGrid(grid) {
  return grid.slice();
}

export function getRowColumn(index) {
  return { row: Math.floor(index / 9), column: index % 9 };
}

export function getBoxStart(index) {
  const { row, column } = getRowColumn(index);
  return { row: Math.floor(row / 3) * 3, column: Math.floor(column / 3) * 3 };
}

export function getUnitLabel(unit) {
  if (unit.type === 'row') return `第 ${unit.index + 1} 行`;
  if (unit.type === 'column') return `第 ${unit.index + 1} 列`;
  return `第 ${unit.index + 1} 宫`;
}

export function getCoordinate(index) {
  const { row, column } = getRowColumn(index);
  return `第 ${row + 1} 行第 ${column + 1} 列`;
}

export function getPeers(index) {
  const { row, column } = getRowColumn(index);
  const { row: boxRow, column: boxColumn } = getBoxStart(index);
  const peers = new Set();
  for (let offset = 0; offset < 9; offset += 1) {
    peers.add(row * 9 + offset);
    peers.add(offset * 9 + column);
  }
  for (let rowOffset = 0; rowOffset < 3; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < 3; columnOffset += 1) {
      peers.add((boxRow + rowOffset) * 9 + boxColumn + columnOffset);
    }
  }
  peers.delete(index);
  return [...peers];
}

export function getCandidates(grid, index) {
  if (grid[index]) return [];
  const used = new Set();
  for (const peer of getPeers(index)) {
    if (grid[peer]) used.add(grid[peer]);
  }
  return DIGITS.filter((value) => !used.has(value));
}

export function getMoveConflicts(grid, index, value) {
  if (value < 1 || value > 9) return [];
  return getPeers(index).filter((peer) => grid[peer] === value);
}

export function getConflicts(grid, index) {
  const value = grid[index];
  if (!value) return [];
  return getMoveConflicts(grid, index, value);
}

export function findAllConflicts(grid) {
  const conflicts = new Set();
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (!grid[index]) continue;
    for (const peer of getConflicts(grid, index)) {
      conflicts.add(index);
      conflicts.add(peer);
    }
  }
  return [...conflicts].sort((left, right) => left - right);
}

export function isValidMove(grid, index, value) {
  return value >= 1 && value <= 9 && !getMoveConflicts(grid, index, value).length;
}

export function isCompleteGrid(grid) {
  return grid.length === CELL_COUNT && grid.every((value) => value >= 1 && value <= 9) && findAllConflicts(grid).length === 0;
}

export function getDigitCounts(grid) {
  return DIGITS.reduce((counts, value) => {
    counts[value] = grid.reduce((total, cell) => total + (cell === value ? 1 : 0), 0);
    return counts;
  }, {});
}

function getUnitValues(grid, unit) {
  return unit.cells.filter((index) => grid[index]);
}

function getUnitEmptyCells(grid, unit) {
  return unit.cells.filter((index) => !grid[index]);
}

function getUnitMissingDigits(grid, unit) {
  const present = new Set(getUnitValues(grid, unit).map((index) => grid[index]));
  return DIGITS.filter((value) => !present.has(value));
}

export function findUnitSingleSteps(grid) {
  const steps = [];
  for (const unit of UNITS) {
    const emptyCells = getUnitEmptyCells(grid, unit);
    const missingDigits = getUnitMissingDigits(grid, unit);
    if (emptyCells.length !== 1 || missingDigits.length !== 1) continue;
    const index = emptyCells[0];
    if (!isValidMove(grid, index, missingDigits[0])) continue;
    steps.push({
      kind: 'unit-single',
      index,
      value: missingDigits[0],
      unit,
      candidates: [missingDigits[0]],
    });
  }
  return steps;
}

export function findNakedSingleSteps(grid) {
  const steps = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (grid[index]) continue;
    const candidates = getCandidates(grid, index);
    if (candidates.length !== 1) continue;
    steps.push({ kind: 'naked-single', index, value: candidates[0], candidates });
  }
  return steps;
}

export function findHiddenSingleSteps(grid) {
  const steps = [];
  for (const unit of UNITS) {
    const emptyCells = getUnitEmptyCells(grid, unit);
    for (const value of DIGITS) {
      const positions = emptyCells.filter((index) => getCandidates(grid, index).includes(value));
      if (positions.length !== 1) continue;
      const index = positions[0];
      steps.push({
        kind: 'hidden-single',
        index,
        value,
        unit,
        candidates: getCandidates(grid, index),
        positions,
      });
    }
  }
  return steps;
}

export function findLogicalStep(grid) {
  return findUnitSingleSteps(grid)[0] || findNakedSingleSteps(grid)[0] || findHiddenSingleSteps(grid)[0] || null;
}

function valuesText(grid, indexes) {
  const values = indexes.map((index) => grid[index]).filter(Boolean);
  return values.length ? values.join('、') : '暂无';
}

export function explainLogicalStep(step, grid) {
  const coordinate = getCoordinate(step.index);
  const { row, column } = getRowColumn(step.index);
  const rowUnit = ROW_UNITS[row];
  const columnUnit = COLUMN_UNITS[column];
  const boxIndex = Math.floor(row / 3) * 3 + Math.floor(column / 3);
  const boxUnit = BOX_UNITS[boxIndex];
  const candidates = step.candidates || getCandidates(grid, step.index);
  const excluded = DIGITS.filter((value) => !candidates.includes(value));

  if (step.kind === 'unit-single') {
    return {
      title: `${getUnitLabel(step.unit)}只剩一个空位`,
      summary: `${coordinate} 应填 ${step.value}`,
      details: [
        `${getUnitLabel(step.unit)}已有数字：${valuesText(grid, step.unit.cells)}。`,
        `1—9 中只缺数字 ${step.value}，所以这个空位只能填 ${step.value}。`,
      ],
      kindLabel: '行列宫唯一空位',
    };
  }

  if (step.kind === 'hidden-single') {
    const otherPositions = step.unit.cells
      .filter((index) => !grid[index] && index !== step.index && getCandidates(grid, index).includes(step.value))
      .map(getCoordinate);
    return {
      title: `${getUnitLabel(step.unit)}中的数字 ${step.value} 只有一个位置`,
      summary: `${coordinate} 应填 ${step.value}`,
      details: [
        `检查${getUnitLabel(step.unit)}的空格后，数字 ${step.value} 的候选位置只有 ${coordinate}。`,
        otherPositions.length ? `其他候选位置：${otherPositions.join('、')}。` : `其他空格都被所在行、列或宫中的数字排除了。`,
      ],
      kindLabel: '隐性唯一',
    };
  }

  return {
    title: `${coordinate}只剩一个候选数字`,
    summary: `${coordinate} 应填 ${step.value}`,
    details: [
      `这一格所在行已有：${valuesText(grid, rowUnit)}；所在列已有：${valuesText(grid, columnUnit)}；所在宫已有：${valuesText(grid, boxUnit)}。`,
      `因此 1—9 中被排除的数字是：${excluded.length ? excluded.join('、') : '无'}；候选集合只剩 ${step.value}。`,
    ],
    kindLabel: '唯一候选',
  };
}

export function isSolved(grid) {
  return isCompleteGrid(grid);
}

export function countSolutions(grid, limit = 2) {
  const working = grid.slice();
  let count = 0;
  const search = () => {
    if (count >= limit) return;
    let bestIndex = -1;
    let bestCandidates = null;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if (working[index]) continue;
      const candidates = getCandidates(working, index);
      if (!candidates.length) return;
      if (!bestCandidates || candidates.length < bestCandidates.length) {
        bestIndex = index;
        bestCandidates = candidates;
        if (candidates.length === 1) break;
      }
    }
    if (bestIndex === -1) {
      count += 1;
      return;
    }
    for (const value of bestCandidates) {
      working[bestIndex] = value;
      search();
      working[bestIndex] = 0;
      if (count >= limit) return;
    }
  };
  search();
  return count;
}

export function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
