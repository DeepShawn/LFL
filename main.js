import { DIFFICULTIES, PUZZLES } from './puzzles.js';
import { formatTime, getConflicts, getWrongCells, isSolved, parseGrid } from './engine.js';

const STORAGE_KEY = 'sudoku-archive-progress-v1';
const DEFAULT_DIFFICULTY = DIFFICULTIES[0].id;
const defaultProgress = () => ({
  selectedDifficulty: DEFAULT_DIFFICULTY,
  currentLevels: Object.fromEntries(DIFFICULTIES.map(({ id }) => [id, 1])),
  completed: Object.fromEntries(DIFFICULTIES.map(({ id }) => [id, 0])),
  records: {},
});

const elements = {
  board: document.querySelector('#board'),
  difficultyList: document.querySelector('#difficulty-list'),
  levelList: document.querySelector('#level-list'),
  levelProgress: document.querySelector('#level-progress'),
  unlockNote: document.querySelector('#unlock-note'),
  stageEyebrow: document.querySelector('#stage-eyebrow'),
  stageTitle: document.querySelector('#stage-title'),
  stageIndex: document.querySelector('#stage-index'),
  timer: document.querySelector('#timer'),
  filledCount: document.querySelector('#filled-count'),
  mistakeCount: document.querySelector('#mistake-count'),
  selectionHint: document.querySelector('#selection-hint'),
  saveStatus: document.querySelector('#save-status'),
  pauseButton: document.querySelector('#pause-button'),
  resetButton: document.querySelector('#reset-button'),
  checkButton: document.querySelector('#check-button'),
  pauseLabel: document.querySelector('#pause-label'),
  pausedCover: document.querySelector('#paused-cover'),
  keypad: document.querySelector('#keypad'),
  toast: document.querySelector('#toast'),
  completeModal: document.querySelector('#complete-modal'),
  completeMessage: document.querySelector('#complete-message'),
  completeTime: document.querySelector('#complete-time'),
  completeLevel: document.querySelector('#complete-level'),
  modalClose: document.querySelector('#modal-close'),
  nextButton: document.querySelector('#next-button'),
};

let progress = loadProgress();
let selectedIndex = -1;
let game = null;
let timerId = null;
let toastId = null;

function loadProgress() {
  const fresh = defaultProgress();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return fresh;
    return {
      ...fresh,
      ...saved,
      currentLevels: { ...fresh.currentLevels, ...(saved.currentLevels || {}) },
      completed: { ...fresh.completed, ...(saved.completed || {}) },
      records: saved.records || {},
    };
  } catch {
    return fresh;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    elements.saveStatus.textContent = '本地进度已保存';
    return true;
  } catch {
    elements.saveStatus.textContent = '本地保存不可用';
    return false;
  }
}

function difficultyById(id) {
  return DIFFICULTIES.find((difficulty) => difficulty.id === id) || DIFFICULTIES[0];
}

function puzzleKey(difficultyId, level) {
  return `${difficultyId}-${String(level).padStart(3, '0')}`;
}

function getCurrentDifficulty() {
  return difficultyById(progress.selectedDifficulty);
}

function getCurrentLevel() {
  const difficulty = getCurrentDifficulty();
  return Math.min(100, Math.max(1, Number(progress.currentLevels[difficulty.id]) || 1));
}

function getPuzzle() {
  return PUZZLES[getCurrentDifficulty().id][getCurrentLevel() - 1];
}

function freshGame(puzzle) {
  const puzzleGrid = parseGrid(puzzle.puzzle);
  const solution = parseGrid(puzzle.solution);
  const key = puzzleKey(getCurrentDifficulty().id, getCurrentLevel());
  const saved = progress.records[key];
  const grid = saved?.grid ? parseGrid(saved.grid) : puzzleGrid.slice();
  return {
    puzzleGrid,
    solution,
    grid: puzzleGrid.map((value, index) => (value ? value : grid[index] || 0)),
    elapsed: Number(saved?.elapsed) || 0,
    mistakes: Number(saved?.mistakes) || 0,
    paused: false,
    completed: false,
  };
}

