// 시청자 관리 탭(#5)의 공통 모델. 실제 API 콘솔(LiveConsole)과 Mock 운영 콘솔이 각자 데이터를 이 모양으로 바꿔 쓴다.
// 범위는 현재 방송(liveId) 하나다. 이전 방송 이력·시청자 전체 목록·수동 제재는 API 명세에 없어 다루지 않는다.
import { categoryLabels, type Category } from './contracts';

export interface ViewerFinding { findingId: string; category: string; status: string }
export interface ViewerCase {
  caseId: string; name: string; createdAt: string; text: string | null;
  // PENDING · CONFIRMED_VIOLATION · CONFIRMED_NORMAL · CANCELLED (ERD confirmation_status)
  confirmationStatus: string; findings: ViewerFinding[]; violationCount: number | null; version: number;
}
export interface ViewerReview { reviewId: string; kind: 'KICK' | 'CONTEXT'; status: 'PENDING' | 'DECIDED'; createdAt: string; summary: string; caseIds: string[] }
export interface ViewerRow { name: string; cases: ViewerCase[]; reviews: ViewerReview[] }

export type ViewerStatus = 'KICK_PENDING' | 'CONTEXT_PENDING' | 'KICK_DECIDED' | 'CONFIRMED' | 'INVESTIGATING' | 'CLEARED';
// 우선순위 순서. 사람의 결정이 필요한 상태가 위로 온다.
export const statusOrder: ViewerStatus[] = ['KICK_PENDING', 'CONTEXT_PENDING', 'KICK_DECIDED', 'CONFIRMED', 'INVESTIGATING', 'CLEARED'];
export const viewerStatusLabels: Record<ViewerStatus, string> = {
  KICK_PENDING: '강퇴 검토 대기', CONTEXT_PENDING: '문맥 검토 대기', KICK_DECIDED: '강퇴 결정됨',
  CONFIRMED: '위반 확정', INVESTIGATING: '조사 중', CLEARED: '취소·정상'
};
export const caseStatusLabels: Record<string, string> = {
  PENDING: '확인 중', CONFIRMED_VIOLATION: '위반 확정', CONFIRMED_NORMAL: '정상 확정', CANCELLED: '취소됨'
};

const activeFindings = (c: ViewerCase) => c.findings.filter(f => f.status === 'CONFIRMED');
export const isConfirmed = (c: ViewerCase) => c.confirmationStatus === 'CONFIRMED_VIOLATION' && activeFindings(c).length > 0;

export function statusOf(row: ViewerRow): ViewerStatus {
  const has = (kind: ViewerReview['kind'], status: ViewerReview['status']) => row.reviews.some(r => r.kind === kind && r.status === status);
  if (has('KICK', 'PENDING')) return 'KICK_PENDING';
  if (has('CONTEXT', 'PENDING')) return 'CONTEXT_PENDING';
  if (has('KICK', 'DECIDED')) return 'KICK_DECIDED';
  if (row.cases.some(isConfirmed)) return 'CONFIRMED';
  if (row.cases.some(c => c.confirmationStatus === 'PENDING')) return 'INVESTIGATING';
  return 'CLEARED';
}
export const confirmedCount = (row: ViewerRow) => row.cases.filter(isConfirmed).length;
export const categoriesOf = (row: ViewerRow) => [...new Set(row.cases.flatMap(activeFindings).map(f => f.category))];
export const categoryName = (c: string) => categoryLabels[c as Category] ?? c;
export const lastAt = (row: ViewerRow) => row.cases.reduce((max, c) => (c.createdAt > max ? c.createdAt : max), '');
// 사건 응답의 violationCount는 같은 방송에서 이 시청자의 다른 확정 위반 사건 수다(현재 사건 제외, 조회 시점). 가장 최근 사건의 값을 보여 준다.
export const latestViolationCount = (row: ViewerRow) => [...row.cases].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.violationCount ?? null;

// 사건을 시청자 이름으로 묶고, 검토는 기준·대상 사건이 속한 시청자에게 붙인다.
export function groupByViewer(cases: ViewerCase[], reviews: ViewerReview[]): ViewerRow[] {
  const rows = new Map<string, ViewerRow>();
  for (const c of cases) {
    const row = rows.get(c.name) ?? { name: c.name, cases: [], reviews: [] };
    row.cases.push(c); rows.set(c.name, row);
  }
  for (const r of reviews) {
    const owner = [...rows.values()].find(row => row.cases.some(c => r.caseIds.includes(c.caseId)));
    if (owner) owner.reviews.push(r);
  }
  return [...rows.values()]
    .map(row => ({ ...row, cases: row.cases.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }))
    .sort((a, b) => statusOrder.indexOf(statusOf(a)) - statusOrder.indexOf(statusOf(b)) || lastAt(b).localeCompare(lastAt(a)));
}
