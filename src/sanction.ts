import type { Category, HandlingRoute } from './contracts';

// 정책 v3.2 MP-2.1 제재 기준표(v3.1과 같다). 열은 같은 방송·같은 유형의 이전 확정 사건 수(0건, 1건, 2건 이상)다.
// 모든 TIMEOUT은 Backend가 자동 적용한다. "2건 이상" 열의 24시간 제한은 강퇴가 아니며, 강퇴는 MP-4.1 통합 집계로 따로 심사한다.
export type HideRule = 'HIDE' | 'DUP_HIDE' | 'DUP_HIDE_AFTER_THIRD';
export interface Sanction { hide: HideRule; timeoutSec: 0 | 600 | 86400 }

const s = (hide: HideRule, timeoutSec: Sanction['timeoutSec'] = 0): Sanction => ({ hide, timeoutSec });
export const sanctionTable: Record<Category, [Sanction, Sanction, Sanction]> = {
  PROFANITY: [s('HIDE'), s('HIDE', 600), s('HIDE', 86400)],
  HARASSMENT: [s('HIDE', 600), s('HIDE', 86400), s('HIDE', 86400)],
  FLOOD: [s('DUP_HIDE_AFTER_THIRD'), s('DUP_HIDE', 600), s('DUP_HIDE', 86400)],
  PHISHING: [s('HIDE', 600), s('HIDE', 600), s('HIDE', 86400)],
  PII_EXPOSURE: [s('HIDE'), s('HIDE', 600), s('HIDE', 86400)]
};
export const priorColumns = ['이전 확정 0건', '이전 확정 1건', '이전 확정 2건 이상'] as const;
// 화면 표기: 메시지를 가리는 조치는 '숨김'. '차단'은 채팅 입력 권한을 막는다는 뜻으로만 쓴다.
export const hideLabels: Record<HideRule, string> = { HIDE: '숨김', DUP_HIDE: '중복 메시지 숨김', DUP_HIDE_AFTER_THIRD: '세 번째 이후 중복 메시지 숨김' };

export const priorColumn = (prior: number) => Math.min(Math.max(prior, 0), 2);
export const sanctionFor = (category: Category, prior: number) => sanctionTable[category][priorColumn(prior)];
export const timeoutText = (sec: number) => sec >= 86400 ? '24시간' : `${sec / 60}분`;
export const sanctionLabel = (x: Sanction) => x.timeoutSec ? `${hideLabels[x.hide]} + ${timeoutText(x.timeoutSec)} 채팅 제한` : hideLabels[x.hide];

// 정책 v3.2 MP-4.1 강퇴 심사: 유형과 관계없이 최근 24시간의 서로 다른 확정 사건 3건. 효력은 이번 방송 종료까지(MP-4.3).
export const KICK_THRESHOLD = 3;
export const KICK_WINDOW_MS = 86_400_000;

// 채팅이 거치는 처리 경로. Backend 필터(src/main/resources/filter/, rules-v2)와 정책 v3.2 기준이다.
export const routeRows: { route: HandlingRoute; trigger: string; decider: string; result: string }[] = [
  { route: 'RULE_CONFIRMED', trigger: '확정 욕설 사전 일치, 링크 포함', decider: 'Backend 규칙', result: '바로 숨김·위반 확정, 기준표의 채팅 제한 자동 적용' },
  { route: 'FLOOD_REVIEW', trigger: '10초 안에 같은 문장 3회 이상', decider: 'Backend 규칙', result: '세 번째부터 숨김·위반 확정' },
  { route: 'CONTEXT_REVIEW', trigger: '공격 표현(집단을 향한 표현 포함), 공식 사칭 + 로그인 요구', decider: 'AI 제안 → 운영자 결정', result: '결정 전까지 임시 비노출(HELD)' },
  { route: 'PII_INVESTIGATION', trigger: '전화번호·계좌번호(하이픈 묶음 10자리 이상)·이메일 형식. 숫자 나열만으로는 아님', decider: 'AI 조사 → 위반 아님이면 백엔드가 해제, 판단 보류면 운영자 결정', result: '처리 전까지 임시 비노출(HELD)' }
];
