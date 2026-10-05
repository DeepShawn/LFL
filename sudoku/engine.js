export const CELL_COUNT = 81;

export function parseGrid(value) {
  if (typeof value !== 'string' || !/^\d{81}$/.test(value)) {
    throw new Error('数独网格必须是 81 位数字字符串');
  }
  return [...value].map(Number);
}

export function cloneGrid(grid) {
  return grid.slice();
}

export function getConflicts(grid, index) {
  const value = grid[index];
  if (!value) return [];
  const row = Math.floor(index / 9);
  const column = index % 9;
  const conflicts = [];
  for (let candidate = 0; candidate < CELL_COUNT; candidate += 1) {
    if (candidate === index || grid[candidate] !== value) continue;
    const candidateRow = Math.floor(candidate / 9);
    const candidateColumn = candidate % 9;
    if (candidateRow === row || candidateColumn === column || (Math.floor(candidateRow / 3) === Math.floor(row / 3) && Math.floor(candidateColumn / 3) === Math.floor(column / 3))) {
      conflicts.push(candidate);
    }
  }
  return conflicts;
}

export function isValidMove(grid, index, value) {
  if (value < 1 || value > 9) return false;
  const next = grid.slice();
  next[index] = 0;
  const row = Math.floor(index / 9);
  const column = index % 9;
  for (let offset = 0; offset < 9; offset += 1) {
    if (next[row * 9 + offset] === value || next[offset * 9 + column] === value) return false;
  }
  const boxRow = Math.floor(row / 3) * 3;
  const boxColumn = Math.floor(column / 3) * 3;
  for (let rowOffset = 0; rowOffset < 3; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < 3; columnOffset += 1) {
      if (next[(boxRow + rowOffset) * 9 + boxColumn + columnOffset] === value) return false;
    }
  }
  return true;
}

export function isSolved(grid, solution) {
  return grid.length === CELL_COUNT && solution.length === CELL_COUNT && grid.every((value, index) => value === solution[index]);
}

export function countSolutions(grid, limit = 2) {
  const working = grid.slice();
  let count = 0;
  const getCandidates = (index) => {
    const row = Math.floor(index / 9);
    const column = index % 9;
    const used = new Set();
    for (let offset = 0; offset < 9; offset += 1) {
      used.add(working[row * 9 + offset]);
      used.add(working[offset * 9 + column]);
    }
    const boxRow = Math.floor(row / 3) * 3;
    const boxColumn = Math.floor(column / 3) * 3;
    for (let rowOffset = 0; rowOffset < 3; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < 3; columnOffset += 1) {
        used.add(working[(boxRow + rowOffset) * 9 + boxColumn + columnOffset]);
      }
    }
    return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((value) => !used.has(value));
  };
  const search = () => {
    if (count >= limit) return;
    let bestIndex = -1;
    let bestCandidates = null;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if (working[index]) continue;
      const candidates = getCandidates(index);
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

export function getWrongCells(grid, solution, givens) {
  return grid.reduce((wrong, value, index) => {
    if (!givens[index] && value && value !== solution[index]) wrong.push(index);
    return wrong;
  }, []);
}

export function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function getBoxStart(index) {
  const row = Math.floor(index / 9);
  const column = index % 9;
  return { row: Math.floor(row / 3) * 3, column: Math.floor(column / 3) * 3 };
}
