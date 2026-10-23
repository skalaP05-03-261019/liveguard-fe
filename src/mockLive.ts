// 목업 방송의 관제 흐름. Backend 처리 경로(LiveService·MessageFilter·LiveModerationService)와 정책 v3.2를 따라
// 사건·검토를 API v1.0 모양(LiveCase·LiveReview)으로 만든다. 실제 Agent 대신 고정 규칙으로 AI 제안을 붙인다.
import { reactive } from 'vue';
import type { Category, ConfirmedFinding, ContextDecision, Finding, HandlingRoute, KickDecision, Live, LiveCase, LiveReview, MaskedContextMessage, Message, ModerationReasonCode } from './contracts';
import { categoryLabels } from './contracts';
import { CHANNEL_ID, LIVE_ID, filterDictionary, type FixtureLine, type MockUser } from './mock';
import { KICK_THRESHOLD, KICK_WINDOW_MS, sanctionFor, timeoutText } from './sanction';

export interface MockMessage extends Message { ownerId: string }
export interface MockCase extends LiveCase { userId: string; createdAt: string; timeoutUntil: string | null }
// caseId·reviewId는 사건별 처리 흐름을 만들 때 쓴다.
export interface StudioLog { id: string; time: string; event: string; detail: string; caseId?: string; reviewId?: string }
export interface MockDecision { kind: LiveReview['kind']; value: string; reason: string; decidedAt: string }
export type KickOutcome = 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
// 목업 전용 처리 기록. 실제 Backend에는 채팅별 처리 기록 API가 없고, 실제 Agent는 판단 과정을 내보내지 않는다
// (agent/app/check_investigation.py: 원문·이유·도구 내용·내부 추론을 보내지 않음). 시연에서 "이런 기록이 있다면"을 보여 주는 용도다.
export interface TraceStep { at: string; title: string; detail: string; code?: string }
export interface AgentToolCall { name: string; input: string; output: string }
export interface MockTrace { messageId: string; route: HandlingRoute; backend: TraceStep[]; agent: { tools: AgentToolCall[]; reasoning: string[]; answer: Finding } | null }
export type SendResult = { ok: true; message: MockMessage; caseItem: MockCase | null } | { ok: false; code: 'KICKED' | 'TIMED_OUT'; until?: string };

