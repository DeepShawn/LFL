import { INTRO, RULES, NOTES, ENDINGS, TUTORIAL_STEPS, objective, inventoryLabels } from './story.js';
import { BUILDINGS, SCENES } from './world.js';

function node(tag, className = '', text = '') {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

function button(text, handler, className = '') {
  const item = node('button', className, text);
  item.type = 'button';
  item.addEventListener('click', handler);
  return item;
}

function paragraph(parent, text, className = '') {
  const item = node('p', className, text);
  parent.append(item);
  return item;
}

function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  if (result.every((item, index) => item === items[index])) result.push(result.shift());
  return result;
}

export class Interactions {
  constructor(dialog, onAction) {
    this.dialog = dialog;
    this.onAction = onAction;
  }

  open(kind, state, object = {}) {
    this.state = state;
    this.object = object;
    this.dialog.replaceChildren();
    this.dialog.classList.add('interaction-dialog');
    this.dialog.setAttribute('aria-labelledby', 'interaction-title');
    this.dialog.setAttribute('aria-describedby', 'interaction-message');
    this.dialog.style.maxHeight = '90dvh';

    const shell = node('div', 'interaction-shell');
    const header = node('header', 'interaction-header');
    this.title = node('h2', '', object.label || '夜录');
    this.title.id = 'interaction-title';
    this.title.tabIndex = -1;
    const dismiss = button('关闭 · 返回现场', () => this.close(), 'interaction-close');
    dismiss.setAttribute('aria-label', '关闭互动面板，返回现场');
    header.append(this.title, dismiss);
    this.content = node('div', 'interaction-content');
    this.content.style.overflowY = 'auto';
    this.content.style.maxHeight = '65dvh';
    this.content.style.overflowWrap = 'anywhere';
    this.content.tabIndex = 0;
    const footer = node('footer', 'interaction-footer');
    this.message = node('p', 'interaction-message', '调查期间世界暂停；关闭面板后返回现场。');
    this.message.id = 'interaction-message';
    this.message.setAttribute('role', 'status');
    this.message.setAttribute('aria-live', 'polite');
    this.message.setAttribute('aria-atomic', 'true');
    footer.append(this.message, button('关闭面板', () => this.close(), 'interaction-close'));
    shell.append(header, this.content, footer);
    this.dialog.append(shell);

    switch (kind) {
      case 'note': this.note(); break;
      case 'puzzle': this.puzzle(); break;
      case 'control': this.circuit(true); break;
      case 'gate': this.gate(); break;
      case 'echoes': this.echoes(); break;
      case 'voice': this.voice(); break;
      case 'bell': this.bell(); break;
      case 'training': this.training(); break;
      case 'lamp': this.lamp(); break;
      case 'journal': this.journal(); break;
      case 'map': this.map(); break;
      default: paragraph(this.content, '这件物品由现场界面处理，请关闭面板返回现场。');
    }
    if (!this.dialog.open) this.dialog.showModal();
    this.title.focus();
  }

  close() {
    this.dialog.close();
  }

  report(text, result = 'info') {
    this.message.dataset.result = result;
    this.message.replaceChildren(node('span', '', text));
  }

  act(action, payload, success) {
    const result = this.onAction(action, payload);
    if (result.ok && success) success(result);
    this.report(result.message, result.ok ? 'success' : 'error');
    if (result.ok && result.close) this.close();
    return result;
  }

  board(title) {
    this.title.textContent = title;
    const board = node('section', 'puzzle-board');
    board.setAttribute('aria-label', title);
    this.content.append(board);
    return board;
  }

  controls(parent, title) {
    const group = node('fieldset', 'puzzle-controls');
    group.style.minInlineSize = '0';
    group.append(node('legend', '', title));
    parent.append(group);
    return group;
  }

  hints(parent, lines) {
    const panel = node('section', 'puzzle-hints');
    panel.setAttribute('aria-label', '三级提示');
    const list = node('ol', 'hint-list');
    list.setAttribute('aria-live', 'polite');
    let level = 0;
    const reveal = button('提示 1 / 3 · 观察方向', () => {
      list.append(node('li', '', lines[level]));
      level++;
      reveal.textContent = level === 3 ? '三级提示已全部展开' : `提示 ${level + 1} / 3 · ${level === 1 ? '核对证据' : '直接解法'}`;
      reveal.disabled = level === 3;
    }, 'hint-button');
    panel.append(reveal, list);
    parent.append(panel);
  }

  noteReference(scene, parent, inspectHere = false) {
    const note = NOTES[scene];
    const known = this.state.notes.includes(`${scene}-note`);
    if (known) {
      const details = node('details', 'verified-note document-view');
      details.append(node('summary', '', `复核已取得纸背：${note.title}`));
      paragraph(details, note.back);
      parent.append(details);
    } else {
      paragraph(parent, `线索在本房间的“${SCENES[scene].objects.find(item => item.type === 'note').label}”。看正面不等于核验，请翻到纸背。`, 'clue-location');
      if (inspectHere) {
        const paper = node('article', 'document-view');
        paper.hidden = true;
        paper.append(node('h3', '', `${note.title} · 纸背`));
        paragraph(paper, note.back);
        const read = button('检查旁边检修记录的纸背', () => {
          paper.hidden = false;
          this.act('inspect', { id: `${scene}-note` }, () => {
            read.disabled = true;
            read.textContent = '检修记录纸背已核验';
          });
        });
        parent.append(read, paper);
      }
    }
  }

  route(parent) {
    const figure = node('figure', 'campus-route');
    figure.append(node('figcaption', '', '校园纵向路线 · 北在上、南在下'));
    const list = node('ol', 'route-list');
    list.append(node('li', '', '北门'));
    BUILDINGS.forEach(building => list.append(node('li', '', building.name)));
    figure.append(list);
    paragraph(figure, '北门 → 行政楼 → 实验楼 → 教学楼 → 宿舍 → 食堂');
    parent.append(figure);
  }

