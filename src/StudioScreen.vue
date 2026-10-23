<script setup lang="ts">
// 운영자(스트리머) Studio 화면. 목업과 실제 API가 같은 화면을 쓴다(#12).
// 화면은 API v1.0 모양의 데이터와 사용자 동작만 다룬다. API·SSE 연결은 LiveConsole.vue, 목업 판정은 mockLive.ts가 맡는다.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { AlertCircle, Ban, BookOpen, ChevronDown, ChevronRight, ClipboardCheck, Eye, EyeOff, FileClock, FileText, History, LogOut, Menu, MessageSquare, MessagesSquare, Pause, Play, Radio, RefreshCcw, ScrollText, Search, ShieldCheck, SkipForward, Sparkles, Split, UserCheck, Users, UserX, Workflow } from 'lucide-vue-next';
import type { Component } from 'vue';
import ViewerManage from './ViewerManage.vue';
import AiEvidence from './AiEvidence.vue';
import { groupByViewer, type ViewerCase, type ViewerFinding, type ViewerReview } from './viewerManage';
import { avatarColor } from './avatar';
import { clockText as hourMinute, dateTimeText } from './chatTime';
import {
  categoryLabels, confirmationLabels, reviewStatusLabels, routeLabels, verdictLabels, visibilityLabels,
  type Category, type ContextDecision, type Finding, type KickDecision, type Live, type LiveCase, type LiveReview, type Message, type Verdict
} from './contracts';
import { KICK_THRESHOLD, priorColumns, routeRows, sanctionFor, sanctionLabel, sanctionTable, type Sanction } from './sanction';
import { filterDictionary } from './mock';

import type { AgentToolCall, MockTrace } from './mockLive';
export interface StudioLog { id: string; time: string; event: string; detail: string; caseId?: string; reviewId?: string }
type Page = 'monitor' | 'reviews' | 'viewers' | 'cases' | 'chats' | 'policy';

const props = withDefaults(defineProps<{
  mock?: boolean; nickname: string; channelName?: string;
  live: Live | null; ended?: boolean; loading?: boolean; online?: boolean;
  // 운영자는 HELD·HIDDEN 원문을 받는다. 오래된 순서.
  messages: Message[]; reviews: LiveReview[]; cases: LiveCase[];
  // 사건 ID → 시청자 이름. 사건·검토 응답은 작성자를 U1로 가려서 호출자가 채팅 이력으로 찾는다.
  caseNames: Record<string, string>;
  // 실시간 이벤트 기록. 화면에 따로 보여 주지 않고 사건 처리 흐름의 시각을 채우는 데 쓴다.
  logs: StudioLog[]; kickProgress: Record<string, string>;
  // 채팅 기록 페이지: 이전 페이지까지 불러온 채팅. 없으면 messages를 쓴다(목업).
  archive?: Message[] | null; archiveMore?: boolean; archiveLoading?: boolean;
  busy?: boolean; error?: string; notice?: string; feedOn?: boolean | null;
  // 목업 전용 채팅별 처리 기록(백엔드 처리·AI 판단 과정). 실제 API에는 없다.
  traces?: Record<string, MockTrace> | null;
}>(), { traces: null, mock: false, channelName: '내 채널', ended: false, loading: false, online: false, busy: false, error: '', notice: '', feedOn: null, archive: null, archiveMore: false, archiveLoading: false });
const emit = defineEmits<{
  decide: [review: LiveReview, value: ContextDecision | KickDecision, reason: string, categories: Category[]];
  revoke: [caseId: string, findingId: string, reason: string];
  page: [page: Page]; refresh: []; start: []; end: []; logout: []; toggleFeed: []; loadOlder: [];
}>();

const page = ref<Page>('monitor');
const pageTitles: Record<Page, string> = { monitor: '실시간 관제', reviews: '결정 대기', viewers: '시청자 관리', cases: '사건 이력', chats: '채팅 기록', policy: '정책 근거' };
function goto(p: Page) { page.value = p; navOpen.value = false; emit('page', p); }

// 메뉴: 넓은 화면에서는 왼쪽에 고정하고 ☰로 접고 편다. 좁은 화면에서는 ☰로 여닫는 서랍이다.
const navOpen = ref(false), navCollapsed = ref(false);
const wideQuery = window.matchMedia('(min-width: 1100px)');
const wide = ref(wideQuery.matches);
const onWide = (e: MediaQueryListEvent) => { wide.value = e.matches; navOpen.value = false; };
const navVisible = computed(() => wide.value ? !navCollapsed.value : navOpen.value);
function toggleNav() { if (wide.value) navCollapsed.value = !navCollapsed.value; else navOpen.value = !navOpen.value; }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') navOpen.value = false; }
onMounted(() => { window.addEventListener('keydown', onKey); wideQuery.addEventListener('change', onWide); });
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); wideQuery.removeEventListener('change', onWide); });

const iso = (v: unknown) => typeof v === 'number' ? new Date(v).toISOString() : String(v ?? '');
const asTime = (v: unknown) => dateTimeText(iso(v) || null);
const nameOf = (caseId: string) => props.caseNames[caseId] ?? `작성자 미확인 · 사건 ${caseId.slice(0, 8)}`;
const caseById = computed(() => new Map(props.cases.map(c => [c.caseId, c])));
const verdictTone = (v?: Verdict) => ({ VIOLATION: 'violation', NO_VIOLATION: 'clear', NEEDS_REVIEW: 'review' } as Record<string, string>)[v ?? ''] ?? 'pending';
const categoryName = (c: string) => categoryLabels[c as Category] ?? c;
const targetText = (c: { messages: { messageId: string; text: string }[]; targetMessageIds: string[] }) => c.messages.find(m => c.targetMessageIds.includes(m.messageId))?.text ?? null;
// 검토 대상 메시지를 보낸 시각. 검토가 만들어진 시각(createdAt)은 AI 조사 뒤라 더 늦다.
const sentAt = (c: { messages: { messageId: string; sentAt: string }[]; targetMessageIds: string[] }) => c.messages.find(m => c.targetMessageIds.includes(m.messageId))?.sentAt ?? null;
const activeCategories = (c: LiveCase) => c.confirmedFindings.filter(f => f.status === 'CONFIRMED').map(f => f.category);

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

// 운영자 결정 대기: 강퇴 승인 → 문맥 검토, 각각 오래 기다린 순서
const pending = computed(() => props.reviews.filter(r => r.status === 'PENDING')
  .sort((a, b) => Number(b.kind === 'KICK') - Number(a.kind === 'KICK') || Date.parse(iso(a.createdAt)) - Date.parse(iso(b.createdAt))));
