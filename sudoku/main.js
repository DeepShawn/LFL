import { DIFFICULTIES, PUZZLES } from './puzzles.js';
import {
  DIGITS,
  explainLogicalStep,
  findAllConflicts,
  findLogicalStep,
  findForcedUnitStep,
  formatTime,
  getCandidates,
  getConflicts,
  getDigitCounts,
  getPeers,
  isCompleteGrid,
  isValidMove,
  parseGrid,
} from './engine.js';

const STORAGE_KEY = 'sudoku-archive-progress-v1';
const DEFAULT_DIFFICULTY = DIFFICULTIES[0].id;
const defaultProgress = () => ({
  selectedDifficulty: DEFAULT_DIFFICULTY,
  currentLevels: Object.fromEntries(DIFFICULTIES.map(({ id }) => [id, 1])),
  completed: Object.fromEntries(DIFFICULTIES.map(({ id }) => [id, 0])),
  records: {},
  theme: 'night',
});

const elements = {
  body: document.body,
  menuScreen: document.querySelector('#menu-screen'),
  gameScreen: document.querySelector('#game-screen'),
  saveStatus: document.querySelector('#save-status'),
  menuThemeToggle: document.querySelector('#menu-theme-toggle'),
  gameThemeToggle: document.querySelector('#game-theme-toggle'),
  difficultyList: document.querySelector('#difficulty-list'),
  levelList: document.querySelector('#level-list'),
  levelProgress: document.querySelector('#level-progress'),
  unlockNote: document.querySelector('#unlock-note'),
  startButton: document.querySelector('#start-button'),
  menuButton: document.querySelector('#menu-button'),
  board: document.querySelector('#board'),
  stageEyebrow: document.querySelector('#stage-eyebrow'),
  stageDifficulty: document.querySelector('#stage-difficulty'),
  stageTitle: document.querySelector('#stage-title'),
  stageIndex: document.querySelector('#stage-index'),
  timer: document.querySelector('#timer'),
  filledCount: document.querySelector('#filled-count'),
  mistakeCount: document.querySelector('#mistake-count'),
  selectionHint: document.querySelector('#selection-hint'),
  pauseButton: document.querySelector('#pause-button'),
  resetButton: document.querySelector('#reset-button'),
  checkButton: document.querySelector('#check-button'),
  pauseLabel: document.querySelector('#pause-label'),
  pausedCover: document.querySelector('#paused-cover'),
  keypad: document.querySelector('#keypad'),
  clearButton: document.querySelector('#clear-button'),
  notesButton: document.querySelector('#notes-button'),
  hintButton: document.querySelector('#hint-button'),
  hintLabel: document.querySelector('#hint-label'),
  logicKind: document.querySelector('#logic-kind'),
  logicTitle: document.querySelector('#logic-title'),
  logicDetails: document.querySelector('#logic-details'),
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
let highlightedDigit = 0;
let forcedDigit = 0;
let game = null;
let boardCells = [];
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
      theme: saved.theme === 'day' ? 'day' : fresh.theme,
    };
  } catch {
    return fresh;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    if (elements.saveStatus) elements.saveStatus.textContent = '本地进度已保存';
    return true;
  } catch {
    if (elements.saveStatus) elements.saveStatus.textContent = '本地保存不可用';
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

function sanitizeGrid(puzzleGrid, savedGrid) {
  const grid = puzzleGrid.slice();
  const candidate = Array.isArray(savedGrid) ? savedGrid : [];
  for (let index = 0; index < 81; index += 1) {
    const value = Number(candidate[index]);
    if (!puzzleGrid[index] && Number.isInteger(value) && value >= 1 && value <= 9 && isValidMove(grid, index, value)) {
      grid[index] = value;
    }
  }
  return grid;
}

function sanitizeNotes(grid, savedNotes) {
  return Array.from({ length: 81 }, (_, index) => {
    if (grid[index] || !Array.isArray(savedNotes?.[index])) return [];
    const candidates = new Set(getCandidates(grid, index));
    return [...new Set(savedNotes[index].map(Number).filter((value) => candidates.has(value)))]
      .filter((value) => DIGITS.includes(value))
      .sort((left, right) => left - right);
  });
}

function freshGame(puzzle) {
  const puzzleGrid = parseGrid(puzzle.puzzle);
  const key = puzzleKey(getCurrentDifficulty().id, getCurrentLevel());
  const saved = progress.records[key];
  const savedGrid = typeof saved?.grid === 'string' ? parseGrid(saved.grid) : saved?.grid;
  const grid = sanitizeGrid(puzzleGrid, savedGrid);
  return {
    puzzleGrid,
    grid,
    notes: sanitizeNotes(grid, saved?.notes),
    elapsed: Number(saved?.elapsed) || 0,
    mistakes: Number(saved?.mistakes) || 0,
    hintUsed: Boolean(saved?.hintUsed),
    notesMode: false,
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
    notes: game.notes,
    elapsed: game.elapsed,
    mistakes: game.mistakes,
    hintUsed: game.hintUsed,
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
  elements.startButton.textContent = `开始第 ${String(currentLevel).padStart(3, '0')} 份档案`;
}

function renderMenu() {
  renderDifficulties();
  renderLevels();
}

function renderHeader() {
  const difficulty = getCurrentDifficulty();
  const level = getCurrentLevel();
  elements.stageEyebrow.textContent = `${difficulty.id.toUpperCase()} / FILE ${String(level).padStart(3, '0')}`;
  elements.stageDifficulty.textContent = `${difficulty.label} · ${difficulty.subtitle}`;
  elements.stageTitle.textContent = `第 ${String(level).padStart(3, '0')} 份档案`;
  elements.stageIndex.textContent = String(level).padStart(3, '0');
}

function cellLabel(index, value, notes) {
  const row = Math.floor(index / 9) + 1;
  const column = (index % 9) + 1;
  if (value) return `第 ${row} 行，第 ${column} 列，数字 ${value}`;
  return `第 ${row} 行，第 ${column} 列，${notes.length ? `笔记 ${notes.join('、')}` : '空白'}`;
}

function createBoard() {
  boardCells = Array.from({ length: 81 }, (_, index) => {
    const cell = document.createElement('button');
    const row = Math.floor(index / 9);
    const column = index % 9;
    cell.type = 'button';
    cell.dataset.index = String(index);
    cell.setAttribute('role', 'gridcell');
    cell.className = ['cell', column % 3 === 2 && column !== 8 && 'box-right', row % 3 === 2 && row !== 8 && 'box-bottom'].filter(Boolean).join(' ');
    elements.board.append(cell);
    return cell;
  });
  elements.board.addEventListener('click', (event) => {
    const cell = event.target.closest('.cell');
    if (cell) selectCell(Number(cell.dataset.index));
  });
}

function renderBoard() {
  const conflictIndexes = new Set(findAllConflicts(game.grid));
  const selectedValue = selectedIndex >= 0 ? game.grid[selectedIndex] : 0;
  const activeDigit = selectedValue || forcedDigit || highlightedDigit;
  for (let index = 0; index < 81; index += 1) {
    const cell = boardCells[index];
    const given = Boolean(game.puzzleGrid[index]);
    const value = game.grid[index];
    const notes = game.notes[index];
    const row = Math.floor(index / 9);
    const column = index % 9;
    const sameRow = selectedIndex >= 0 && row === Math.floor(selectedIndex / 9);
    const sameColumn = selectedIndex >= 0 && column === selectedIndex % 9;
    const selectedBox = selectedIndex >= 0 && Math.floor(row / 3) === Math.floor(Math.floor(selectedIndex / 9) / 3) && Math.floor(column / 3) === Math.floor((selectedIndex % 9) / 3);
    cell.className = [
      'cell',
      given && 'is-given',
      index === selectedIndex && 'is-selected',
      index === selectedIndex && forcedDigit && 'is-forced',
      index !== selectedIndex && (sameRow || sameColumn || selectedBox) && 'is-peer',
      activeDigit && value === activeDigit && 'is-number-highlight',
      conflictIndexes.has(index) && 'is-conflict',
      column % 3 === 2 && column !== 8 && 'box-right',
      row % 3 === 2 && row !== 8 && 'box-bottom',
    ].filter(Boolean).join(' ');
    cell.setAttribute('aria-selected', String(index === selectedIndex));
    cell.setAttribute('aria-label', cellLabel(index, value, notes));
    cell.replaceChildren();
    if (value) {
      cell.textContent = value;
    } else {
      const noteGrid = document.createElement('span');
      noteGrid.className = 'cell-notes';
      DIGITS.forEach((digit) => {
        const note = document.createElement('span');
        note.textContent = notes.includes(digit) ? String(digit) : '';
        noteGrid.append(note);
      });
      cell.append(noteGrid);
    }
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

function renderKeypad() {
  const counts = getDigitCounts(game.grid);
  elements.keypad.replaceChildren();
  DIGITS.forEach((digit) => {
    if (counts[digit] >= 9) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.value = String(digit);
    button.className = digit === highlightedDigit ? 'is-active' : '';
    button.textContent = String(digit);
    button.setAttribute('aria-label', `数字 ${digit}${counts[digit] === 8 ? '，最后一个' : ''}`);
    elements.keypad.append(button);
  });
  const allFilled = DIGITS.every((digit) => counts[digit] >= 9);
  if (!allFilled) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'keypad-clear';
    clear.dataset.value = 'clear';
    clear.textContent = '清除';
    elements.keypad.append(clear);
  }
}

function renderModes() {
  elements.notesButton.classList.toggle('is-active', game.notesMode);
  elements.notesButton.setAttribute('aria-pressed', String(game.notesMode));
  elements.notesButton.querySelector('strong').textContent = game.notesMode ? '笔记模式·开' : '笔记模式';
  elements.hintButton.disabled = game.hintUsed;
  elements.hintLabel.textContent = game.hintUsed ? '本局提示已使用' : '使用一次提示';
}

function renderAll() {
  renderHeader();
  renderBoard();
  renderMetrics();
  renderKeypad();
  renderModes();
}

function setLogic(kind, title, details) {
  elements.logicKind.textContent = kind;
  elements.logicTitle.textContent = title;
  elements.logicDetails.replaceChildren();
  details.forEach((detail) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = detail;
    elements.logicDetails.append(paragraph);
  });
}

function selectCell(index) {
  if (game.paused) return;
  if (selectedIndex === index) {
    selectedIndex = -1;
    forcedDigit = 0;
    highlightedDigit = 0;
    elements.selectionHint.textContent = '已取消单元格选择。点击数字可高亮盘面。';
    renderBoard();
    renderKeypad();
    return;
  }
  selectedIndex = index;
  highlightedDigit = 0;
  const forcedStep = findForcedUnitStep(game.grid, index);
  forcedDigit = forcedStep?.value || 0;
  const given = Boolean(game.puzzleGrid[index]);
  const candidates = game.grid[index] ? [] : getCandidates(game.grid, index);
  elements.selectionHint.textContent = given
    ? '这是题目线索，不能修改。'
    : forcedDigit
      ? `这个单位只剩一个空位，应填 ${forcedDigit}。`
      : game.notesMode
        ? `笔记候选：${candidates.join('、') || '无'}`
        : `第 ${Math.floor(index / 9) + 1} 行 · 第 ${(index % 9) + 1} 列`;
  elements.selectionHint.classList.remove('is-error', 'is-success');
  renderBoard();
  renderKeypad();
}

function removePeerNote(value, index) {
  for (const peer of getPeers(index)) {
    if (!game.notes[peer].includes(value)) continue;
    game.notes[peer] = game.notes[peer].filter((note) => note !== value);
  }
}

function placeValue(index, value) {
  game.grid[index] = value;
  game.notes[index] = [];
  removePeerNote(value, index);
}

function commitValue(value) {
  if (selectedIndex < 0) return;
  if (game.puzzleGrid[selectedIndex]) {
    showToast('线索格不能修改。');
    return;
  }
  if (value === 0) {
    game.grid[selectedIndex] = 0;
    game.notes[selectedIndex] = [];
    elements.selectionHint.textContent = '已清除这个空格。';
    saveGame();
    renderAll();
    return;
  }
  if (!isValidMove(game.grid, selectedIndex, value)) {
    game.mistakes += 1;
    const conflicts = getConflicts([...game.grid.slice(0, selectedIndex), value, ...game.grid.slice(selectedIndex + 1)], selectedIndex);
    elements.selectionHint.textContent = conflicts.length ? '逻辑冲突：同一行、列或宫已有这个数字。' : '这个数字不能放在这里。';
    elements.selectionHint.classList.add('is-error');
    renderMetrics();
    renderBoard();
    showToast('输入被规则拒绝，未检查标准答案。');
    saveGame();
    return;
  }
  placeValue(selectedIndex, value);
  selectedIndex = -1;
  forcedDigit = 0;
  highlightedDigit = 0;
  saveGame();
  renderAll();
  if (isCompleteGrid(game.grid)) completeGame();
}

function toggleNote(value) {
  if (selectedIndex < 0 || game.puzzleGrid[selectedIndex] || game.grid[selectedIndex]) {
    showToast('笔记只能写在空白格中。');
    return;
  }
  const candidates = getCandidates(game.grid, selectedIndex);
  if (!candidates.includes(value)) {
    elements.selectionHint.textContent = '这个数字已被同一行、列或宫排除。';
    elements.selectionHint.classList.add('is-error');
    showToast('笔记不能记录逻辑上不可能的数字。');
    return;
  }
  const notes = game.notes[selectedIndex];
  game.notes[selectedIndex] = notes.includes(value) ? notes.filter((note) => note !== value) : [...notes, value].sort((left, right) => left - right);
  elements.selectionHint.textContent = `候选数字：${game.notes[selectedIndex].join('、') || '暂无'}`;
  elements.selectionHint.classList.remove('is-error');
  saveGame();
  renderBoard();
}

function setKeypadValue(value) {
  if (game.paused) {
    showToast('计时已暂停，继续后再填写。');
    return;
  }
  if (value === 0) {
    if (selectedIndex < 0) {
      highlightedDigit = 0;
      elements.selectionHint.textContent = '已取消数字高亮。';
      renderBoard();
      renderKeypad();
    } else {
      commitValue(0);
    }
    return;
  }
  if (selectedIndex < 0) {
    highlightedDigit = highlightedDigit === value ? 0 : value;
    elements.selectionHint.textContent = highlightedDigit ? `正在查看数字 ${highlightedDigit}。` : '已取消数字高亮。';
    elements.selectionHint.classList.remove('is-error');
    renderBoard();
    renderKeypad();
    return;
  }
  if (game.notesMode) toggleNote(value);
  else commitValue(value);
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
  const conflicts = findAllConflicts(game.grid);
  if (conflicts.length) {
    elements.selectionHint.textContent = `发现 ${conflicts.length} 个逻辑冲突，请检查重复数字。`;
    elements.selectionHint.classList.add('is-error');
    setLogic('LOGIC CHECK', '盘面存在规则冲突', ['同一行、列或宫不能出现重复数字。', '检查标红的单元格，不需要对照标准答案。']);
    renderBoard();
    showToast('只按行、列、宫检查：这里有重复数字。');
    return;
  }
  const empty = game.grid.filter((value) => !value).length;
  if (empty) {
    const step = findLogicalStep(game.grid);
    elements.selectionHint.textContent = `当前没有逻辑冲突，还剩 ${empty} 格。`;
    elements.selectionHint.classList.remove('is-error');
    if (step) {
      const explanation = explainLogicalStep(step, game.grid);
      setLogic(`下一步 · ${explanation.kindLabel}`, explanation.title, [explanation.summary, ...explanation.details]);
    } else {
      setLogic('LOGIC CHECK', '当前盘面没有基础唯一候选', ['没有发现重复数字，但剩余空格还不能仅靠基础行列宫规则确定。', '继续记录候选或使用本局提示。']);
    }
    showToast(`当前逻辑有效，还差 ${empty} 格。`);
    return;
  }
  completeGame();
}

function useHint() {
  if (game.paused || game.hintUsed) return;
  const conflicts = findAllConflicts(game.grid);
  if (conflicts.length) {
    showToast('请先清除逻辑冲突，提示需要建立在有效盘面上。');
    return;
  }
  const step = findLogicalStep(game.grid);
  if (!step) {
    showToast('当前没有可以由基础行列宫规则确定的数字，提示机会暂不消耗。');
    return;
  }
  const explanation = explainLogicalStep(step, game.grid);
  game.hintUsed = true;
  placeValue(step.index, step.value);
  selectedIndex = -1;
  highlightedDigit = 0;
  setLogic(`本局提示 · ${explanation.kindLabel}`, explanation.title, [explanation.summary, ...explanation.details]);
  elements.selectionHint.textContent = '提示已填入一个数字，本局提示机会已用完。';
  elements.selectionHint.classList.remove('is-error');
  saveGame();
  renderAll();
  if (isCompleteGrid(game.grid)) completeGame();
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
    showMenu();
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
  forcedDigit = 0;
  highlightedDigit = 0;
  game = freshGame(getPuzzle());
  renderAll();
  startTimer();
}

function showGame() {
  closeModal();
  elements.menuScreen.hidden = true;
  elements.gameScreen.hidden = false;
  window.scrollTo(0, 0);
  loadGame();
}

function showMenu() {
  stopTimer();
  if (!game?.completed) saveGame();
  elements.completeModal.hidden = true;
  elements.gameScreen.hidden = true;
  elements.menuScreen.hidden = false;
  window.scrollTo(0, 0);
  renderMenu();
}

function chooseDifficulty(difficultyId) {
  progress.selectedDifficulty = difficultyId;
  persist();
  renderMenu();
}

function chooseLevel(level) {
  const difficulty = getCurrentDifficulty();
  if (level > (progress.completed[difficulty.id] || 0) + 1) {
    showToast('先完成前面的档案，才能解锁这一关。');
    return;
  }
  progress.currentLevels[difficulty.id] = level;
  persist();
  renderMenu();
}

function resetGame() {
  if (!game) return;
  game.grid = game.puzzleGrid.slice();
  game.notes = Array.from({ length: 81 }, () => []);
  game.elapsed = 0;
  game.mistakes = 0;
  game.hintUsed = false;
  game.completed = false;
  game.paused = false;
  selectedIndex = -1;
  forcedDigit = 0;
  highlightedDigit = 0;
  saveGame();
  renderAll();
  startTimer();
  showToast('本关已重置，提示机会也已恢复。');
}

function togglePause() {
  if (game.completed) return;
  game.paused = !game.paused;
  if (game.paused) stopTimer();
  else startTimer();
  saveGame();
  renderMetrics();
}

function toggleTheme() {
  progress.theme = progress.theme === 'night' ? 'day' : 'night';
  applyTheme();
  persist();
}

function applyTheme() {
  elements.body.dataset.theme = progress.theme;
  const nextLabel = progress.theme === 'night' ? '☼ 白日模式' : '☾ 夜晚模式';
  [elements.menuThemeToggle, elements.gameThemeToggle].forEach((button) => {
    button.textContent = nextLabel;
    button.setAttribute('aria-label', progress.theme === 'night' ? '切换到白日模式' : '切换到夜晚模式');
  });
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
  setKeypadValue(button.dataset.value === 'clear' ? 0 : Number(button.dataset.value));
});
elements.startButton.addEventListener('click', showGame);
elements.menuButton.addEventListener('click', showMenu);
elements.checkButton.addEventListener('click', checkAnswer);
elements.pauseButton.addEventListener('click', togglePause);
elements.resetButton.addEventListener('click', resetGame);
elements.notesButton.addEventListener('click', () => {
  if (game.paused) return;
  game.notesMode = !game.notesMode;
  renderModes();
  elements.selectionHint.textContent = game.notesMode ? '笔记模式已开启：选择数字记录候选。' : '普通模式已开启：选择数字填入。';
});
elements.hintButton.addEventListener('click', useHint);
elements.clearButton.addEventListener('click', () => setKeypadValue(0));
elements.menuThemeToggle.addEventListener('click', toggleTheme);
elements.gameThemeToggle.addEventListener('click', toggleTheme);
elements.modalClose.addEventListener('click', closeModal);
elements.nextButton.addEventListener('click', openNext);
elements.completeModal.addEventListener('click', (event) => {
  if (event.target === elements.completeModal) closeModal();
});
document.addEventListener('keydown', (event) => {
  if (elements.gameScreen.hidden || !elements.completeModal.hidden) {
    if (event.key === 'Escape' && !elements.completeModal.hidden) closeModal();
    return;
  }
  if (event.key >= '1' && event.key <= '9') {
    event.preventDefault();
    setKeypadValue(Number(event.key));
    return;
  }
  if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
    event.preventDefault();
    setKeypadValue(0);
    return;
  }
  const movement = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
  if (movement) {
    event.preventDefault();
    moveSelection(...movement);
  }
});

window.addEventListener('pagehide', saveGame);
createBoard();
applyTheme();
renderMenu();
