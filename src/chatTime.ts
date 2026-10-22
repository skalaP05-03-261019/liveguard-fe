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
