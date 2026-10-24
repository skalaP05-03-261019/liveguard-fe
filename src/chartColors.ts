import type { BarSegment } from './StackedBar.vue';

// 시스템 운영자 대시보드 차트 색. dataviz 검증 스크립트(validate_palette.js, 라이트)로 고른 값이다. 초록·빨강은 색각 이상 구분이 안 돼(ΔE 4.1) 쓰지 않는다.
// ① 정상·비정상·판정 대기: 모든 검사 통과(최저 ΔE 15.3). ② 승인·결정 대기·기각: 구분 통과(최저 ΔE 24.4), 기각 회청색은 '조치 없음'이라 일부러 무채색에 가깝다.
export const JUDGMENT_COLORS = { normal: '#2a78d6', abnormal: '#e34948', pending: '#eda100' };
export const KICK_COLORS = { APPROVED: '#6250d6', PENDING: '#eda100', REJECTED: '#64748B' };

// ① 채팅 판정 조각: 정상(PUBLIC) · 비정상(HIDDEN) · 판정 대기(HELD)
export function judgmentSegments(scanned: number, hidden: number, held: number): BarSegment[] {
  return [
    { key: 'normal', label: '정상', value: Math.max(scanned - hidden - held, 0), color: JUDGMENT_COLORS.normal },
    { key: 'abnormal', label: '비정상', value: hidden, color: JUDGMENT_COLORS.abnormal },
    { key: 'pending', label: '판정 대기', value: held, color: JUDGMENT_COLORS.pending }
  ];
}
