import { LIVE_CHANNEL_ID, sysChannels } from './systemMock';

// 기간 통계(#41)의 데이터 모양. Backend에 요청한 기간 집계 API(GET /api/admin/stats, 초안)의 응답과 같게 둔다.
// 실제 API가 생기기 전까지 목업만 이 모양의 예시 데이터를 만든다.
export interface PeriodLive {
  liveId: string; channelId: string; channelName: string; startedAt: string; endedAt: string | null;
  scanned: number; hidden: number; held: number;
  kickReviews: { pending: number; approved: number; rejected: number; invalidated: number };
}
export interface PeriodDay { date: string; scanned: number; hidden: number; held: number }
export interface PeriodStats { from: string; to: string; lives: PeriodLive[]; daily: PeriodDay[] }

// 한국 시간 날짜(YYYY-MM-DD)와 그날 0시의 UTC 시각. 화면은 한국 시간, API에는 UTC로 보낸다.
const KST = 9 * 3600_000, DAY = 86400_000;
export const kstDay = (t: number) => new Date(t + KST).toISOString().slice(0, 10);
export const kstStart = (day: string) => Date.parse(`${day}T00:00:00Z`) - KST;
export const addDays = (day: string, n: number) => kstDay(kstStart(day) + n * DAY);
export const daysBetween = (from: string, to: string) => Math.round((kstStart(to) - kstStart(from)) / DAY) + 1;

// 고정된 예시가 나오도록 날짜·채널로 정한 의사 난수(0~1)
const rand = (seed: number) => { const v = Math.sin(seed * 12.9898) * 43758.5453; return v - Math.floor(v); };
const channels = [{ id: LIVE_CHANNEL_ID, name: '행복한게임방', live: true }, ...sysChannels.map(c => ({ id: c.id, name: c.name, live: c.live }))];
const BASE_RATE = [2.1, 2.3, 2.2, 1.7, 1.4]; // 방송별 평소 비정상 비율(%)

// 오늘부터 35일 전까지의 예시 방송. 오늘은 방송 중인 채널만 진행 중이고, 하루 전 롤 랭크 올리기에 비정상이 몰린 날이 있다.
function mockLives(now: number): PeriodLive[] {
  const today = kstDay(now), lives: PeriodLive[] = [];
  for (let k = 35; k >= 0; k--) {
    const day = addDays(today, -k);
    channels.forEach((ch, i) => {
      const r = (j: number) => rand(k * 97 + i * 13 + j);
      let start: number, end: number | null;
      if (k === 0) { if (!ch.live) return; start = now - (1 + i) * 3600_000; end = null; }
      else { if (r(1) > 0.7) return; start = kstStart(day) + (18 + i % 3) * 3600_000; end = start + (2 + Math.floor(r(2) * 3)) * 3600_000; }
      const scanned = 300 + Math.floor(r(3) * 1200);
      const rate = Math.max(0.3, BASE_RATE[i] + (k === 1 && i === 1 ? 4 : 0) + (r(4) - 0.5) * 1.2);
      lives.push({
        liveId: `${ch.id}-${day}`, channelId: ch.id, channelName: ch.name, startedAt: new Date(start).toISOString(), endedAt: end === null ? null : new Date(end).toISOString(),
        scanned, hidden: Math.round(scanned * rate / 100), held: k === 0 ? Math.floor(r(5) * 8) : 0,
        kickReviews: { approved: r(6) < 0.3 ? 1 : 0, rejected: r(7) < 0.15 ? 1 : 0, pending: k === 0 && r(8) < 0.5 ? 1 : 0, invalidated: 0 }
      });
    });
  }
  return lives;
}

// 기간 [from, to)와 겹치는 방송, 그리고 한국 시간 날짜별 합계(그날 시작한 방송 기준)
export function mockPeriodStats(fromDay: string, toDay: string, now: number): PeriodStats {
  const from = kstStart(fromDay), to = kstStart(toDay) + DAY;
  const lives = mockLives(now)
    .filter(l => Date.parse(l.startedAt) < to && (l.endedAt === null || Date.parse(l.endedAt) >= from))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const daily: PeriodDay[] = [];
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    const same = lives.filter(l => kstDay(Date.parse(l.startedAt)) === day);
    daily.push({ date: day, scanned: same.reduce((n, l) => n + l.scanned, 0), hidden: same.reduce((n, l) => n + l.hidden, 0), held: same.reduce((n, l) => n + l.held, 0) });
  }
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), lives, daily };
}