// 같은 시청자가 같은 문장을 보낸 다른 사건. 문장이 같으면 이미 결정한 검토가 다시 열린 것처럼 보이므로 함께 보여 준다.
const sameText = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim();
function repeatsOf(r: LiveReview) {
  const name = nameOf(r.caseId), text = sameText(targetText(r));
  if (!text) return [];
  return props.cases.filter(c => c.caseId !== r.caseId && nameOf(c.caseId) === name && sameText(targetText(c)) === text)
    .sort((a, b) => Date.parse(iso(sentAt(a) ?? a.createdAt)) - Date.parse(iso(sentAt(b) ?? b.createdAt)))
    .map(c => {
      const open = props.reviews.some(x => x.status === 'PENDING' && x.kind === 'CONTEXT' && x.caseId === c.caseId);
      return { caseId: c.caseId, time: asTime(sentAt(c) ?? c.createdAt), status: open ? '결정 대기' : confirmationLabels[c.confirmationStatus] ?? c.confirmationStatus };
    });
}
const reasons = reactive<Record<string, string>>({});
const picked = reactive<Record<string, Category[]>>({});
// 검토 응답에 근거가 없으면 같은 사건에 저장된 AI 판정을 사용한다.
const findingsOf = (r: LiveReview) => r.findings.length ? r.findings : caseById.value.get(r.caseId)?.findings ?? [];
const categoriesOf = (r: LiveReview) => picked[r.reviewId] ?? [...new Set(findingsOf(r).flatMap(f => f.categories))];
function toggleCategory(r: LiveReview, c: Category, on: boolean) { const now = categoriesOf(r); picked[r.reviewId] = on ? [...new Set([...now, c])] : now.filter(x => x !== c); }
const reasonOf = (id: string) => (reasons[id] ?? '').trim();
// 결정 대기는 강퇴 승인과 문맥 검토를 따로 보여 준다(정책상 별개의 결정).
// 영역마다 한 줄 목록이고, 고른 건 하나만 펼친다. 처음에는 영역의 맨 위(오래 기다린) 건을 펼친다.
const queues = computed(() => [
  { kind: 'KICK' as const, title: '강퇴 승인 대기', note: `유형과 관계없이 확정 위반 ${KICK_THRESHOLD}건이 쌓인 시청자입니다. 승인해도 기준 사건을 다시 확인한 뒤 실행됩니다.`, empty: '강퇴 승인 요청이 없습니다.', items: pending.value.filter(r => r.kind === 'KICK') },
  { kind: 'CONTEXT' as const, title: '문맥 검토 대기', note: 'AI 제안은 참고용입니다. 공개 여부는 운영자가 결정합니다.', empty: '문맥 검토할 채팅이 없습니다.', items: pending.value.filter(r => r.kind === 'CONTEXT') }
]);
const openIds = reactive<Record<LiveReview['kind'], string | null>>({ KICK: null, CONTEXT: null }); // '' = 모두 접음
function activeOf(kind: LiveReview['kind']) {
  const items = pending.value.filter(r => r.kind === kind), id = openIds[kind];
  return id === '' ? null : (items.find(r => r.reviewId === id) ?? items[0])?.reviewId ?? null;
}
const isOpen = (r: LiveReview) => activeOf(r.kind) === r.reviewId;
// 두 대기열은 탭으로 나눈다. 처음에는 강퇴 요청이 있으면 강퇴 탭, 없으면 문맥 탭을 보여 주고, 그다음부터는 고른 탭을 유지한다.
const queueTab = ref<LiveReview['kind'] | null>(null);
const shownQueue = computed(() => { const kind = queueTab.value ?? (queues.value[0].items.length ? 'KICK' : 'CONTEXT'); return queues.value.find(q => q.kind === kind)!; });
function toggleReview(r: LiveReview) { openIds[r.kind] = isOpen(r) ? '' : r.reviewId; }
// 결정은 하나를 고른 뒤 제출한다. 위반 확정을 고를 때만 위반 유형을 고른다.
const choice = reactive<Record<string, ContextDecision | KickDecision>>({});
const contextChoices: { value: ContextDecision; label: string }[] = [{ value: 'CONFIRM_NORMAL', label: '정상 확정' }, { value: 'CONFIRM_VIOLATION', label: '위반 확정' }, { value: 'DEFER', label: '보류' }];
const kickChoices: { value: KickDecision; label: string }[] = [{ value: 'APPROVE', label: '강퇴 승인' }, { value: 'REJECT', label: '강퇴 기각' }];
const canSubmit = (r: LiveReview) => !props.busy && !props.ended && !!choice[r.reviewId] && !!reasonOf(r.reviewId) && (choice[r.reviewId] !== 'CONFIRM_VIOLATION' || categoriesOf(r).length > 0);
function submit(r: LiveReview) {
  const value = choice[r.reviewId], reason = reasonOf(r.reviewId);
  if (!value || !reason) return;
  emit('decide', r, value, reason, value === 'CONFIRM_VIOLATION' ? categoriesOf(r) : []);
}
const excerptOf = (r: LiveReview) => r.kind === 'KICK' ? `확정 사건 ${r.basisCaseIds.length}건` : targetText(r) ?? '';
// 결정이 반영되어 대기 목록에서 빠지면 입력값을 지운다.
watch(() => pending.value.map(r => r.reviewId), ids => { for (const id of new Set([...Object.keys(reasons), ...Object.keys(choice)])) if (!ids.includes(id)) { delete reasons[id]; delete picked[id]; delete choice[id]; } });
const basisCases = (r: LiveReview) => r.basisCaseIds.map(id => ({ id, item: caseById.value.get(id) }));
// 결정 이후의 강퇴 처리 상태(접수 → 적용 완료·실패·확인 중). 최근 결정이 위에 온다.
// 기준 사건이 오판 취소되거나 재검증에서 탈락하면 검토가 무효(INVALIDATED)가 되고, 적용된 강퇴도 풀린다.
function kickStateOf(r: LiveReview) {
  const state = props.kickProgress[r.reviewId];
  if (!state || r.status !== 'INVALIDATED' || /^(근거 취소|재검증 탈락)/.test(state)) return state;
  return state.startsWith('강퇴 적용 완료') ? '근거 취소 · 강퇴 해제' : '무효 · 강퇴하지 않음';
}
const kickStates = computed(() => props.reviews.filter(r => r.kind === 'KICK' && props.kickProgress[r.reviewId])
  .map(r => ({ review: r, state: kickStateOf(r) })).reverse());

// 확정 사건의 조치. 같은 시청자의 이전 확정 수로 기준표에서 계산한다.
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

