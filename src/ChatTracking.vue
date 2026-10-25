<script setup lang="ts">
// 채팅관제 Tracking(시스템 운영자 화면의 탭). 채팅 한 줄을 누르면 그 채팅이 어떤 판단을 거쳐 처리됐는지
// 판정 흐름(정책 v3.2, Backend LiveModerationService.judgment 기준)으로 보여 준다. 조회 전용이라 결정하지 않는다.
// 강조는 서버 기록(목업은 목업 처리 기록)으로만 정한다. 기록이 없는 단계는 추정해서 칠하지 않는다.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { Component } from 'vue';
import { Ban, BookOpen, Eye, EyeOff, FileText, History, MessageSquare, Pause, Play, ScrollText, Search, ShieldCheck, SkipForward, Split, UserCheck, UserX, Workflow } from 'lucide-vue-next';
import { avatarColor } from './avatar';
import { clockText as hourMinute, dateTimeText } from './chatTime';
import { categoryLabels, reviewStatusLabels, routeLabels, verdictLabels, visibilityLabels, type Category, type Finding, type LiveCase, type LiveReview, type Message, type Verdict } from './contracts';
import { sanctionFor, sanctionLabel, type Sanction } from './sanction';
import type { AgentToolCall, MockTrace } from './mockLive';
import type { StudioLog } from './StudioScreen.vue';

const props = withDefaults(defineProps<{
  channelName: string; messages: Message[]; reviews: LiveReview[]; cases: LiveCase[];
  caseNames: Record<string, string>; logs: StudioLog[]; kickProgress: Record<string, string>;
  traces?: Record<string, MockTrace> | null;
}>(), { traces: null });

const iso = (v: unknown) => typeof v === 'number' ? new Date(v).toISOString() : String(v ?? '');
const asTime = (v: unknown) => dateTimeText(iso(v) || null);
const toMs = (v: unknown) => Date.parse(iso(v));
const nameOf = (caseId: string) => props.caseNames[caseId] ?? `작성자 미확인 · 사건 ${caseId.slice(0, 8)}`;
const verdictTone = (v?: Verdict) => ({ VIOLATION: 'violation', NO_VIOLATION: 'clear', NEEDS_REVIEW: 'review' } as Record<string, string>)[v ?? ''] ?? 'pending';
const categoryName = (c: string) => categoryLabels[c as Category] ?? c;
const activeCategories = (c: LiveCase) => c.confirmedFindings.filter(f => f.status === 'CONFIRMED').map(f => f.category);
const isRule = (c: LiveCase) => c.handlingRoute === 'RULE_CONFIRMED' || c.handlingRoute === 'FLOOD_REVIEW';
const caseByMessage = computed(() => { const out = new Map<string, LiveCase>(); for (const c of props.cases) for (const id of c.targetMessageIds) out.set(id, c); return out; });
function kickStateOf(r: LiveReview) {
  const state = props.kickProgress[r.reviewId];
  if (!state || r.status !== 'INVALIDATED' || /^(근거 취소|재검증 탈락)/.test(state)) return state;
  return state.startsWith('강퇴 적용 완료') ? '근거 취소 · 강퇴 해제' : '무효 · 강퇴하지 않음';
}
function ruleAction(c: LiveCase) {
  if (c.confirmationStatus === 'CANCELLED') return { label: '오판 취소', tone: 'none' };
  const at = Date.parse(iso(c.createdAt)), name = nameOf(c.caseId);
  let worst: Sanction | null = null;
  for (const category of activeCategories(c)) {
    const prior = props.cases.filter(x => x.caseId !== c.caseId && nameOf(x.caseId) === name && Date.parse(iso(x.createdAt)) < at && activeCategories(x).includes(category)).length;
    const s = sanctionFor(category, prior); if (!worst || s.timeoutSec > worst.timeoutSec) worst = s;
  }
  return worst ? { label: sanctionLabel(worst), tone: worst.timeoutSec ? 'timeout' : 'hide' } : { label: '확인 중', tone: 'none' };
}
function caseStateOf(c: LiveCase): { label: string; tone: string } {
  if (c.confirmationStatus === 'CONFIRMED_VIOLATION') return { label: `위반 확정 · ${ruleAction(c).label}`, tone: 'violation' };
  if (c.confirmationStatus === 'CONFIRMED_NORMAL') return { label: '정상 확정 · 공개', tone: 'clear' };
  if (c.confirmationStatus === 'CANCELLED') return { label: '오판 취소', tone: 'cancelled' };
  const openReview = props.reviews.some(r => r.kind === 'CONTEXT' && r.caseId === c.caseId && r.status === 'PENDING');
  return { label: c.findings?.length ? '결정 대기' : openReview ? '결정 대기 · AI 결과 없음' : 'AI 조사 중', tone: 'pending' };
}

// 채팅: 사용자가 직접 위로 스크롤했을 때만 따라가기를 멈추고, 그동안 온 메시지 수를 버튼으로 알려 준다.
const filter = ref<'all' | 'private'>('all');
const privateCount = computed(() => props.messages.filter(m => m.visibility !== 'PUBLIC').length);
const shownMessages = computed(() => (filter.value === 'all' ? props.messages : props.messages.filter(m => m.visibility !== 'PUBLIC')).slice(-200));
const chatRef = ref<HTMLElement | null>(null), follow = ref(true), unread = ref(0);
function toBottom(smooth = true) { const el = chatRef.value; if (!el) return; el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); follow.value = true; unread.value = 0; }
function onScroll() { const el = chatRef.value; if (!el) return; const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40; follow.value = atBottom; if (atBottom) unread.value = 0; }
watch(chatRef, el => { if (el) nextTick(() => toBottom(false)); });
watch(() => shownMessages.value.map(m => m.messageId), async (ids, previous) => {
  await nextTick();
  if (follow.value) toBottom(false); else { const known = new Set(previous); unread.value += ids.filter(id => !known.has(id)).length; }
});

