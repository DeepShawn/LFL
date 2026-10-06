import { DIFFICULTY_CONFIG } from '../simulation/difficulty.js';

export function getSnackTargetCount(difficulty) {
  return { simple: 2, normal: 3, hard: 4, terror: 5 }[difficulty];
}

export function getResearchPromptAttempts(difficulty) {
  return DIFFICULTY_CONFIG[difficulty].promptAttempts;
}

export function applyFailurePolicy(difficulty) {
  if (difficulty === 'simple') return { kind: 'continue', suspicion: 0, pressure: 0, chase: false };
  if (difficulty === 'normal') return { kind: 'continue', suspicion: 12, pressure: 10, chase: false };
  if (difficulty === 'hard') return { kind: 'anomaly', suspicion: 18, pressure: 18, chase: true };
  return { kind: 'terror', suspicion: 24, pressure: 24, chase: true };
}

export function getEventDefinition(id) {
  return {
    'homework-correction': { title: '课前订正作业', location: '教室', summary: '找到被标记的错题，完成订正并在上课前交出。' },
    snacking: { title: '上课偷吃', location: '教室', summary: '在视线窗口之间分多次偷吃完目标份数。' },
    'research-question': { title: '后三排研究性问题', location: '教室后排', summary: '靠同学小声提示与课堂线索推理回答。' },
    'untaught-topic': { title: '没讲过的知识点', location: '教室', summary: '取证后，用多轮礼貌表达请求澄清。' },
    'copying-suspicion': { title: '抄作业怀疑', location: '教室/走廊', summary: '建立完整证据链，避免被怀疑抄作业。' },
    'milk-tea': { title: '避免请奶茶', location: '教室/走廊/办公室', summary: '判断意图，先转移注意力，失败后路线躲避。' },
    rain: { title: '求雨占体育课', location: '教室/办公室/走廊', summary: '调查真相后，用任一干预路线阻止求雨。' },
    'holiday-homework': { title: '假期巨量化学作业', location: '假期作业桌', summary: '追踪题目、安排排程，并控制心理压力。' },
  }[id];
}
