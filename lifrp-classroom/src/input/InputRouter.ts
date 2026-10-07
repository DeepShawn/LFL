export class InputRouter {
  onInteract: () => void = () => {};
  onCancel: () => void = () => {};
  onView: () => void = () => {};
  onPanel: () => void = () => {};
  private enabled = false;
  private readonly target: Window;

  constructor(target: Window = window) { this.target = target; }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.target.addEventListener('keydown', this.keydown);
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.target.removeEventListener('keydown', this.keydown);
  }

  private keydown = (event: KeyboardEvent) => {
    if (!this.enabled || event.repeat) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('input,select,textarea,dialog')) return;
    if (event.code === 'KeyE') { event.preventDefault(); this.onInteract(); }
    else if (event.code === 'Escape') { event.preventDefault(); this.onCancel(); }
    else if (event.code === 'KeyV') { event.preventDefault(); this.onView(); }
    else if (event.code === 'KeyI') { event.preventDefault(); this.onPanel(); }
  };
}
