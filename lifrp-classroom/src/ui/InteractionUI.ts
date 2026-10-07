export interface ContextPrompt {
  id: string;
  label: string;
  hint: string;
  distance: number;
  kind: 'object' | 'person' | 'door' | 'portal';
}

export interface ContextAction { id: string; label: string; disabled?: boolean; }
export interface EvidenceEntry { event: string; source: string; text: string; }

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export class InteractionUI {
  private expanded = false;
  private overlay: HTMLDialogElement | null = null;
  private contextSignature = '';

  constructor(private readonly root: HTMLElement, private readonly onAction: (id: string) => void, private readonly onModalChange: (open: boolean, pausesWorld: boolean) => void = () => {}) {}

  renderContext(prompt: ContextPrompt | null, actions: ContextAction[]) {
    const signature = `${prompt?.id || ''}|${prompt?.label || ''}|${prompt?.hint || ''}|${this.expanded}|${actions.map(action => `${action.id}:${action.label}:${Boolean(action.disabled)}`).join(';')}`;
    if (signature === this.contextSignature) return;
    this.contextSignature = signature;
    this.root.hidden = false;
    this.root.replaceChildren();
    const kicker = node('div', prompt ? '附近目标 / NEARBY' : '交互系统 / CONTEXT', 'interaction-kicker');
    const title = node('div', prompt?.label || '场景交互', 'interaction-title');
    const hint = node('p', prompt?.hint || '锁定一个场景目标，靠近后执行主要动作。', 'interaction-hint');
    this.root.append(kicker, title, hint);
    if (!actions.length) {
      this.root.append(node('p', prompt ? '当前目标暂时没有可执行行动。先完成事件前置条件。' : '移动到金色目标附近开始调查。', 'interaction-empty'));
      return;
    }
    const primary = actions[0];
    const primaryButton = this.actionButton(primary, true);
    this.root.append(primaryButton);
    const secondary = actions.slice(1, 4);
    if (secondary.length) {
      const expand = node('button', this.expanded ? '收起其他行动' : `更多行动（${secondary.length}）`, 'interaction-more') as HTMLButtonElement;
      expand.type = 'button';
      expand.addEventListener('click', () => { this.expanded = !this.expanded; this.renderContext(prompt, actions); });
      this.root.append(expand);
      if (this.expanded) {
        const list = node('div', undefined, 'interaction-secondary');
        secondary.forEach(action => list.append(this.actionButton(action, false)));
        this.root.append(list);
      }
    }
  }

  openObjectView(title: string, body: string[], action: { label: string; disabled?: boolean; onConfirm: () => void } | null) {
    this.openOverlay('物品近景 / CLOSE LOOK', title, body, action);
  }

  openDialogue(speaker: string, body: string[], action: { label: string; disabled?: boolean; onConfirm: () => void } | null) {
    this.openOverlay(`对话 / ${speaker}`, speaker, body, action);
  }

  openEvidence(entries: EvidenceEntry[]) {
    const dialog = this.createDialog('证据记录 / EVIDENCE');
    const list = node('div', undefined, 'evidence-list');
    if (!entries.length) list.append(node('p', '尚未发现可记录的证据。', 'interaction-empty'));
    for (const entry of entries) {
      const card = node('article', undefined, 'evidence-card');
      card.append(node('span', entry.event, 'evidence-event'), node('strong', entry.source), node('p', entry.text));
      list.append(card);
    }
    dialog.append(list);
    this.show(dialog, true);
  }

  close() { this.overlay?.close(); }

  private actionButton(action: ContextAction, primary: boolean) {
    const button = node('button', action.label, primary ? 'interaction-primary' : 'interaction-action') as HTMLButtonElement;
    button.type = 'button';
    button.dataset.action = action.id;
    button.disabled = Boolean(action.disabled);
    button.addEventListener('click', () => this.onAction(action.id));
    return button;
  }

  private openOverlay(kicker: string, title: string, body: string[], action: { label: string; disabled?: boolean; onConfirm: () => void } | null) {
    const dialog = this.createDialog(kicker);
    dialog.append(node('h3', title, 'close-look-title'));
    const text = node('div', undefined, 'close-look-copy');
    body.forEach(line => text.append(node('p', line)));
    dialog.append(text);
    if (action) {
      const confirm = node('button', action.label, 'primary-button') as HTMLButtonElement;
      confirm.type = 'button'; confirm.disabled = Boolean(action.disabled);
      confirm.addEventListener('click', () => { action.onConfirm(); dialog.close(); });
      dialog.append(confirm);
    }
    this.show(dialog, false);
  }

  private createDialog(kicker: string) {
    const dialog = document.createElement('dialog');
    dialog.className = 'interaction-dialog settings-dialog';
    dialog.append(node('div', kicker, 'section-kicker'));
    const close = node('button', '返回探索', 'text-button') as HTMLButtonElement;
    close.type = 'button'; close.addEventListener('click', () => dialog.close());
    dialog.append(close);
    dialog.addEventListener('close', () => { if (this.overlay === dialog) this.overlay = null; dialog.remove(); });
    return dialog;
  }

  private show(dialog: HTMLDialogElement, pausesWorld: boolean) {
    this.overlay?.close();
    this.overlay = dialog;
    dialog.dataset.pausesWorld = String(pausesWorld);
    document.body.append(dialog);
    dialog.addEventListener('close', () => this.onModalChange(false, pausesWorld), { once: true });
    this.onModalChange(true, pausesWorld);
    dialog.showModal();
  }
}
