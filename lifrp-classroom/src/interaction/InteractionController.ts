import type { InteractionTarget } from './targets';

export type InteractionPhase = 'idle' | 'locked' | 'approaching' | 'operating' | 'dialogue' | 'confirming';
export interface InteractionPosition { room: string; x: number; z: number; view: 'map' | 'first-person'; }
export interface InteractionState {
  phase: InteractionPhase;
  target: InteractionTarget | null;
  distance: number;
  canOperate: boolean;
  message: string;
}

export interface InteractionControllerOptions {
  targets: () => InteractionTarget[];
  isActionAvailable: (actionId: string, target: InteractionTarget) => boolean;
  submit: (actionId: string, target: InteractionTarget) => void;
  canSee?: (target: InteractionTarget, position: InteractionPosition) => boolean;
  onChange?: (state: InteractionState) => void;
}

/** Coordinates lock, proximity and one-shot submission for both camera modes. */
export class InteractionController {
  private state: InteractionState = { phase: 'idle', target: null, distance: Infinity, canOperate: false, message: '' };
  private lockedId: string | null = null;
  private submitted = new Set<string>();

  constructor(private readonly options: InteractionControllerOptions) {}

  get snapshot() { return this.state; }

  update(position: InteractionPosition) {
    const target = this.options.targets().filter(item => item.room === position.room)
      .map(item => ({ item, distance: Math.hypot(item.x - position.x, item.z - position.z) }))
      .filter(({ item, distance }) => distance <= item.observeRange)
      .filter(({ item }) => !this.options.canSee || this.options.canSee(item, position))
      .sort((a, b) => a.distance - b.distance)[0];
    if (!target) return this.clear();
    if (this.lockedId && this.lockedId !== target.item.id) this.lockedId = null;
    const locked = this.lockedId === target.item.id;
    const canOperate = target.distance <= target.item.range && locked;
    const next: InteractionState = {
      phase: locked ? (canOperate ? 'locked' : 'approaching') : 'idle',
      target: target.item,
      distance: target.distance,
      canOperate,
      message: canOperate ? '' : `再靠近${target.item.label}`,
    };
    this.publish(next);
    return next;
  }

  lock(id: string, distance = 0) {
    const target = this.options.targets().find(item => item.id === id) || null;
    if (!target) return this.clear();
    this.lockedId = id;
    const canOperate = distance <= target.range;
    this.publish({ ...this.state, phase: canOperate ? 'locked' : 'approaching', target, distance, canOperate, message: canOperate ? '' : `再靠近${target.label}` });
    return this.state;
  }

  operate(actionId?: string) {
    const target = this.state.target;
    if (!target || !this.state.canOperate) return false;
    const action = actionId || target.actionIds.find(id => this.options.isActionAvailable(id, target));
    if (!action || !this.options.isActionAvailable(action, target)) return false;
    const key = `${target.id}:${action}`;
    if (this.submitted.has(key)) return false;
    this.submitted.add(key);
    this.publish({ ...this.state, phase: 'operating' });
    this.options.submit(action, target);
    return true;
  }

  cancel() {
    this.lockedId = null;
    this.submitted.clear();
    this.publish({ phase: 'idle', target: this.state.target, distance: this.state.distance, canOperate: false, message: '' });
  }

  clear() {
    this.lockedId = null;
    this.publish({ phase: 'idle', target: null, distance: Infinity, canOperate: false, message: '' });
    return this.state;
  }

  resetSubmitted() { this.submitted.clear(); }

  /** Release a command after its confirmation/cancellation so repeatable game
   * actions (snacks, study slots, and evidence review) remain available while
   * a rapid duplicate click is still rejected during the current submission. */
  release(actionId: string, targetId = this.state.target?.id) {
    if (targetId) this.submitted.delete(`${targetId}:${actionId}`);
  }

  private publish(next: InteractionState) {
    this.state = next;
    this.options.onChange?.(next);
  }
}