  note() {
    const scene = Object.keys(NOTES).find(id => `${id}-note` === this.object.id) || this.state.scene;
    const note = NOTES[scene];
    this.title.textContent = note.title;
    const paper = node('article', 'document-view');
    const side = node('h3', '', '纸张正面 · 墨迹');
    const text = node('p', 'document-text', note.front);
    const controls = node('div', 'document-actions');
    let back = false;
    let inspected = false;
    const frontButton = button('看正面', () => show(false));
    const backButton = button('翻到纸背 · 核验压痕', () => {
      show(true);
      if (!inspected) inspected = this.act('inspect', { id: this.object.id }).ok;
    });
    const show = isBack => {
      back = isBack;
      side.textContent = back ? '纸张背面 · 旧压痕' : '纸张正面 · 墨迹';
      text.textContent = back ? note.back : note.front;
      paper.dataset.side = back ? 'back' : 'front';
      frontButton.setAttribute('aria-pressed', String(!back));
      backButton.setAttribute('aria-pressed', String(back));
    };
    controls.append(frontButton, backButton);
    paper.append(side, text, controls);
    paragraph(paper, '纸背的内容可留在已核验手册中；翻阅不要求立即关闭面板。');
    this.content.append(paper);
    show(false);
  }

  puzzle() {
    const scene = this.object.id?.replace(/-puzzle$/, '') || this.state.scene;
    switch (scene) {
      case 'admin': this.archive(); break;
      case 'lab': this.circuit(false); break;
      case 'classroom': this.seat(); break;
      case 'dorm': this.pass(); break;
      case 'canteen': this.name(); break;
      case 'tutorial': this.tutorialPuzzle(); break;
      default: paragraph(this.content, '这里没有可操作的谜题，请返回现场。');
    }
  }

  archiveRecord(parent) {
    const record = node('article', 'document-view archive-record');
    record.append(node('h3', '', '档案柜已开 · 原册已取出'));
    paragraph(record, '你取得的是整本四十人名册原件，不是封套，也不是拓片。');
    const table = node('table', 'archive-table');
    const caption = node('caption', '', '同一个名字，两种证据');
    const body = node('tbody');
    for (const [label, evidence, className] of [
      ['第17号 林舟', '旧墨与纸背压痕一致；原有行。', 'original-name'],
      ['第41号 林舟（红字）', '后来补上的红墨；没有对应旧压痕。', 'forged-name'],
    ]) {
      const row = node('tr', className);
      const heading = node('th', '', label);
      heading.scope = 'row';
      row.append(heading, node('td', '', evidence));
      body.append(row);
    }
    table.append(caption, body);
    record.append(table);
    paragraph(record, '把整册转向灯：纸背只有 40 行旧压痕，第41行停在表面。');
    parent.append(record);
  }

  archive() {
    const board = this.board('档案台 · 五块建筑木牌');
    this.route(board);
    if (this.state.flags.archive) {
      this.archiveRecord(board);
      return;
    }
    this.noteReference('admin', board);
    paragraph(board, '从北门出发按建筑顺序装牌。点击木牌放入下一个空槽，点击槽位可取回该牌；也可撤销或全部重排。北门不是木牌。');
    const controls = this.controls(board, '由北向南，五槽依次');
    const tray = node('div', 'tile-tray');
    const slots = node('ol', 'tile-slots');
    const answer = [];
    const tiles = new Map();
    const slotButtons = [];
    const labels = Object.fromEntries(BUILDINGS.map(item => [item.id, item.name]));
    for (const id of shuffled(BUILDINGS.map(item => item.id))) {
      const tile = button(labels[id], () => {
        answer.push(id);
        update();
        this.report(`${labels[id]}已放入第${answer.length}槽。`);
      }, 'building-tile');
      tile.dataset.building = id;
      tiles.set(id, tile);
      tray.append(tile);
    }
    for (let i = 0; i < 5; i++) {
      const slot = button('', () => {
        const [removed] = answer.splice(i, 1);
        update();
        this.report(`${labels[removed]}已取回，其余牌按顺序前移。`);
      }, 'tile-slot');
      const item = node('li');
      item.append(slot);
      slots.append(item);
      slotButtons.push(slot);
    }
    const undo = button('撤销最后一牌', () => {
      answer.pop();
      update();
      this.report('已撤销最后一牌。');
    });
    const reset = button('清空五槽，重新排列', () => {
      answer.length = 0;
      update();
      this.report('木牌已全部取回；尚未提交任何排列。');
    });
    const submit = button('按此顺序开柜', () => this.act('solve', { id: 'archive', answer: [...answer] }, () => {
      controls.disabled = true;
      this.archiveRecord(board);
    }), 'puzzle-submit');
    const update = () => {
      tiles.forEach((tile, id) => { tile.disabled = answer.includes(id); });
      slotButtons.forEach((slot, i) => {
        slot.textContent = `第${i + 1}槽：${answer[i] ? labels[answer[i]] + ' · 点击取回' : '空'}`;
        slot.disabled = !answer[i];
      });
      submit.disabled = answer.length !== 5;
      undo.disabled = answer.length === 0;
      reset.disabled = answer.length === 0;
    };
    controls.append(tray, slots, undo, reset, submit);
    update();
    this.hints(board, [
      '不要照着新墨字排，把封套翻过来核对旧路线。',
      '北门在最北端，五块木牌对应沿纵向主路由近到远的五栋楼。',
      '五槽从头到尾是：行政楼、实验楼、教学楼、宿舍、食堂。排满后按“按此顺序开柜”。',
    ]);
  }