function saveGame() {
  if (!game) return;
  const difficultyId = getCurrentDifficulty().id;
  const level = getCurrentLevel();
  progress.currentLevels[difficultyId] = level;
  progress.records[puzzleKey(difficultyId, level)] = {
    grid: game.grid.join(''),
    elapsed: game.elapsed,
    mistakes: game.mistakes,
  };
  persist();
}

function renderDifficulties() {
  elements.difficultyList.replaceChildren();
  DIFFICULTIES.forEach((difficulty, index) => {
    const completed = progress.completed[difficulty.id] || 0;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `difficulty-card${difficulty.id === getCurrentDifficulty().id ? ' is-active' : ''}`;
    button.dataset.difficulty = difficulty.id;
    button.setAttribute('aria-pressed', String(difficulty.id === getCurrentDifficulty().id));
    button.innerHTML = `<span class="difficulty-number">0${index + 1}</span><span class="difficulty-name">${difficulty.label}<small>${difficulty.subtitle}</small></span><span class="difficulty-progress">${completed} / 100</span>`;
    elements.difficultyList.append(button);
  });
}

function renderLevels() {
  const difficulty = getCurrentDifficulty();
  const currentLevel = getCurrentLevel();
  const completed = progress.completed[difficulty.id] || 0;
  elements.levelProgress.textContent = `${completed} / 100`;
  elements.levelList.replaceChildren();
  for (let level = 1; level <= 100; level += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'level-button';
    button.textContent = String(level).padStart(2, '0');
    button.dataset.level = String(level);
    button.disabled = level > completed + 1;
    if (level <= completed) button.classList.add('is-completed');
    if (level === currentLevel) button.classList.add('is-current');
    button.setAttribute('aria-label', `第 ${level} 关${button.disabled ? '，未解锁' : ''}`);
    elements.levelList.append(button);
  }
  elements.unlockNote.textContent = completed >= 100 ? '本档案柜已全部归档，可以重玩任意关卡。' : `完成第 ${completed + 1} 关后解锁下一份档案。`;
}

function renderHeader() {
  const difficulty = getCurrentDifficulty();
  const level = getCurrentLevel();
  elements.stageEyebrow.textContent = `${difficulty.id.toUpperCase()} / FILE ${String(level).padStart(3, '0')}`;
  elements.stageTitle.textContent = `${difficulty.label} · ${difficulty.subtitle}`;
  elements.stageIndex.textContent = String(level).padStart(3, '0');
}

function cellLabel(index, value) {
  const row = Math.floor(index / 9) + 1;
  const column = (index % 9) + 1;
  return `第 ${row} 行，第 ${column} 列，${value ? `数字 ${value}` : '空白'}`;
}

function renderBoard() {
  elements.board.replaceChildren();
  const conflictIndexes = selectedIndex >= 0 ? getConflicts(game.grid, selectedIndex) : [];
  const selectedValue = selectedIndex >= 0 ? game.grid[selectedIndex] : 0;
  for (let index = 0; index < 81; index += 1) {
    const cell = document.createElement('button');
    const given = Boolean(game.puzzleGrid[index]);
    const value = game.grid[index];
    const sameRow = selectedIndex >= 0 && Math.floor(index / 9) === Math.floor(selectedIndex / 9);
    const sameColumn = selectedIndex >= 0 && index % 9 === selectedIndex % 9;
    const selectedBox = selectedIndex >= 0 && Math.floor(Math.floor(index / 9) / 3) === Math.floor(Math.floor(selectedIndex / 9) / 3) && Math.floor((index % 9) / 3) === Math.floor((selectedIndex % 9) / 3);
    cell.type = 'button';
    cell.className = `cell${given ? ' is-given' : ''}${index === selectedIndex ? ' is-selected' : ''}${index !== selectedIndex && (sameRow || sameColumn || selectedBox) ? ' is-peer' : ''}${selectedValue && value === selectedValue ? ' is-same-number' : ''}${game.puzzleGrid[index] === 0 && value && value !== game.solution[index] ? ' is-wrong' : ''}${conflictIndexes.includes(index) ? ' is-conflict' : ''}`;
    cell.dataset.index = String(index);
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-selected', String(index === selectedIndex));
    cell.setAttribute('aria-label', cellLabel(index, value));
    cell.textContent = value || '';
    cell.addEventListener('click', () => selectCell(index));
    elements.board.append(cell);
  }
}

