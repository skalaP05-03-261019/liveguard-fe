// LIVE:GUARD 브라우저 API v1.0(liveId) 스키마. 기준: Backend contracts/openapi.yaml
// 목업과 실제 API 화면은 이 타입 하나만 쓴다.
export type UUID = string;
export type Role = 'VIEWER' | 'MODERATOR' | 'PLATFORM_ADMIN';
export type Visibility = 'PUBLIC' | 'HELD' | 'HIDDEN';
export type Category = 'PROFANITY' | 'HARASSMENT' | 'FLOOD' | 'PHISHING' | 'PII_EXPOSURE';
export type Verdict = 'VIOLATION' | 'NO_VIOLATION' | 'NEEDS_REVIEW';
export type HandlingRoute = 'PASS' | 'RULE_CONFIRMED' | 'CONTEXT_REVIEW' | 'PII_INVESTIGATION' | 'FLOOD_REVIEW';
export type ConfirmationStatus = 'PENDING' | 'CONFIRMED_VIOLATION' | 'CONFIRMED_NORMAL' | 'CANCELLED';
export type ReviewKind = 'CONTEXT' | 'KICK';
// 명세는 PENDING·DECIDED. BE는 재검증 탈락·근거 취소로 무효가 된 검토에 INVALIDATED를 쓴다(TBD-06).
export type ReviewStatus = 'PENDING' | 'DECIDED' | 'INVALIDATED';
export type ContextDecision = 'CONFIRM_NORMAL' | 'CONFIRM_VIOLATION' | 'DEFER';
export type KickDecision = 'APPROVE' | 'REJECT';
// KICKED는 방송 종료까지(until 없음), TIMED_OUT은 until = 제한 만료 시각
export type ErrorCode = 'VALIDATION_FAILED' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'KICKED' | 'TIMED_OUT' | 'NOT_FOUND' | 'CASE_NOT_READY' | 'STALE_VERSION' | 'IDEMPOTENCY_CONFLICT' | 'LIVE_ENDED' | 'LIVE_ALREADY_ACTIVE' | 'REVIEW_NOT_APPROVED' | 'NOT_IMPLEMENTED' | 'TEMPORARY_UNAVAILABLE' | 'INTERNAL_ERROR';
export type ModerationReasonCode = 'PROFANITY_INCLUDED' | 'LINK_NOT_ALLOWED' | 'FLOOD_REPEATED' | 'CONTEXT_PENDING' | 'PII_PENDING';
export interface Envelope<T> { data: T; traceId: string }
export interface Me { userId: UUID; nickname: string; role: Role; channelIds: UUID[] }
// moderationReasonCode·moderationNotice·timeoutUntil·reviewStatus는 작성자 본인에게 보내는 응답에만 채워진다.
export interface Message {
  messageId: UUID; channelId: UUID; authorAlias: string; text: string; visibility: Visibility; version: number; sentAt: string; isMine: boolean;
  liveId?: UUID | null; moderationReasonCode?: ModerationReasonCode | null; moderationNotice?: string | null; timeoutUntil?: string | null; reviewStatus?: 'PENDING' | null;
}
// timeoutUntil: 요청자 본인의 활성 채팅 제한 종료 시각
export interface MessagePage { items: Message[]; nextCursor: string | null; timeoutUntil?: string | null }
export interface Live { liveId: UUID; channelId: UUID; startedAt: string; endedAt: string | null }
export interface ChannelWithLive { channelId: UUID; name: string; live: Live | null }
// 사건·검토의 문맥 메시지. 작성자는 U1, 주변 사람은 U2…로 가리고 개인정보는 [PHONE]·[EMAIL] 등으로 바꾼다.
export interface MaskedContextMessage { messageId: UUID; authorAlias: string; text: string; visibility: string; sentAt: string; version?: number }
// Agent가 작성한 메시지별 판단. 실제 AI 근거는 여기에만 있다.
export interface Finding { messageId: UUID; verdict: Verdict; categories: Category[]; policyIds: string[]; reason: string; missingFacts: string[] }
export interface ConfirmedFinding { findingId: UUID; category: Category; status: 'CONFIRMED' | 'REVOKED'; confirmedAt: string | number | null; revokedAt: string | number | null }
// summary는 BE 고정 문구다(Agent 작성 아님).
export interface LiveReview { reviewId: UUID; kind: ReviewKind; liveId: UUID; caseId: UUID; status: ReviewStatus; version: number; createdAt: string | number; aiVerdict: Verdict; messages: MaskedContextMessage[]; targetMessageIds: UUID[]; findings: Finding[]; basisCaseIds: UUID[]; summary: string }
export interface LiveCase {
  caseId: UUID; liveId: UUID; version: number; confirmationStatus: ConfirmationStatus; handlingRoute?: HandlingRoute;
  messages: MaskedContextMessage[]; targetMessageIds: UUID[]; confirmedFindings: ConfirmedFinding[]; findings?: Finding[];
  createdAt?: string | number; violationCount?: number; status?: string;
}
export interface Decision { decisionId: UUID; reviewId: UUID; kind: ReviewKind; value: string; operatorId: UUID; decidedAt: string }
export interface ApiErrorBody { error: { code: ErrorCode; message: string; retryable: boolean; until?: string; currentVersion?: number }; traceId: string }
export class ApiError extends Error { constructor(public readonly code: ErrorCode, message: string, public readonly retryable = false, public readonly until?: string, public readonly currentVersion?: number) { super(message); this.name = 'ApiError'; } }