  circuit(total) {
    const id = total ? 'power' : 'circuit';
    const board = this.board(total ? '行政楼 · 广播总控' : '实验楼 · 本楼检修分路');
    paragraph(board, total ? '铭牌：行政总路。这里控制整个循环的重复播送，不是实验楼分路。只有取回姓名条后，旧凭才能核准总控操作。' : '铭牌：实验楼分路。这里仅控制本楼，不能代替行政楼的广播总控。');
    if (this.state.flags[id]) {
      paragraph(board, total ? '总路已核准：铃接通，灯接通，重复广播断开。' : '本楼分路已核准：铃接通、灯接通、播断开。关闭面板后可在现场观察真铃两短一长及门闩动作。', 'puzzle-complete');
      return;
    }
    if (total) {
      paragraph(board, '总路实刻：“铃灯留用，重复播送止于此。”取回的姓名用于核验，不在此补签新身份。');
      if (!this.state.flags.name) paragraph(board, '目前尚未取得姓名条。可以观察开关，但操作能否生效由总控核验。', 'puzzle-warning');
    } else {
      this.noteReference('lab', board, true);
    }
    const controls = this.controls(board, total ? '总路开关 · 顺序为铃、灯、播' : '本楼开关 · 顺序为铃、灯、播');
    const values = [true, true, true];
    const switches = [];
    const labels = ['铃 · 机械校铃', '灯 · 安全照明', total ? '播 · 重复点名总路' : '播 · 本楼广播支路'];
    const update = () => switches.forEach((item, i) => {
      item.textContent = `${total ? '总路' : '本楼'} ${labels[i]}：${values[i] ? '接通' : '断开'}`;
      item.setAttribute('aria-checked', String(values[i]));
    });
    labels.forEach((label, i) => {
      const item = button('', () => { values[i] = !values[i]; update(); }, 'circuit-switch');
      item.setAttribute('role', 'switch');
      item.setAttribute('aria-label', `${total ? '总路' : '本楼'} ${label}`);
      switches.push(item);
      controls.append(item);
    });
    const successText = paragraph(board, '开关目前只是预选，按核准后才会影响现场。');
    controls.append(button('重置开关预选', () => {
      values.splice(0, 3, true, true, true);
      update();
      this.report('三个预选开关已重置为接通，尚未核准。');
    }), button(total ? '核准总路设置' : '核准本楼设置', () => this.act('solve', { id, answer: [...values] }, () => {
      controls.disabled = true;
      successText.textContent = total ? '总路核验通过。铃灯保留，重复播送已停止。' : '本楼核验通过。请关闭面板，到机械校铃前观察铃槌两短一长和门闩动作；声音本身不算证据。';
    }), 'puzzle-submit'));
    update();
    this.hints(board, [
      total ? '先区分行政总路和已经处理过的实验楼分路，总路需要旧姓名核验。' : '检查旁边记录的纸背，不要信“全断”的新墨。',
      '需要保留能看见动作的机械校铃与安全照明，只停止广播。',
      `按顺序保持“铃：接通、灯：接通、播：断开”，再按${total ? '核准总路设置' : '核准本楼设置'}。`,
    ]);
  }

  numberedGrid(parent, noun, onPick) {
    const scroll = node('div', 'grid-scroll');
    scroll.style.overflowX = 'auto';
    const grid = node('div', `${noun === '座位' ? 'seat' : 'bowl'}-grid`);
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', `五行八列${noun}，前到后、左到右编号`);
    grid.style.minWidth = '24rem';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'minmax(0, 1fr)';
    const buttons = [];
    for (let row = 0; row < 5; row++) {
      const line = node('div', 'numbered-row');
      line.style.display = 'grid';
      line.style.gridTemplateColumns = 'repeat(8, minmax(0, 1fr))';
      line.setAttribute('role', 'group');
      line.setAttribute('aria-label', `第${row + 1}行${row === 0 ? '，前排' : row === 4 ? '，后排' : ''}`);
      for (let col = 0; col < 8; col++) {
        const number = row * 8 + col + 1;
        const item = button(String(number), () => onPick(number), 'numbered-item');
        item.dataset.number = String(number);
        item.style.minHeight = '44px';
        item.setAttribute('aria-label', `第${row + 1}行第${col + 1}列，第${number}号${noun}`);
        item.addEventListener('keydown', event => {
          let target = number - 1;
          if (event.key === 'ArrowLeft' && col > 0) target--;
          else if (event.key === 'ArrowRight' && col < 7) target++;
          else if (event.key === 'ArrowUp' && row > 0) target -= 8;
          else if (event.key === 'ArrowDown' && row < 4) target += 8;
          else if (event.key === 'Home') target = event.ctrlKey ? 0 : row * 8;
          else if (event.key === 'End') target = event.ctrlKey ? 39 : row * 8 + 7;
          else if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          buttons[target].focus();
        });
        buttons.push(item);
        line.append(item);
      }
      grid.append(line);
    }
    scroll.append(grid);
    parent.append(scroll);
    return buttons;
  }