function renderMetrics() {
  const filled = game.grid.reduce((count, value) => count + (value ? 1 : 0), 0);
  elements.filledCount.textContent = String(filled);
  elements.mistakeCount.textContent = String(game.mistakes);
  elements.timer.textContent = formatTime(game.elapsed);
  elements.pauseLabel.hidden = !game.paused;
  elements.pausedCover.hidden = !game.paused;
  elements.pauseButton.textContent = game.paused ? '继续计时' : '暂停计时';
}

function renderAll() {
  renderDifficulties();
  renderLevels();
  renderHeader();
  renderBoard();
  renderMetrics();
}

function selectCell(index) {
  if (game.paused) return;
  selectedIndex = index;
  const given = Boolean(game.puzzleGrid[index]);
  elements.selectionHint.textContent = given ? '这是题目线索，选择一个空格填写。' : `第 ${Math.floor(index / 9) + 1} 行 · 第 ${(index % 9) + 1} 列`;
  elements.selectionHint.classList.remove('is-error', 'is-success');
  renderBoard();
}

function setValue(value) {
  if (game.paused) {
    showToast('计时已暂停，继续后再填写。');
    return;
  }
  if (selectedIndex < 0) {
    elements.selectionHint.textContent = '先选择一个空格。';
    elements.selectionHint.classList.add('is-error');
    return;
  }
  if (game.puzzleGrid[selectedIndex]) {
    showToast('线索格不能修改。');
    return;
  }
  const previous = game.grid[selectedIndex];
  if (value === 0) {
    game.grid[selectedIndex] = 0;
  } else {
    game.grid[selectedIndex] = value;
    if (previous !== value && value !== game.solution[selectedIndex]) game.mistakes += 1;
  }
  saveGame();
  renderBoard();
  renderMetrics();
  if (isSolved(game.grid, game.solution)) completeGame();
}

function moveSelection(rowDelta, columnDelta) {
  if (selectedIndex < 0) {
    selectCell(0);
    return;
  }
  const row = Math.floor(selectedIndex / 9);
  const column = selectedIndex % 9;
  const nextRow = Math.max(0, Math.min(8, row + rowDelta));
  const nextColumn = Math.max(0, Math.min(8, column + columnDelta));
  selectCell(nextRow * 9 + nextColumn);
}

function checkAnswer() {
  if (game.paused) return;
  const wrong = getWrongCells(game.grid, game.solution, game.puzzleGrid);
  const empty = game.grid.filter((value) => !value).length;
  if (wrong.length) {
    elements.selectionHint.textContent = `${wrong.length} 个数字需要重新核对。`;
    elements.selectionHint.classList.remove('is-success');
    elements.selectionHint.classList.add('is-error');
    wrong.forEach((index) => {
      const cell = elements.board.querySelector(`[data-index="${index}"]`);
      cell?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 220 });
    });
    showToast('还有数字没有归位。');
    return;
  }
  if (empty) {
    elements.selectionHint.textContent = `还差 ${empty} 格，继续推理。`;
    elements.selectionHint.classList.remove('is-error');
    elements.selectionHint.classList.add('is-success');
    showToast(`还差 ${empty} 格完成档案。`);
    return;
  }
  completeGame();
}

