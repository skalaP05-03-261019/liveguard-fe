// 목업 방송의 관제 흐름. Backend 처리 경로(LiveService·MessageFilter·LiveModerationService)와 정책 v3.1을 따라
// 사건·검토를 API v1.0 모양(LiveCase·LiveReview)으로 만든다. 실제 Agent 대신 고정 규칙으로 AI 제안을 붙인다.
import { reactive } from 'vue';
import type { Category, ConfirmedFinding, ContextDecision, Finding, HandlingRoute, KickDecision, Live, LiveCase, LiveReview, MaskedContextMessage, Message, ModerationReasonCode } from './contracts';
import { categoryLabels } from './contracts';
import { CHANNEL_ID, LIVE_ID, filterDictionary, type FixtureLine, type MockUser } from './mock';
import { KICK_THRESHOLD, KICK_WINDOW_MS, sanctionFor, timeoutText } from './sanction';

export interface MockMessage extends Message { ownerId: string }
export interface MockCase extends LiveCase { userId: string; createdAt: string; timeoutUntil: string | null }
export interface StudioLog { id: string; time: string; event: string; detail: string }
export interface MockDecision { kind: LiveReview['kind']; value: string; reason: string; decidedAt: string }
export type KickOutcome = 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
export type SendResult = { ok: true; message: MockMessage; caseItem: MockCase | null } | { ok: false; code: 'KICKED' | 'TIMED_OUT'; until?: string };

// BE가 검토 카드에 넣는 고정 요약 문구(LiveModerationService.reviewCard)
export const KICK_SUMMARY = '서로 다른 확정 사건 3건 — 방송 종료까지 차단 승인 요청';
export const CONTEXT_SUMMARY = 'AI 제안을 확인하고 최종 결정해 주세요';
export const KICK_WAITING = '결정 접수 · 실행 결과 대기';

const iso = (t: number) => new Date(t).toISOString();
const uid = () => crypto.randomUUID();
const FLOOD_WINDOW_MS = 10_000;