  seat() {
    const board = this.board('教学楼 · 原始五行八列座位');
    if (this.state.flags.seat) {
      paragraph(board, '第17号已核验：面向黑板，第三行第一列。桌沿实刻与原册旧压痕相合；网格外的41不是原有座位。', 'puzzle-complete');
      return;
    }
    this.noteReference('classroom', board);
    paragraph(board, '面向黑板：前排在上，后排在下；每行由左向右编号。点击座位会直接核验；选错后仍可重新选。窄屏可横向滚动网格。');
    paragraph(board, '键盘：Tab 进入座位，方向键换座，Home / End 到行首 / 行尾，Enter 或空格核验。');
    const controls = this.controls(board, '选择林舟的原座位');
    paragraph(controls, '黑板 · 前方', 'blackboard');
    const selected = paragraph(board, '尚未核验座位。', 'seat-inspection');
    const choose = number => {
      selected.textContent = number === 41 ? '你碰到了网格外新添的第41把椅子；它没有原始格线。' : `正在核验第${number}号：第${Math.floor((number - 1) / 8) + 1}行、第${(number - 1) % 8 + 1}列。`;
      this.act('solve', { id: 'seat', answer: number }, () => {
        controls.disabled = true;
        selected.textContent = '第17号林舟，第三行第一列。实刻与旧册一致，已找回原座位。';
      });
    };
    this.numberedGrid(controls, '座位', choose);
    paragraph(controls, '后方 · 第五行之后', 'room-back');
    const extra = node('div', 'extra-seat');
    paragraph(extra, '网格外：新添的一把椅子，没有旧格线。');
    extra.append(button('核验网格外第41座（新纸签）', () => choose(41), 'forged-seat'));
    controls.append(extra);
    this.hints(board, [
      '找到原始座位表，翻背看格线，而不是跟着红箭头走。',
      '每排八座。前两排一共十六座，下一排最左侧接着编号。',
      '点击第三行第一列的17号；额外的41号椅子不属于原来的五行八列。',
    ]);
  }

  pass() {
    const board = this.board('宿舍 · 三片旧签离联');
    if (this.state.flags.pass) {
      paragraph(board, '旧签离联已拼回：第17号 林舟 / 状态 已离 / 22:17。三片纸背的压痕与撕口连续，没有添加新签名。', 'puzzle-complete');
      return;
    }
    this.noteReference('dorm', board);
    paragraph(board, '正面有异常浮墨。先翻背，再点选片段，接着点击目标槽位。槽位横排展示，左、中、右分别代表原联的上、中、下片；也可拖放，手机仅点击即可完成。');
    const controls = this.controls(board, '纸背拼合台');
    const pieces = {
      a: { front: '片 a：姓名栏浮出“41 林舟”，下层仍露出17。', back: '┌─────────────┐\n│ 第17号 林舟 │\n│     │ 离    │\n└─────∨───────┘\n顶：完整纸边\n底：单齿撕口' },
      b: { front: '片 b：“未离”盖住“已离”，两层墨迹错位。', back: '┌─────∧───────┐\n│ 状态：已离  │\n│     │ 校    │\n└────∨─∨──────┘\n顶：单齿撕口\n底：双齿撕口' },
      c: { front: '片 c：22:17 被重写成 22:41，末笔悬在纸外。', back: '┌────∧─∧──────┐\n│    22:17    │\n│     │ 存根  │\n└─────────────┘\n顶：双齿撕口\n底：完整纸边' },
    };
    const slots = [null, null, null];
    let selected = null;
    let dragged = null;
    let back = false;
    let solved = false;
    const cards = new Map();
    const slotViews = [];
    const selection = paragraph(controls, '尚未选中片段。', 'fragment-selection');
    const flip = button('翻到三片纸背', () => {
      back = !back;
      update();
      this.report(back ? '现在显示纸背：用完整边、单齿与双齿撕口核对，不看浮墨。' : '现在显示片段正面，表层墨迹不能作为原凭。');
    }, 'fragment-flip');
    const tray = node('div', 'fragment-tray');
    const place = (index, id) => {
      if (solved) return;
      if (!id) {
        this.report('请先点选一片纸，再点击目标槽位。');
        return;
      }
      const previous = slots.indexOf(id);
      const displaced = slots[index];
      if (previous !== -1) slots[previous] = displaced;
      slots[index] = id;
      selected = null;
      update();
      this.report(`片${id}已放入${['上片（左）', '中片', '下片（右）'][index]}槽${displaced && displaced !== id ? '，原片段已换位或退回待选区' : ''}。`);
    };
    for (const id of shuffled(['a', 'b', 'c'])) {
      const card = button('', () => {
        selected = selected === id ? null : id;
        update();
      }, 'paper-fragment');
      card.draggable = true;
      card.dataset.fragment = id;
      card.addEventListener('dragstart', event => {
        if (solved) { event.preventDefault(); return; }
        dragged = id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
      });
      card.addEventListener('dragend', () => { dragged = null; });
      cards.set(id, card);
      tray.append(card);
    }
    const slotScroll = node('div', 'fragment-slot-scroll');
    slotScroll.style.overflowX = 'auto';
    const slotsElement = node('div', 'fragment-slots');
    slotsElement.style.display = 'grid';
    slotsElement.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
    slotsElement.style.minWidth = '27rem';
    const preview = node('pre', 'fragment-preview');
    preview.style.whiteSpace = 'pre-wrap';
    preview.setAttribute('aria-label', '按上中下顺序排列的纸片预览');
    for (let index = 0; index < 3; index++) {
      const box = node('div', 'fragment-slot');
      const target = button('', () => place(index, selected), 'fragment-target');
      const remove = button('取回本槽', () => {
        selected = slots[index];
        slots[index] = null;
        update();
      });
      const swap = direction => {
        const other = index + direction;
        [slots[index], slots[other]] = [slots[other], slots[index]];
        update();
        this.report('相邻两槽已互换，可继续核对纸背。');
      };
      const left = button('与左槽互换', () => swap(-1));
      const right = button('与右槽互换', () => swap(1));
      left.disabled = index === 0;
      right.disabled = index === 2;
      box.addEventListener('dragover', event => {
        if (dragged && !solved) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
      });
      box.addEventListener('drop', event => {
        if (!dragged || solved) return;
        event.preventDefault();
        place(index, dragged);
        dragged = null;
      });
      box.append(target, remove, left, right);
      slotsElement.append(box);
      slotViews.push({ target, remove });
    }
    slotScroll.append(slotsElement);
    const submit = button('按当前拼法核验旧联', () => this.act('solve', { id: 'pass', answer: [...slots] }, () => {
      solved = true;
      controls.disabled = true;
      cards.forEach(card => { card.draggable = false; });
      paragraph(board, '旧联已拼回并收好：第17号 林舟 / 已离 / 22:17。没有重新签名。', 'puzzle-complete');
    }), 'puzzle-submit');
    const reset = button('重置三槽', () => {
      slots.fill(null);
      selected = null;
      dragged = null;
      update();
      this.report('三槽已清空，所有片段回到待选区。');
    });
    const update = () => {
      flip.textContent = back ? '翻回三片正面' : '翻到三片纸背';
      flip.setAttribute('aria-pressed', String(back));
      selection.textContent = selected ? `已选片${selected}，请点击目标槽；占用的槽会交换或退回原片。` : '点选片段，再点击上、中或下槽。';
      cards.forEach((card, id) => {
        const position = slots.indexOf(id);
        const label = `片${id} · ${position === -1 ? '待选区' : ['上槽', '中槽', '下槽'][position]}${selected === id ? ' · 已选中' : ''}`;
        const art = node('span', 'fragment-face', back ? pieces[id].back : pieces[id].front);
        art.style.display = 'block';
        art.style.whiteSpace = 'pre-wrap';
        card.replaceChildren(node('strong', '', label), art);
        card.setAttribute('aria-pressed', String(selected === id));
      });
      slotViews.forEach(({ target, remove }, index) => {
        target.textContent = `${['上片（左）', '中片', '下片（右）'][index]}槽：${slots[index] ? `片${slots[index]}` : '空'} · 点击放置`;
        remove.disabled = !slots[index];
      });
      preview.textContent = slots.map((id, index) => `${['上片', '中片', '下片'][index]}\n${id ? (back ? pieces[id].back : pieces[id].front) : '（空槽）'}`).join('\n\n');
      submit.disabled = slots.some(id => !id);
    };
    controls.append(flip, tray, slotScroll, preview, reset, submit);
    paragraph(board, '纸背接法：完整顶边在最上，单齿接单齿，双齿接双齿，完整底边在最下；中央竖痕连成“离 / 校 / 存根”。这不是补签一张新联。');
    update();
    this.hints(board, [
      '先翻到纸背，正面姓名、状态与时间的异常墨迹不能决定拼法。',
      '上片有完整顶边与单齿下缘，中片上单齿下双齿，下片双齿上缘、完整底边。',
      '上、中、下三槽依次放 a、b、c，读作第17号林舟 / 已离 / 22:17，再核验旧联。',
    ]);
  }

