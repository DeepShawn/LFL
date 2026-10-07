import { describe, expect, it } from 'vitest';
import { actInteraction, createGame, type GameOptions } from '../simulation/game';
import { InteractionController } from './InteractionController';
import { targetById, targetsForRoom } from './targets';
import { findPath, segmentClear } from '../world/navigation';
import collision from '../../public/assets/models/collision.json';

const options: GameOptions = {
  name: '交互测试', mode: 'chapters', role: 'student', region: 'front',
  seat: { id: 'F-01', row: 1, column: 3, special: null }, difficulty: 'normal', unlockedChapter: 1,
};

describe('scene interaction contract', () => {
  it('locks a stable target and submits one action once', () => {
    const submitted: string[] = [];
    const controller = new InteractionController({
      targets: () => targetsForRoom('classroom'),
      isActionAvailable: action => action === 'inspect:q2',
      submit: action => submitted.push(action),
      canSee: () => true,
    });
    controller.update({ room: 'classroom', x: 0, z: .55, view: 'map' });
    expect(controller.snapshot.target?.id).toBe('classroom:desk');
    expect(controller.snapshot.canOperate).toBe(false);
    controller.lock('classroom:desk', .4);
    expect(controller.snapshot.canOperate).toBe(true);
    expect(controller.operate('inspect:q2')).toBe(true);
    expect(controller.operate('inspect:q2')).toBe(false);
    controller.release('inspect:q2', 'classroom:desk');
    expect(controller.operate('inspect:q2')).toBe(true);
    expect(submitted).toEqual(['inspect:q2', 'inspect:q2']);
  });

  it('rejects stale room targets before the event state machine runs', () => {
    const state = createGame(options, () => 0);
    const before = JSON.stringify(state);
    const result = actInteraction(state, 'office:records', 'evidence:office', () => 0);
    expect(result.message).toContain('当前房间');
    expect(JSON.stringify(state)).toBe(before);
  });

  it('uses the same object command to enter through a physical door', () => {
    const state = createGame(options, () => 0);
    state.room = 'corridor';
    const result = actInteraction(state, 'corridor:office-door', 'go:office', () => 0);
    expect(result.tone).toBe('quiet');
    expect(state.room).toBe('office');
  });

  it('keeps the chemistry representative task on the desk target', () => {
    const state = createGame({ ...options, role: 'chemistry-rep' }, () => 0);
    const result = actInteraction(state, 'classroom:desk', 'rep:inspect', () => 0);
    expect(result.tone).toBe('quiet');
    expect(state.data['homework-correction'].marked).toEqual(['q2', 'q5']);
  });

  it('finds a reachable waypoint path and rejects a blocked direct segment', () => {
    const room = { bounds: [-5, 5, -4, 4] as [number, number, number, number], obstacles: [[-1, 1, -1, 1] as [number, number, number, number]] };
    expect(segmentClear({ x: -2, z: 2 }, { x: 2, z: -2 }, room)).toBe(false);
    const path = findPath({ x: -2, z: 2 }, { x: 2, z: -2 }, room);
    expect(path).not.toBeNull();
    expect(path?.at(-1)).toEqual({ x: 2, z: -2 });
    expect(targetById('classroom:desk')?.room).toBe('classroom');
    expect(targetById('classroom:desk')?.actionIds).toContain('rep:inspect');
  });

  it('keeps the office doorway reachable without removing office cubicle blockers', () => {
    const office = collision.office as { bounds: [number, number, number, number]; obstacles: [number, number, number, number][] };
    expect(findPath({ x: 0, z: -3.2 }, { x: 0, z: 3.1 }, office)).not.toBeNull();
    expect(office.obstacles).toContainEqual([-1.05, 1.05, -2.42, -0.86]);
  });
});