// Backend TextNormalizer(norm-v1): NFKC, 소문자, 공백 하나로, 같은 글자 3번 이상은 2번으로
export function normalize(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\p{Z}]+/gu, ' ').trim().replace(/(.)\1{2,}/gsu, '$1$1');
}
const EMAIL = /[\p{L}\p{N}._%+-]+@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[A-Za-z]{2,63}/gu;
const WITH_SCHEME = /\bhttps?:\/\/[^\s/?#]+/gi;
const BARE_DOMAIN = /(?<![\p{L}\p{N}@.-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[A-Za-z]{2,63}(?![\p{L}\p{N}-])/u;
const PII = /01[016789][- .]?[0-9]{3,4}[- .]?[0-9]{4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
// Backend UrlHosts: 스킴 있는 주소 → 이메일 제거 → 스킴 없는 도메인
export function hasLink(text: string) {
  const t = text.normalize('NFKC');
  if (WITH_SCHEME.test(t)) { WITH_SCHEME.lastIndex = 0; return true; }
  return BARE_DOMAIN.test(t.replace(EMAIL, ' '));
}
interface Classified { route: HandlingRoute; tags: string[]; ruleCategories: Category[] }
// Backend MessageFilter.classify + LiveService 후처리(링크 우선, 개인정보 조사)
export function classify(text: string, sameTextCount: number): Classified {
  const n = normalize(text), d = filterDictionary;
  const has = (list: string[], value = n) => list.some(w => value.includes(normalize(w)));
  const withoutExceptions = d.profanityExceptions.reduce((t, e) => t.split(normalize(e)).join(' '), n);
  const profanity = has(d.certainProfanity, withoutExceptions), attack = has(d.attack), official = has(d.officialClaim), credential = has(d.credential);
  const link = hasLink(text), repeated = sameTextCount >= 3;
  const tags = [attack && 'ATTACK_TERM', profanity && 'CERTAIN_PROFANITY', official && 'OFFICIAL_CLAIM', credential && 'CREDENTIAL_REQUEST', link && 'LINK', repeated && 'REPEATED_TEXT'].filter((x): x is string => !!x);
  const ruleCategories: Category[] = [...(profanity ? ['PROFANITY' as const] : []), ...(link ? ['PHISHING' as const] : [])];
  if (profanity || link) return { route: 'RULE_CONFIRMED', tags, ruleCategories };
  if (repeated) return { route: 'FLOOD_REVIEW', tags, ruleCategories };
  if (PII.test(text)) return { route: 'PII_INVESTIGATION', tags: [...tags, text.includes('@') ? 'PII_EMAIL' : 'PII_PHONE'], ruleCategories };
  if (attack || (official && credential)) return { route: 'CONTEXT_REVIEW', tags, ruleCategories };
  return { route: 'PASS', tags, ruleCategories };
}
// 이미 가린 [URL:host] 안의 도메인은 다시 가리지 않는다.
const MASK_DOMAIN = /(?<![\p{L}\p{N}@.\-:[])((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[A-Za-z]{2,63})(?![\p{L}\p{N}-])[^\s\]]*/gu;
// Backend PiiMasker 일부: 문맥 메시지에서 이메일·전화번호·주소를 가린다.
export function maskText(text: string) {
  return text.replace(EMAIL, '[EMAIL]').replace(/01[016789][- .]?[0-9]{3,4}[- .]?[0-9]{4}/g, '[PHONE]').replace(/\bhttps?:\/\/([^\s/?#]+)\S*/gi, '[URL:$1]')
    .replace(MASK_DOMAIN, (_, host: string) => `[URL:${host.toLowerCase()}]`);
}
// 목업 Agent. 실제 모델을 부르지 않고 경로와 표현으로 정한 제안을 붙인다. 계약상 VIOLATION은 정책 ID, NEEDS_REVIEW는 확인 필요 사실이 있어야 한다.
function mockAgent(messageId: string, route: HandlingRoute, tags: string[], text: string): Finding {
  if (route === 'PII_INVESTIGATION') return { messageId, verdict: 'NEEDS_REVIEW', categories: ['PII_EXPOSURE'], policyIds: ['SP-3.1'], reason: '(목업 Agent) 연락처 형식이 있지만 실제 개인정보인지 확인할 근거가 없습니다.', missingFacts: ['본인 또는 타인의 실제 연락처인지'] };
  if (tags.includes('OFFICIAL_CLAIM') && tags.includes('CREDENTIAL_REQUEST')) return { messageId, verdict: 'VIOLATION', categories: ['PHISHING'], policyIds: ['CP-5.2'], reason: '(목업 Agent) 공식 운영자를 자칭하며 계정 정보를 요구합니다.', missingFacts: [] };
  if (/컨트롤|한타|플레이|실력|노래|대박|ㅋㅋ/.test(text)) return { messageId, verdict: 'NO_VIOLATION', categories: [], policyIds: ['CP-2.2'], reason: '(목업 Agent) 감탄 표현으로 쓰였고 특정 대상을 공격하지 않습니다.', missingFacts: [] };
  return { messageId, verdict: 'VIOLATION', categories: ['HARASSMENT'], policyIds: ['CP-3.2'], reason: '(목업 Agent) 특정 대상에게 떠나라고 요구하거나 위협하는 공격 표현입니다.', missingFacts: [] };
}
// Backend LiveService.decorate의 작성자 안내. 규칙 확정은 프론트 사유 라벨을 쓴다(정책 문구와 다른 BE 문장은 따르지 않음).
function authorNotice(route: HandlingRoute, hidden: boolean): { code: ModerationReasonCode | null; notice: string | null } {
  if (route === 'FLOOD_REVIEW') return { code: 'FLOOD_REPEATED', notice: '동일 문장 반복으로 숨김 처리되었습니다.' };
  if (route === 'PII_INVESTIGATION' && !hidden) return { code: 'PII_PENDING', notice: '개인정보 노출 가능성을 확인하고 있습니다.' };
  if (route === 'CONTEXT_REVIEW' || route === 'PII_INVESTIGATION') return { code: route === 'PII_INVESTIGATION' ? 'PII_PENDING' : 'CONTEXT_PENDING', notice: hidden ? '운영자 검토로 위반이 확정되어 숨김 처리되었습니다.' : '문맥 확인과 운영자 결정을 기다립니다.' };
  return { code: null, notice: null };
}

export function createMockLive(users: MockUser[]) {
  const state = reactive({
    live: { liveId: LIVE_ID, channelId: CHANNEL_ID, startedAt: iso(Date.now() - 3_600_000), endedAt: null } as Live,
    messages: [] as MockMessage[], cases: [] as MockCase[], reviews: [] as LiveReview[],
    decisions: {} as Record<string, MockDecision>, timeouts: {} as Record<string, string>, kicks: {} as Record<string, string>,
    kickProgress: {} as Record<string, string>, logs: [] as StudioLog[],
    floodMarks: [] as { userId: string; text: string; caseId: string; lastSentAt: number }[]
  });
  const aliasOf = (userId: string) => users.find(u => u.id === userId)?.alias ?? '시청자';
  const ownerOfCase = (caseId: string) => state.cases.find(c => c.caseId === caseId)?.userId;
  function log(event: string, detail: string, at = Date.now()) {
    state.logs.unshift({ id: uid(), time: iso(at), event, detail }); state.logs.splice(80);
  }
  const activeFindings = (c: LiveCase) => c.confirmedFindings.filter(f => f.status === 'CONFIRMED');
  const isConfirmed = (c: LiveCase) => c.confirmationStatus === 'CONFIRMED_VIOLATION' && activeFindings(c).length > 0;
  const confirmedAt = (c: LiveCase) => Math.max(...activeFindings(c).map(f => Date.parse(String(f.confirmedAt))));
  const targets = (c: LiveCase) => state.messages.filter(m => c.targetMessageIds.includes(m.messageId));
  function setVisibility(m: MockMessage, visibility: Message['visibility'], route: HandlingRoute) {
    if (m.visibility === visibility) return;
    m.visibility = visibility; m.version++;
    const { code, notice } = visibility === 'PUBLIC' ? { code: null, notice: null } : authorNotice(route, visibility === 'HIDDEN');
    m.moderationReasonCode = visibility === 'PUBLIC' ? null : (code ?? m.moderationReasonCode); m.moderationNotice = notice;
    m.reviewStatus = visibility === 'HELD' ? 'PENDING' : null;
    if (visibility === 'PUBLIC') m.timeoutUntil = null;
  }
  // Backend platform.snapshot: 방송의 최근 20개 메시지, 작성자 U1·주변 사람 U2…, 개인정보 마스킹
  function snapshot(userId: string): MaskedContextMessage[] {
    const aliases = new Map<string, string>([[userId, 'U1']]);
    return state.messages.slice(-20).map(m => {
      if (!aliases.has(m.ownerId)) aliases.set(m.ownerId, `U${aliases.size + 1}`);
      return { messageId: m.messageId, authorAlias: aliases.get(m.ownerId)!, text: maskText(m.text), visibility: m.visibility, sentAt: m.sentAt, version: m.version };
    });
  }
  function recentConfirmed(userId: string, at: number) {
    return state.cases.filter(c => c.userId === userId && isConfirmed(c) && confirmedAt(c) > at - KICK_WINDOW_MS).length;
  }
  // 정책 v3.1 MP-2.1: 같은 방송·같은 유형의 이전 확정 사건 수로 기간을 정하고, 여러 유형이면 가장 긴 하나만 적용한다.
  function confirm(c: MockCase, categories: Category[], at: number, byOperator: boolean) {
    let timeoutSec = 0;
    for (const category of categories) {
      const prior = state.cases.filter(x => x.caseId !== c.caseId && x.userId === c.userId && x.confirmedFindings.some(f => f.category === category && f.status === 'CONFIRMED')).length;
      timeoutSec = Math.max(timeoutSec, sanctionFor(category, prior).timeoutSec);
      c.confirmedFindings.push({ findingId: uid(), category, status: 'CONFIRMED', confirmedAt: iso(at), revokedAt: null } satisfies ConfirmedFinding);
    }
    c.confirmationStatus = 'CONFIRMED_VIOLATION'; c.status = 'HIDDEN'; c.version++;
    const route = c.handlingRoute ?? 'RULE_CONFIRMED';
    for (const m of targets(c)) setVisibility(m, 'HIDDEN', byOperator ? 'CONTEXT_REVIEW' : route);
    if (timeoutSec) {
      const until = at + timeoutSec * 1000;
      c.timeoutUntil = iso(until);
      if (!state.timeouts[c.userId] || Date.parse(state.timeouts[c.userId]) < until) state.timeouts[c.userId] = iso(until);
      for (const m of targets(c)) m.timeoutUntil = c.timeoutUntil;
    }
    c.violationCount = recentConfirmed(c.userId, at);
    log('CASE_UPDATED', `${aliasOf(c.userId)} · ${categories.map(x => categoryLabels[x]).join('·')} 위반 확정${timeoutSec ? ` · 채팅 ${timeoutText(timeoutSec)} 제한` : ''}`, at);
    ensureKick(c, at);
  }
  // 정책 v3.1 MP-4.1: 최근 24시간의 서로 다른 확정 사건 3건. 대기·결정된 강퇴 검토에 쓰인 사건은 다시 쓰지 않는다.
  function ensureKick(trigger: MockCase, at: number) {
    const userId = trigger.userId;
    const kicks = state.reviews.filter(r => r.kind === 'KICK' && ownerOfCase(r.caseId) === userId);
    if (kicks.some(r => r.status === 'PENDING')) return;
    const used = new Set(kicks.filter(r => r.status !== 'INVALIDATED').flatMap(r => r.basisCaseIds));
    const eligible = state.cases.filter(c => c.userId === userId && isConfirmed(c) && !used.has(c.caseId) && confirmedAt(c) > at - KICK_WINDOW_MS)
      .sort((a, b) => confirmedAt(a) - confirmedAt(b) || a.caseId.localeCompare(b.caseId));
    if (eligible.length < KICK_THRESHOLD) return;
    const reviewId = uid();
    state.reviews.push({ reviewId, kind: 'KICK', liveId: LIVE_ID, caseId: trigger.caseId, status: 'PENDING', version: 1, createdAt: iso(at), aiVerdict: 'VIOLATION', messages: trigger.messages, targetMessageIds: trigger.targetMessageIds, findings: trigger.findings ?? [], basisCaseIds: eligible.slice(0, KICK_THRESHOLD).map(c => c.caseId), summary: KICK_SUMMARY });
    trigger.status = 'KICK_REVIEW_PENDING';
    log('KICK_REVIEW_REQUIRED', `${aliasOf(userId)} · 확정 사건 ${KICK_THRESHOLD}건`, at);
  }
  function send(user: MockUser, text: string, at = Date.now()): SendResult {
    if (state.kicks[user.id]) return { ok: false, code: 'KICKED' };
    const until = state.timeouts[user.id];
    if (until && Date.parse(until) > at) return { ok: false, code: 'TIMED_OUT', until };
    const normalized = normalize(text);
    const same = state.messages.filter(m => m.ownerId === user.id && normalize(m.text) === normalized && Date.parse(m.sentAt) > at - FLOOD_WINDOW_MS).length + 1;
    let { route, tags, ruleCategories } = classify(text, same);
    const base: MockMessage = { messageId: uid(), channelId: CHANNEL_ID, liveId: LIVE_ID, authorAlias: user.alias, text, visibility: 'PUBLIC', version: 1, sentAt: iso(at), isMine: false, ownerId: user.id, moderationReasonCode: null, moderationNotice: null, reviewStatus: null, timeoutUntil: null };
    // 같은 도배가 10초 안에 이어지면 기존 도배 사건에 붙여 숨긴다(Backend flood_marks).
    const mark = route === 'RULE_CONFIRMED' ? undefined : state.floodMarks.find(f => f.userId === user.id && f.text === normalized && f.lastSentAt > at - FLOOD_WINDOW_MS);
    const owner = mark && state.cases.find(c => c.caseId === mark.caseId && isConfirmed(c));
    if (mark && owner) {
      const message = reactive({ ...base, visibility: 'HIDDEN', moderationReasonCode: 'FLOOD_REPEATED', moderationNotice: '동일 문장 반복으로 숨김 처리되었습니다.' }) as MockMessage;
      state.messages.push(message); owner.targetMessageIds.push(message.messageId); mark.lastSentAt = at;
      log('CHAT', `${user.alias} · 도배 반복 숨김`, at);
      return { ok: true, message, caseItem: owner };
    }
    if (route === 'RULE_CONFIRMED') ruleCategories = ruleCategories.length ? ruleCategories : ['PROFANITY'];
    const message = reactive({ ...base, visibility: route === 'PASS' ? 'PUBLIC' : route === 'RULE_CONFIRMED' ? 'HIDDEN' : 'HELD' }) as MockMessage;
    if (route === 'RULE_CONFIRMED') message.moderationReasonCode = tags.includes('LINK') ? 'LINK_NOT_ALLOWED' : 'PROFANITY_INCLUDED';
    else if (route !== 'PASS') { const n = authorNotice(route, false); message.moderationReasonCode = n.code; message.moderationNotice = n.notice; message.reviewStatus = message.visibility === 'HELD' ? 'PENDING' : null; }
    state.messages.push(message); if (state.messages.length > 300) state.messages.splice(0, state.messages.length - 300);
    log('CHAT', `${user.alias} · ${message.visibility}`, at);
    if (route === 'PASS') return { ok: true, message, caseItem: null };
    const c = reactive({ caseId: uid(), liveId: LIVE_ID, version: 1, confirmationStatus: 'PENDING', handlingRoute: route, messages: snapshot(user.id), targetMessageIds: [message.messageId], confirmedFindings: [], findings: [], createdAt: iso(at), violationCount: recentConfirmed(user.id, at), status: 'ANALYZING', userId: user.id, timeoutUntil: null }) as MockCase;
    state.cases.push(c);
    log('CASE_CREATED', `${user.alias} · ${route}`, at);
    if (route === 'FLOOD_REVIEW') { confirm(c, ['FLOOD'], at, false); state.floodMarks.push({ userId: user.id, text: normalized, caseId: c.caseId, lastSentAt: at }); }
    else if (route === 'RULE_CONFIRMED') confirm(c, ruleCategories, at, false);
    else {
      log('TOOL_START', `${user.alias} · ${route === 'PII_INVESTIGATION' ? '개인정보 조사' : '문맥 조사'} (목업 Agent)`, at);
      const finding = mockAgent(message.messageId, route, tags, text);
      c.findings = [finding]; c.status = 'NEEDS_REVIEW';
      log('TOOL_END', `${user.alias} · AI 제안 ${finding.verdict}`, at);
      state.reviews.push({ reviewId: uid(), kind: 'CONTEXT', liveId: LIVE_ID, caseId: c.caseId, status: 'PENDING', version: 1, createdAt: iso(at), aiVerdict: finding.verdict, messages: c.messages, targetMessageIds: c.targetMessageIds, findings: c.findings, basisCaseIds: [], summary: CONTEXT_SUMMARY });
      log('CONTEXT_REVIEW_REQUIRED', `${user.alias} · AI 제안 ${finding.verdict}`, at);
    }
    return { ok: true, message, caseItem: c };
  }
  // 문맥 검토(정상·위반·보류)와 강퇴(승인·기각). 202 접수와 같다: 강퇴는 결과 시뮬레이션 전까지 실행되지 않는다.
  function decide(reviewId: string, value: ContextDecision | KickDecision, reason: string, categories: Category[] = [], at = Date.now()): { ok: boolean; message: string } {
    const r = state.reviews.find(x => x.reviewId === reviewId);
    if (!r || r.status !== 'PENDING') return { ok: false, message: '다른 결정이 먼저 반영되어 최신 상태를 불러왔습니다. (MOCK)' };
    const c = state.cases.find(x => x.caseId === r.caseId)!;
    if (r.kind === 'CONTEXT' && value === 'CONFIRM_VIOLATION' && !categories.length) return { ok: false, message: '위반 유형을 하나 이상 선택해 주세요.' };
    state.decisions[reviewId] = { kind: r.kind, value, reason, decidedAt: iso(at) };
    r.version++;
    log('REVIEW_DECIDED', `${aliasOf(c.userId)} · ${r.kind} ${value}`, at);
    if (r.kind === 'CONTEXT') {
      if (value === 'DEFER') return { ok: true, message: '보류했습니다. 검토 대기에 남습니다. (MOCK)' };
      r.status = 'DECIDED';
      if (value === 'CONFIRM_NORMAL') {
        c.confirmationStatus = 'CONFIRMED_NORMAL'; c.status = 'NO_ACTION'; c.version++;
        for (const m of targets(c)) setVisibility(m, 'PUBLIC', c.handlingRoute ?? 'CONTEXT_REVIEW');
        log('MESSAGE_RESTORED', `${aliasOf(c.userId)} · 정상 확정으로 공개`, at);
        return { ok: true, message: '정상으로 확정해 메시지를 공개했습니다. (MOCK)' };
      }
      confirm(c, categories, at, true);
      return { ok: true, message: '위반으로 확정해 메시지를 숨겼습니다. (MOCK)' };
    }
    r.status = 'DECIDED';
    if (value === 'REJECT') { state.kickProgress[reviewId] = '강퇴 기각 · 기존 제재 유지'; return { ok: true, message: '강퇴 요청을 모의 기각했습니다. 기존 메시지 가림과 채팅 제한은 유지됩니다. (MOCK)' }; }
    // 승인 후 재검증: 기준 사건이 모두 아직 확정 상태여야 한다(MP-4.2).
    if (!r.basisCaseIds.every(id => { const b = state.cases.find(x => x.caseId === id); return b && isConfirmed(b); })) {
      r.status = 'INVALIDATED'; state.kickProgress[reviewId] = '재검증 탈락 · 강퇴하지 않음';
      return { ok: true, message: '기준 사건이 바뀌어 재검증에서 탈락했습니다. 강퇴하지 않습니다. (MOCK)' };
    }
    state.kickProgress[reviewId] = KICK_WAITING;
    return { ok: true, message: `${KICK_WAITING} (MOCK)` };
  }
  // 목업 전용: 강퇴 실행 결과. 실제 API에서는 ACTION_APPLIED·LIVE_ACCESS_BLOCKED로 확인한다.
  function finishKick(reviewId: string, outcome: KickOutcome, at = Date.now()): string | null {
    const r = state.reviews.find(x => x.reviewId === reviewId);
    if (!r || state.kickProgress[reviewId] !== KICK_WAITING) return null;
    const userId = ownerOfCase(r.caseId)!;
    if (outcome === 'SUCCEEDED') {
      state.kicks[userId] = reviewId; state.kickProgress[reviewId] = '강퇴 적용 완료';
      log('LIVE_ACCESS_BLOCKED', `${aliasOf(userId)} · 이번 방송 종료까지`, at); log('ACTION_APPLIED', 'KICK · SUCCEEDED · CONFIRMED', at);
      return '강퇴가 모의 적용됐습니다. (MOCK)';
    }
    if (outcome === 'FAILED') { state.kickProgress[reviewId] = '강퇴 실행 실패 · 기존 제재 유지'; log('ACTION_FAILED', 'KICK · FAILED · CONFIRMED', at); return '강퇴 실행 실패를 모의 적용했습니다. 기존 제재는 유지됩니다. (MOCK)'; }
    state.kickProgress[reviewId] = '실행 결과 확인 중 · 실패로 단정하지 않음'; log('ACTION_FAILED', 'KICK · RUNNING · UNKNOWN', at);
    return '강퇴 실행 결과를 확인 중입니다. 실패로 단정하지 않습니다. (MOCK)';
  }
  // 오판 취소: 근거를 무효로 하고, 남은 근거가 없으면 공개한다. 채팅 제한은 남은 사건 기준으로 줄이기만 하고, 이 사건을 쓴 강퇴는 무효로 한다.
  function revoke(caseId: string, findingId: string, reason: string, at = Date.now()): boolean {
    const c = state.cases.find(x => x.caseId === caseId), f = c?.confirmedFindings.find(x => x.findingId === findingId);
    if (!c || !f || f.status !== 'CONFIRMED' || !reason.trim()) return false;
    f.status = 'REVOKED'; f.revokedAt = iso(at); c.version++;
    if (!activeFindings(c).length) {
      c.confirmationStatus = 'CANCELLED'; c.status = 'NO_ACTION'; c.timeoutUntil = null;
      for (const m of targets(c)) setVisibility(m, 'PUBLIC', c.handlingRoute ?? 'RULE_CONFIRMED');
    }
    const remaining = Math.max(0, ...state.cases.filter(x => x.userId === c.userId && isConfirmed(x) && x.timeoutUntil).map(x => Date.parse(x.timeoutUntil!)));
    const current = state.timeouts[c.userId];
    if (current && remaining < Date.parse(current)) { if (remaining > at) state.timeouts[c.userId] = iso(remaining); else delete state.timeouts[c.userId]; }
    for (const r of state.reviews.filter(x => x.kind === 'KICK' && x.status !== 'INVALIDATED' && x.basisCaseIds.includes(caseId))) {
      r.status = 'INVALIDATED'; r.version++;
      if (state.kicks[c.userId] === r.reviewId) { delete state.kicks[c.userId]; state.kickProgress[r.reviewId] = '근거 취소 · 강퇴 해제'; }
      else if (state.kickProgress[r.reviewId]) state.kickProgress[r.reviewId] = '근거 취소 · 강퇴하지 않음';
    }
    log('CASE_UPDATED', `${aliasOf(c.userId)} · ${categoryLabels[f.category]} 오판 취소 · ${reason}`, at);
    return true;
  }
  // 초기 화면: fixture 채팅과 운영자 결정을 시간 순서대로 다시 넣는다.
  function reset(lines: FixtureLine[], now = Date.now()) {
    Object.assign(state, { messages: [], cases: [], reviews: [], decisions: {}, timeouts: {}, kicks: {}, kickProgress: {}, logs: [], floodMarks: [] });
    state.live = { liveId: LIVE_ID, channelId: CHANNEL_ID, startedAt: iso(now - 3_600_000), endedAt: null };
    type Step = { at: number; run: () => void };
    const steps: Step[] = [];
    for (const line of lines) {
      const user = users.find(u => u.alias === line.alias)!;
      const at = now - line.minutesAgo * 60_000;
      let sent: MockMessage | null = null;
      for (let n = 0; n < (line.repeat ?? 1); n++) steps.push({ at: at + n * 2000, run: () => { const r = send(user, line.text, at + n * 2000); if (r.ok) sent = r.message; } });
      const d = line.decide;
      if (d) steps.push({ at: now - d.minutesAgo * 60_000, run: () => {
        const r = state.reviews.find(x => x.kind === 'CONTEXT' && x.targetMessageIds.includes(sent?.messageId ?? ''));
        if (r) decide(r.reviewId, d.value, d.reason, d.categories, now - d.minutesAgo * 60_000);
      } });
    }
    steps.sort((a, b) => a.at - b.at).forEach(s => s.run());
    state.logs.splice(0);
    log('MOCK', '목업 방송 데이터를 불러왔습니다. 판정은 정책 v3.1 기준입니다.', now);
  }
  return { state, aliasOf, send, decide, finishKick, revoke, reset, log };
}
