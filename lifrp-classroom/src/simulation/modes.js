const EVENT_ORDER = [
  'homework-correction',
  'snacking',
  'research-question',
  'untaught-topic',
  'copying-suspicion',
  'milk-tea',
  'rain',
  'holiday-homework',
];

export function getInitialUnlocks() {
  return {
    day: true,
    chapters: [1],
    challenge: false,
    eventCount: 2,
    dayEventCount: 2,
    events: EVENT_ORDER.slice(0, 2),
  };
}

export function getUnlocksAfterChapter(chapter) {
  const completed = Math.max(0, Math.min(5, chapter));
  const eventCount = Math.min(8, completed === 0 ? 2 : completed === 1 ? 4 : completed === 2 ? 6 : completed === 3 ? 7 : 8);
  return {
    day: true,
    chapters: Array.from({ length: completed + 1 }, (_, index) => index + 1).filter((value) => value <= 5),
    challenge: completed >= 1,
    eventCount,
    dayEventCount: completed >= 2 ? eventCount : 2,
    events: EVENT_ORDER.slice(0, eventCount),
  };
}

export function getEventOrder() {
  return [...EVENT_ORDER];
}