// 사건 하나의 처리 흐름: 채팅 → 사건 생성 → AI 조사 → AI 판정 → 운영자 결정 → 조치 (→ 강퇴 심사).
// 서버 응답에 남는 정보(보낸 시각·사건 생성·AI 판정·확정 상태와 시각)는 항상 보인다.
// AI 조사 시작·완료와 운영자 결정 시각은 실시간 이벤트에만 있어, 이 화면을 연 뒤의 일만 시각이 보인다(감사 로그 API 없음).
type FlowTone = 'done' | 'wait' | 'skip';
interface FlowStep { label: string; time: string | null; detail: string; tone: FlowTone }
const isRule = (c: LiveCase) => c.handlingRoute === 'RULE_CONFIRMED' || c.handlingRoute === 'FLOOD_REVIEW';
const toMs = (v: unknown) => Date.parse(iso(v));
function flowOf(c: LiveCase): FlowStep[] {
  const reviewIds = new Set(props.reviews.filter(r => r.caseId === c.caseId).map(r => r.reviewId));
  const events = props.logs.filter(l => l.caseId === c.caseId || (!!l.reviewId && reviewIds.has(l.reviewId))).sort((a, b) => toMs(a.time) - toMs(b.time));
  const first = (name: string) => events.find(l => l.event === name);
  const last = (name: string) => [...events].reverse().find(l => l.event === name);
  const at = (l?: StudioLog) => l ? asTime(l.time) : null;
  const review = props.reviews.find(r => r.kind === 'CONTEXT' && r.caseId === c.caseId);
  const finding = c.findings?.[0] ?? review?.findings[0];
  const confirmed = c.confirmedFindings.map(f => toMs(f.confirmedAt)).filter(t => !Number.isNaN(t)).sort((a, b) => a - b)[0];
  const revoked = c.confirmedFindings.map(f => toMs(f.revokedAt)).filter(t => !Number.isNaN(t)).sort((a, b) => b - a)[0];
  const steps: FlowStep[] = [
    { label: '채팅', time: asTime(sentAt(c) ?? c.createdAt), detail: targetText(c) ?? '원문 없음', tone: 'done' },
    { label: '사건 생성', time: asTime(c.createdAt), detail: c.handlingRoute ? routeLabels[c.handlingRoute] : '-', tone: 'done' }
  ];
  if (isRule(c)) {
    steps.push({ label: 'AI 조사', time: null, detail: '없음 · Backend 규칙으로 바로 확정', tone: 'skip' });
    steps.push({ label: '운영자 결정', time: null, detail: '없음 · 규칙 확정은 사람이 결정하지 않습니다', tone: 'skip' });
  } else {
    const start = first('TOOL_START'), end = last('TOOL_END'), failed = last('TASK_FAILED');
    if (failed && !finding) steps.push({ label: 'AI 조사', time: at(failed), detail: 'AI 조사 실패', tone: 'wait' });
    else if (finding) steps.push({ label: 'AI 조사', time: at(end) ?? at(start), detail: start || end ? `시작 ${at(start) ?? '-'} → 완료 ${at(end) ?? '-'}` : '완료 (시각은 이 화면을 연 뒤의 기록만 보입니다)', tone: 'done' });
    else steps.push({ label: 'AI 조사', time: at(start), detail: '조사 중', tone: 'wait' });
    steps.push(finding
      ? { label: 'AI 판정', time: null, detail: `${verdictLabels[finding.verdict]} (${finding.verdict}) · ${finding.reason}${finding.policyIds.length ? ` · 정책 ${finding.policyIds.join(', ')}` : ''}`, tone: 'done' }
      : { label: 'AI 판정', time: null, detail: '판정 대기', tone: 'wait' });
    const decided = last('REVIEW_DECIDED');
    if (review?.status === 'PENDING' || c.confirmationStatus === 'PENDING') steps.push({ label: '운영자 결정', time: null, detail: decided ? `보류됨 (${at(decided)}) · 다시 결정 대기` : '결정 대기', tone: 'wait' });
    else steps.push({ label: '운영자 결정', time: at(decided), detail: c.confirmationStatus === 'CONFIRMED_NORMAL' ? '정상 확정' : '위반 확정', tone: 'done' });
  }
  if (c.confirmationStatus === 'CONFIRMED_VIOLATION') steps.push({ label: '조치', time: confirmed ? asTime(confirmed) : null, detail: ruleAction(c).label, tone: 'done' });
  else if (c.confirmationStatus === 'CONFIRMED_NORMAL') steps.push({ label: '조치', time: at(last('MESSAGE_RESTORED')), detail: '공개', tone: 'done' });
  else if (c.confirmationStatus === 'CANCELLED') steps.push({ label: '조치', time: revoked ? asTime(revoked) : null, detail: '오판 취소 · 숨김 해제', tone: 'done' });
  else steps.push({ label: '조치', time: null, detail: '임시 비노출 유지', tone: 'wait' });
  for (const k of props.reviews.filter(r => r.kind === 'KICK' && r.basisCaseIds.includes(c.caseId))) {
    const state = kickStateOf(k);
    steps.push({ label: '강퇴 심사', time: asTime(k.createdAt), detail: `기준 사건 ${k.basisCaseIds.length}건 중 하나 · ${reviewStatusLabels[k.status] ?? k.status}${state ? ` · ${state}` : ''}`, tone: k.status === 'PENDING' ? 'wait' : 'done' });
  }
  return steps;
}
const openCase = ref<string | null>(null);
function toggleCase(id: string) { openCase.value = openCase.value === id ? null : id; }
function showFlow(caseId: string) { openCase.value = caseId; caseTab.value = 'cases'; caseFilter.value = 'ALL'; goto('cases'); }
// 사건 이력: '사건'과 '검토 기록'을 탭으로 나누고, 사건은 상태로 걸러 본다.
type CaseFilter = 'ALL' | 'PENDING' | 'VIOLATION' | 'RULE' | 'CLEARED';
const caseTab = ref<'cases' | 'reviews'>('cases');
const caseFilter = ref<CaseFilter>('ALL');
const caseFilters: { key: CaseFilter; label: string; match: (c: LiveCase) => boolean }[] = [
  { key: 'ALL', label: '전체', match: () => true },
  { key: 'PENDING', label: '결정 대기', match: c => c.confirmationStatus === 'PENDING' },
  { key: 'VIOLATION', label: '위반 확정', match: c => c.confirmationStatus === 'CONFIRMED_VIOLATION' },
  { key: 'RULE', label: '규칙 자동 숨김', match: c => isRule(c) },
  { key: 'CLEARED', label: '정상·취소', match: c => c.confirmationStatus === 'CONFIRMED_NORMAL' || c.confirmationStatus === 'CANCELLED' }
];
const shownCases = computed(() => { const f = caseFilters.find(x => x.key === caseFilter.value)!; return casesByTime.value.filter(f.match); });
const caseCount = (key: CaseFilter) => casesByTime.value.filter(caseFilters.find(x => x.key === key)!.match).length;
// 사건 한 줄의 상태. 확정된 사건은 조치까지 함께 보여 준다.
function caseStateOf(c: LiveCase): { label: string; tone: string } {
  if (c.confirmationStatus === 'CONFIRMED_VIOLATION') return { label: `위반 확정 · ${ruleAction(c).label}`, tone: 'violation' };
  if (c.confirmationStatus === 'CONFIRMED_NORMAL') return { label: '정상 확정 · 공개', tone: 'clear' };
  if (c.confirmationStatus === 'CANCELLED') return { label: '오판 취소', tone: 'cancelled' };
  return { label: c.findings?.length ? '결정 대기' : 'AI 조사 중', tone: 'pending' };
}
// 강퇴 카드의 기준 사건별 근거. 고정 요약 문구 대신 사건마다 AI 판단 이유를 보여 준다.
function basisReason(c: LiveCase) {
  if (isRule(c)) return '규칙 자동 확정 · AI 조사 없음';
  const f = c.findings?.[0];
  return f ? `AI ${verdictLabels[f.verdict]} · ${f.reason}` : 'AI 판단 정보 없음';
}

// 채팅 기록: 이번 방송의 모든 채팅(숨김·검토 중 포함). 최신 채팅 목록이 이전 페이지보다 새 상태이므로 같은 메시지는 최신 목록 것을 쓴다.
type ChatFilter = 'ALL' | 'PUBLIC' | 'PRIVATE' | 'CASE';
const chatQuery = ref(''), chatFilter = ref<ChatFilter>('ALL');
const caseByMessage = computed(() => { const out = new Map<string, LiveCase>(); for (const c of props.cases) for (const id of c.targetMessageIds) out.set(id, c); return out; });
const chatRows = computed(() => {
  const all = new Map<string, Message>();
  for (const m of props.archive ?? []) all.set(m.messageId, m);
  for (const m of props.messages) all.set(m.messageId, m);
  return [...all.values()].sort((a, b) => toMs(b.sentAt) - toMs(a.sentAt));
});
const chatFilters: { key: ChatFilter; label: string; match: (m: Message) => boolean }[] = [
  { key: 'ALL', label: '전체', match: () => true },
  { key: 'PUBLIC', label: '공개', match: m => m.visibility === 'PUBLIC' },
  { key: 'PRIVATE', label: '비공개', match: m => m.visibility !== 'PUBLIC' },
  { key: 'CASE', label: '사건 있음', match: m => caseByMessage.value.has(m.messageId) }
];
const chatCount = (key: ChatFilter) => chatRows.value.filter(chatFilters.find(x => x.key === key)!.match).length;
const shownChats = computed(() => {
  const f = chatFilters.find(x => x.key === chatFilter.value)!, q = chatQuery.value.trim();
  return chatRows.value.filter(m => f.match(m) && (!q || m.text.includes(q) || m.authorAlias.includes(q)));
});