// BE가 검토 카드에 넣는 고정 요약 문구(LiveModerationService.reviewCard)
export const KICK_SUMMARY = '서로 다른 확정 사건 3건 — 방송 종료까지 차단 승인 요청';
export const CONTEXT_SUMMARY = 'AI 제안을 확인하고 최종 결정해 주세요';
// AI 판정 없이 연 문맥 검토의 고정 요약(A-25, LiveModerationService.reviewCard)
export const NO_AI_SUMMARY = 'AI 분석 결과를 받지 못했습니다. 주변 문맥을 확인하고 직접 결정해 주세요';
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
// Backend PiiMasker(rules-v2): 휴대전화(010…)·지역번호(02, 031…)·국제 형식(+82 10…), 하이픈 묶음 계좌(숫자 10자리 이상), 이메일.
// 하이픈 없이 이어진 숫자 나열은 후보가 아니다(AC-06). 스킴 있는 주소 안의 문자열은 링크로 따로 본다.
const PHONE_RE = /(?<![\d-])(?:\+82[-.\s]?|0)(?:1[016789]|2|[3-6]\d)[-.\s]?\d{3,4}[-.\s]?\d{4}(?![\d-])/g;
const NUMBER_GROUPS = /(?<![\d-])\d{2,6}(?:-\d{2,7}){2,3}(?![\d-])/g;
const LONG_NUMBER = /(?<!\d)\d{10,19}(?!\d)/g;
const isAccount = (group: string) => group.replace(/-/g, '').length >= 10;
export function piiTags(text: string): string[] {
  let rest = text.normalize('NFKC').replace(/\bhttps?:\/\/[^\s/?#]+\S*/gi, ' ');
  const email = new RegExp(EMAIL.source, 'u').test(rest); rest = rest.replace(EMAIL, ' ');
  const phone = new RegExp(PHONE_RE.source).test(rest); rest = rest.replace(PHONE_RE, ' ');
  const account = (rest.match(NUMBER_GROUPS) ?? []).some(isAccount);
  return [phone && 'PII_PHONE', account && 'PII_ACCOUNT', email && 'PII_EMAIL'].filter((x): x is string => !!x);
}
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
  const pii = piiTags(text);
  if (pii.length) return { route: 'PII_INVESTIGATION', tags: [...tags, ...pii], ruleCategories };
  if (attack || (official && credential)) return { route: 'CONTEXT_REVIEW', tags, ruleCategories };
  return { route: 'PASS', tags, ruleCategories };
}
const PUBLIC_CONTACT = /고객센터|대표번호|공식 문의처/;
// 정체성 속성으로 묶인 집단을 가리키는 말(목업 판정용). 특정 팀의 팬처럼 정체성 속성이 아닌 집단은 넣지 않는다.
const IDENTITY_GROUP = /출신|지역 사람|국적|외국인|인종|민족|종교|여자들|남자들|노인들|장애인/;
// 개인정보 후보의 종류와 가림 표시. 여러 종류면 Backend 태그 순서(전화번호 → 계좌 → 이메일)의 첫 번째.
const piiKind = (text: string): [string, string] => ({ PII_PHONE: ['전화번호', '[PHONE]'], PII_ACCOUNT: ['계좌번호', '[ACCOUNT]'], PII_EMAIL: ['이메일', '[EMAIL]'] } as Record<string, [string, string]>)[piiTags(text)[0]] ?? ['연락처', '[가림]'];
const found = (list: string[], value: string) => list.filter(w => value.includes(normalize(w)));
// 사전 검사에서 걸린 단어. 처리 기록과 목업 Agent의 판단 과정에 쓴다.
function dictHits(text: string, same: number) {
  const n = normalize(text), d = filterDictionary, out: string[] = [];
  const exceptions = found(d.profanityExceptions, n);
  const profanity = found(d.certainProfanity, exceptions.reduce((t, e) => t.split(normalize(e)).join(' '), n));
  const add = (label: string, words: string[]) => { if (words.length) out.push(`${label} '${words.join("', '")}'`); };
  add('확정 욕설', profanity); add('욕설 예외 단어(세지 않음)', exceptions); add('공격 표현', found(d.attack, n));
  add('공식 자칭', found(d.officialClaim, n)); add('계정 정보 요구', found(d.credential, n));
  if (hasLink(text)) out.push('링크 주소');
  const pii = piiTags(text);
  if (pii.includes('PII_PHONE')) out.push('전화번호 형식');
  if (pii.includes('PII_ACCOUNT')) out.push('계좌번호 형식');
  if (pii.includes('PII_EMAIL')) out.push('이메일 형식');
  if (same >= 3) out.push(`같은 문장 ${same}번 (10초 안)`);
  return out;
}
const routeText: Record<HandlingRoute, string> = {
  PASS: '사전에 걸린 단어가 없어 통과 → 공개',
  RULE_CONFIRMED: '확정 욕설·링크 → 규칙으로 바로 확정. AI 조사 없음',
  FLOOD_REVIEW: '같은 문장 반복 → 도배로 바로 확정. AI 조사 없음',
  PII_INVESTIGATION: '개인정보 형식 → 임시 비노출 후 AI Agent 조사',
  CONTEXT_REVIEW: '공격 표현·사칭 의심 → 임시 비노출 후 AI Agent 조사'
};
// policy-v3.2.md 조항 제목
const policyTitles: Record<string, string> = { 'CP-2.2': '문맥 판단의 오탐 예외', 'CP-3.1': '인신공격의 판단 범위', 'CP-3.2': '괴롭힘 (HARASSMENT)', 'CP-3.3': '집단 대상 비하·배제 (HARASSMENT)', 'CP-5.2': '사칭 (PHISHING)', 'SP-3.1': '개인정보 노출 (PII_EXPOSURE)' };
const policyText = (id: string) => `${id} ${policyTitles[id] ?? ''}`.trim();
// 목업 Agent의 도구 호출과 판단 과정. 도구 이름은 실제 Agent(business MCP·RAG MCP)와 같다.
function mockAgentTrace(route: HandlingRoute, text: string, finding: Finding, contextSize: number, priorConfirmed: number): NonNullable<MockTrace['agent']> {
  const n = normalize(text), d = filterDictionary, policy = finding.policyIds[0] ?? '';
  const attack = found(d.attack, n)[0], official = found(d.officialClaim, n)[0], credential = found(d.credential, n)[0];
  const phishing = finding.categories.includes('PHISHING'), groupHate = finding.policyIds.includes('CP-3.3');
  const publicContact = route === 'PII_INVESTIGATION' && finding.verdict === 'NO_VIOLATION';
  const query = publicContact ? '회사의 공개 연락처도 개인정보 노출인지' : route === 'PII_INVESTIGATION' ? '채팅에 전화번호나 이메일을 올린 경우'
    : phishing ? '운영자를 자칭하며 계정 정보를 요구하는 채팅'
    : groupHate ? '출신 집단 전체를 방송에서 배제하라는 표현'
    : finding.verdict === 'NO_VIOLATION' ? '감탄으로 쓰인 공격 단어의 오탐 예외' : '특정 대상에게 떠나라고 요구하는 표현';
  const candidates = route === 'PII_INVESTIGATION' ? ['SP-3.1'] : phishing ? ['CP-5.2'] : groupHate ? ['CP-3.3', 'CP-2.2', 'CP-3.2'] : ['CP-3.2', 'CP-2.2', 'CP-3.1'];
  const tools: AgentToolCall[] = [
    { name: 'get_chat_context', input: '대상 메시지 + 최근 채팅', output: `대상 U1 1건, 주변 ${Math.max(0, contextSize - 1)}개 (전화번호·이메일·링크 가림)` },
    { name: 'get_user_history', input: 'U1 · 이번 방송', output: `확정 위반 ${priorConfirmed}건` },
    { name: 'search_policy', input: `"${query}" · 정책 v3.2`, output: candidates.map(policyText).join(' / ') },
    ...(policy ? [{ name: 'get_policy_section', input: policy, output: `${policyText(policy)} 원문 확인` }] : [])
  ];
  const reasoning = publicContact ? [
    `대상 메시지에 ${piiKind(text)[0]} 형식이 있습니다. 문맥 기록에는 ${piiKind(text)[1]}로 가려져 있습니다.`,
    "'고객센터'와 함께 쓰여 개인이 아닌 게임사의 공개 문의처로 안내하고 있습니다.",
    'SP-3.1은 실제 개인정보 노출을 막습니다. 회사가 공개한 문의처는 개인정보 노출로 보지 않습니다.',
    '위반 아님으로 판정합니다. 개인정보 경로라 백엔드가 검증하면 운영자 검토 없이 공개됩니다.'
  ] : route === 'PII_INVESTIGATION' ? [
    `대상 메시지에 ${piiKind(text)[0]} 형식이 있습니다. 문맥 기록에는 ${piiKind(text)[1]}로 가려져 있습니다.`,
    '주변 채팅에서 이 연락처가 작성자 본인 것인지, 다른 사람 것인지 드러나지 않습니다.',
    'SP-3.1은 다른 사람의 연락처를 드러내는 것을 막습니다. 본인 연락처인지는 채팅만으로 확인할 수 없습니다.',
    '근거가 부족하므로 위반으로 단정하지 않고 판단 보류로 넘깁니다. 확인할 사실을 함께 적습니다.'
  ] : groupHate ? [
    `공격 표현 '${attack}'이 출신으로 묶은 집단 전체를 향합니다.`,
    '대상 집단(정체성 속성)과 배제 요구("나가라")가 모두 확인됩니다. 특정 팀의 팬처럼 정체성 속성이 아닌 집단이 아닙니다.',
    '자조, 비판·제지 목적의 인용, 가벼운 고정관념 같은 CP-2.2 정상 예외가 아닙니다.',
    'CP-3.3 집단 대상 비하·배제(정책 v3.2)로 위반을 제안합니다. 확정은 운영자가 합니다.'
  ] : phishing ? [
    `'${official}'(공식 자칭)과 '${credential}'(계정 정보 요구)가 한 메시지에 함께 있습니다.`,
    '작성자 U1은 이 채널의 운영자가 아닌 일반 시청자입니다.',
    'CP-5.2 사칭에 해당합니다. 계정 탈취로 이어질 수 있습니다.',
    '위반(피싱·사칭)으로 제안합니다. 근거 정책 CP-5.2.'
  ] : finding.verdict === 'NO_VIOLATION' ? [
    `공격 표현 '${attack}'이 들어 있습니다.`,
    '같은 문장이 플레이 장면에 대한 반응(컨트롤·한타 등)입니다.',
    '특정 시청자나 방송인을 겨냥하지 않았습니다. CP-2.2 문맥 판단의 오탐 예외에 해당합니다.',
    '위반 아님으로 제안합니다. 공개 여부는 운영자가 정합니다.'
  ] : [
    `공격 표현 '${attack}'이 들어 있습니다.`,
    '앞뒤 채팅에서 감탄이나 인용으로 쓰인 흔적이 없습니다.',
    '방송인 또는 다른 시청자에게 떠나라고 요구하거나 위협합니다. CP-3.2 괴롭힘에 해당합니다.',
    '위반(괴롭힘)으로 제안합니다. 근거 정책 CP-3.2.'
  ];
  return { tools, reasoning, answer: finding };
}
const verifyText = (f: Finding) => f.verdict === 'VIOLATION' ? `위반 제안에 정책 ID(${f.policyIds.join(', ')})가 있음 → 형식 검사 통과`
  : f.verdict === 'NEEDS_REVIEW' ? `판단 보류에 확인 필요 사실 ${f.missingFacts.length}개가 있음 → 형식 검사 통과`
  : `위반 아님 제안 · 정책 ${f.policyIds.join(', ') || '-'} → 형식 검사 통과`;
// 이미 가린 [URL:host] 안의 도메인은 다시 가리지 않는다.
const MASK_DOMAIN = /(?<![\p{L}\p{N}@.\-:[])((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[A-Za-z]{2,63})(?![\p{L}\p{N}-])[^\s\]]*/gu;
// Backend PiiMasker 일부: 문맥 메시지에서 이메일·전화번호·주소를 가린다.
export function maskText(text: string) {
  return text.normalize('NFKC').replace(/\bhttps?:\/\/([^\s/?#]+)\S*/gi, '[URL:$1]').replace(EMAIL, '[EMAIL]')
    .replace(MASK_DOMAIN, (_, host: string) => `[URL:${host.toLowerCase()}]`)
    .replace(PHONE_RE, '[PHONE]').replace(NUMBER_GROUPS, g => isAccount(g) ? '[ACCOUNT]' : g).replace(LONG_NUMBER, '[ACCOUNT]');
}
// 목업 Agent. 실제 모델을 부르지 않고 경로와 표현으로 정한 제안을 붙인다. 계약상 VIOLATION은 정책 ID, NEEDS_REVIEW는 확인 필요 사실이 있어야 한다.
function mockAgent(messageId: string, route: HandlingRoute, tags: string[], text: string): Finding {
  // 게임사 고객센터처럼 개인이 아닌 공개 연락처는 위반 아님으로 판정한다. 개인정보 경로라 BE 검증 뒤 운영자 없이 공개된다(v3.2 §5).
  if (route === 'PII_INVESTIGATION' && PUBLIC_CONTACT.test(text)) return { messageId, verdict: 'NO_VIOLATION', categories: [], policyIds: ['SP-3.1'], reason: '(목업 Agent) 개인이 아닌 게임사 고객센터의 공개 연락처입니다. 개인정보 노출이 아닙니다.', missingFacts: [] };
  if (route === 'PII_INVESTIGATION') return { messageId, verdict: 'NEEDS_REVIEW', categories: ['PII_EXPOSURE'], policyIds: ['SP-3.1'], reason: '(목업 Agent) 연락처 형식이 있지만 실제 개인정보인지 확인할 근거가 없습니다.', missingFacts: ['본인 또는 타인의 실제 연락처인지'] };
  if (tags.includes('OFFICIAL_CLAIM') && tags.includes('CREDENTIAL_REQUEST')) return { messageId, verdict: 'VIOLATION', categories: ['PHISHING'], policyIds: ['CP-5.2'], reason: '(목업 Agent) 공식 운영자를 자칭하며 계정 정보를 요구합니다.', missingFacts: [] };
  // v3.2 CP-3.3: 집단 전체의 열등 단정이나 배제 요구. 대상 집단과 배제 표현이 함께 있어야 한다.
  if (IDENTITY_GROUP.test(text)) return { messageId, verdict: 'VIOLATION', categories: ['HARASSMENT'], policyIds: ['CP-3.3'], reason: '(목업 Agent) 출신으로 묶은 집단 전체를 방송에서 나가라고 배제합니다. 자조나 비판 인용이 아닙니다.', missingFacts: [] };
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
    kickProgress: {} as Record<string, string>, logs: [] as StudioLog[], traces: {} as Record<string, MockTrace>,
    floodMarks: [] as { userId: string; text: string; caseId: string; lastSentAt: number }[]
  });
  const aliasOf = (userId: string) => users.find(u => u.id === userId)?.alias ?? '시청자';
  const ownerOfCase = (caseId: string) => state.cases.find(c => c.caseId === caseId)?.userId;
  function log(event: string, detail: string, at = Date.now(), ids: { caseId?: string; reviewId?: string } = {}) {
    state.logs.unshift({ id: uid(), time: iso(at), event, detail, ...ids }); state.logs.splice(200);
  }
  const activeFindings = (c: LiveCase) => c.confirmedFindings.filter(f => f.status === 'CONFIRMED');
  const isConfirmed = (c: LiveCase) => c.confirmationStatus === 'CONFIRMED_VIOLATION' && activeFindings(c).length > 0;
  const confirmedAt = (c: LiveCase) => Math.max(...activeFindings(c).map(f => Date.parse(String(f.confirmedAt))));
  const targets = (c: LiveCase) => state.messages.filter(m => c.targetMessageIds.includes(m.messageId));
  function addStep(messageIds: string[], at: number, title: string, detail: string, code?: string) {
    for (const id of messageIds) state.traces[id]?.backend.push({ at: iso(at), title, detail, code });
  }
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
  // 사건의 violationCount(Backend CaseDetail): 같은 방송에서 이 시청자의 다른 사건 중 취소되지 않은 확정 위반이 있는 사건 수.
  // 현재 사건은 빼고 조회 시점 기준이다. 강퇴 집계(최근 24시간, 현재 포함)와 다르다.
  function recount(userId: string) {
    const mine = state.cases.filter(c => c.userId === userId);
    for (const c of mine) c.violationCount = mine.filter(x => x.caseId !== c.caseId && isConfirmed(x)).length;
  }
  // 정책 v3.2 MP-2.1: 같은 방송·같은 유형의 이전 확정 사건 수로 기간을 정하고, 여러 유형이면 가장 긴 하나만 적용한다.
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
    recount(c.userId);
    addStep(c.targetMessageIds, at, byOperator ? '제재 적용 (운영자 위반 확정)' : '제재 적용', `${categories.map(x => categoryLabels[x]).join('·')} 확정 → 숨김${timeoutSec ? ` + 채팅 ${timeoutText(timeoutSec)} 제한` : ''}`, 'MP-2.1');
    log('CASE_UPDATED', `${aliasOf(c.userId)} · ${categories.map(x => categoryLabels[x]).join('·')} 위반 확정${timeoutSec ? ` · 채팅 ${timeoutText(timeoutSec)} 제한` : ''}`, at, { caseId: c.caseId });
    ensureKick(c, at);
  }
  // 정책 v3.2 MP-4.1: 최근 24시간의 서로 다른 확정 사건 3건.
  // MP-4.2 소진: 대기 중이거나 한 번이라도 결정된 강퇴 검토의 기준 사건은 다시 세지 않는다.
  // 결정 뒤 오판 취소로 무효가 돼도 소진은 유지된다. 결정 전에 무효가 된 검토의 사건만 다시 센다(Backend live_reservations).
  function ensureKick(trigger: MockCase, at: number) {
    const userId = trigger.userId;
    const kicks = state.reviews.filter(r => r.kind === 'KICK' && ownerOfCase(r.caseId) === userId);
    if (kicks.some(r => r.status === 'PENDING')) return;
    const used = new Set(kicks.filter(r => r.status === 'PENDING' || state.decisions[r.reviewId]).flatMap(r => r.basisCaseIds));
    const eligible = state.cases.filter(c => c.userId === userId && isConfirmed(c) && !used.has(c.caseId) && confirmedAt(c) > at - KICK_WINDOW_MS)
      .sort((a, b) => confirmedAt(a) - confirmedAt(b) || a.caseId.localeCompare(b.caseId));
    if (eligible.length < KICK_THRESHOLD) return;
    const reviewId = uid();
    state.reviews.push({ reviewId, kind: 'KICK', liveId: LIVE_ID, caseId: trigger.caseId, status: 'PENDING', version: 1, createdAt: iso(at), aiVerdict: 'VIOLATION', messages: trigger.messages, targetMessageIds: trigger.targetMessageIds, findings: trigger.findings ?? [], basisCaseIds: eligible.slice(0, KICK_THRESHOLD).map(c => c.caseId), summary: KICK_SUMMARY });
    trigger.status = 'KICK_REVIEW_PENDING';
    addStep(trigger.targetMessageIds, at, '강퇴 심사 요청', `최근 24시간 확정 사건 ${KICK_THRESHOLD}건 → 운영자 승인 대기`, 'MP-4.1');
    log('KICK_REVIEW_REQUIRED', `${aliasOf(userId)} · 확정 사건 ${KICK_THRESHOLD}건`, at, { caseId: trigger.caseId, reviewId });
  }
  // agentTimeout: Agent 판정이 마감(기본 3분) 안에 오지 않은 경우를 재현한다(A-25). 목업은 마감을 기다리지 않고 바로 연다.
  function send(user: MockUser, text: string, at = Date.now(), opts: { agentTimeout?: boolean } = {}): SendResult {
    if (state.kicks[user.id]) return { ok: false, code: 'KICKED' };
    const until = state.timeouts[user.id];
    if (until && Date.parse(until) > at) return { ok: false, code: 'TIMED_OUT', until };
    const normalized = normalize(text);
    const same = state.messages.filter(m => m.ownerId === user.id && normalize(m.text) === normalized && Date.parse(m.sentAt) > at - FLOOD_WINDOW_MS).length + 1;
    let { route, tags, ruleCategories } = classify(text, same);
    const messageId = uid();
    const trace: MockTrace = reactive({ messageId, route, agent: null, backend: [
      { at: iso(at), title: '정규화', detail: `"${text}" → "${normalized}"`, code: 'norm-v1' },
      { at: iso(at), title: '사전 검사', detail: dictHits(text, same).join(' · ') || '사전에 걸린 단어 없음', code: 'dict-v2' }
    ] });
    const base: MockMessage = { messageId, channelId: CHANNEL_ID, liveId: LIVE_ID, authorAlias: user.alias, text, visibility: 'PUBLIC', version: 1, sentAt: iso(at), isMine: false, ownerId: user.id, moderationReasonCode: null, moderationNotice: null, reviewStatus: null, timeoutUntil: null };
    // 같은 도배가 10초 안에 이어지면 기존 도배 사건에 붙여 숨긴다(Backend flood_marks).
    const mark = route === 'RULE_CONFIRMED' ? undefined : state.floodMarks.find(f => f.userId === user.id && f.text === normalized && f.lastSentAt > at - FLOOD_WINDOW_MS);
    const owner = mark && state.cases.find(c => c.caseId === mark.caseId && isConfirmed(c));
    if (mark && owner) {
      const message = reactive({ ...base, visibility: 'HIDDEN', moderationReasonCode: 'FLOOD_REPEATED', moderationNotice: '동일 문장 반복으로 숨김 처리되었습니다.' }) as MockMessage;
      trace.route = 'FLOOD_REVIEW'; trace.backend.push({ at: iso(at), title: '기존 도배 사건에 추가', detail: '10초 안에 같은 문장이 이어져 바로 숨김', code: 'CP-4.2' });
      state.traces[messageId] = trace;
      state.messages.push(message); owner.targetMessageIds.push(message.messageId); mark.lastSentAt = at;
      log('CHAT', `${user.alias} · 도배 반복 숨김`, at);
      return { ok: true, message, caseItem: owner };
    }
    if (route === 'RULE_CONFIRMED') ruleCategories = ruleCategories.length ? ruleCategories : ['PROFANITY'];
    const message = reactive({ ...base, visibility: route === 'PASS' ? 'PUBLIC' : route === 'RULE_CONFIRMED' ? 'HIDDEN' : 'HELD' }) as MockMessage;
    if (route === 'RULE_CONFIRMED') message.moderationReasonCode = tags.includes('LINK') ? 'LINK_NOT_ALLOWED' : 'PROFANITY_INCLUDED';
    else if (route !== 'PASS') { const n = authorNotice(route, false); message.moderationReasonCode = n.code; message.moderationNotice = n.notice; message.reviewStatus = message.visibility === 'HELD' ? 'PENDING' : null; }
    trace.backend.push({ at: iso(at), title: '처리 경로 결정', detail: routeText[route], code: route });
    state.traces[messageId] = trace;
    state.messages.push(message);
    if (state.messages.length > 300) for (const old of state.messages.splice(0, state.messages.length - 300)) delete state.traces[old.messageId];
    log('CHAT', `${user.alias} · ${message.visibility}`, at);
    if (route === 'PASS') return { ok: true, message, caseItem: null };
    const c = reactive({ caseId: uid(), liveId: LIVE_ID, version: 1, confirmationStatus: 'PENDING', handlingRoute: route, messages: snapshot(user.id), targetMessageIds: [message.messageId], confirmedFindings: [], findings: [], createdAt: iso(at), violationCount: 0, status: 'ANALYZING', userId: user.id, timeoutUntil: null }) as MockCase;
    state.cases.push(c); recount(user.id);
    log('CASE_CREATED', `${user.alias} · ${route}`, at, { caseId: c.caseId });
    if (route !== 'RULE_CONFIRMED' && route !== 'FLOOD_REVIEW') {
      addStep([messageId], at, '임시 비노출', '작성자와 운영자에게만 보임', 'HELD');
      addStep([messageId], at, '문맥 준비', `최근 채팅 ${c.messages.length}개. 작성자 U1·주변 U2…로 바꾸고 전화번호·이메일·링크를 가림`, 'SP-4.1');
      addStep([messageId], at, 'Agent 조사 요청', '조사 작업 1건 (대상 메시지 1개)', 'investigate');
    }
    if (route === 'FLOOD_REVIEW') { confirm(c, ['FLOOD'], at, false); state.floodMarks.push({ userId: user.id, text: normalized, caseId: c.caseId, lastSentAt: at }); }
    else if (route === 'RULE_CONFIRMED') confirm(c, ruleCategories, at, false);
    else {
      log('TOOL_START', `${user.alias} · ${route === 'PII_INVESTIGATION' ? '개인정보 조사' : '문맥 조사'} (목업 Agent)`, at, { caseId: c.caseId });
      if (opts.agentTimeout) {
        // AI 판정 없이 문맥 검토를 연다(A-25): aiVerdict=NEEDS_REVIEW, findings=[], 메시지는 HELD 유지.
        addStep([messageId], at, '판정 마감 초과', 'AI 판정이 마감(기본 3분) 안에 오지 않음 → AI 결과 없이 검토 열기', 'A-25');
        addStep([messageId], at, '문맥 검토 생성', 'AI 결과 없음 · 운영자가 직접 결정하고 백엔드가 바로 적용', 'CONTEXT_REVIEW_REQUIRED');
        const reviewId = uid();
        state.reviews.push({ reviewId, kind: 'CONTEXT', liveId: LIVE_ID, caseId: c.caseId, status: 'PENDING', version: 1, createdAt: iso(at), aiVerdict: 'NEEDS_REVIEW', messages: c.messages, targetMessageIds: c.targetMessageIds, findings: [], basisCaseIds: [], summary: NO_AI_SUMMARY });
        log('CONTEXT_REVIEW_REQUIRED', `${user.alias} · AI 결과 없음`, at, { caseId: c.caseId, reviewId });
        return { ok: true, message, caseItem: c };
      }
      const finding = mockAgent(message.messageId, route, tags, text);
      c.findings = [finding]; c.status = 'NEEDS_REVIEW';
      trace.agent = mockAgentTrace(route, text, finding, c.messages.length, c.violationCount ?? 0);
      addStep([messageId], at, '판단·근거 검증', verifyText(finding), finding.verdict);
      if (route === 'PII_INVESTIGATION' && finding.verdict === 'NO_VIOLATION') {
        c.confirmationStatus = 'CONFIRMED_NORMAL'; c.status = 'NO_ACTION'; c.version++;
        setVisibility(message, 'PUBLIC', route);
        log('MESSAGE_RESTORED', `${user.alias} · 개인정보 정상 판정으로 공개 (운영자 검토 없음)`, at, { caseId: c.caseId });
        addStep([messageId], at, '가림 해제', '개인정보 정상 판정 → 운영자 검토 없이 공개 (정책 v3.2 §5)', 'CONFIRMED_NORMAL');
        return { ok: true, message, caseItem: c };
      }
      addStep([messageId], at, '문맥 검토 생성', 'AI 제안만으로 확정하지 않고 운영자 결정 대기 (정책 v3.2)', 'CONTEXT_REVIEW_REQUIRED');
      log('TOOL_END', `${user.alias} · AI 제안 ${finding.verdict}`, at, { caseId: c.caseId });
      const reviewId = uid();
      state.reviews.push({ reviewId, kind: 'CONTEXT', liveId: LIVE_ID, caseId: c.caseId, status: 'PENDING', version: 1, createdAt: iso(at), aiVerdict: finding.verdict, messages: c.messages, targetMessageIds: c.targetMessageIds, findings: c.findings, basisCaseIds: [], summary: CONTEXT_SUMMARY });
      log('CONTEXT_REVIEW_REQUIRED', `${user.alias} · AI 제안 ${finding.verdict}`, at, { caseId: c.caseId, reviewId });
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
    log('REVIEW_DECIDED', `${aliasOf(c.userId)} · ${r.kind} ${value}`, at, { caseId: c.caseId, reviewId });
    if (r.kind === 'CONTEXT') addStep(c.targetMessageIds, at, '운영자 결정', `${value === 'CONFIRM_NORMAL' ? '정상 확정 → 공개' : value === 'CONFIRM_VIOLATION' ? '위반 확정' : '보류 → 다시 결정 대기'}${reason ? ` · 이유: ${reason}` : ''}`, value);
    if (r.kind === 'CONTEXT') {
      if (value === 'DEFER') return { ok: true, message: '보류했습니다. 검토 대기에 남습니다. (MOCK)' };
      r.status = 'DECIDED';
      if (value === 'CONFIRM_NORMAL') {
        c.confirmationStatus = 'CONFIRMED_NORMAL'; c.status = 'NO_ACTION'; c.version++;
        for (const m of targets(c)) setVisibility(m, 'PUBLIC', c.handlingRoute ?? 'CONTEXT_REVIEW');
        log('MESSAGE_RESTORED', `${aliasOf(c.userId)} · 정상 확정으로 공개`, at, { caseId: c.caseId });
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
      log('LIVE_ACCESS_BLOCKED', `${aliasOf(userId)} · 이번 방송 종료까지`, at); log('ACTION_APPLIED', 'KICK · SUCCEEDED · CONFIRMED', at, { caseId: r.caseId, reviewId });
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
    addStep(c.targetMessageIds, at, '오판 취소', `${categoryLabels[f.category]} 근거 취소${c.confirmationStatus === 'CANCELLED' ? ' → 다시 공개' : ''} · 이유: ${reason}`, 'REVOKED');
    recount(c.userId);
    log('CASE_UPDATED', `${aliasOf(c.userId)} · ${categoryLabels[f.category]} 오판 취소 · ${reason}`, at, { caseId: c.caseId });
    return true;
  }
  // 초기 화면: fixture 채팅과 운영자 결정을 시간 순서대로 다시 넣는다.
  function reset(lines: FixtureLine[], now = Date.now()) {
    Object.assign(state, { messages: [], cases: [], reviews: [], decisions: {}, timeouts: {}, kicks: {}, kickProgress: {}, logs: [], traces: {}, floodMarks: [] });
    state.live = { liveId: LIVE_ID, channelId: CHANNEL_ID, startedAt: iso(now - 3_600_000), endedAt: null };
    type Step = { at: number; run: () => void };
    const steps: Step[] = [];
    for (const line of lines) {
      const user = users.find(u => u.alias === line.alias)!;
      const at = now - line.minutesAgo * 60_000;
      let sent: MockMessage | null = null;
      for (let n = 0; n < (line.repeat ?? 1); n++) steps.push({ at: at + n * 2000, run: () => { const r = send(user, line.text, at + n * 2000, { agentTimeout: line.agentTimeout }); if (r.ok) sent = r.message; } });
      const d = line.decide;
      if (d) steps.push({ at: now - d.minutesAgo * 60_000, run: () => {
        const r = state.reviews.find(x => x.kind === 'CONTEXT' && x.targetMessageIds.includes(sent?.messageId ?? ''));
        if (r) decide(r.reviewId, d.value, '', d.categories, now - d.minutesAgo * 60_000);
      } });
    }
    steps.sort((a, b) => a.at - b.at).forEach(s => s.run());
    log('MOCK', '목업 방송 데이터를 불러왔습니다. 판정은 정책 v3.2 기준입니다.', now);
  }
  return { state, aliasOf, send, decide, finishKick, revoke, reset, log };
}
