import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTIES, PUZZLES } from '../puzzles.js';
import { countSolutions, formatTime, getConflicts, getWrongCells, isSolved, isValidMove, parseGrid } from '../engine.js';

test('题库包含四档且每档至少 100 关', () => {
  assert.deepEqual(DIFFICULTIES.map(({ id }) => id), ['simple', 'normal', 'advanced', 'master']);
  for (const difficulty of DIFFICULTIES) assert.equal(PUZZLES[difficulty.id].length, 100);
});

test('每道题的网格长度、线索和解都有效', () => {
  for (const difficulty of DIFFICULTIES) {
    for (const puzzle of PUZZLES[difficulty.id]) {
      const grid = parseGrid(puzzle.puzzle);
      const solution = parseGrid(puzzle.solution);
      const givens = grid.filter(Boolean).length;
      assert.equal(grid.length, 81);
      assert.equal(solution.length, 81);
      assert.ok(givens > 0 && givens < 81);
      assert.equal(countSolutions(grid), 1, `${puzzle.id} 必须有唯一解`);
      grid.forEach((value, index) => {
        if (value) assert.equal(value, solution[index], `${puzzle.id} 的线索必须匹配解`);
      });
    }
  }
});

test('移动校验、冲突检测与错误格检测', () => {
  const puzzle = PUZZLES.simple[0];
  const givens = parseGrid(puzzle.puzzle);
  const solution = parseGrid(puzzle.solution);
  const grid = givens.slice();
  const emptyIndex = grid.findIndex((value) => value === 0);
  assert.equal(isValidMove(grid, emptyIndex, solution[emptyIndex]), true);
  grid[emptyIndex] = solution[emptyIndex];
  assert.deepEqual(getConflicts(grid, emptyIndex), []);
  grid[emptyIndex] = solution[emptyIndex] === 9 ? 8 : 9;
  assert.deepEqual(getWrongCells(grid, solution, givens), [emptyIndex]);
});

test('完成状态与时间格式', () => {
  const puzzle = PUZZLES.normal[17];
  const solution = parseGrid(puzzle.solution);
  const givens = parseGrid(puzzle.puzzle);
  assert.equal(isSolved(solution, solution), true);
  assert.equal(isSolved(givens, solution), false);
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(3725), '62:05');
});
