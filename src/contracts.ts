// LIVE:GUARD OpenAPI 0.5.0-lite 브라우저에 공개된 스키마만 정의한다.
export type UUID = string;
export type Role = 'VIEWER' | 'MODERATOR' | 'PLATFORM_ADMIN';
export type Visibility = 'PUBLIC' | 'HELD' | 'HIDDEN';
export type FilterResult = 'PASS' | 'REVIEW' | 'HOLD' | 'FLOOD';
export type CaseStatus = 'ANALYZING' | 'NO_ACTION' | 'HIDDEN' | 'NEEDS_REVIEW' | 'KICK_REVIEW_PENDING' | 'CLOSED' | 'FAILED';
export type Verdict = 'VIOLATION' | 'NO_VIOLATION' | 'NEEDS_REVIEW';
// PII_EXPOSURE는 조치 기준표에 맞춰 추가했다. OpenAPI 0.5.0-lite에는 아직 없다.
export type Category = 'PROFANITY' | 'HARASSMENT' | 'FLOOD' | 'PHISHING' | 'PII_EXPOSURE';
export type KickReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED';
// KICKED는 방송 종료까지(until 없음), TIMED_OUT은 until = 제한 만료 시각 (openapi.yaml ErrorCode)
export type ErrorCode = 'VALIDATION_FAILED' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'KICKED' | 'TIMED_OUT' | 'LIVE_ENDED' | 'NOT_FOUND' | 'STALE_VERSION' | 'IDEMPOTENCY_CONFLICT' | 'REVIEW_NOT_APPROVED' | 'TEMPORARY_UNAVAILABLE';
export type ModerationReasonCode = 'PROFANITY_INCLUDED' | 'LINK_NOT_ALLOWED' | 'FLOOD_REPEATED' | 'CONTEXT_PENDING' | 'PII_PENDING';
export interface Envelope<T> { data: T; traceId: string }
export interface Me { userId: UUID; nickname: string; role: Role; channelIds: UUID[] }
// moderationReasonCode·moderationNotice·timeoutUntil·reviewStatus는 작성자 본인에게 보내는 응답에만 채워진다.
export interface Message {
  messageId: UUID; channelId: UUID; authorAlias: string; text: string; visibility: Visibility; version: number; sentAt: string; isMine: boolean;
  liveId?: UUID | null; moderationReasonCode?: ModerationReasonCode | null; moderationNotice?: string | null; timeoutUntil?: string | null; reviewStatus?: 'PENDING' | null;
}
export interface MessagePage { items: Message[]; nextCursor: string | null; timeoutUntil?: string | null }
export interface PolicySnapshot { policyId: string; version: string; title: string; text: string; resourceUri: string }
export interface CaseSummary { caseId: UUID; channelId: UUID; userAlias: string; filterResult: FilterResult; status: CaseStatus; verdict?: Verdict | null; category?: Category | null; version: number; createdAt: string }
export interface KickReview { reviewId: UUID; channelId: UUID; userAlias: string; status: KickReviewStatus; summary: string; caseIds: UUID[]; decisionReason?: string | null; kickExpiresAt?: string | null; version: number; createdAt: string }
export interface CaseDetail extends CaseSummary { messages: Message[]; reason: string | null; evidenceMessageIds: UUID[]; policySnapshots: PolicySnapshot[]; violationCount: number; kickReview?: KickReview | null; traceUrl?: string | null }
export interface ChatEvent { messageId: UUID; authorAlias: string; text: string; visibility: Visibility; version: number; sentAt: string }
export interface VisibilityChangedEvent { messageId: UUID; visibility: Visibility; version: number; text?: string; authorAlias?: string }
export interface UserKickedEvent { until?: string }
export interface CaseEvent { caseId: UUID; status: CaseStatus; filterResult?: FilterResult; version: number }
export interface ToolEvent { caseId: UUID; tool: string; callId: string; status?: string; elapsedMs?: number }
export interface KickReviewEvent { reviewId: UUID; caseId: UUID; status: KickReviewStatus; kickExpiresAt?: string }
export interface TaskFailedEvent { caseId: UUID; stage: string; errorCode: string; traceUrl?: string }
export interface AuditEntry { id: string; time: string; type: string; content: string; state: string }
export interface ApiErrorBody { error: { code: ErrorCode; message: string; retryable: boolean; until?: string; currentVersion?: number }; traceId: string }
export class ApiError extends Error { constructor(public readonly code: ErrorCode, message: string, public readonly retryable = false, public readonly until?: string, public readonly currentVersion?: number) { super(message); this.name = 'ApiError'; } }
export const categoryLabels: Record<Category, string> = { PROFANITY: '욕설', HARASSMENT: '괴롭힘', FLOOD: '도배', PHISHING: '피싱', PII_EXPOSURE: '개인정보 노출' };
export const statusLabels: Record<CaseStatus, string> = { ANALYZING: '분석 중', NO_ACTION: '조치 없음', HIDDEN: '메시지 숨김', NEEDS_REVIEW: '추가 검토', KICK_REVIEW_PENDING: '강퇴 검토 대기', CLOSED: '종료', FAILED: '처리 실패' };
export const visibilityLabels: Record<Visibility, string> = { PUBLIC: '공개', HELD: '임시 비노출', HIDDEN: '숨김' };
// moderationNotice가 없을 때 쓰는 작성자 안내. 탐지 단어·개인정보 원문은 넣지 않는다(openapi.yaml Message).
export const reasonLabels: Record<ModerationReasonCode, string> = {
  PROFANITY_INCLUDED: '메시지에 금지된 욕설이 포함되어 숨김 처리되었습니다.',
  LINK_NOT_ALLOWED: '허용되지 않은 링크가 포함되어 숨김 처리되었습니다.',
  FLOOD_REPEATED: '동일 문장 반복으로 숨김 처리되었습니다.',
  CONTEXT_PENDING: '문맥 확인과 운영자 결정을 기다리고 있습니다.',
  PII_PENDING: '개인정보 노출 가능성을 확인하고 있습니다.'
};
export const reviewLabels: Record<KickReviewStatus, string> = { PENDING: '승인 대기', APPROVED: '승인 접수', REJECTED: '기각', EXECUTED: '강퇴 실행', FAILED: '실행 실패' };
