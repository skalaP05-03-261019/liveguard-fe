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

// 운영자 화면의 시각 표시. 방송이 자정을 넘기거나 나중에 다시 볼 때도 구분되도록 날짜를 함께 쓴다. 예) 10월 22일 22:40
const dateTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function dateTimeText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const time = typeof value === 'number' ? value : Date.parse(value);
  return Number.isNaN(time) ? '-' : dateTime.format(time);
}