  name() {
    const board = this.board('食堂 · 归名仪式板');
    if (this.state.flags.name) {
      paragraph(board, '第17号林舟姓名条已取回。原册与旧签离联已经自动收回，四十只旧碗未动，册外41碗倒扣。', 'puzzle-complete');
      return;
    }
    this.noteReference('canteen', board);
    paragraph(board, '桌缘的实刻：“灯下置原册，门侧验旧联。册内四十碗不动，册外一碗须倒扣。”');
    const controls = this.controls(board, '摆放旧凭，选择一只碗');
    const placements = { archive: false, pass: false };
    const placementButtons = new Map();
    const names = { archive: '灯下 · 名册原件', pass: '门侧 · 旧签离联' };
    for (const key of ['archive', 'pass']) {
      const item = button('', () => {
        if (!this.state.inventory[key]) {
          this.report(`尚未携带${inventoryLabels[key]}，不能用新纸代替。`, 'error');
          return;
        }
        placements[key] = !placements[key];
        update();
      }, 'ritual-placement');
      placementButtons.set(key, item);
      controls.append(item);
    }
    paragraph(controls, '旧碗共五行八列，编号1—40；每只都有旧刻。点击只检查，不自动倒扣。窄屏可横向滚动，键盘方向键换碗、Enter 检查。');
    let inspecting = null;
    let bowl = null;
    const detail = node('p', 'bowl-inspection', '请先检查碗号。');
    detail.setAttribute('aria-live', 'polite');
    const pick = number => {
      inspecting = number;
      update();
    };
    const oldBowls = this.numberedGrid(controls, '碗', pick);
    const extra = node('div', 'extra-bowl');
    paragraph(extra, '册外的一只 · 不在四十只旧碗的网格内');
    const extraButton = button('检查第41碗 · 新墨号', () => pick(41), 'bowl-41');
    extra.append(extraButton);
    controls.append(extra, detail);
    const turn = button('先检查一只碗', () => {
      bowl = bowl === inspecting ? null : inspecting;
      update();
      this.report(bowl ? `预选倒扣第${bowl}碗；其他碗保持原位，尚未提交仪式。` : '这只碗已放正，目前没有倒扣的碗。');
    }, 'turn-bowl');
    const reset = button('收回预摆，碗全部放正', () => {
      placements.archive = false;
      placements.pass = false;
      bowl = null;
      inspecting = null;
      update();
      this.report('仪式板已重置，随身物品未被消耗。');
    });
    const submit = button('核验旧凭并归名', () => this.act('solve', { id: 'name', answer: { ...placements, bowl } }, () => {
      controls.disabled = true;
      paragraph(board, '已取回第17号林舟姓名条。名册原件与旧签离联自动收回，接下来可去北门，或先调查回声台。', 'puzzle-complete');
    }), 'puzzle-submit');
    const update = () => {
      placementButtons.forEach((item, key) => {
        item.textContent = `${names[key]}：${placements[key] ? '已预摆（点击收回）' : this.state.inventory[key] ? '未摆放（点击放下）' : '未携带'}`;
        item.setAttribute('aria-pressed', String(placements[key]));
      });
      oldBowls.forEach((item, i) => {
        item.textContent = `${i + 1}${bowl === i + 1 ? ' 倒扣' : ''}`;
        item.setAttribute('aria-pressed', String(inspecting === i + 1));
        item.setAttribute('aria-label', `第${i + 1}碗，旧号实刻，${bowl === i + 1 ? '预选倒扣' : '保持原位'}，点击检查`);
      });
      extraButton.textContent = `检查第41碗 · 新墨号${bowl === 41 ? ' · 已预选倒扣' : ''}`;
      extraButton.setAttribute('aria-pressed', String(inspecting === 41));
      detail.textContent = inspecting === null ? '请先检查碗号。' : inspecting === 41 ? '41号只写在表面，没有旧号实刻，也不属于册内四十碗。' : `第${inspecting}碗的号刻进碗底，与原册第${inspecting}行对应，是原有旧碗。`;
      turn.disabled = inspecting === null;
      turn.textContent = inspecting === null ? '先检查一只碗' : bowl === inspecting ? `把第${inspecting}碗放正` : `预选倒扣第${inspecting}碗`;
    };
    controls.append(turn, reset, submit);
    paragraph(board, '一次只预摆一只倒扣碗；改选倒扣对象时会先把上一只放正。只有提交后才核验，关闭面板会丢弃未确认的预摆。');
    update();
    this.hints(board, [
      '翻看归名口诀的纸背，区分原件与新纸、实刻与浮墨。',
      '名册原件放灯下，旧签离联放门侧。五行八列的四十只旧碗都应保持原位。',
      '将两个旧凭按钮切到已预摆，检查网格外41碗并预选倒扣，然后按“核验旧凭并归名”。',
    ]);
  }

