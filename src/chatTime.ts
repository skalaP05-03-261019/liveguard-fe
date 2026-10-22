export function timeoutEndText(until: string): string {
  return new Date(until).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
}

export function timeoutRemainingText(until: string | null | undefined, now: number): string {
  if (!until) return '';
  const seconds = Math.max(0, Math.ceil((Date.parse(until) - now) / 1000));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return `${hours ? `${hours}시간 ` : ''}${minutes}분 ${seconds % 60}초`;
}

// 운영자 화면의 시각 표시. 연도까지 넣은 표준 형식(YYYY-MM-DD HH:mm, 한국 시간)이다. 예) 2026-10-22 22:40
const dateTimeParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function dateTimeText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (Number.isNaN(time)) return '-';
  const part = Object.fromEntries(dateTimeParts.formatToParts(time).map(x => [x.type, x.value]));
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}`;
}
