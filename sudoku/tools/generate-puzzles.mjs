import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { findLogicalStep, parseGrid } from '../engine.js';

const SIZE = 9;
const CELL_COUNT = SIZE * SIZE;
const difficultyConfig = [
  { id: 'simple', label: '简单', subtitle: '入门推理', clues: 45, seed: 0x13579bdf },
  { id: 'normal', label: '普通', subtitle: '稳步进阶', clues: 39, seed: 0x2468ace1 },
  { id: 'advanced', label: '高级', subtitle: '深度演算', clues: 33, seed: 0x5bd1e995 },
  { id: 'master', label: '骨灰级', subtitle: '极限挑战', clues: 27, seed: 0x9e3779b9 },
];

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) >>> 0;
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) >>> 0;
    state ^= state >>> 16;
    return (state >>> 0) / 0x100000000;
  };
}

function shuffled(values, random) {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function getCandidates(grid, index) {
  const row = Math.floor(index / SIZE);
  const column = index % SIZE;
  const used = new Set();
  for (let offset = 0; offset < SIZE; offset += 1) {
    used.add(grid[row * SIZE + offset]);
    used.add(grid[offset * SIZE + column]);
  }
  const boxRow = Math.floor(row / 3) * 3;
  const boxColumn = Math.floor(column / 3) * 3;
  for (let rowOffset = 0; rowOffset < 3; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < 3; columnOffset += 1) {
      used.add(grid[(boxRow + rowOffset) * SIZE + boxColumn + columnOffset]);
    }
  }
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((value) => !used.has(value));
}

function findBestEmpty(grid) {
  let bestIndex = -1;
  let bestCandidates = null;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (grid[index]) continue;
    const candidates = getCandidates(grid, index);
    if (!candidates.length) return { index, candidates };
    if (!bestCandidates || candidates.length < bestCandidates.length) {
      bestIndex = index;
      bestCandidates = candidates;
      if (candidates.length === 1) break;
    }
  }
  return { index: bestIndex, candidates: bestCandidates || [] };
}

function fillGrid(random) {
  const grid = Array(CELL_COUNT).fill(0);
  const fill = () => {
    const { index, candidates } = findBestEmpty(grid);
    if (index === -1) return true;
    for (const value of shuffled(candidates, random)) {
      grid[index] = value;
      if (fill()) return true;
    }
    grid[index] = 0;
    return false;
  };
  fill();
  return grid;
}

function countSolutions(grid, limit = 2) {
  const working = grid.slice();
  let count = 0;
  const search = () => {
    if (count >= limit) return;
    const { index, candidates } = findBestEmpty(working);
    if (index === -1) {
      count += 1;
      return;
    }
    for (const value of candidates) {
      working[index] = value;
      search();
      working[index] = 0;
      if (count >= limit) return;
    }
  };
  search();
  return count;
}

function createPuzzle(random, targetClues) {
  const solution = fillGrid(random);
  const puzzle = solution.slice();
  const indexes = shuffled([...Array(CELL_COUNT).keys()], random);
  let clues = CELL_COUNT;
  for (const index of indexes) {
    if (clues <= targetClues) break;
    const previous = puzzle[index];
    puzzle[index] = 0;
    if (countSolutions(puzzle) !== 1) puzzle[index] = previous;
    else clues -= 1;
  }
  return { puzzle: puzzle.join(''), solution: solution.join(''), clues };
}

async function main() {
  const puzzles = {};
  for (const config of difficultyConfig) {
    const random = rng(config.seed);
    puzzles[config.id] = [];
    for (let level = 1; level <= 100; level += 1) {
      let generated = createPuzzle(random, config.clues);
      let attempts = 0;
      while ((generated.clues > config.clues || !findLogicalStep(parseGrid(generated.puzzle))) && attempts < 100) {
        generated = createPuzzle(random, config.clues);
        attempts += 1;
      }
      if (generated.clues > config.clues || !findLogicalStep(parseGrid(generated.puzzle))) {
        throw new Error(`无法为 ${config.id}-${level} 生成可提示题目`);
      }
      puzzles[config.id].push({
        id: `${config.id}-${String(level).padStart(3, '0')}`,
        puzzle: generated.puzzle,
        solution: generated.solution,
      });
    }
  }

  const output = `const DIFFICULTIES = ${JSON.stringify(difficultyConfig.map(({ id, label, subtitle, clues }) => ({ id, label, subtitle, clues })))};\n\nconst PUZZLES = ${JSON.stringify(puzzles)};\n\nexport { DIFFICULTIES, PUZZLES };\n`;
  const destination = resolve(dirname(new URL(import.meta.url).pathname), '../puzzles.js');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, output);
  console.log(`Generated ${Object.values(puzzles).flat().length} puzzles at ${destination}`);
}

main();
