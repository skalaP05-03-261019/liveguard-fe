// Display states only. INVALIDATED is an existing BE extension, not a new API enum.
export type ReportStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'INVALIDATED' | 'UNAVAILABLE';
export const reportStatusLabels: Record<ReportStatus, string> = {
  PENDING: '대기 중', APPROVED: '승인', REJECTED: '기각',
  INVALIDATED: '무효 · 계약 확인 필요', UNAVAILABLE: '결정 정보 미확인'
};
export function reportStatus(status: string, decision?: { value: string }): ReportStatus {
  if (status === 'INVALIDATED') return 'INVALIDATED';
  if (status === 'PENDING' && (!decision || decision.value === 'DEFER')) return 'PENDING';
  if (status === 'DECIDED' && decision?.value === 'APPROVE') return 'APPROVED';
  if (status === 'DECIDED' && decision?.value === 'REJECT') return 'REJECTED';
  return 'UNAVAILABLE';
}
export function basisCaseCount(ids: readonly string[]): number { return new Set(ids).size; }