// 채팅 상세: 실시간 관제에서 채팅 한 줄을 누르면 오른쪽 칸에 처리 경로와 AI Agent 판단을 보여 준다.
// AI Agent는 Backend가 문맥 검토·개인정보 조사로 보낸 채팅만 판단한다. 그 밖의 채팅은 Backend 필터 결과만 있고, 없는 AI 판단을 만들어 보여 주지 않는다.
// 사건·검토·실시간 기록이 갱신되면 패널도 그대로 따라 바뀐다.
const selectedId = ref<string | null>(null);
const selected = computed(() => {
  const id = selectedId.value; if (!id) return null;
  const message = props.messages.find(m => m.messageId === id) ?? null;
  if (!message) return null;
  const item = caseByMessage.value.get(id) ?? null;
  const review = item ? props.reviews.find(r => r.kind === 'CONTEXT' && r.caseId === item.caseId) ?? null : null;
  const ai = !!item && !isRule(item);
  const finding = item?.findings?.[0] ?? review?.findings[0] ?? null;
  const investigating = ai && !finding;
  const trace = props.traces?.[id] ?? null;
  const route = !item && trace?.route === 'PASS'
    ? { title: '필터 통과 (목업 기록)', detail: '목업 Backend 기록: 사전에 걸린 단어가 없어 공개했습니다. AI 조사는 하지 않습니다.' }
    : !item
    ? { title: '서버 경로 기록 없음', detail: '사건 응답에 처리 경로가 없습니다. 공개 여부만으로 통과 경로라고 추정하지 않습니다.' }
    : isRule(item)
      ? { title: item.handlingRoute ? routeLabels[item.handlingRoute] : '규칙 자동 확정', detail: 'Backend 규칙으로 바로 확정했습니다. AI 조사는 하지 않습니다.' }
      : { title: item.handlingRoute ? routeLabels[item.handlingRoute] : 'AI 문맥 검토', detail: 'Backend가 AI Agent에게 판단을 맡긴 채팅입니다. 결정은 운영자가 합니다.' };
  return { message, item, review, ai, finding, investigating, route, trace, state: item ? caseStateOf(item) : null };
});
// 채팅 판정 흐름: 노드를 세 열(백엔드 · 가운데 · Agent·운영자)에 카드로 놓고 실제 노드끼리 화살표로 잇는다.
// 강조는 서버 기록(목업은 목업 처리 기록)으로만 정한다. path = 거친 단계, wait = 지금 대기, skip = 이 채팅이 가지 않은 분기,
// unknown = 기록이 없어 알 수 없음. 아직 기록이 없는 다음 단계는 거쳤다고 칠하지 않는다.
type FlowActor = 'backend' | 'agent' | 'human';
type FlowNodeId = 'input' | 'classify' | 'public' | 'rule' | 'agent' | 'policy' | 'verify' | 'wait' | 'sanction' | 'normal' | 'kickReview' | 'kick';
type FlowState = 'path' | 'wait' | 'skip' | 'unknown';
interface FlowNode { id: FlowNodeId; title: string; sub: string; actor: FlowActor; tag: string; icon: Component; col: 0 | 1 | 2; top: number; role: string }
// 단계와 역할은 정책 v3.2(POLICY.md §1·§3·§5·§6·§8)과 Backend 구현(LiveModerationService.judgment)을 따른다.
const flowNodes: FlowNode[] = [
  { id: 'input', title: '채팅 접수', sub: '메시지 접수', actor: 'backend', tag: 'INPUT', icon: MessageSquare, col: 1, top: 4, role: '시청자 메시지를 접수하고 방송·작성자 정보를 연결합니다.' },
  { id: 'classify', title: '백엔드 1차 분류', sub: 'PASS · HOLD · FLOOD', actor: 'backend', tag: 'BACKEND', icon: Split, col: 1, top: 84, role: '정규화한 문장을 사전과 규칙으로 검사해 처리 경로(통과·규칙 확정·문맥 검토·개인정보 조사·도배)를 정합니다. 일반 시청자에게 원문을 먼저 공개하지 않습니다. (v3.2 §3)' },
  { id: 'public', title: '공개 유지', sub: 'PASS · Agent 미호출', actor: 'backend', tag: 'PASS', icon: Eye, col: 0, top: 184, role: '조사 신호가 없어 공개합니다. Agent는 호출하지 않습니다. (v3.2 §3)' },
  { id: 'rule', title: '규칙 확정', sub: '명확한 욕설 · 링크 · 도배', actor: 'backend', tag: 'BACKEND', icon: ScrollText, col: 1, top: 184, role: '명확한 욕설과 링크는 BE 규칙으로 위반을 확정합니다. 도배는 10초 안 같은 문장 세 번째부터입니다. AI 조사는 없습니다. (v3.2 §1·§2·§7)' },
  { id: 'agent', title: '문맥·개인정보 조사', sub: '가린 대화 · 작성자 이력', actor: 'agent', tag: 'AGENT · 01', icon: Search, col: 2, top: 184, role: 'BE가 고른 후보만 조사합니다. 가린 주변 채팅과 작성자 이력을 불러옵니다. 제재는 하지 않습니다. (v3.2 §1, SP-4.1)' },
  { id: 'policy', title: '정책 대조 · AI 판정', sub: '위반 · 위반 아님 · 판단 보류', actor: 'agent', tag: 'AGENT · 02', icon: BookOpen, col: 2, top: 264, role: '조사 결과를 정책 v3.2 조항에 대조해 판정(VIOLATION·NO_VIOLATION·NEEDS_REVIEW)과 근거를 냅니다. AI 판정은 제안입니다. (v3.2 §5)' },
  { id: 'verify', title: '근거·정책 검증', sub: '경로별 결과 반영', actor: 'backend', tag: 'BACKEND', icon: ShieldCheck, col: 2, top: 344, role: 'BE가 판정의 근거 형식과 정책 ID를 검증하고 경로별로 넘깁니다. 문맥 후보와 판단 보류는 운영자 결정, 개인정보 정상은 가림 해제입니다. (v3.2 §5)' },
  { id: 'wait', title: '운영자 결정 대기', sub: '정상 · 위반 · 보류', actor: 'human', tag: 'HUMAN', icon: UserCheck, col: 2, top: 434, role: '운영자가 AI 결과와 다르게 판단할 수 있습니다. 보류는 공개 승인이 아니며, 운영자 확인 없이 자동 공개하지 않습니다. (v3.2 §5)' },
  { id: 'sanction', title: '숨김 · 제재 적용', sub: '유형별 제재표', actor: 'backend', tag: 'BACKEND', icon: EyeOff, col: 1, top: 524, role: '확정 위반을 숨기고 같은 유형의 이전 확정 수로 채팅 제한을 정합니다. 여러 유형이면 가장 긴 제한 하나만 적용합니다. (v3.2 §6, MP-2.1)' },
  { id: 'normal', title: '공개 · 가림 해제', sub: '정상 확정 · 개인정보 정상', actor: 'backend', tag: 'RESTORE', icon: Eye, col: 2, top: 524, role: '이 사건의 가림 원인만 풉니다. 다른 유효한 숨김이나 가림이 있으면 공개하지 않습니다. (v3.2 §4·§5)' },
  { id: 'kickReview', title: '강퇴 승인 요청', sub: '24시간 확정 통합 3건', actor: 'human', tag: 'HUMAN', icon: UserX, col: 1, top: 614, role: '같은 시청자·같은 방송의 최근 24시간 확정 사건이 유형 통합 3건이면 강퇴 승인을 따로 요청합니다. 자동 집행하지 않습니다. (v3.2 §8, MP-4.1)' },
  { id: 'kick', title: '강퇴 실행', sub: '재검증 후 방송 종료까지', actor: 'backend', tag: 'APPROVED', icon: Ban, col: 1, top: 704, role: '승인한 기준 사건을 재검증한 뒤 실행합니다. 이 방송이 끝날 때까지 재입장과 채팅을 막습니다. 실패해도 기존 가림은 풀지 않습니다. (v3.2 §9·§10)' }
];
const flowEdgeDefs: [FlowNodeId, FlowNodeId, string][] = [
  ['input', 'classify', ''], ['classify', 'public', '통과'], ['classify', 'rule', '규칙 확정'], ['classify', 'agent', '조사 후보'],
  ['agent', 'policy', ''], ['agent', 'wait', 'AI 결과 없음'], ['policy', 'verify', 'AI 판정 전달'], ['verify', 'wait', '문맥 검토 · 판단 보류'], ['verify', 'normal', '개인정보 정상'], ['verify', 'sanction', '개인정보 위반'],
  ['rule', 'sanction', ''], ['wait', 'normal', '정상 확정'], ['wait', 'sanction', '위반 확정'], ['sanction', 'kickReview', '확정 3건'], ['kickReview', 'kick', '승인 · 재검증']
];
const actorText: Record<FlowActor, string> = { backend: '백엔드', agent: 'Agent', human: '운영자' };
const flowNodeOf = (id: FlowNodeId) => flowNodes.find(n => n.id === id)!;
const kickReviewOf = (item: LiveCase | null) => item ? props.reviews.find(r => r.kind === 'KICK' && r.caseId === item.caseId) ?? null : null;
const flow = computed(() => {
  const sel = selected.value;
  const state = Object.fromEntries(flowNodes.map(n => [n.id, 'unknown'])) as Record<FlowNodeId, FlowState>;
  const edges = new Set<string>(), steps: FlowNodeId[] = [];
  let current: FlowNodeId | null = null;
  const out = () => ({ state, edges, steps, current: current ?? steps.at(-1) ?? null });
  if (!sel) return out();
  const go = (...ids: FlowNodeId[]) => { for (const id of ids) { const prev = steps.at(-1); if (prev) edges.add(`${prev}-${id}`); steps.push(id); state[id] = 'path'; } };
  const waitAt = (id: FlowNodeId, ...later: FlowNodeId[]) => { state[id] = 'wait'; current = id; for (const l of later) state[l] = 'unknown'; };
  go('input');
  const item = sel.item;
  const route = item?.handlingRoute ?? (!item && sel.trace?.route === 'PASS' ? 'PASS' : null);
  // 사건 응답에 처리 경로가 없으면 분류부터는 알 수 없다. 공개 상태만으로 통과라고 추정하지 않는다.
  if (!route) return out();
  for (const n of flowNodes) if (n.id !== 'input') state[n.id] = 'skip';
  go('classify');
  if (route === 'PASS' || !item) { go('public'); return out(); }
  if (isRule(item)) {
    go('rule');
    if (!item.confirmedFindings.length) { waitAt('rule'); return out(); }
    go('sanction');
  } else {
    go('agent');
    // AI 판정 없이 열린 검토(A-25): Agent 조사에서 바로 운영자 결정으로. 정책 대조·검증은 거치지 않았다.
    if (!sel.finding && sel.review) {
      go('wait');
      if (sel.review.status === 'PENDING') { waitAt('wait', 'normal', 'sanction', 'kickReview', 'kick'); return out(); }
      if (item.confirmationStatus === 'CONFIRMED_NORMAL') { go('normal'); return out(); }
      go('sanction');
      const k = kickReviewOf(item);
      if (k) { go('kickReview'); if (k.status === 'PENDING') waitAt('kickReview', 'kick'); else if ((props.kickProgress[k.reviewId] ?? '').startsWith('강퇴 적용 완료')) go('kick'); }
      return out();
    }
    if (!sel.finding) { waitAt('agent', 'policy', 'verify', 'wait', 'normal', 'sanction', 'kickReview', 'kick'); return out(); }
    go('policy', 'verify');
    // 개인정보 경로는 운영자 검토 없이 BE가 반영할 수 있다(정상 → 해제, 검증된 위반 → 확정). 문맥 경로는 항상 운영자 결정.
    if (!sel.review) {
      if (item.confirmationStatus === 'CONFIRMED_NORMAL') { go('normal'); return out(); }
      if (item.confirmationStatus === 'CONFIRMED_VIOLATION' || item.confirmationStatus === 'CANCELLED') go('sanction');
      else { waitAt('verify', 'wait', 'normal', 'sanction', 'kickReview', 'kick'); return out(); }
    } else {
    go('wait');
    if (sel.review.status === 'PENDING') { waitAt('wait', 'normal', 'sanction', 'kickReview', 'kick'); return out(); }
    if (item.confirmationStatus === 'CONFIRMED_NORMAL') { go('normal'); return out(); }
    go('sanction');
    }
  }
  const kick = kickReviewOf(item);
  if (kick) {
    go('kickReview');
    if (kick.status === 'PENDING') waitAt('kickReview', 'kick');
    else if ((props.kickProgress[kick.reviewId] ?? '').startsWith('강퇴 적용 완료')) go('kick');
  }
  return out();
});
// 경로 재생: 거친 단계를 하나씩 보여 준다. null이면 전체.
const flowProgress = ref<number | null>(null), flowPlaying = ref(false), flowChosen = ref<FlowNodeId | null>(null);
let flowTimer: ReturnType<typeof setInterval> | undefined;
const flowShown = computed(() => flowProgress.value ?? flow.value.steps.length);
function stopFlow() { if (flowTimer) clearInterval(flowTimer); flowTimer = undefined; flowPlaying.value = false; }
function stepFlow() {
  const total = flow.value.steps.length, next = Math.min(total, (flowProgress.value ?? total) + 1);
  flowProgress.value = next >= total ? null : next; flowChosen.value = flow.value.steps[next - 1] ?? null;
  if (flowProgress.value === null) stopFlow();
}
function togglePlay() {
  if (flowPlaying.value) return stopFlow();
  flowProgress.value = 0; flowPlaying.value = true; stepFlow();
  flowTimer = setInterval(stepFlow, 900);
}
onBeforeUnmount(stopFlow);
function selectMessage(id: string) { stopFlow(); selectedId.value = selectedId.value === id ? null : id; flowChosen.value = null; flowProgress.value = null; }
// 재생 중에는 아직 보여 주지 않은 단계를 '다음'으로 둔다.
function nodeTone(id: FlowNodeId): FlowState | 'later' {
  const f = flow.value, i = f.steps.indexOf(id);
  return i >= 0 && i >= flowShown.value ? 'later' : f.state[id];
}
function edgeTone(a: FlowNodeId, b: FlowNodeId): FlowState | 'later' {
  const f = flow.value;
  if (f.edges.has(`${a}-${b}`)) return f.steps.indexOf(b) < flowShown.value ? 'path' : 'later';
  return f.state[a] === 'unknown' || f.state[b] === 'unknown' ? 'unknown' : 'skip';
}
const flowFocus = computed<FlowNodeId>(() => flowChosen.value ?? flow.value.current ?? 'input');
const nodeToneText: Record<FlowState | 'later', string> = { path: '거친 단계', wait: '지금 대기', skip: '거치지 않음', unknown: '기록 없음', later: '다음 단계' };
// 화살표 좌표는 그려진 카드 위치로 계산한다. 폭이 바뀌면 다시 계산한다.
const flowGraph = ref<HTMLElement | null>(null);
const edgePaths = ref<{ id: string; a: FlowNodeId; b: FlowNodeId; d: string; label: string; lx: number; ly: number; anchor: 'start' | 'middle' | 'end'; actor: FlowActor }[]>([]);
function drawEdges() {
  const g = flowGraph.value; if (!g || !g.clientWidth) return;
  const box = (id: FlowNodeId) => {
    const e = g.querySelector<HTMLElement>(`[data-flow-node="${id}"]`)!;
    return { l: e.offsetLeft, r: e.offsetLeft + e.offsetWidth, t: e.offsetTop, b: e.offsetTop + e.offsetHeight, cx: e.offsetLeft + e.offsetWidth / 2, cy: e.offsetTop + e.offsetHeight / 2 };
  };
  edgePaths.value = flowEdgeDefs.map(([a, b, label]) => {
    const p = box(a), q = box(b);
    const actor: FlowActor = flowNodeOf(a).actor === 'agent' ? 'agent' : flowNodeOf(b).actor === 'human' || flowNodeOf(a).actor === 'human' ? 'human' : 'backend';
    let d: string, lx: number, ly: number, anchor: 'start' | 'middle' | 'end' = 'middle';
    // 판단 검증과 운영자 결정에서 제재로: 왼쪽으로 나가 제재 카드 위로 들어간다. 위쪽에서 나가는 선을 더 안쪽으로 보내 서로 겹치지 않게 한다.
    if (a === 'agent' && b === 'wait') { const x = p.l - 9; d = `M${p.l - 2} ${p.cy}H${x}V${q.t - 14}H${q.l + 16}V${q.t - 4}`; lx = x - 4; ly = (p.b + q.t) / 2; anchor = 'end'; }
    else if ((a === 'wait' || a === 'verify') && b === 'sanction') { const x = q.r - (a === 'verify' ? 44 : 22); d = `M${p.l - 2} ${p.cy}H${x}V${q.t - 4}`; lx = p.l - 6; ly = p.cy - 6; anchor = 'end'; }
    // 판단 검증에서 가림 해제로: 오른쪽 여백을 따라 내려가 해제 카드 오른쪽으로 들어간다.
    else if (a === 'verify' && b === 'normal') { const x = p.r + 7; d = `M${p.r + 1} ${p.cy}H${x}V${q.cy}H${q.r + 4}`; lx = p.r - 4; ly = p.b + 14; anchor = 'end'; }
    else if (a === 'verify' && b === 'wait') { d = `M${p.cx} ${p.b + 1}V${q.t - 4}`; lx = p.cx - 7; ly = q.t - 8; anchor = 'end'; }
    else if (a === 'wait' && b === 'normal') { d = `M${p.cx} ${p.b + 1}V${q.t - 4}`; lx = p.cx - 7; ly = q.t - 6; anchor = 'end'; }
    else if (Math.abs(p.cx - q.cx) < 2) { d = `M${p.cx} ${p.b + 1}V${q.t - 4}`; lx = p.cx + 7; ly = Math.max((p.b + q.t) / 2 + 3, q.t - 6); anchor = 'start'; }
    else { const mid = p.b + (q.t - p.b) / 2; d = `M${p.cx} ${p.b + 1}V${mid}H${q.cx}V${q.t - 4}`; lx = (p.cx + q.cx) / 2; ly = mid - 5; }
    return { id: `${a}-${b}`, a, b, d, label, lx, ly, anchor, actor };
  });
}
let flowObserver: ResizeObserver | undefined;
watch(flowGraph, el => { flowObserver?.disconnect(); if (el) { flowObserver = new ResizeObserver(() => drawEdges()); flowObserver.observe(el); nextTick(drawEdges); } });
onBeforeUnmount(() => flowObserver?.disconnect());
// 위쪽 요약: 누가 판단하고 누가 실행했는지, 지금 어디에 있는지.
const outcome = computed(() => {
  const sel = selected.value!, f = flow.value, item = sel.item;
  const routeName = item?.handlingRoute ? routeLabels[item.handlingRoute] : '';
  const res = (kind: FlowActor, heading: string, detail: string, route = routeName): { kind: FlowActor; heading: string; detail: string; route: string; icon: Component } => ({ kind, heading, detail, route, icon: kind === 'agent' ? Workflow : kind === 'human' ? UserCheck : ShieldCheck });
  if (!item) return sel.trace?.route === 'PASS'
    ? res('backend', '백엔드에서 통과', '판단: 백엔드 · 실행: 백엔드 · Agent 호출 없음 (목업 기록)', '필터 통과 (목업 기록)')
    : res('backend', '서버 경로 기록 없음', '사건 응답에 처리 경로가 없습니다. 공개 여부만으로 통과 경로라고 추정하지 않습니다.', '');
  if (f.current === 'kickReview' && f.state.kickReview === 'wait') return res('human', '강퇴 승인 대기', '확정 사건 3건 · 승인: 운영자 · 실행: 백엔드');
  if (item.confirmationStatus === 'CANCELLED') return res(isRule(item) ? 'backend' : 'agent', '오판 취소 · 다시 공개', '운영자가 근거를 취소했습니다. 남은 근거가 없어 공개합니다.');
  if (isRule(item)) return res('backend', '백엔드만으로 처리됨', '판단: 백엔드 규칙 · 실행: 백엔드 · Agent 호출 없음');
  const detail = item.handlingRoute === 'PII_INVESTIGATION' ? '판단: Agent · 검증: 백엔드 · 판단 보류면 운영자 결정' : '판단 제안: Agent · 결정: 운영자 · 실행: 백엔드';
  if (!sel.finding && sel.review) {
    const noAi = 'AI 결과 없음(마감 초과 또는 분석 실패) · 결정: 운영자 · 실행: 백엔드';
    if (sel.review.status === 'PENDING') return res('human', 'AI 결과 없음 · 운영자 결정 대기', noAi);
    return res('human', item.confirmationStatus === 'CONFIRMED_NORMAL' ? '운영자 정상 확정 · 공개 (AI 결과 없음)' : '운영자 위반 확정 · 숨김 (AI 결과 없음)', noAi);
  }
  if (!sel.finding) return res('agent', 'Agent 조사 중', detail);
  if (!sel.review && item.confirmationStatus === 'CONFIRMED_NORMAL') return res('agent', '개인정보 정상 · 가림 해제', '판단: Agent · 검증·해제: 백엔드 · 운영자 검토 없음');
  if (!sel.review && item.confirmationStatus === 'CONFIRMED_VIOLATION') return res('agent', '개인정보 위반 확정 · 숨김', '판단: Agent · 근거 검증·확정: 백엔드');
  if (f.current === 'wait') return res('human', 'AI 제안 · 운영자 결정 대기', detail);
  if (item.confirmationStatus === 'CONFIRMED_NORMAL') return res('agent', '운영자 정상 확정 · 공개', detail);
  if (item.confirmationStatus === 'CONFIRMED_VIOLATION') return res('agent', '운영자 위반 확정 · 숨김', detail);
  return res('agent', 'Agent 판단 완료', detail);
});
// 노드를 누르면 아래에 그 단계의 판단 내용 · 확인한 근거 · 상태와 실행 주체를 보여 준다.
// 거치지 않았거나 기록이 없는 단계는 역할 설명만 보이고, 사실 칸은 비운다.
const evidence = computed(() => {
  const sel = selected.value!, id = flowFocus.value, n = flowNodeOf(id), tone = nodeTone(id);
  const f = flow.value, index = f.steps.indexOf(id);
  const base = { id, title: n.title, actor: n.actor, index: index >= 0 ? index + 1 : null, tone, text: n.role, facts: [] as string[], tag: '', before: '', after: '', executor: '',
    tools: [] as AgentToolCall[], reasoning: [] as string[], answer: null as Finding | null };
  if (tone === 'skip' || tone === 'unknown') return base;
  const item = sel.item, review = sel.review, finding = sel.finding, trace = sel.trace, message = sel.message;
  const reviewIds = new Set(props.reviews.filter(r => item && r.caseId === item.caseId).map(r => r.reviewId));
  const events = props.logs.filter(l => item && (l.caseId === item.caseId || (!!l.reviewId && reviewIds.has(l.reviewId)))).sort((a, b) => toMs(a.time) - toMs(b.time));
  const at = (name: string, last = false) => { const l = last ? [...events].reverse().find(x => x.event === name) : events.find(x => x.event === name); return l ? asTime(l.time) : null; };
  const step = (title: string) => trace?.backend.filter(s => s.title === title) ?? [];
  const facts = base.facts, add = (v: string | null | undefined | false) => { if (v) facts.push(v); };
  const confirmedAt = item?.confirmedFindings.map(x => toMs(x.confirmedAt)).filter(t => !Number.isNaN(t)).sort((a, b) => a - b)[0];
  const revoked = item?.confirmedFindings.find(x => x.revokedAt);
  const cats = item ? item.confirmedFindings.map(x => categoryName(x.category)).join('·') : '';
  const routeCode = item?.handlingRoute ?? trace?.route ?? '';
  const hidden = item?.confirmationStatus === 'CANCELLED' ? '오판 취소 · 공개' : item ? ruleAction(item).label : '';
  const fill = (text: string, before: string, after: string, executor: string, tag = '') => Object.assign(base, { text, before, after, executor, tag });
  switch (id) {
    case 'input':
      add(`보낸 시각 ${asTime(message.sentAt)}`); add(`작성자 ${message.authorAlias}`);
      fill(n.role, '입력', '접수', '백엔드가 메시지를 접수합니다.', '채팅 500자 이내'); break;
    case 'classify': {
      for (const s of [...step('정규화'), ...step('사전 검사')]) add(`${s.title}: ${s.detail}`);
      add(`처리 시각 ${asTime(item?.createdAt ?? message.sentAt)}`);
      add(routeCode && `처리 경로 ${routeLabels[routeCode as keyof typeof routeLabels] ?? routeCode}`);
      const ai = !!item && !isRule(item), pass = routeCode === 'PASS';
      fill(pass ? '조사 신호가 없어 바로 공개합니다.' : ai ? '문맥 의심·개인정보 후보라 임시 비노출(HELD)하고 Agent 조사로 넘깁니다.' : '명확한 욕설·링크·도배 규칙과 일치해 Agent 호출 없이 처리합니다.',
        '접수', pass ? '공개' : ai ? '임시 비노출' : '위반 확정', pass ? '백엔드가 바로 공개합니다.' : ai ? '백엔드가 임시 비노출로 바꾸고 Agent 조사를 요청합니다.' : '판단·실행 모두 백엔드입니다. Agent는 호출하지 않습니다.', routeCode);
      break;
    }
    case 'public': add('Agent 미호출'); fill('조사 신호가 없어 공개합니다.', '접수', '공개', '백엔드가 공개합니다.', 'PASS · v3.2 §3'); break;
    case 'rule':
      add(cats && `위반 유형 ${cats}`); add(confirmedAt ? `확정 시각 ${asTime(confirmedAt)}` : null);
      fill(routeCode === 'FLOOD_REVIEW' ? '10초 안 같은 문장 세 번째부터 도배로 확정합니다.' : '명확한 욕설·링크 규칙과 일치해 위반으로 확정합니다. 인용·설명이어도 욕설은 적용합니다.', '접수', '위반 확정', '판단·실행 모두 백엔드 · Agent 호출 없음', routeCode); break;
    case 'agent':
      add(at('TOOL_START') && `조사 시작 ${at('TOOL_START')}`); add(at('TOOL_END', true) && `조사 완료 ${at('TOOL_END', true)}`); add(at('TASK_FAILED', true) && `조사 실패 ${at('TASK_FAILED', true)}`);
      if (!facts.length && finding) add('조사 시각은 이 화면을 연 뒤의 실시간 기록만 보입니다.');
      base.tools = trace?.agent?.tools.filter(t => t.name === 'get_chat_context' || t.name === 'get_user_history') ?? [];
      if (!finding && review) {
        add(`AI 결과 없이 검토 열림 ${asTime(review.createdAt)}`);
        for (const s2 of step('판정 마감 초과')) add(s2.detail);
        fill('AI 분석 결과를 받지 못했습니다. 판정이 마감(기본 3분) 안에 오지 않았거나 분석이 실패해, 백엔드가 AI 결과 없이 문맥 검토를 열었습니다.',
          '임시 비노출', '운영자 결정 대기', '백엔드가 AI 결과 없이 검토를 엽니다. 메시지는 계속 비공개이고, 결정은 백엔드가 바로 적용합니다.', 'A-25'); break;
      }
      fill(sel.investigating ? '조사 중입니다. 결과가 나오면 자동으로 보입니다.' : '가린 주변 채팅과 작성자의 이번 방송 이력을 불러와 표현의 뜻을 조사했습니다.',
        '임시 비노출', '임시 비노출', 'Agent가 조사합니다. 이 단계에서는 제재하지 않습니다.', 'SP-4.1 원문 마스킹'); break;
    case 'policy':
      add(finding && `AI 제안 ${verdictLabels[finding.verdict]} (${finding.verdict})`);
      add(finding && `적용 정책 ${finding.policyIds.join(', ') || '-'}`); add(finding && `위반 유형 ${finding.categories.map(categoryName).join('·') || '없음'}`);
      for (const m of finding?.missingFacts ?? []) add(`확인 필요: ${m}`);
      base.tools = trace?.agent?.tools.filter(t => t.name === 'search_policy' || t.name === 'get_policy_section') ?? [];
      base.reasoning = trace?.agent?.reasoning ?? []; base.answer = trace?.agent?.answer ?? null;
      fill(finding?.reason ?? n.role, '임시 비노출', '판정 제안', 'Agent는 판정과 근거만 냅니다. 제재·공개는 하지 않습니다.', finding?.policyIds.join(', ') || 'v3.2 §5'); break;
    case 'verify': {
      const pii = item?.handlingRoute === 'PII_INVESTIGATION';
      add(finding && `받은 판정 ${verdictLabels[finding.verdict]} (${finding.verdict})`);
      add(finding?.verdict === 'VIOLATION' && `위반 유형·정책 ID 있음 (${finding.policyIds.join(', ')})`);
      add(finding?.verdict === 'NEEDS_REVIEW' && `확인 필요 사실 ${finding.missingFacts.length}개 있음`);
      for (const s2 of step('판단·근거 검증')) add(s2.detail);
      const next = review ? '운영자 결정 대기' : item?.confirmationStatus === 'CONFIRMED_NORMAL' ? '가림 해제' : item?.confirmationStatus === 'CONFIRMED_VIOLATION' ? '위반 확정' : '검증 중';
      add(`결과: ${next}`);
      fill(pii ? '개인정보 경로: AI 조사 후 백엔드가 근거·정책을 검증합니다. v3.2는 실존·소유자 확인 없이 형태·노출 문맥으로 판단하며, 개인정보 단독 위반은 운영자 결정 없이 확정합니다. 정상은 가림 해제, 판단 보류·다른 유형 혼합은 운영자 검토입니다. v3.1 사건은 당시 기준을 유지합니다.' : '문맥 경로: AI 판정과 상관없이 운영자 결정으로 넘깁니다. AI 정상 판단만으로 공개하지 않습니다.',
        '임시 비노출', next, '백엔드가 검증하고 넘깁니다.', 'v3.2 §5'); break;
    }
    case 'wait': {
      add(review && `결정 요청 ${asTime(review.createdAt)}`);
      add(review && `검토 상태 ${reviewStatusLabels[review.status] ?? review.status} · 버전 ${review.version}`);
      // 보류는 검토 버전 숫자가 아니라 실제 보류 결정(REVIEW_DECIDED의 DEFER)으로 판단한다. 늦게 온 AI 판정도 버전을 올린다(A-25).
      const defers = events.filter(l => l.event === 'REVIEW_DECIDED' && /DEFER/.test(l.detail));
      if (defers.length) add(`보류 ${defers.length}회 · 같은 검토로 다시 결정 대기 (마지막 ${asTime(defers[defers.length - 1].time)})`);
      if (review && !finding) add('AI 결과 없음 · 운영자가 주변 문맥을 보고 직접 판단');
      for (const s of step('운영자 결정')) add(`${asTime(s.at)} ${s.detail}`);
      const decided = item?.confirmationStatus === 'CONFIRMED_NORMAL' ? '정상 확정' : item?.confirmationStatus === 'CONFIRMED_VIOLATION' || item?.confirmationStatus === 'CANCELLED' ? '위반 확정' : '결정 대기';
      fill('AI 제안은 참고용입니다. 운영자가 정상·위반·보류를 결정할 때까지 공개하지 않습니다. 보류는 공개 승인이 아닙니다.', '임시 비노출', decided, '운영자가 결정합니다. 위반 확정 전에는 확정 이력에 넣지 않습니다.', 'v3.2 §5'); break;
    }
    case 'sanction': {
      const byOperator = !!item && !isRule(item);
      add(cats && `위반 유형 ${cats}`); add(hidden && `조치 ${hidden}`); add(confirmedAt ? `확정 시각 ${asTime(confirmedAt)}` : null);
      add(revoked && `오판 취소 ${asTime(revoked.revokedAt)}`);
      fill(byOperator ? '운영자가 위반으로 확정해 숨기고 기준표의 제재를 적용합니다.' : '규칙 확정에 따라 숨기고 기준표의 제재를 적용합니다.',
        byOperator ? '임시 비노출' : '위반 확정', hidden, `판단: ${byOperator ? (review ? '운영자' : 'Agent · 백엔드 검증') : '백엔드 규칙'} · 실행: 백엔드`, 'v3.2 §6 제재표 (MP-2.1)'); break;
    }
    case 'normal':
      add(at('MESSAGE_RESTORED', true) && `공개 시각 ${at('MESSAGE_RESTORED', true)}`);
      for (const s of step('운영자 결정')) add(`${asTime(s.at)} ${s.detail}`);
      fill(review ? '운영자가 정상으로 확정해 다시 공개합니다.' : '개인정보 정상 판정을 백엔드가 검증해 가림을 풉니다.', '임시 비노출', '공개', review ? '결정: 운영자 · 공개 실행: 백엔드' : '판단: Agent · 검증·해제: 백엔드', 'v3.2 §4·§5'); break;
    case 'kickReview': {
      const k = kickReviewOf(item);
      add(k && `요청 시각 ${asTime(k.createdAt)}`); add(k && `기준 사건 ${k.basisCaseIds.length}건`); add(k && `상태 ${reviewStatusLabels[k.status] ?? k.status}`); add(k && kickStateOf(k));
      fill(n.role, '확정 통합 3건', !k ? '-' : k.status === 'PENDING' ? '승인 대기' : reviewStatusLabels[k.status] ?? k.status, '운영자가 승인·기각합니다. 기각해도 기존 숨김과 제한은 유지합니다.', 'v3.2 §8 (MP-4.1)'); break;
    }
    case 'kick': { const k = kickReviewOf(item); add(k && kickStateOf(k)); fill(n.role, '승인', '강퇴 적용', '승인: 운영자 · 재검증·실행: 백엔드', 'v3.2 §9·§10'); break; }
  }
  return base;
});
// 상태 변경 기록: 판단 주체와 실행 주체를 따로 적는다. 목업은 목업 처리 기록을, 실제 API는 사건·검토 응답과 화면을 연 뒤의 실시간 이벤트를 쓴다.
const clockText = (v: unknown) => { const t = toMs(v); return Number.isNaN(t) ? '-' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(t); };
const history = computed(() => {
  const sel = selected.value!, item = sel.item, trace = sel.trace;
  type Row = { at: number; time: string; actor: FlowActor; who: string; title: string; detail: string; exec: string };
  const rows: Row[] = [];
  const push = (when: unknown, actor: FlowActor, who: string, title: string, detail: string, exec: string) => { const t = toMs(when); if (!Number.isNaN(t)) rows.push({ at: t, time: clockText(when), actor, who, title, detail, exec }); };
  push(sel.message.sentAt, 'backend', '백엔드', '메시지 접수', '시청자 입력 → 접수', '백엔드 접수');
  const reviewIds = new Set(props.reviews.filter(r => item && r.caseId === item.caseId).map(r => r.reviewId));
  const events = props.logs.filter(l => item && (l.caseId === item.caseId || (!!l.reviewId && reviewIds.has(l.reviewId))));
  for (const l of trace ? [] : events) {
    if (l.event === 'TOOL_START') push(l.time, 'agent', 'Agent', '조사 시작', l.detail, '판단만 수행');
    if (l.event === 'TOOL_END') push(l.time, 'agent', 'Agent', '조사 완료 · 제안 전달', l.detail, '판단만 수행');
    if (l.event === 'TASK_FAILED') push(l.time, 'agent', 'Agent', '조사 실패', l.detail, '판단만 수행');
  }
  if (trace) {
    for (const s of trace.backend) {
      const human = s.title === '운영자 결정' || s.title === '오판 취소' || s.title.startsWith('제재 적용 (운영자');
      push(s.at, human ? 'human' : 'backend', human ? '운영자' : '백엔드', s.title, s.detail, human ? '운영자 결정 · 백엔드 실행' : s.code ?? '백엔드');
      if (s.title === 'Agent 조사 요청' && trace.agent) {
        push(s.at, 'agent', 'Agent', '조사 · 정책 확인', trace.agent.tools.map(t => t.name).join(' → '), '판단만 수행');
        push(s.at, 'agent', 'Agent', '판단 제안 전달', `${verdictLabels[trace.agent.answer.verdict]} (${trace.agent.answer.verdict})`, '판단만 수행');
      }
    }
  } else if (item) {
    push(item.createdAt, 'backend', '백엔드', '1차 분류 · 사건 생성', item.handlingRoute ? routeLabels[item.handlingRoute] : '-', '백엔드 분류');
    const review = sel.review;
    if (review) push(review.createdAt, 'human', '운영자 대기', '운영자 결정 요청', sel.finding ? `AI 제안 ${verdictLabels[sel.finding.verdict]}` : 'AI 결과 없음 (마감 초과 또는 분석 실패)', '결정 전 공개 안 함');
    for (const l of events) {
      if (l.event === 'REVIEW_DECIDED') push(l.time, 'human', '운영자', '운영자 결정', item.confirmationStatus === 'CONFIRMED_NORMAL' ? '정상 확정' : item.confirmationStatus === 'PENDING' ? '보류' : '위반 확정', '운영자 결정');
      if (l.event === 'MESSAGE_RESTORED') push(l.time, 'backend', '백엔드', '다시 공개', '임시 비노출 → 공개', '백엔드 실행');
    }
    for (const x of item.confirmedFindings) {
      push(x.confirmedAt, isRule(item) ? 'backend' : 'human', isRule(item) ? '백엔드 규칙' : '운영자 판단', '숨김 · 제재 적용', `${categoryName(x.category)} 확정 · ${ruleAction(item).label}`, '백엔드 실행');
      if (x.revokedAt) push(x.revokedAt, 'human', '운영자', '오판 취소', `${categoryName(x.category)} 근거 취소`, '백엔드 실행');
    }
  }
  const kick = kickReviewOf(item);
  if (kick && !trace) push(kick.createdAt, 'human', '운영자 대기', '강퇴 승인 요청', `기준 사건 ${kick.basisCaseIds.length}건`, '승인 전 실행 안 함');
  return rows.map((r, i) => ({ ...r, i })).sort((a, b) => a.at - b.at || a.i - b.i);
});