// 채팅 상세: 실시간 관제에서 채팅 한 줄을 누르면 오른쪽 칸에 처리 경로와 AI Agent 판단을 보여 준다.
// AI Agent는 Backend가 문맥 검토·개인정보 조사로 보낸 채팅만 판단한다. 그 밖의 채팅은 Backend 필터 결과만 있고, 없는 AI 판단을 만들어 보여 주지 않는다.
// 사건·검토·실시간 기록이 갱신되면 패널도 그대로 따라 바뀐다.
const selectedId = ref<string | null>(null);
const selected = computed(() => {
  const id = selectedId.value; if (!id) return null;
  const message = props.messages.find(m => m.messageId === id) ?? (props.archive ?? []).find(m => m.messageId === id) ?? null;
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
// 단계와 역할은 정책 v3.1(POLICY.md §1·§3·§5·§6·§8)과 Backend 구현(LiveModerationService.judgment)을 따른다.
const flowNodes: FlowNode[] = [
  { id: 'input', title: '채팅 접수', sub: '메시지 접수', actor: 'backend', tag: 'INPUT', icon: MessageSquare, col: 1, top: 4, role: '시청자 메시지를 접수하고 방송·작성자 정보를 연결합니다.' },
  { id: 'classify', title: '백엔드 1차 분류', sub: 'PASS · HOLD · FLOOD', actor: 'backend', tag: 'BACKEND', icon: Split, col: 1, top: 84, role: '정규화한 문장을 사전과 규칙으로 검사해 처리 경로(통과·규칙 확정·문맥 검토·개인정보 조사·도배)를 정합니다. 일반 시청자에게 원문을 먼저 공개하지 않습니다. (v3.1 §3)' },
  { id: 'public', title: '공개 유지', sub: 'PASS · Agent 미호출', actor: 'backend', tag: 'PASS', icon: Eye, col: 0, top: 184, role: '조사 신호가 없어 공개합니다. Agent는 호출하지 않습니다. (v3.1 §3)' },
  { id: 'rule', title: '규칙 확정', sub: '명확한 욕설 · 링크 · 도배', actor: 'backend', tag: 'BACKEND', icon: ScrollText, col: 1, top: 184, role: '명확한 욕설과 링크는 BE 규칙으로 위반을 확정합니다. 도배는 10초 안 같은 문장 세 번째부터입니다. AI 조사는 없습니다. (v3.1 §1·§2·§7)' },
  { id: 'agent', title: '문맥·개인정보 조사', sub: '가린 대화 · 작성자 이력', actor: 'agent', tag: 'AGENT · 01', icon: Search, col: 2, top: 184, role: 'BE가 고른 후보만 조사합니다. 가린 주변 채팅과 작성자 이력을 불러옵니다. 제재는 하지 않습니다. (v3.1 §1, SP-4.1)' },
  { id: 'policy', title: '정책 대조 · AI 판정', sub: '위반 · 위반 아님 · 판단 보류', actor: 'agent', tag: 'AGENT · 02', icon: BookOpen, col: 2, top: 264, role: '조사 결과를 정책 v3.1 조항에 대조해 판정(VIOLATION·NO_VIOLATION·NEEDS_REVIEW)과 근거를 냅니다. AI 판정은 제안입니다. (v3.1 §5)' },
  { id: 'verify', title: '근거·정책 검증', sub: '경로별 결과 반영', actor: 'backend', tag: 'BACKEND', icon: ShieldCheck, col: 2, top: 344, role: 'BE가 판정의 근거 형식과 정책 ID를 검증하고 경로별로 넘깁니다. 문맥 후보와 판단 보류는 운영자 결정, 개인정보 정상은 가림 해제입니다. (v3.1 §5)' },
  { id: 'wait', title: '운영자 결정 대기', sub: '정상 · 위반 · 보류', actor: 'human', tag: 'HUMAN', icon: UserCheck, col: 2, top: 434, role: '운영자가 AI 결과와 다르게 판단할 수 있습니다. 보류는 공개 승인이 아니며, 운영자 확인 없이 자동 공개하지 않습니다. (v3.1 §5)' },
  { id: 'sanction', title: '숨김 · 제재 적용', sub: '유형별 제재표', actor: 'backend', tag: 'BACKEND', icon: EyeOff, col: 1, top: 524, role: '확정 위반을 숨기고 같은 유형의 이전 확정 수로 채팅 제한을 정합니다. 여러 유형이면 가장 긴 제한 하나만 적용합니다. (v3.1 §6, MP-2.1)' },
  { id: 'normal', title: '공개 · 가림 해제', sub: '정상 확정 · 개인정보 정상', actor: 'backend', tag: 'RESTORE', icon: Eye, col: 2, top: 524, role: '이 사건의 가림 원인만 풉니다. 다른 유효한 숨김이나 가림이 있으면 공개하지 않습니다. (v3.1 §4·§5)' },
  { id: 'kickReview', title: '강퇴 승인 요청', sub: '24시간 확정 통합 3건', actor: 'human', tag: 'HUMAN', icon: UserX, col: 1, top: 614, role: '같은 시청자·같은 방송의 최근 24시간 확정 사건이 유형 통합 3건이면 강퇴 승인을 따로 요청합니다. 자동 집행하지 않습니다. (v3.1 §8, MP-4.1)' },
  { id: 'kick', title: '강퇴 실행', sub: '재검증 후 방송 종료까지', actor: 'backend', tag: 'APPROVED', icon: Ban, col: 1, top: 704, role: '승인한 기준 사건을 재검증한 뒤 실행합니다. 이 방송이 끝날 때까지 재입장과 채팅을 막습니다. 실패해도 기존 가림은 풀지 않습니다. (v3.1 §9·§10)' }
];
const flowEdgeDefs: [FlowNodeId, FlowNodeId, string][] = [
  ['input', 'classify', ''], ['classify', 'public', '통과'], ['classify', 'rule', '규칙 확정'], ['classify', 'agent', '조사 후보'],
  ['agent', 'policy', ''], ['policy', 'verify', 'AI 판정 전달'], ['verify', 'wait', '문맥 검토 · 판단 보류'], ['verify', 'normal', '개인정보 정상'], ['verify', 'sanction', '개인정보 위반'],
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
    if ((a === 'wait' || a === 'verify') && b === 'sanction') { const x = q.r - (a === 'verify' ? 44 : 22); d = `M${p.l - 2} ${p.cy}H${x}V${q.t - 4}`; lx = p.l - 6; ly = p.cy - 6; anchor = 'end'; }
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
    case 'public': add('Agent 미호출'); fill('조사 신호가 없어 공개합니다.', '접수', '공개', '백엔드가 공개합니다.', 'PASS · v3.1 §3'); break;
    case 'rule':
      add(cats && `위반 유형 ${cats}`); add(confirmedAt ? `확정 시각 ${asTime(confirmedAt)}` : null);
      fill(routeCode === 'FLOOD_REVIEW' ? '10초 안 같은 문장 세 번째부터 도배로 확정합니다.' : '명확한 욕설·링크 규칙과 일치해 위반으로 확정합니다. 인용·설명이어도 욕설은 적용합니다.', '접수', '위반 확정', '판단·실행 모두 백엔드 · Agent 호출 없음', routeCode); break;
    case 'agent':
      add(at('TOOL_START') && `조사 시작 ${at('TOOL_START')}`); add(at('TOOL_END', true) && `조사 완료 ${at('TOOL_END', true)}`); add(at('TASK_FAILED', true) && `조사 실패 ${at('TASK_FAILED', true)}`);
      if (!facts.length && finding) add('조사 시각은 이 화면을 연 뒤의 실시간 기록만 보입니다.');
      base.tools = trace?.agent?.tools.filter(t => t.name === 'get_chat_context' || t.name === 'get_user_history') ?? [];
      fill(sel.investigating ? '조사 중입니다. 결과가 나오면 자동으로 보입니다.' : '가린 주변 채팅과 작성자의 이번 방송 이력을 불러와 표현의 뜻을 조사했습니다.',
        '임시 비노출', '임시 비노출', 'Agent가 조사합니다. 이 단계에서는 제재하지 않습니다.', 'SP-4.1 원문 마스킹'); break;
    case 'policy':
      add(finding && `AI 제안 ${verdictLabels[finding.verdict]} (${finding.verdict})`);
      add(finding && `적용 정책 ${finding.policyIds.join(', ') || '-'}`); add(finding && `위반 유형 ${finding.categories.map(categoryName).join('·') || '없음'}`);
      for (const m of finding?.missingFacts ?? []) add(`확인 필요: ${m}`);
      base.tools = trace?.agent?.tools.filter(t => t.name === 'search_policy' || t.name === 'get_policy_section') ?? [];
      base.reasoning = trace?.agent?.reasoning ?? []; base.answer = trace?.agent?.answer ?? null;
      fill(finding?.reason ?? n.role, '임시 비노출', '판정 제안', 'Agent는 판정과 근거만 냅니다. 제재·공개는 하지 않습니다.', finding?.policyIds.join(', ') || 'v3.1 §5'); break;
    case 'verify': {
      const pii = item?.handlingRoute === 'PII_INVESTIGATION';
      add(finding && `받은 판정 ${verdictLabels[finding.verdict]} (${finding.verdict})`);
      add(finding?.verdict === 'VIOLATION' && `위반 유형·정책 ID 있음 (${finding.policyIds.join(', ')})`);
      add(finding?.verdict === 'NEEDS_REVIEW' && `확인 필요 사실 ${finding.missingFacts.length}개 있음`);
      for (const s2 of step('판단·근거 검증')) add(s2.detail);
      const next = review ? '운영자 결정 대기' : item?.confirmationStatus === 'CONFIRMED_NORMAL' ? '가림 해제' : item?.confirmationStatus === 'CONFIRMED_VIOLATION' ? '위반 확정' : '검증 중';
      add(`결과: ${next}`);
      fill(pii ? '개인정보 경로: 정상이면 가림을 풀고, 판단 보류면 운영자 검토로 넘깁니다. 위반은 실제 개인정보 근거가 검증될 때만 확정합니다.' : '문맥 경로: AI 판정과 상관없이 운영자 결정으로 넘깁니다. AI 정상 판단만으로 공개하지 않습니다.',
        '임시 비노출', next, '백엔드가 검증하고 넘깁니다.', 'v3.1 §5'); break;
    }
    case 'wait': {
      add(review && `결정 요청 ${asTime(review.createdAt)}`);
      add(review && `검토 상태 ${reviewStatusLabels[review.status] ?? review.status} · 버전 ${review.version}`);
      if (review && (review.status === 'PENDING' ? review.version > 1 : review.version > 2)) add('보류 기록 있음 · 같은 검토로 다시 결정 대기');
      for (const s of step('운영자 결정')) add(`${asTime(s.at)} ${s.detail}`);
      const decided = item?.confirmationStatus === 'CONFIRMED_NORMAL' ? '정상 확정' : item?.confirmationStatus === 'CONFIRMED_VIOLATION' || item?.confirmationStatus === 'CANCELLED' ? '위반 확정' : '결정 대기';
      fill('AI 제안은 참고용입니다. 운영자가 정상·위반·보류를 결정할 때까지 공개하지 않습니다. 보류는 공개 승인이 아닙니다.', '임시 비노출', decided, '운영자가 결정합니다. 위반 확정 전에는 확정 이력에 넣지 않습니다.', 'v3.1 §5'); break;
    }
    case 'sanction': {
      const byOperator = !!item && !isRule(item);
      add(cats && `위반 유형 ${cats}`); add(hidden && `조치 ${hidden}`); add(confirmedAt ? `확정 시각 ${asTime(confirmedAt)}` : null);
      add(revoked && `오판 취소 ${asTime(revoked.revokedAt)}`);
      fill(byOperator ? '운영자가 위반으로 확정해 숨기고 기준표의 제재를 적용합니다.' : '규칙 확정에 따라 숨기고 기준표의 제재를 적용합니다.',
        byOperator ? '임시 비노출' : '위반 확정', hidden, `판단: ${byOperator ? (review ? '운영자' : 'Agent · 백엔드 검증') : '백엔드 규칙'} · 실행: 백엔드`, 'v3.1 §6 제재표 (MP-2.1)'); break;
    }
    case 'normal':
      add(at('MESSAGE_RESTORED', true) && `공개 시각 ${at('MESSAGE_RESTORED', true)}`);
      for (const s of step('운영자 결정')) add(`${asTime(s.at)} ${s.detail}`);
      fill(review ? '운영자가 정상으로 확정해 다시 공개합니다.' : '개인정보 정상 판정을 백엔드가 검증해 가림을 풉니다.', '임시 비노출', '공개', review ? '결정: 운영자 · 공개 실행: 백엔드' : '판단: Agent · 검증·해제: 백엔드', 'v3.1 §4·§5'); break;
    case 'kickReview': {
      const k = kickReviewOf(item);
      add(k && `요청 시각 ${asTime(k.createdAt)}`); add(k && `기준 사건 ${k.basisCaseIds.length}건`); add(k && `상태 ${reviewStatusLabels[k.status] ?? k.status}`); add(k && kickStateOf(k));
      fill(n.role, '확정 통합 3건', !k ? '-' : k.status === 'PENDING' ? '승인 대기' : reviewStatusLabels[k.status] ?? k.status, '운영자가 승인·기각합니다. 기각해도 기존 숨김과 제한은 유지합니다.', 'v3.1 §8 (MP-4.1)'); break;
    }
    case 'kick': { const k = kickReviewOf(item); add(k && kickStateOf(k)); fill(n.role, '승인', '강퇴 적용', '승인: 운영자 · 재검증·실행: 백엔드', 'v3.1 §9·§10'); break; }
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
    if (review) push(review.createdAt, 'human', '운영자 대기', '운영자 결정 요청', sel.finding ? `AI 제안 ${verdictLabels[sel.finding.verdict]}` : '-', '결정 전 공개 안 함');
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

function openDecision(r: LiveReview) { queueTab.value = r.kind; openIds[r.kind] = r.reviewId; goto('reviews'); }

// 시청자 관리: 사건·검토를 시청자 이름으로 묶는다. 무효가 된 검토는 빼고 보여 준다.
const viewerRows = computed(() => groupByViewer(
  props.cases.map((c): ViewerCase => ({ caseId: c.caseId, name: nameOf(c.caseId), createdAt: iso(c.createdAt), text: targetText(c), confirmationStatus: c.confirmationStatus, findings: c.confirmedFindings.map(f => ({ findingId: f.findingId, category: f.category, status: f.status })), violationCount: c.violationCount ?? null, version: c.version })),
  props.reviews.filter(r => r.status !== 'INVALIDATED').map((r): ViewerReview => ({ reviewId: r.reviewId, kind: r.kind, status: r.status === 'PENDING' ? 'PENDING' : 'DECIDED', createdAt: iso(r.createdAt), summary: r.summary, caseIds: r.kind === 'CONTEXT' ? [r.caseId] : r.basisCaseIds }))));
function onViewerDecide(v: ViewerReview, value: string, reason: string) {
  const r = props.reviews.find(x => x.reviewId === v.reviewId); if (!r) return;
  emit('decide', r, value as ContextDecision | KickDecision, reason, value === 'CONFIRM_VIOLATION' ? categoriesOf(r) : []);
}
function onViewerRevoke(item: ViewerCase, f: ViewerFinding, reason: string) { emit('revoke', item.caseId, f.findingId, reason); }

const casesByTime = computed(() => [...props.cases].sort((a, b) => Date.parse(iso(b.createdAt)) - Date.parse(iso(a.createdAt))));
const sanctionRows = Object.entries(sanctionTable) as [Category, (typeof sanctionTable)[Category]][];
// Backend 필터 사전(dict-v2) 사본. 단어는 정규화(NFKC·소문자·공백 정리) 뒤 부분 일치로 비교한다.
const dictRows: { name: string; words: string[]; result: string }[] = [
  { name: '확정 욕설', words: filterDictionary.certainProfanity, result: '바로 숨김·욕설 위반 확정' },
  { name: '욕설 예외', words: filterDictionary.profanityExceptions, result: '비교 전에 지움 (확정 욕설로 보지 않음)' },
  { name: '공격 표현', words: filterDictionary.attack, result: 'AI 문맥 검토 → 운영자 결정 (결정 전까지 임시 비노출)' },
  { name: '공식 자칭', words: filterDictionary.officialClaim, result: '로그인 요구와 함께 있으면 AI 문맥 검토' },
  { name: '로그인 요구', words: filterDictionary.credential, result: '공식 자칭과 함께 있으면 AI 문맥 검토' }
];
</script>

<template>
  <div class="app-shell studio-shell">
    <header class="topbar"><div class="topbar-title"><button class="yt-icon-button" :class="{on: navVisible}" :title="navVisible ? '메뉴 닫기' : '메뉴 열기'" aria-controls="operator-nav" :aria-expanded="navVisible" @click="toggleNav"><Menu :size="22"/></button><span class="yt-logo"><span class="yt-logo-mark"><ShieldCheck :size="15"/></span><b>LIVE<span>:</span>GUARD</b></span><span class="console-tag">Studio</span></div>
      <div class="topbar-right"><span class="connection"><span class="online-dot" :class="{off: !online}"/> {{mock ? 'MOCK 데이터' : online ? '실시간 연결' : '연결 대기'}}</span><span class="yt-me" :style="{background: avatarColor(nickname)}" :title="nickname">{{nickname.slice(0,1)}}</span><span class="operator-info">{{nickname}}</span><button class="header-logout" @click="emit('logout')"><LogOut :size="16"/> 로그아웃</button></div></header>
    <div class="app-body">
      <div v-if="!wide && navOpen" class="nav-backdrop" @click="navOpen = false"/>
      <aside id="operator-nav" class="sidebar" :class="{open: !wide && navOpen, docked: wide && !navCollapsed}" :aria-hidden="!navVisible" :inert="!navVisible">
        <div class="sidebar-channel"><span class="yt-channel-avatar big">🎮</span><b>채널 콘텐츠 관제</b><small>{{channelName}}</small></div>
        <nav class="side-nav" aria-label="운영자 메뉴">
          <button :class="{active: page==='monitor'}" :aria-current="page==='monitor' ? 'page' : undefined" @click="goto('monitor')"><Radio :size="20"/><span>실시간 관제</span></button>
          <button :class="{active: page==='reviews'}" :aria-current="page==='reviews' ? 'page' : undefined" @click="goto('reviews')"><ClipboardCheck :size="20"/><span>결정 대기</span><b v-if="pending.length" class="side-count">{{pending.length}}</b></button>
          <button :class="{active: page==='viewers'}" :aria-current="page==='viewers' ? 'page' : undefined" @click="goto('viewers')"><Users :size="20"/><span>시청자 관리</span></button>
          <button :class="{active: page==='cases'}" :aria-current="page==='cases' ? 'page' : undefined" @click="goto('cases')"><FileClock :size="20"/><span>사건 이력</span></button>
 <button :class="{active: page==='chats'}" :aria-current="page==='chats' ? 'page' : undefined" @click="goto('chats')"><MessagesSquare :size="20"/><span>채팅 기록</span></button>
          <button :class="{active: page==='policy'}" :aria-current="page==='policy' ? 'page' : undefined" @click="goto('policy')"><BookOpen :size="20"/><span>정책 근거</span></button>
        </nav>
        <div class="sidebar-foot"><span class="online-dot" :class="{off: !online}"/>{{mock ? '목업 방송 · 정책 v3.1 판정' : online ? 'SSE 연결됨' : '연결 확인 중'}}</div>
      </aside>
      <div class="workspace">
        <main class="main-content">
          <div class="status-strip"><div><Sparkles :size="16"/><b>{{pageTitles[page]}}</b><span v-if="mock" class="mock-mode-pill">MOCK · 시뮬레이션 결과</span><span v-else>LIVE API · 서버 권한 적용</span></div>
            <div class="status-controls"><button v-if="!mock" @click="emit('refresh')"><RefreshCcw :size="14"/> 새로고침</button><button v-if="!mock && !loading && (!live || ended)" class="primary" :disabled="busy" @click="emit('start')">방송 시작</button><button v-if="!mock && live && !ended" :disabled="busy" @click="emit('end')">방송 종료</button></div></div>
          <p v-if="error" class="error-inline" role="alert"><AlertCircle :size="17"/> {{error}}</p>
          <p v-if="notice" class="studio-notice" role="status">{{notice}}</p>
          <p v-for="k in kickStates" :key="k.review.reviewId" class="kick-progress" role="status"><span>강퇴 처리 · {{nameOf(k.review.caseId)}}: <b>{{k.state}}</b></span><slot name="kick-actions" :review-id="k.review.reviewId" :state="k.state"/></p>

          <section v-if="!live && !loading" class="card secondary-page studio-empty"><Radio :size="30"/><h2>진행 중인 방송이 없습니다</h2><p>방송을 시작하면 시청자 채팅과 AI 조사 결과를 확인할 수 있습니다.</p></section>
          <template v-else-if="live">
            <p class="studio-live-line"><span :class="ended ? 'ended' : 'on'">{{ended ? '종료' : '● LIVE'}}</span> 방송 {{live.liveId.slice(0,8)}} · {{asTime(live.startedAt)}} 시작<template v-if="ended"> · 방송이 종료되어 결정할 수 없습니다</template><button v-if="pending.length && page!=='reviews'" type="button" class="queue-link" :title="`강퇴 승인 ${queues[0].items.length} · 문맥 검토 ${queues[1].items.length}`" @click="goto('reviews')">결정 대기 {{pending.length}}건 →</button></p>

            <template v-if="page==='monitor'">
            <section class="monitor-grid chat-only">
              <div class="stream-panel card"><div class="stream-caption"><span class="yt-channel-avatar">🎮</span><div><b>{{mock ? '오늘도 게임하는 날! 같이 놀아요 🎮' : '오늘의 라이브'}}</b><small>{{channelName}} · <span class="live-badge">{{ended ? '방송 종료' : '● 실시간'}}</span></small></div></div></div>
              <div class="chat-panel card"><div class="panel-heading"><h2>실시간 채팅 <ChevronDown :size="17"/></h2><div class="panel-heading-end"><button v-if="feedOn !== null" class="icon-control" :class="{on: feedOn}" :title="feedOn ? '채팅 흐름 일시정지 (MOCK)' : '채팅 흐름 재생 (MOCK)'" :aria-pressed="feedOn" @click="emit('toggleFeed')"><Pause v-if="feedOn" :size="17"/><Play v-else :size="17"/></button><button class="blocked-toggle" :class="{on: filter==='private'}" :aria-pressed="filter==='private'" @click="filter = filter==='all' ? 'private' : 'all'" :title="filter==='all' ? '임시 비노출·숨김 채팅만 보기' : '전체 채팅 보기'">비공개 채팅 <b>{{privateCount}}</b></button></div></div>
                <div class="scan-wrap"><span class="ai-scan" aria-hidden="true"/><div ref="chatRef" class="chat-list" @scroll.passive="onScroll">
                  <div v-for="m in shownMessages" :key="m.messageId" :data-message-id="m.messageId" class="chat-row" :class="{held: m.visibility==='HELD', hidden: m.visibility==='HIDDEN', selected: selectedId===m.messageId}" role="button" tabindex="0" :aria-pressed="selectedId===m.messageId" @click="selectMessage(m.messageId)" @keydown.enter.prevent="selectMessage(m.messageId)" @keydown.space.prevent="selectMessage(m.messageId)"><span class="chat-avatar" :style="{background: avatarColor(m.authorAlias)}">{{m.authorAlias.slice(0,1)}}</span><span class="chat-line"><b>{{m.authorAlias}}</b><span class="chat-text">{{m.text}}</span></span><span v-if="m.visibility!=='PUBLIC'" class="state-pill" :class="m.visibility.toLowerCase()">{{visibilityLabels[m.visibility]}}</span><time class="chat-time" :datetime="iso(m.sentAt)" :title="asTime(m.sentAt)">{{hourMinute(iso(m.sentAt))}}</time></div>
                  <div v-if="!shownMessages.length" class="empty-block">표시할 채팅이 없습니다.</div></div>
                  <button v-if="unread" class="new-msg-pill" @click="toBottom()">새 메시지 {{unread}}개 <ChevronDown :size="15"/></button></div>
                <div class="chat-footer"><div class="ai-notice"><ShieldCheck :size="15"/> 임시 비노출·숨김 채팅은 작성자와 담당 운영자에게만 보입니다.</div><details v-if="$slots.demo" class="demo-fold"><summary>목업 빠른 시연</summary><slot name="demo"/></details></div>
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
                  <div class="detail-actions"><button v-if="selected.review && selected.review.status==='PENDING'" type="button" class="primary" @click="openDecision(selected.review)">결정하러 가기 →</button><button v-if="selected.item" type="button" @click="showFlow(selected.item.caseId)">사건 이력에서 보기</button></div>
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

            <section v-else-if="page==='reviews'" class="queue-page">
                <section class="hitl-section decision-queue" :class="shownQueue.kind.toLowerCase()" aria-label="운영자 결정 대기">
                  <header class="section-head"><span class="section-icon human"><ClipboardCheck :size="17"/></span><b>운영자 결정 대기</b><span class="pending-count">{{pending.length}}건</span></header>
                  <div class="studio-tabs queue-tabs" role="tablist" aria-label="결정 대기 종류"><button v-for="q in queues" :key="q.kind" role="tab" :aria-selected="shownQueue.kind===q.kind" :class="{on: shownQueue.kind===q.kind}" @click="queueTab=q.kind"><UserX v-if="q.kind==='KICK'" :size="15"/><ClipboardCheck v-else :size="15"/>{{q.kind==='KICK' ? '강퇴 승인' : '문맥 검토'}} <b>{{q.items.length}}</b><i v-if="q.items.length && shownQueue.kind!==q.kind" class="tab-alert" aria-label="대기 중"/></button></div>
                  <p class="queue-note">{{shownQueue.note}}</p>
                  <p v-if="!shownQueue.items.length" class="section-empty">{{shownQueue.empty}}</p>
                  <article v-for="r in shownQueue.items" :key="r.reviewId" class="studio-review" :class="[r.kind.toLowerCase(), {open: isOpen(r)}]" :data-review-id="r.reviewId" :data-version="r.version">
                    <button type="button" class="review-head" :aria-expanded="isOpen(r)" @click="toggleReview(r)">
                      <ChevronDown v-if="isOpen(r)" :size="16"/><ChevronRight v-else :size="16"/>
                      <b>{{nameOf(r.caseId)}}</b>
                      <span class="review-excerpt">{{excerptOf(r)}}</span>
                      <span v-if="r.kind==='CONTEXT' && findingsOf(r)[0]" class="verdict-badge" :class="verdictTone(findingsOf(r)[0].verdict)">{{verdictLabels[findingsOf(r)[0].verdict]}}</span>
                      <small :title="r.kind==='CONTEXT' && sentAt(r) ? `메시지 보낸 시각 · 검토 요청 ${asTime(r.createdAt)} · 버전 ${r.version}` : `강퇴 승인 요청 시각 · 버전 ${r.version}`">{{asTime(r.kind==='CONTEXT' && sentAt(r) ? sentAt(r) : r.createdAt)}}</small>
                    </button>
                    <div v-if="isOpen(r)" class="review-body">
                      <template v-if="r.kind==='CONTEXT'">
                        <blockquote v-if="targetText(r)" class="review-target">{{targetText(r)}}</blockquote>
                        <AiEvidence :findings="findingsOf(r)" :mock="mock"/>
                        <div class="review-choice" role="radiogroup" aria-label="결정"><label v-for="opt in contextChoices" :key="opt.value" :class="{on: choice[r.reviewId]===opt.value}"><input type="radio" :name="'choice-' + r.reviewId" :value="opt.value" v-model="choice[r.reviewId]" :disabled="busy || ended"/>{{opt.label}}</label></div>
                        <fieldset v-if="choice[r.reviewId]==='CONFIRM_VIOLATION'" class="review-categories"><legend>적용할 위반 유형</legend><label v-for="(name, key) in categoryLabels" :key="key"><input type="checkbox" :checked="categoriesOf(r).includes(key)" :disabled="busy || ended" @change="toggleCategory(r, key, ($event.target as HTMLInputElement).checked)"/>{{name}}</label></fieldset>
                        <label class="review-reason-label" :for="'reason-' + r.reviewId">결정 이유 (필수)</label><textarea :id="'reason-' + r.reviewId" v-model="reasons[r.reviewId]" rows="2" maxlength="500" placeholder="확인한 근거와 결정 이유를 입력하세요" :disabled="busy || ended"/>
                        <div class="review-submit"><button class="primary" :disabled="!canSubmit(r)" @click="submit(r)">제출</button></div>
                        <details class="review-more"><summary>자세히</summary>
                          <p v-if="repeatsOf(r).length" class="review-repeats">같은 시청자가 같은 문장을 {{repeatsOf(r).length}}번 더 보냈습니다: <span v-for="x in repeatsOf(r)" :key="x.caseId">{{x.time}} {{x.status}}</span></p>
                          <div class="review-context"><b>마스킹된 주변 문맥 · U1 = 검토 대상 작성자</b><ol><li v-for="m in r.messages" :key="m.messageId" :class="{target: r.targetMessageIds.includes(m.messageId)}"><b>{{m.authorAlias}}</b> {{m.text}}</li></ol></div>
                          <p class="review-foot">정상 확정은 공개, 위반 확정은 숨김과 기준표의 채팅 제한, 보류는 임시 비노출을 유지합니다.</p>
                          <button type="button" class="review-flow-link" @click="showFlow(r.caseId)">처리 흐름 보기 →</button>
                        </details>
                      </template>
                      <template v-else>
                        <table class="sanction-log basis-log"><caption>기준 사건 {{r.basisCaseIds.length}}건</caption><thead><tr><th>시간</th><th>유형</th><th>메시지</th><th>상태</th></tr></thead><tbody>
                          <tr v-for="b in basisCases(r)" :key="b.id" :data-case-id="b.id"><td class="log-time">{{b.item ? asTime(b.item.createdAt) : '-'}}</td><td class="log-cat">{{b.item ? activeCategories(b.item).map(categoryName).join('·') || '-' : '-'}}</td><td class="log-text">{{b.item ? targetText(b.item) ?? '원문 없음' : `사건 ${b.id.slice(0,8)}`}}<small v-if="b.item" class="basis-reason">{{basisReason(b.item)}}</small></td><td>{{b.item ? confirmationLabels[b.item.confirmationStatus] : '확인 중'}}</td></tr></tbody></table>
                        <details v-for="b in basisCases(r).filter(b => b.item && !isRule(b.item))" :key="'evidence-' + b.id" class="review-more"><summary>기준 사건 AI 판단 근거 · {{b.id.slice(0,8)}}</summary><AiEvidence :findings="b.item?.findings ?? []" :mock="mock"/></details>
                        <div class="review-choice" role="radiogroup" aria-label="결정"><label v-for="opt in kickChoices" :key="opt.value" :class="{on: choice[r.reviewId]===opt.value}"><input type="radio" :name="'choice-' + r.reviewId" :value="opt.value" v-model="choice[r.reviewId]" :disabled="busy || ended"/>{{opt.label}}</label></div>
                        <label class="review-reason-label" :for="'reason-' + r.reviewId">운영자 판단 근거 (필수)</label><textarea :id="'reason-' + r.reviewId" v-model="reasons[r.reviewId]" rows="2" maxlength="500" placeholder="최종 결정의 근거를 입력하세요" :disabled="busy || ended"/>
                        <div class="review-submit"><button class="primary" :disabled="!canSubmit(r)" @click="submit(r)">제출</button></div>
                        <details class="review-more"><summary>자세히</summary>
                          <p class="review-summary">요청 문구: {{r.summary}}</p>
                          <p class="review-foot">승인 저장은 강퇴 완료가 아닙니다. 기준 사건을 다시 확인한 뒤 이번 방송 종료까지 입장·채팅이 제한됩니다. 기각하면 기존 숨김·채팅 제한은 유지됩니다.</p>
                        </details>
                      </template>
                    </div>
                  </article>
                </section>
            </section>

            <ViewerManage v-else-if="page==='viewers'" :rows="viewerRows" :busy="busy || ended" :scope="mock ? '현재 방송(Mock 데이터)' : '현재 방송'" @decide="onViewerDecide" @revoke="onViewerRevoke"/>

            <section v-else-if="page==='cases'" class="secondary-page card"><div class="secondary-heading"><div><h2><FileClock :size="24"/> 사건 이력</h2><p>행을 펼치면 사건 하나가 어떻게 처리됐는지 단계별로 볼 수 있습니다.</p></div></div>
              <div class="studio-tabs" role="tablist" aria-label="사건 이력 보기"><button role="tab" :aria-selected="caseTab==='cases'" :class="{on: caseTab==='cases'}" @click="caseTab='cases'">사건 <b>{{cases.length}}</b></button><button role="tab" :aria-selected="caseTab==='reviews'" :class="{on: caseTab==='reviews'}" @click="caseTab='reviews'">검토 기록 <b>{{reviews.length}}</b></button></div>
              <template v-if="caseTab==='cases'">
                <div class="vm-chips" role="group" aria-label="사건 상태 필터"><button v-for="f in caseFilters" :key="f.key" :class="{on: caseFilter===f.key}" :aria-pressed="caseFilter===f.key" @click="caseFilter=f.key">{{f.label}} <b>{{caseCount(f.key)}}</b></button></div>
                <div class="table-scroll"><table class="data-table case-table"><thead><tr><th class="vm-toggle-col"></th><th>시각</th><th>시청자</th><th>메시지 (마스킹)</th><th>상태</th></tr></thead><tbody>
                  <template v-for="c in shownCases" :key="c.caseId"><tr class="case-row" :class="{open: openCase===c.caseId}" :data-case-id="c.caseId" @click="toggleCase(c.caseId)"><td class="vm-toggle-col"><button class="vm-expand" :aria-expanded="openCase===c.caseId" :aria-label="`${nameOf(c.caseId)} 사건 처리 흐름 ${openCase===c.caseId ? '닫기' : '보기'}`" @click.stop="toggleCase(c.caseId)"><ChevronDown v-if="openCase===c.caseId" :size="18"/><ChevronRight v-else :size="18"/></button></td><td class="nowrap">{{asTime(c.createdAt)}}</td><td class="nowrap">{{nameOf(c.caseId)}}</td><td class="log-text">{{targetText(c) ?? '-'}}</td><td><span class="case-state" :class="caseStateOf(c).tone">{{caseStateOf(c).label}}</span></td></tr>
                  <tr v-if="openCase===c.caseId" class="case-flow-row"><td colspan="5"><ol class="case-flow" aria-label="사건 처리 흐름"><li v-for="(step, n) in flowOf(c)" :key="n" :class="step.tone"><b>{{step.label}}</b><time>{{step.time ?? ''}}</time><span>{{step.detail}}</span></li></ol><small class="vm-muted">AI 조사 시작·완료와 운영자 결정 시각은 실시간 이벤트에만 있어, 이 화면을 연 뒤의 일만 보입니다. 새로고침하면 사라집니다.</small></td></tr></template></tbody></table></div>
                <p v-if="!shownCases.length" class="empty-block">{{cases.length ? '조건에 맞는 사건이 없습니다.' : '아직 사건이 없습니다.'}}</p>
              </template>
              <template v-else>
                <div class="table-scroll"><table class="data-table"><thead><tr><th>요청 시각</th><th>종류</th><th>시청자</th><th>상태</th></tr></thead><tbody>
                  <tr v-for="r in reviews" :key="r.reviewId"><td class="nowrap">{{asTime(r.createdAt)}}</td><td>{{r.kind==='KICK' ? '강퇴 승인' : '문맥 검토'}}</td><td>{{nameOf(r.caseId)}}</td><td>{{reviewStatusLabels[r.status] ?? r.status}}<template v-if="kickStateOf(r)"> · {{kickStateOf(r)}}</template></td></tr></tbody></table></div>
                <p v-if="!reviews.length" class="empty-block">아직 검토 기록이 없습니다.</p>
              </template></section>

            <section v-else-if="page==='policy'" class="secondary-page card"><div class="secondary-heading"><div><h2><BookOpen :size="24"/> 정책 근거</h2><p>운영정책 v3.1 기준의 처리 경로와 제재 기준입니다. 읽기 전용이며 제재 기간은 운영자가 정하지 않습니다.</p></div></div>
              <h3 class="studio-subhead">처리 경로</h3>
              <div class="table-scroll"><table class="data-table"><thead><tr><th>경로</th><th>조건</th><th>결정</th><th>결과</th></tr></thead><tbody><tr v-for="row in routeRows" :key="row.route"><td><b>{{routeLabels[row.route]}}</b></td><td>{{row.trigger}}</td><td>{{row.decider}}</td><td>{{row.result}}</td></tr></tbody></table></div>
              <h3 class="studio-subhead">필터 사전</h3><p class="studio-help">Backend 필터 사전(dict-v2, 팀 확정 전 초기 목록)과 같은 단어입니다. 애매한 표현(존나·지랄·'개-' 접두어·시바 등)은 일부러 넣지 않아 그대로 공개됩니다. 링크와 전화번호·이메일은 사전이 아니라 코드 규칙으로 찾습니다.</p>
              <div class="table-scroll"><table class="data-table studio-dict"><thead><tr><th>사전</th><th>단어</th><th>처리</th></tr></thead><tbody><tr v-for="row in dictRows" :key="row.name"><td><b>{{row.name}}</b></td><td><code v-for="w in row.words" :key="w">{{w}}</code></td><td>{{row.result}}</td></tr></tbody></table></div>
              <h3 class="studio-subhead">제재 기준표 (MP-2.1)</h3><p class="studio-help">같은 방송·같은 유형의 이전 확정 사건 수로 정합니다. 모든 채팅 제한은 자동 적용되며, 24시간 제한도 강퇴가 아닙니다.</p>
              <div class="table-scroll"><table class="data-table sanction-table"><thead><tr><th>유형</th><th v-for="col in priorColumns" :key="col">{{col}}</th></tr></thead><tbody><tr v-for="[cat, row] in sanctionRows" :key="cat"><td><b>{{categoryName(cat)}}</b><small>{{cat}}</small></td><td v-for="(cell, i) in row" :key="i">{{sanctionLabel(cell)}}</td></tr></tbody></table></div>
              <h3 class="studio-subhead">강퇴 심사 (MP-4.1~4.3)</h3>
              <ul class="studio-rules"><li>유형과 관계없이 최근 24시간의 서로 다른 확정 사건이 {{KICK_THRESHOLD}}건 이상이면 강퇴 승인 요청이 만들어집니다.</li><li>운영자가 승인하면 기준 사건을 다시 확인한 뒤 실행합니다. 효력은 <b>이번 방송 종료까지</b>입니다.</li><li>승인·기각으로 결정된 요청에 쓰인 사건은 소진되어 다음 강퇴 심사에서 다시 세지 않습니다.</li><li>기준 사건이 오판 취소되면 그 강퇴 요청은 무효가 되고, 이미 실행된 강퇴도 풀립니다. 결정된 뒤 무효가 된 요청의 나머지 사건도 소진 상태로 남습니다.</li></ul></section>

            <section v-else-if="page==='chats'" class="secondary-page card"><div class="secondary-heading"><div><h2><MessagesSquare :size="24"/> 채팅 기록</h2><p>이번 방송의 채팅을 한곳에서 찾아봅니다. 숨김·검토 중인 채팅도 운영자에게는 보입니다.</p></div><span>{{chatRows.length}}건</span></div>
              <div class="chat-db-tools"><input v-model="chatQuery" type="search" placeholder="메시지·시청자 검색" aria-label="채팅 기록 검색"/><div class="vm-chips" role="group" aria-label="채팅 상태 필터"><button v-for="f in chatFilters" :key="f.key" :class="{on: chatFilter===f.key}" :aria-pressed="chatFilter===f.key" @click="chatFilter=f.key">{{f.label}} <b>{{chatCount(f.key)}}</b></button></div></div>
              <div class="table-scroll"><table class="data-table chat-db"><thead><tr><th>시각</th><th>시청자</th><th>메시지</th><th>공개 상태</th><th>사건</th></tr></thead><tbody>
                <tr v-for="m in shownChats" :key="m.messageId" :data-message-id="m.messageId"><td class="nowrap">{{asTime(m.sentAt)}}</td><td class="nowrap">{{m.authorAlias}}</td><td class="chat-db-text">{{m.text}}</td><td class="nowrap"><span v-if="m.visibility!=='PUBLIC'" class="state-pill" :class="m.visibility.toLowerCase()">{{visibilityLabels[m.visibility]}}</span><span v-else class="vm-muted">공개</span></td>
                  <td><template v-if="caseByMessage.get(m.messageId)"><span class="case-state" :class="caseStateOf(caseByMessage.get(m.messageId)!).tone">{{caseStateOf(caseByMessage.get(m.messageId)!).label}}</span><button type="button" class="review-flow-link" @click="showFlow(caseByMessage.get(m.messageId)!.caseId)">처리 흐름 →</button></template><span v-else class="vm-muted">-</span></td></tr></tbody></table></div>
              <p v-if="!shownChats.length" class="empty-block">{{chatRows.length ? '조건에 맞는 채팅이 없습니다.' : '아직 채팅이 없습니다.'}}</p>
              <div v-if="archiveMore" class="chat-db-more"><button type="button" :disabled="archiveLoading" @click="emit('loadOlder')">{{archiveLoading ? '불러오는 중…' : '이전 채팅 더 불러오기'}}</button></div>
            </section>
          </template>
          <footer class="dashboard-footer"><span>LIVE:GUARD · API v1.0 (liveId){{mock ? ' · MOCK' : ''}}</span><span>프론트는 <code>/api/**</code>만 사용합니다. <code>/internal/**</code>·MCP·Agent 호출은 백엔드 담당입니다.</span></footer>
        </main>
      </div>
    </div>
  </div>
</template>