  echoes() {
    const board = this.board('食堂 · 旧应答归册');
    if (!this.state.flags.name) {
      paragraph(board, '先在归名桌取回自己的旧姓名条，再来核对其余应答。现在不要以新名字替它们签收。');
      return;
    }
    paragraph(board, '这些是循环保存的旧应答，不是遇害同学。三份样本分别有册号实痕，把声条归到同号槽，便能校准其余应答。');
    paragraph(board, '其他三十九道旧应答将归回原册；仍须关闭重复播送才能散场。你也可以关闭面板，只带自己的名字离开。');
    if (this.state.flags.echoes) {
      paragraph(board, this.state.flags.power ? '旧应答已归册，总路也已停止重复播送，可以前往北门。' : '旧应答已归册。请回行政楼广播总控，停止重复播送。', 'puzzle-complete');
      return;
    }
    const controls = this.controls(board, '把声条放入同册号的槽');
    const samples = [
      { id: 1, slot: '一号槽 · 册页压痕“1”，一条短凹线', strip: '声条 1 · 背面实痕“一”' },
      { id: 8, slot: '八号槽 · 册页压痕“8”，两环刻记', strip: '声条 8 · 背面实痕“八”' },
      { id: 32, slot: '三十二号槽 · 册页压痕“32”，三长两短刻记', strip: '声条 32 · 背面实痕“三十二”' },
    ];
    const selects = [];
    for (const sample of samples) {
      const label = node('label', 'echo-slot');
      label.append(node('span', '', sample.slot));
      const select = node('select', 'echo-select');
      select.style.maxWidth = '100%';
      select.setAttribute('aria-label', sample.slot);
      const empty = node('option', '', '请选择一条旧声条');
      empty.value = '';
      select.append(empty);
      for (const choice of [samples[2], samples[0], samples[1]]) {
        const option = node('option', '', choice.strip);
        option.value = String(choice.id);
        select.append(option);
      }
      select.addEventListener('change', () => { submit.disabled = selects.some(item => !item.value); });
      selects.push(select);
      label.append(select);
      controls.append(label);
    }
    const submit = button('核验三份样本，归还旧应答', () => this.act('echoes', { answer: selects.map(select => Number(select.value)) }, () => {
      controls.disabled = true;
      paragraph(board, '其他三十九道旧应答已归回原册；仍须关闭重复播送才能散场。', 'puzzle-complete');
    }), 'puzzle-submit');
    submit.disabled = true;
    controls.append(button('清空声条选择', () => {
      selects.forEach(select => { select.value = ''; });
      submit.disabled = true;
      this.report('已清空三槽，可重新匹配声条。');
    }), submit);
    this.hints(board, [
      '这里归还的是应答的存档，不是替任何人新签一个名字。',
      '每条声条的背面实痕都对应一个旧册号，按槽的号匹配，不听它自报的名字。',
      '三个槽按界面顺序分别选声条1、声条8、声条32，再提交核验。',
    ]);
  }