</script>

<template>
  <section class="tracking-grid">
              <div class="chat-panel card"><div class="panel-heading"><h2>실시간 채팅 <small class="tracking-channel">{{channelName}}</small></h2><div class="panel-heading-end"><button class="blocked-toggle" :class="{on: filter==='private'}" :aria-pressed="filter==='private'" @click="filter = filter==='all' ? 'private' : 'all'" :title="filter==='all' ? '임시 비노출·숨김 채팅만 보기' : '전체 채팅 보기'">비공개 채팅 <b>{{privateCount}}</b></button></div></div>
                <div class="scan-wrap"><span class="ai-scan" aria-hidden="true"/><div ref="chatRef" class="chat-list" @scroll.passive="onScroll">
                  <div v-for="m in shownMessages" :key="m.messageId" :data-message-id="m.messageId" class="chat-row" :class="{held: m.visibility==='HELD', hidden: m.visibility==='HIDDEN', selected: selectedId===m.messageId}" role="button" tabindex="0" :aria-pressed="selectedId===m.messageId" @click="selectMessage(m.messageId)" @keydown.enter.prevent="selectMessage(m.messageId)" @keydown.space.prevent="selectMessage(m.messageId)"><span class="chat-avatar" :style="{background: avatarColor(m.authorAlias)}">{{m.authorAlias.slice(0,1)}}</span><span class="chat-line"><b>{{m.authorAlias}}</b><span class="chat-text">{{m.text}}</span></span><span v-if="m.visibility!=='PUBLIC'" class="state-pill" :class="m.visibility.toLowerCase()">{{visibilityLabels[m.visibility]}}</span><time class="chat-time" :datetime="iso(m.sentAt)" :title="asTime(m.sentAt)">{{hourMinute(iso(m.sentAt))}}</time></div>
                  <div v-if="!shownMessages.length" class="empty-block">표시할 채팅이 없습니다.</div></div>
                  <button v-if="unread" class="new-msg-pill" @click="toBottom()">새 메시지 {{unread}}개 <ChevronDown :size="15"/></button></div>
                <div class="chat-footer"><div class="ai-notice"><ShieldCheck :size="15"/> 임시 비노출·숨김 채팅은 작성자와 담당 운영자에게만 보입니다.</div></div>
              </div>
              <aside class="chat-detail card" aria-label="채팅 상세">
                <div class="panel-heading"><h2>채팅 상세</h2><button v-if="selected" type="button" class="icon-control" title="닫기" aria-label="채팅 상세 닫기" @click="selectedId=null">✕</button></div>
                <p v-if="!selected" class="chat-detail-empty">채팅을 누르면 그 채팅이 어떻게 처리됐는지, AI Agent가 어떻게 판단했는지 볼 수 있습니다.</p>
                <div v-else class="chat-detail-body flow-detail">
                  <div class="flow-main">
                  <div class="chat-row detail-message" :class="{held: selected.message.visibility==='HELD', hidden: selected.message.visibility==='HIDDEN'}"><span class="chat-avatar" :style="{background: avatarColor(selected.message.authorAlias)}">{{selected.message.authorAlias.slice(0,1)}}</span><span class="chat-line"><b>{{selected.message.authorAlias}}</b><span class="chat-text">{{selected.message.text}}</span></span><span v-if="selected.message.visibility!=='PUBLIC'" class="state-pill" :class="selected.message.visibility.toLowerCase()">{{visibilityLabels[selected.message.visibility]}}</span><time class="chat-time" :datetime="iso(selected.message.sentAt)" :title="asTime(selected.message.sentAt)">{{hourMinute(iso(selected.message.sentAt))}}</time></div>
                  <div class="flow-outcome" :class="outcome.kind" data-flow-outcome aria-live="polite">
                    <span class="outcome-symbol"><component :is="outcome.icon" :size="17"/></span>
                    <div class="outcome-text"><strong>{{outcome.heading}}</strong><p>{{outcome.detail}}</p>
                      <div class="outcome-tags"><span v-if="outcome.route" class="route-name">{{outcome.route}}</span><span v-if="selected.finding" class="verdict-badge" :class="verdictTone(selected.finding.verdict)">AI 제안 · {{verdictLabels[selected.finding.verdict]}}</span><span v-if="selected.state" class="case-state" :class="selected.state.tone">{{selected.state.label}}</span></div></div>
                    <span class="outcome-state">현재 {{visibilityLabels[selected.message.visibility]}}</span>
                  </div>
                  <section class="flow-evidence" data-flow-evidence aria-live="polite">
                    <div class="flow-section-head"><div><span class="eyebrow">WHY THIS DECISION?</span><h3>단계별 판단 근거</h3></div><span class="flow-badge" :class="evidence.actor">{{evidence.actor==='agent' ? 'Agent 판단' : evidence.actor==='human' ? '운영자 결정' : '백엔드 처리'}}</span></div>
                    <div class="evidence-stage"><span class="stage-index">{{evidence.index ? String(evidence.index).padStart(2,'0') : '—'}}</span>{{evidence.title}}</div>
                    <p v-if="evidence.tone==='skip'" class="not-visited">이 채팅은 이 단계를 거치지 않았습니다. 아래는 이 단계의 역할 설명입니다.</p>
                    <p v-else-if="evidence.tone==='unknown'" class="not-visited">서버에 이 단계의 기록이 아직 없습니다. 추정해서 채우지 않습니다.</p>
                    <p v-else-if="evidence.tone==='later'" class="not-visited">재생 중 · 아직 보여 주지 않은 단계입니다.</p>
                    <div class="evidence-grid">
                      <div class="evidence-section"><h4><Search :size="12"/> 판단 내용</h4><p>{{evidence.text}}</p><span v-if="evidence.tag" class="code-tag">{{evidence.tag}}</span></div>
                      <div class="evidence-section"><h4><FileText :size="12"/> 확인한 근거</h4><ul v-if="evidence.facts.length"><li v-for="fact in evidence.facts" :key="fact">{{fact}}</li></ul><p v-else class="evidence-empty">기록 없음</p></div>
                      <div class="evidence-section"><h4><History :size="12"/> 상태와 실행 주체</h4><div v-if="evidence.before" class="state-change"><span>{{evidence.before}}</span><b>→</b><span class="new-state">{{evidence.after}}</span></div><p>{{evidence.executor || '-'}}</p></div>
                    </div>
                    <div v-if="evidence.tools.length || evidence.reasoning.length" class="flow-mock" data-mock-trace>
                      <p class="trace-note"><span class="mock-tag">목업</span> 실제 Agent는 판단 과정을 보내지 않고 결과(제안·이유·정책·확인 필요)만 보냅니다. 아래는 시연용 예시입니다.</p>
                      <template v-if="evidence.tools.length"><h4>도구 호출</h4><ol class="trace-tools"><li v-for="(t, i) in evidence.tools" :key="i"><code>{{t.name}}</code><span>{{t.input}}</span><small>→ {{t.output}}</small></li></ol></template>
                      <template v-if="evidence.reasoning.length"><h4>판단 과정</h4><ol class="trace-reasoning"><li v-for="(r, i) in evidence.reasoning" :key="i">{{r}}</li></ol></template>
                      <template v-if="evidence.answer"><h4>최종 답변</h4><pre class="trace-answer">{{JSON.stringify(evidence.answer, null, 2)}}</pre></template>
                    </div>
                  </section>
                  <section class="flow-history" data-flow-history>
                    <div class="flow-section-head"><h3><History :size="15"/> 상태 변경 기록</h3><span>판단 주체와 실행 주체를 따로 기록합니다</span></div>
                    <div v-for="r in history" :key="r.i" class="history-row"><time class="history-time">{{r.time}}</time><span class="flow-badge" :class="r.actor">{{r.who}}</span><div class="history-content"><strong>{{r.title}}</strong><span>{{r.detail}}</span></div><span class="history-executor">{{r.exec}}</span></div>
                    <p v-if="!history.length" class="evidence-empty">기록이 없습니다.</p>
                  </section>
                  </div>
                  <div class="flow-side">
                  <div class="flow-toolbar">
                    <div class="flow-legend"><span><i class="dot backend"/>백엔드</span><span><i class="dot agent"/>Agent</span><span><i class="dot human"/>운영자</span><span><i class="dot inactive"/>미통과</span><span><i class="dot unknown"/>기록 없음</span></div>
                    <div class="flow-controls"><span class="step-counter">{{String(flowShown).padStart(2,'0')}} / {{String(flow.steps.length).padStart(2,'0')}} 단계</span><button type="button" class="play-button" @click="togglePlay"><Pause v-if="flowPlaying" :size="12"/><Play v-else :size="12"/>{{flowPlaying ? '일시 정지' : '경로 재생'}}</button><button type="button" class="flow-icon-button" title="다음 단계" aria-label="다음 단계" :disabled="flowProgress===null" @click="stopFlow(); stepFlow()"><SkipForward :size="14"/></button></div>
                  </div>
                  <div ref="flowGraph" class="flow-graph" role="group" aria-label="채팅 판정 분기 그래프. 이 채팅이 실제로 거친 경로를 색으로 표시">
                    <svg class="flow-edges" aria-hidden="true">
                      <defs><marker v-for="m in ['backend','agent','human','off']" :key="m" :id="'flow-arrow-' + m" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 6 3 0 6" :class="'arrow-' + m"/></marker></defs>
                      <g v-for="e in edgePaths" :key="e.id" class="flow-edge" :class="[e.actor, edgeTone(e.a, e.b)]" :data-flow-edge="e.id"><path :d="e.d" :marker-end="`url(#flow-arrow-${edgeTone(e.a, e.b)==='path' ? e.actor : 'off'})`"/><text v-if="e.label" :x="e.lx" :y="e.ly" :text-anchor="e.anchor">{{e.label}}</text></g>
                    </svg>
                    <div class="lane-label backend-lane">BACKEND <span>빠른 분류와 실행</span></div><div class="lane-label agent-lane">AGENT · 운영자 <span>조사 · 검증 · 결정</span></div>
                    <button v-for="n in flowNodes" :key="n.id" type="button" class="flow-node" :class="[n.actor, nodeTone(n.id), {selected: flowFocus===n.id, current: flow.current===n.id && nodeTone(n.id)!=='later'}]" :data-flow-node="n.id" :style="{'--col': n.col, '--top': n.top + 'px'}" :aria-pressed="flowFocus===n.id" :aria-label="`${n.title}, ${actorText[n.actor]}, ${nodeToneText[nodeTone(n.id)]}`" @click="flowChosen=n.id"><span class="node-icon"><component :is="n.icon" :size="14"/></span><span class="node-copy"><span class="node-type">{{n.tag}}</span><strong>{{n.title}}</strong><small>{{n.sub}}</small></span></button>
                  </div>
                  <ol class="flow-mobile-path" aria-label="이 채팅이 거친 단계"><li v-for="(id, i) in flow.steps" :key="id"><button type="button" class="flow-node" :class="[flowNodeOf(id).actor, nodeTone(id), {selected: flowFocus===id}]" :aria-pressed="flowFocus===id" @click="flowChosen=id"><span class="node-copy"><span class="node-type">{{String(i + 1).padStart(2,'0')}} · {{flowNodeOf(id).tag}}</span><strong>{{flowNodeOf(id).title}}</strong><small>{{flowNodeOf(id).sub}}</small></span></button></li></ol>
                  <p class="flow-footnote">색이 채워진 노드와 선이 서버 기록으로 실제 거친 경로입니다. 기록이 없는 단계는 점선으로 두고 추정해서 칠하지 않습니다.</p>
                  </div>
                </div>
              </aside>
  </section>
</template>
