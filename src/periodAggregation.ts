// Proposed BE #89 semantics for mock data only; not a published API contract.
export interface PeriodLive {
  liveId: string; channelId: string; channelName: string; startedAt: string; endedAt: string | null;
  scanned: number; hidden: number; held: number;
  kickReviews: { pending: number; approved: number; rejected: number; invalidated: number };
}
export interface PeriodDay { date: string; scanned: number; hidden: number; held: number }
export interface PeriodStats { from: string; to: string; lives: PeriodLive[]; daily: PeriodDay[] }
export type FixtureLive = Pick<PeriodLive, 'liveId' | 'channelId' | 'channelName' | 'startedAt' | 'endedAt'>;
export interface PeriodFixture {
  lives: FixtureLive[];
  // Each group represents count synthetic messages sent at this timestamp, not prorated real data.
  messages: { liveId: string; sentAt: string; visibility: 'PUBLIC' | 'HIDDEN' | 'HELD'; count: number }[];
  reviews: { liveId: string; createdAt: string; status: keyof PeriodLive['kickReviews'] }[];
}
const KST = 9 * 3600_000, DAY = 86400_000;
export const kstDay = (t: number) => new Date(t + KST).toISOString().slice(0, 10);
export const kstStart = (day: string) => Date.parse(`${day}T00:00:00Z`) - KST;
export const addDays = (day: string, n: number) => kstDay(kstStart(day) + n * DAY);
export const daysBetween = (from: string, to: string) => Math.round((kstStart(to) - kstStart(from)) / DAY) + 1;

export function aggregatePeriodStats(fromDay: string, toDay: string, fixture: PeriodFixture): PeriodStats {
  const from = kstStart(fromDay), to = kstStart(toDay) + DAY;
  const lives = fixture.lives.filter(l => Date.parse(l.startedAt) < to && (l.endedAt === null || Date.parse(l.endedAt) > from))
    .map<PeriodLive>(l => ({ ...l, scanned: 0, hidden: 0, held: 0, kickReviews: { pending: 0, approved: 0, rejected: 0, invalidated: 0 } }))
    .sort((a,b) => b.startedAt.localeCompare(a.startedAt));
  const byLive = new Map(lives.map(l => [l.liveId, l]));
  const daily: PeriodDay[] = [];
  for (let day=fromDay; day<=toDay; day=addDays(day,1)) daily.push({ date: day, scanned: 0, hidden: 0, held: 0 });
  const byDay = new Map(daily.map(d => [d.date,d]));
  for (const m of fixture.messages) {
    const at=Date.parse(m.sentAt), live=byLive.get(m.liveId), day=byDay.get(kstDay(at));
    if (!live || !day || at<from || at>=to) continue;
    live.scanned+=m.count;day.scanned+=m.count;
    if (m.visibility==='HIDDEN') { live.hidden+=m.count;day.hidden+=m.count; }
    if (m.visibility==='HELD') { live.held+=m.count;day.held+=m.count; }
  }
  for (const r of fixture.reviews) {
    const at=Date.parse(r.createdAt), live=byLive.get(r.liveId);
    if (live && at>=from && at<to) live.kickReviews[r.status]++;
  }
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), lives, daily };
}
