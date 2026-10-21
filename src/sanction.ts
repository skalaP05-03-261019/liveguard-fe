import type { Category } from './contracts';

// 악성 채팅 조치 기준표. 열은 최근 24시간 이전 확정 위반 수(0건, 1건, 2건 이상)다.
// TIMEOUT 600초는 Backend 업무 규칙으로 자동 적용하고, 86400초(24시간)는 interrupt 후 운영자 승인을 거쳐 kick_user로 실행한다.
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
export const needsApproval = (x: Sanction) => x.timeoutSec >= 86400;
export const timeoutText = (sec: number) => sec >= 86400 ? '24시간' : `${sec / 60}분`;
export const sanctionLabel = (x: Sanction) => x.timeoutSec ? `${hideLabels[x.hide]} + TIMEOUT ${x.timeoutSec}초` : hideLabels[x.hide];
// 서버가 KICKED의 until만 주는 경우 남은 시간이 짧으면 채팅 일시 제한(TIMEOUT 600초)으로 본다.
export const SHORT_TIMEOUT_MS = 15 * 60_000;