function completeGame() {
  if (game.completed) return;
  game.completed = true;
  game.paused = true;
  stopTimer();
  const difficultyId = getCurrentDifficulty().id;
  const level = getCurrentLevel();
  progress.completed[difficultyId] = Math.max(progress.completed[difficultyId] || 0, level);
  delete progress.records[puzzleKey(difficultyId, level)];
  persist();
  renderAll();
  elements.completeTime.textContent = formatTime(game.elapsed);
  elements.completeLevel.textContent = `${String(level).padStart(3, '0')} / 100`;
  elements.completeMessage.textContent = level >= 100 ? `你用 ${formatTime(game.elapsed)} 完成了这一档的最后一关。` : `你用 ${formatTime(game.elapsed)} 完成了这一关。下一份档案已解锁。`;
  elements.nextButton.textContent = level >= 100 ? '回到档案目录' : '打开下一份档案';
  elements.completeModal.hidden = false;
}

function closeModal() {
  elements.completeModal.hidden = true;
}

function openNext() {
  const level = getCurrentLevel();
  closeModal();
  if (level >= 100) {
    renderAll();
    showToast('这一档的 100 份档案已全部归档。');
    return;
  }
  progress.currentLevels[getCurrentDifficulty().id] = level + 1;
  persist();
  loadGame();
}

function loadGame() {
  stopTimer();
  selectedIndex = -1;
  game = freshGame(getPuzzle());
  renderAll();
  startTimer();
}

function chooseDifficulty(difficultyId) {
  if (difficultyId === getCurrentDifficulty().id) return;
  progress.selectedDifficulty = difficultyId;
  persist();
  loadGame();
}

function chooseLevel(level) {
  const difficulty = getCurrentDifficulty();
  if (level > (progress.completed[difficulty.id] || 0) + 1) {
    showToast('先完成前面的档案，才能解锁这一关。');
    return;
  }
  progress.currentLevels[difficulty.id] = level;
  persist();
  loadGame();
}

function resetGame() {
  if (!game) return;
  game.grid = game.puzzleGrid.slice();
  game.elapsed = 0;
  game.mistakes = 0;
  game.completed = false;
  game.paused = false;
  selectedIndex = -1;
  saveGame();
  renderAll();
  startTimer();
  showToast('本关已重置。');
}

function togglePause() {
  if (game.completed) return;
  game.paused = !game.paused;
  if (game.paused) stopTimer();
  else startTimer();
  saveGame();
  renderMetrics();
}

function startTimer() {
  stopTimer();
  if (game.paused || game.completed) return;
  timerId = window.setInterval(() => {
    game.elapsed += 1;
    elements.timer.textContent = formatTime(game.elapsed);
    if (game.elapsed % 5 === 0) saveGame();
  }, 1000);
}

function stopTimer() {
  if (timerId) window.clearInterval(timerId);
  timerId = null;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  window.clearTimeout(toastId);
  toastId = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 2400);
}

elements.difficultyList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-difficulty]');
  if (button) chooseDifficulty(button.dataset.difficulty);
});
elements.levelList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-level]');
  if (button && !button.disabled) chooseLevel(Number(button.dataset.level));
});
elements.keypad.addEventListener('click', (event) => {
  const button = event.target.closest('[data-value]');
  if (!button) return;
  setValue(button.dataset.value === 'clear' ? 0 : Number(button.dataset.value));
});
elements.checkButton.addEventListener('click', checkAnswer);
elements.pauseButton.addEventListener('click', togglePause);
elements.resetButton.addEventListener('click', resetGame);
elements.modalClose.addEventListener('click', closeModal);
elements.nextButton.addEventListener('click', openNext);
elements.completeModal.addEventListener('click', (event) => {
  if (event.target === elements.completeModal) closeModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key >= '1' && event.key <= '9') {
    event.preventDefault();
    setValue(Number(event.key));
    return;
  }
  if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
    event.preventDefault();
    setValue(0);
    return;
  }
  const movement = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
  if (movement) {
    event.preventDefault();
    moveSelection(...movement);
  }
  if (event.key === 'Escape' && !elements.completeModal.hidden) closeModal();
});

window.addEventListener('pagehide', saveGame);
loadGame();