  gate() {
    this.title.textContent = '北门 · 旧凭核验';
    const panel = node('section', 'gate-panel document-view');
    panel.append(node('h3', '', '栏杆实刻'));
    paragraph(panel, '旧联证离校，旧名验本人，只核旧凭不收新签。');
    const inventory = this.state.inventory;
    const missing = [];
    if (!inventory.pass) missing.push(inventoryLabels.pass);
    if (!inventory.name) missing.push(inventoryLabels.name);
    paragraph(panel, missing.length ? `尚缺：${missing.join('、')}。北门不会把补签的新纸当旧凭；请沿校园路线找回它们，门始终可以回来核验。` : '旧签离联与第17号姓名条都在。可以核验离校，不必添加任何新签名。', 'gate-readiness');
    if (this.state.flags.name) {
      paragraph(panel, `旧应答：${this.state.flags.echoes ? '已归册' : '未归册'}；重复播送总路：${this.state.flags.power ? '已停止' : '未停止'}。`);
      paragraph(panel, this.state.flags.echoes && this.state.flags.power ? '两项散场条件都已完成。核验旧凭即可结束最后一遍点名。' : '你可以只带自己的名字离开。若想让循环散场，还需归还旧应答并关闭行政总路。');
    }
    const actions = node('div', 'gate-actions');
    actions.append(button('出示旧联与旧名，核验离校', () => this.act('gate', { choice: 'leave' }), 'gate-leave'));
    const confirmation = node('section', 'signature-confirmation');
    confirmation.hidden = true;
    confirmation.setAttribute('aria-label', '主动认领第41行的第二次确认');
    confirmation.append(node('h3', '', '这不是旧凭核验'));
    paragraph(confirmation, `确认后，你将亲手认领伪造的同名身份，走向“${ENDINGS.bad.title}”。无论旧应答或总路是否完成，新签都优先决定这个结局；听见或回应过声音不会替你做此选择。`);
    const consent = node('label', 'signature-consent');
    const check = node('input');
    check.type = 'checkbox';
    check.autocomplete = 'off';
    consent.append(check, node('span', '', '我知道原班只有四十人，仍主动认领第41行“林舟”。'));
    const sign = button('确认：我主动认领第41行', () => {
      if (check.checked) this.act('gate', { choice: 'sign' });
    }, 'gate-sign-confirm');
    sign.disabled = true;
    check.addEventListener('change', () => { sign.disabled = !check.checked; });
    const cancel = button('不认领，退回旧凭核验', () => {
      confirmation.hidden = true;
      check.checked = false;
      sign.disabled = true;
      consider.focus();
      this.report('未签署任何新身份，可以继续核验旧凭或返回校园。');
    });
    confirmation.append(consent, sign, cancel);
    const consider = button('查看新签名选项（尚不签署）', () => {
      confirmation.hidden = false;
      check.checked = false;
      sign.disabled = true;
      cancel.focus();
    }, 'gate-sign-warning');
    consider.hidden = missing.length > 0;
    actions.append(consider);
    panel.append(actions, confirmation);
    this.content.append(panel);
  }

  voice() {
    this.title.textContent = '宿舍 · 门外的声音';
    const panel = node('section', 'voice-panel document-view');
    paragraph(panel, '门外传来与你一模一样的声音：“林舟，已经点过你的名字了。开门吧。”门内的旧纸却还没有对上压痕。');
    paragraph(panel, '声音应答只会暴露位置，不会替你认领第41行。开门会触发可重试的追逐，不是结局。');
    const reply = paragraph(panel, '你可以隔门核验、保持沉默，或明知风险仍打开门。', 'voice-reply');
    const actions = node('div', 'voice-actions');
    actions.append(
      button('隔门核验旧纸压痕', () => this.act('voice', { choice: 'verify' }, () => {
        reply.textContent = '你问：“旧纸背面的撕口和压痕是什么？”门外先学你声，回答不了旧纸压痕。它又学了一遍你的问题，始终没有给出证据。反复调查不会额外恢复 SAN。';
      })),
      button('保持沉默，不开门', () => this.act('voice', { choice: 'silence' }, () => {
        reply.textContent = '你没有开门，也没有新签。门外的声音只能重复已经听过的话。';
      })),
      button('打开门（触发可重试追逐）', () => this.act('voice', { choice: 'open' }, () => {
        reply.textContent = '门已打开。关闭面板回到现场，利用遮挡与距离脱离追逐；追逐不是结局判定。';
      })),
    );
    panel.append(actions);
    this.content.append(panel);
  }

  lamp() {
    this.title.textContent = this.object.label || '安全灯 · 检修座';
    const panel = node('section', 'lamp-panel');
    paragraph(panel, '检修插头带有与灯座一致的凹口，铭牌刻着“照明检修”。旁边另有广播支路端口；外观相近，用途不同。');
    const connected = this.state.activatedLamps.includes(this.object.id);
    const status = paragraph(panel, connected ? '这盏安全灯已接通照明检修端口。' : '请选择与插头铭牌、凹口相符的端口。', 'lamp-status');
    const controls = this.controls(panel, '两个可辨认的端口');
    const connect = port => this.act('lamp', { id: this.object.id, port }, () => {
      controls.disabled = true;
      status.textContent = '照明已接通。请关闭面板，到灯下按住 R 或使用定神操作恢复 SAN。安全灯不能清除敌人的追逐。';
    });
    controls.append(
      button('接入照明检修端口（灯座凹口匹配）', () => connect('light'), 'lamp-port'),
      button('接入广播支路端口（广播插座）', () => connect('broadcast'), 'lamp-port'),
    );
    controls.disabled = connected;
    paragraph(panel, '接错可以重选，不会替你完成接线。追逐中不能打开检修面板；先利用遮挡脱离敌人，再来接灯。');
    paragraph(panel, '恢复操作在现场进行：关闭面板，到已接通的灯下按住 R / 定神。灯光不是清除仇恨的开关。');
    this.content.append(panel);
  }

  bell() {
    this.title.textContent = '实验楼 · 机械校铃与门闩';
    const panel = node('section', 'bell-panel');
    paragraph(panel, '透过玻璃能看见铃槌与门闩连杆。检修铭牌规定：铃槌短击、短击、长击，随后门闩动作。只有响声、没有这些动作的伪铃不可相信。');
    const pattern = node('ol', 'bell-pattern');
    ['第一次：短击，铃槌回位', '第二次：短击，铃槌回位', '第三次：长击，观察门闩'].forEach(line => pattern.append(node('li', '', line)));
    panel.append(pattern);
    const status = paragraph(panel, this.state.flags.circuit ? '本楼分路已核验，可以观察机械校铃。' : '先在本楼检修柜核验线路；只有广播里的铃声不算通过。', 'bell-observation');
    panel.append(button('观察实体铃槌与门闩', () => this.act('bell', {}, () => {
      status.textContent = this.state.flags.circuit ? '观察记录：实体铃槌两短一长，并伴随门闩动作。关闭面板后由现场呈现机械动作；不要把无动作的回放声当成另一遍放行。' : '铃槌没有动，门闩也没有抬起。先恢复本楼线路，不要相信只有声音的伪铃。';
    })));
    this.content.append(panel);
  }