export const categoryLabels: Record<Category, string> = { PROFANITY: '욕설', HARASSMENT: '괴롭힘', FLOOD: '도배', PHISHING: '피싱', PII_EXPOSURE: '개인정보 노출' };
export const visibilityLabels: Record<Visibility, string> = { PUBLIC: '공개', HELD: '임시 비노출', HIDDEN: '숨김' };
// moderationNotice가 없을 때 쓰는 작성자 안내. 탐지 단어·개인정보 원문은 넣지 않는다(openapi.yaml Message).
export const reasonLabels: Record<ModerationReasonCode, string> = {
  PROFANITY_INCLUDED: '메시지에 금지된 욕설이 포함되어 숨김 처리되었습니다.',
  // 정책(CONTRACTS) 문구. 악성·피싱으로 확인했다는 표현은 쓰지 않는다.
  LINK_NOT_ALLOWED: '이 방송에서는 링크 전송이 금지되어 있습니다.',
  FLOOD_REPEATED: '동일 문장 반복으로 숨김 처리되었습니다.',
  CONTEXT_PENDING: '문맥 확인과 운영자 결정을 기다리고 있습니다.',
  PII_PENDING: '개인정보 노출 가능성을 확인하고 있습니다.'
};
// 작성자에게 보여 줄 숨김·검토 사유. 서버가 준 사유만 쓰고 임의로 만들지 않는다.
// 규칙으로 바로 숨긴 욕설·링크는 사유 코드의 정책 문구를 쓴다. Backend가 두 경우를 한 문장("금지된 욕설 또는 링크가…")으로 보내기 때문이다.
const RULE_CODES: ModerationReasonCode[] = ['PROFANITY_INCLUDED', 'LINK_NOT_ALLOWED'];
export function authorNotice(m: Pick<Message, 'visibility' | 'moderationNotice' | 'moderationReasonCode'>): string | null {
  const code = m.moderationReasonCode;
  if (code && RULE_CODES.includes(code)) return reasonLabels[code];
  return m.moderationNotice ?? (code ? reasonLabels[code] : null) ?? (m.visibility === 'HELD' ? '운영자 검토 중인 메시지입니다.' : null);
}
export const verdictLabels: Record<Verdict, string> = { VIOLATION: '위반 의심', NO_VIOLATION: '위반 아님', NEEDS_REVIEW: '판단 보류' };
export const confirmationLabels: Record<ConfirmationStatus, string> = { PENDING: '확인 중', CONFIRMED_VIOLATION: '위반 확정', CONFIRMED_NORMAL: '정상 확정', CANCELLED: '취소됨' };
export const routeLabels: Record<HandlingRoute, string> = { PASS: '통과', RULE_CONFIRMED: '규칙 자동 확정', CONTEXT_REVIEW: 'AI 문맥 검토', PII_INVESTIGATION: 'AI 개인정보 조사', FLOOD_REVIEW: '도배 자동 확정' };
export const reviewKindLabels: Record<ReviewKind, string> = { CONTEXT: '문맥 검토', KICK: '강퇴 승인' };
export const reviewStatusLabels: Record<ReviewStatus, string> = { PENDING: '결정 대기', DECIDED: '결정됨', INVALIDATED: '무효 · 근거 취소 또는 재검증 탈락' };
// 진행 기록에 붙이는 SSE 이벤트 설명
export const eventLabels: Record<string, string> = {
  CHAT: '새 채팅', MESSAGE_VISIBILITY_CHANGED: '메시지 공개 상태 변경', MESSAGE_RESTORED: '메시지 공개 복원', LIVE_ACCESS_BLOCKED: '입장 제한 적용', LIVE_ENDED: '방송 종료',
  CASE_CREATED: '사건 생성', CASE_UPDATED: '사건 상태 변경', TOOL_START: 'AI 조사 시작', TOOL_END: 'AI 조사 완료', TASK_FAILED: 'AI 조사 실패',
  CONTEXT_REVIEW_REQUIRED: '문맥 검토 요청', KICK_REVIEW_REQUIRED: '강퇴 승인 요청', REVIEW_DECIDED: '운영자 결정 접수', ACTION_APPLIED: '조치 적용 확인', ACTION_FAILED: '조치 실패 또는 결과 미확인'
};
