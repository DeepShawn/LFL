export type InteractionRoom = 'classroom' | 'corridor' | 'office';
export type TargetKind = 'object' | 'person' | 'door';

export interface InteractionTarget {
  id: string;
  room: InteractionRoom;
  kind: TargetKind;
  label: string;
  hint: string;
  x: number;
  z: number;
  range: number;
  observeRange: number;
  actionIds: string[];
  targetRoom?: InteractionRoom;
}

/**
 * Stable gameplay IDs live here instead of depending on merged GLB node names.
 * Coordinates are shared by both asset tiers and are deliberately sparse: the
 * renderer only queries targets in the currently loaded room.
 */
export const INTERACTION_TARGETS: InteractionTarget[] = [
  {
    id: 'classroom:desk', room: 'classroom', kind: 'object', label: '自己的课桌',
    hint: '打开作业本、抽屉或桌面的实验记录', x: 0, z: .55, range: 1.8, observeRange: 3.2,
    actionIds: ['rep:inspect', 'inspect:q2', 'inspect:q5', 'solve:q2:44', 'solve:q2:32', 'solve:q5:balanced', 'solve:q5:unbalanced', 'evidence:work', 'evidence:experiment', 'evidence:textbook', 'explain:method', 'difference:reasoning', 'difference:wrong-answer', 'snack', 'schedule:balanced', 'schedule:focused', 'track', 'study', 'rest', 'holiday:next-day', 'submit'],
  },
  {
    id: 'classroom:board', room: 'classroom', kind: 'object', label: '黑板与讲台',
    hint: '查看板书、课表和讲台上的批注', x: 0, z: -3.18, range: 1.45, observeRange: 4.5,
    actionIds: ['evidence:blackboard', 'evidence:experiment', 'evidence:classroom', 'evidence:textbook', 'inspect:q2', 'inspect:q5', 'answer:surface-area', 'answer:more-gas', 'answer:catalyst', 'speak:fact', 'speak:clarify', 'speak:learn', 'intervene:item'],
  },
  {
    id: 'classroom:neighbor', room: 'classroom', kind: 'person', label: '邻座同学',
    hint: '请求协作，或听取研究性问题的耳语提示', x: 1.45, z: .55, range: 1.3, observeRange: 3.4,
    actionIds: ['distract', 'listen', 'evidence:witness', 'explain:method', 'difference:reasoning', 'difference:wrong-answer'],
  },
  {
    id: 'classroom:submit', room: 'classroom', kind: 'object', label: '收作业的位置',
    hint: '确认答案后，把作业本交到讲台', x: -1.25, z: -2.85, range: 1.25, observeRange: 3.8,
    actionIds: ['submit', 'intervene:item', 'solve:q2:44', 'solve:q2:32', 'solve:q5:balanced', 'solve:q5:unbalanced'],
  },
  {
    id: 'corridor:witness', room: 'corridor', kind: 'person', label: '走廊同学',
    hint: '交谈、询问语气，核对独立作答过程', x: 0, z: 0, range: 1.4, observeRange: 3.5,
    actionIds: ['evidence:witness', 'listen', 'judge:serious', 'judge:joking', 'intervene:dialogue', 'divert', 'route'],
  },
  {
    id: 'corridor:classroom-door', room: 'corridor', kind: 'door', label: '教室门',
    hint: '靠近门口后进入教室', x: -9.5, z: -.9, range: 1.2, observeRange: 3,
    actionIds: ['go:classroom', 'escape'], targetRoom: 'classroom',
  },
  {
    id: 'corridor:office-door', room: 'corridor', kind: 'door', label: '办公室门',
    hint: '靠近门口后进入办公室', x: 9.5, z: -.9, range: 1.2, observeRange: 3,
    actionIds: ['go:office', 'escape'], targetRoom: 'office',
  },
  {
    id: 'classroom:corridor-door', room: 'classroom', kind: 'door', label: '走廊门',
    hint: '靠近门口后进入走廊', x: -4.45, z: -1, range: 1.2, observeRange: 3,
    actionIds: ['go:corridor', 'escape'], targetRoom: 'corridor',
  },
  {
    id: 'office:records', room: 'office', kind: 'object', label: '办公室资料桌',
    hint: '查看审批记录、订单和付款便条', x: 0, z: -3.05, range: 1.35, observeRange: 3.4,
    actionIds: ['evidence:office', 'evidence:order'],
  },
  {
    id: 'office:teacher', room: 'office', kind: 'person', label: '办公室老师',
    hint: '出示材料、请求说明或提交完整记录', x: 1.55, z: -3.05, range: 1.35, observeRange: 3.5,
    actionIds: ['intervene:organize', 'escape'],
  },
  {
    id: 'office:corridor-door', room: 'office', kind: 'door', label: '办公室门',
    hint: '靠近门口后返回走廊', x: 0, z: 3.1, range: 1.2, observeRange: 3,
    actionIds: ['go:corridor', 'escape'], targetRoom: 'corridor',
  },
];

export function targetsForRoom(room: InteractionRoom) {
  return INTERACTION_TARGETS.filter(target => target.room === room);
}

export function targetById(id: string) {
  return INTERACTION_TARGETS.find(target => target.id === id);
}