  training() {
    this.title.textContent = '演练 · 点名者与遮挡';
    const panel = node('section', 'training-panel');
    paragraph(panel, '演习会启动一段可重试的追逐。关闭此面板回到现场后，移动到墙体遮挡后并拉开距离；安全灯不会直接消除追逐。');
    paragraph(panel, '失败后打开暂停菜单选择“从最近检查点重新开始”；完成全部项目后点击左上方“完成教程”。');
    const start = button('启动教学躲藏演习', () => this.act('training', {}, () => {
      start.disabled = true;
      paragraph(panel, '演习已启动。请关闭面板返回世界，练习借助遮挡脱离追逐。');
    }), 'training-start');
    panel.append(start);
    this.content.append(panel);
  }

  tutorialPuzzle() {
    const board = this.board('练习台 · 检查纸背');
    if (this.state.flags.tutorialPaper || this.state.tutorial.puzzle) {
      paragraph(board, '原痕已确认：第17号。接下来关闭面板，按当前目标练习灯下定神、温水与躲藏。', 'puzzle-complete');
      return;
    }
    this.noteReference('tutorial', board);
    paragraph(board, '练习纸正面是第41号浮墨，纸背只留第17号旧压痕。这个练习没有额外隐藏锁，也不需要新签。');
    const confirm = button('翻纸确认原痕', () => this.act('solve', { id: 'tutorial', answer: 17 }, () => {
      confirm.disabled = true;
      paragraph(board, '已按旧压痕确认第17号。下一步请关闭面板返回现场。', 'puzzle-complete');
    }), 'puzzle-submit');
    board.append(confirm);
    this.hints(board, [
      '墨迹与纸背压痕冲突时，先看纸背。',
      '练习纸背保留的是17；41只是正面的新墨。',
      '按“翻纸确认原痕”即可提交第17号，教学的其他操作在现场进行。',
    ]);
  }

  journal() {
    this.title.textContent = '夜录手册 · 已核验证据';
    const panel = node('article', 'journal-view document-view');
    paragraph(panel, INTRO[0]);
    panel.append(node('h3', '', '下一目标'));
    paragraph(panel, objective(this.state), 'current-objective');
    panel.append(node('h3', '', '随身物品'));
    const inventory = node('ul', 'inventory-list');
    let count = 0;
    for (const [key, label] of Object.entries(inventoryLabels)) {
      const value = this.state.inventory[key];
      if (value) {
        inventory.append(node('li', '', `${label}${typeof value === 'number' ? ` × ${value}` : ''}`));
        count++;
      }
    }
    if (!count) inventory.append(node('li', '', '尚未取得旧凭或温水。'));
    panel.append(inventory, node('h3', '', '已翻背核验的纸张'));
    let known = 0;
    for (const [scene, note] of Object.entries(NOTES)) {
      if (!this.state.notes.includes(`${scene}-note`)) continue;
      known++;
      const entry = node('details', 'journal-note');
      entry.append(node('summary', '', `${SCENES[scene].label} · ${note.title}`));
      entry.append(node('h4', '', '正面 · 浮墨可能改写'));
      paragraph(entry, note.front);
      entry.append(node('h4', '', '背面 · 已核验旧压痕'));
      paragraph(entry, note.back);
      panel.append(entry);
    }
    if (!known) paragraph(panel, '手册还没有已核验纸背。到现场调查纸条并翻背后才会收录，不展示未取得的线索。');
    panel.append(node('h3', '', '夜行规则'));
    const rules = node('ol', 'rules-list');
    RULES.forEach(rule => rules.append(node('li', '', rule)));
    panel.append(rules);
    this.route(panel);
    if (this.state.flags.name) paragraph(panel, '完成归名后，可先在食堂归还旧应答，再返行政楼处理总控，最后到北门；也可以只核验自己的旧凭离开。');
    if (this.state.mode === 'tutorial' || this.state.scene === 'tutorial') {
      const details = node('details', 'tutorial-reference');
      details.append(node('summary', '', '演习操作索引'));
      const steps = node('ol');
      TUTORIAL_STEPS.forEach(step => steps.append(node('li', '', step)));
      details.append(steps);
      panel.append(details);
    }
    this.content.append(panel);
  }

  map() {
    this.title.textContent = '校园纵向图';
    const panel = node('section', 'map-view');
    paragraph(panel, '北在上，南在下。地图只标建筑与当前开放状态，不显示敌人位置。');
    const list = node('ol', 'campus-map');
    list.append(node('li', this.state.scene === 'campus' ? 'current-location' : '', `北门与校园主路 · 开放${this.state.scene === 'campus' ? ' · 你在校园' : ''}`));
    for (const building of BUILDINGS) {
      const available = !building.required || Boolean(this.state.flags[building.required]);
      const current = this.state.scene === building.id;
      const item = node('li', current ? 'current-location' : '', `${building.name} · ${available ? '已开放' : '尚未开放'}${this.state.flags[building.flag] ? ' · 本楼旧凭已核验' : ''}${current ? ' · 当前位置' : ''}`);
      if (current) item.setAttribute('aria-current', 'location');
      list.append(item);
    }
    panel.append(list);
    if (this.state.scene === 'tutorial') paragraph(panel, '当前位置：入夜演习。演习区域独立于正式校园路线。');
    panel.append(node('h3', '', '下一目标'));
    paragraph(panel, objective(this.state));
    if (this.state.flags.name) paragraph(panel, '散场路线：食堂回声台 → 返回行政楼总控 → 北门。只带自己的名字离校则可直接去北门核验。');
    this.content.append(panel);
  }
}
