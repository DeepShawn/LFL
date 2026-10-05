import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTIES, PUZZLES } from '../puzzles.js';
import {
  countSolutions,
  explainLogicalStep,
  findAllConflicts,
  findLogicalStep,
  findUnitSingleSteps,
  formatTime,
  getCandidates,
  getConflicts,
  getPeers,
  isCompleteGrid,
  isValidMove,
  parseGrid,
} from '../engine.js';

test('题库包含四档且每档至少 100 关', () => {
  assert.deepEqual(DIFFICULTIES.map(({ id }) => id), ['simple', 'normal', 'advanced', 'master']);
  for (const difficulty of DIFFICULTIES) assert.equal(PUZZLES[difficulty.id].length, 100);
});

test('每道题的网格长度、唯一解和初始逻辑步骤都有效', () => {
  for (const difficulty of DIFFICULTIES) {
    for (const puzzle of PUZZLES[difficulty.id]) {
      const grid = parseGrid(puzzle.puzzle);
      const solution = parseGrid(puzzle.solution);
      const givens = grid.filter(Boolean).length;
      assert.equal(grid.length, 81);
      assert.equal(solution.length, 81);
      assert.ok(givens > 0 && givens < 81);
      assert.equal(countSolutions(grid), 1, `${puzzle.id} 必须有唯一解`);
      assert.ok(findLogicalStep(grid), `${puzzle.id} 初始局面必须有可解释逻辑步骤`);
      grid.forEach((value, index) => {
        if (value) assert.equal(value, solution[index], `${puzzle.id} 的线索必须匹配解`);
      });
    }
  }
});

test('错误检查只依据行、列、宫，不依据标准答案', () => {
  const grid = parseGrid(PUZZLES.simple[0].puzzle);
  const emptyIndex = grid.findIndex((value) => value === 0);
  const testIndex = Array.from({ length: 81 }, (_, index) => index).find((index) => !grid[index] && getCandidates(grid, index).length > 1);
  assert.notEqual(testIndex, undefined);
  const candidates = getCandidates(grid, testIndex);
  const legalAlternative = candidates[0];
  assert.equal(isValidMove(grid, testIndex, legalAlternative), true);
  grid[testIndex] = legalAlternative;
  assert.deepEqual(getConflicts(grid, testIndex), []);

  const peer = getPeers(testIndex).find((index) => grid[index]);
  assert.notEqual(peer, undefined);
  const conflictingValue = grid[peer];
  const conflictingGrid = grid.slice();
  conflictingGrid[testIndex] = conflictingValue;
  assert.ok(findAllConflicts(conflictingGrid).includes(testIndex));
  assert.equal(isValidMove(conflictingGrid, testIndex, conflictingValue), false);
});

test('提示步骤包含可读的推理说明', () => {
  const grid = parseGrid(PUZZLES.normal[17].puzzle);
  const step = findLogicalStep(grid);
  assert.ok(step);
  const explanation = explainLogicalStep(step, grid);
  assert.ok(['唯一候选', '隐性唯一', '行列宫唯一空位'].includes(explanation.kindLabel));
  assert.match(explanation.summary, /应填/);
  assert.ok(explanation.details.length >= 2);
});

test('单位只剩一个空位时可以直接确定数字', () => {
  const solution = parseGrid(PUZZLES.simple[0].solution);
  const missingIndex = 8;
  solution[missingIndex] = 0;
  const steps = findUnitSingleSteps(solution);
  assert.equal(steps.length, 3);
  assert.deepEqual([...new Set(steps.map((step) => step.value))], [parseGrid(PUZZLES.simple[0].solution)[missingIndex]]);
});

test('完整状态只用数独规则判定', () => {
  const solution = parseGrid(PUZZLES.normal[17].solution);
  assert.equal(isCompleteGrid(solution), true);
  assert.equal(isCompleteGrid(solution.map((value, index) => (index === 0 ? 0 : value))), false);
  const duplicate = solution.slice();
  duplicate[0] = duplicate[1];
  assert.equal(isCompleteGrid(duplicate), false);
});

test('时间格式', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(3725), '62:05');
});
