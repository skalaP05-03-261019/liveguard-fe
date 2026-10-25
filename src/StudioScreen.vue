<script setup lang="ts">
// 운영자(스트리머) Studio 화면. 목업과 실제 API가 같은 화면을 쓴다(#12).
// 화면은 API v1.0 모양의 데이터와 사용자 동작만 다룬다. API·SSE 연결은 LiveConsole.vue, 목업 판정은 mockLive.ts가 맡는다.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { AlertCircle, BookOpen, ChevronDown, ChevronRight, ClipboardCheck, FileClock, LogOut, Menu, MessagesSquare, Pause, Play, Radio, RefreshCcw, ShieldCheck, Sparkles, Users, UserX } from 'lucide-vue-next';
import ViewerManage from './ViewerManage.vue';
import OperatorTools from './OperatorTools.vue';
import DecisionNotifications from './DecisionNotifications.vue';
import type { ShortcutAction, OperatorAlert } from './operatorTools';
import ModeBadge from './ModeBadge.vue';
import AiEvidence from './AiEvidence.vue';
import { groupByViewer, type ViewerCase, type ViewerFinding, type ViewerReview } from './viewerManage';
import { avatarColor } from './avatar';
import { clockText as hourMinute, dateTimeText } from './chatTime';
import {
  categoryLabels, confirmationLabels, reviewStatusLabels, routeLabels, verdictLabels, visibilityLabels,
  type Category, type ContextDecision, type KickDecision, type Live, type LiveCase, type LiveReview, type Message, type Verdict
} from './contracts';
import { KICK_THRESHOLD, priorColumns, routeRows, sanctionFor, sanctionLabel, sanctionTable, type Sanction } from './sanction';
import { filterDictionary } from './mock';

export interface StudioLog { id: string; time: string; event: string; detail: string; caseId?: string; reviewId?: string }
type Page = 'monitor' | 'viewers' | 'cases' | 'chats' | 'policy';

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
}>(), { mock: false, channelName: '내 채널', ended: false, loading: false, online: false, busy: false, error: '', notice: '', feedOn: null, archive: null, archiveMore: false, archiveLoading: false });
const emit = defineEmits<{
  decide: [review: LiveReview, value: ContextDecision | KickDecision, reason: string, categories: Category[]];
  revoke: [caseId: string, findingId: string, reason: string];
  page: [page: Page]; refresh: []; start: []; end: []; logout: []; toggleFeed: []; loadOlder: [];
}>();

const operatorToolsRef=ref<InstanceType<typeof OperatorTools>|null>(null);
const page = ref<Page>('monitor');
const pageTitles: Record<Page, string> = { monitor: '실시간 모니터링', viewers: '시청자 관리', cases: '사건 이력', chats: '채팅 기록', policy: '채팅 관제 운영 정책' };
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
const pending = computed(() => props.reviews.filter(r => r.status === 'PENDING' && r.liveId === props.live?.liveId)
  .sort((a, b) => Number(b.kind === 'KICK') - Number(a.kind === 'KICK') || Date.parse(iso(a.createdAt)) - Date.parse(iso(b.createdAt))));
const freshReviews=ref(new Set<string>()),arrivalAnnouncement=ref('');
let arrivalScope='',seenReviews:Set<string>|null=null;
const arrivalTimers=new Map<string,ReturnType<typeof setTimeout>>();
function clearArrivals(){for(const timer of arrivalTimers.values())clearTimeout(timer);arrivalTimers.clear();freshReviews.value=new Set();arrivalAnnouncement.value='';}
watch([()=>props.live?.liveId,()=>props.loading,()=>props.ended,()=>pending.value.map(r=>r.reviewId).join(',')],()=>{
 const scope=props.live?.liveId??'';
 if(scope!==arrivalScope){clearArrivals();seenReviews=null;arrivalScope=scope;}
 if(!scope||props.ended){clearArrivals();seenReviews=null;return;}
 if(props.loading)return;
 const ids=pending.value.map(r=>r.reviewId);
 if(!seenReviews){seenReviews=new Set(ids);return;}
 const added=ids.filter(id=>!seenReviews!.has(id));
 for(const id of ids)seenReviews.add(id);
 const current=new Set(ids);freshReviews.value=new Set([...freshReviews.value].filter(id=>current.has(id)));
 if(!freshReviews.value.size)arrivalAnnouncement.value='';
 if(!added.length)return;
 freshReviews.value=new Set([...freshReviews.value,...added]);
 arrivalAnnouncement.value=`새 결정 대기 요청 ${freshReviews.value.size}건이 도착했습니다.`;
 for(const id of added){arrivalTimers.set(id,setTimeout(()=>{freshReviews.value=new Set([...freshReviews.value].filter(x=>x!==id));arrivalTimers.delete(id);if(!freshReviews.value.size)arrivalAnnouncement.value='';},8000));}
},{immediate:true});
onBeforeUnmount(clearArrivals);
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
const picked = reactive<Record<string, Category[]>>({});
// 검토 응답에 근거가 없으면 같은 사건에 저장된 AI 판정을 사용한다.
const findingsOf = (r: LiveReview) => r.findings.length ? r.findings : caseById.value.get(r.caseId)?.findings ?? [];
// AI 판정 없이 열린 문맥 검토(Backend A-25): Agent 판정이 마감(기본 3분) 안에 오지 않았거나 분석이 실패했다.
// aiVerdict는 NEEDS_REVIEW로 오지만 AI가 판단을 보류한 것이 아니므로 "AI 결과 없음"으로 구분한다. 늦게 판정이 오면 같은 검토에 붙는다.
const noAiResult = (r: LiveReview) => r.kind === 'CONTEXT' && !findingsOf(r).length;
const NO_AI_NOTICE = 'AI 분석 결과를 받지 못했습니다. 주변 문맥을 확인하고 직접 결정해 주세요';
const categoriesOf = (r: LiveReview) => picked[r.reviewId] ?? [...new Set(findingsOf(r).flatMap(f => f.categories))];
function toggleCategory(r: LiveReview, c: Category, on: boolean) { const now = categoriesOf(r); picked[r.reviewId] = on ? [...new Set([...now, c])] : now.filter(x => x !== c); }
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
// 두 열을 동시에 표시한다. 클릭·키보드 초점이 있는 열에서 탐색 단축키를 적용한다.
const queueTab = ref<LiveReview['kind'] | null>(null);
const monitorQueues=computed(()=>[queues.value[0],queues.value[1]]);
const shownQueue = computed(() => { const kind = queueTab.value ?? (queues.value[1].items.length ? 'CONTEXT' : 'KICK'); return queues.value.find(q => q.kind === kind)!; });
function toggleReview(r: LiveReview) { openIds[r.kind] = isOpen(r) ? '' : r.reviewId; }
// 결정은 하나를 고른 뒤 제출한다. 위반 확정을 고를 때만 위반 유형을 고른다.
const choice = reactive<Record<string, ContextDecision | KickDecision>>({});
const contextChoices: { value: ContextDecision; label: string }[] = [{ value: 'CONFIRM_NORMAL', label: '정상 확정' }, { value: 'CONFIRM_VIOLATION', label: '위반 확정' }, { value: 'DEFER', label: '보류' }];
const kickChoices: { value: KickDecision; label: string }[] = [{ value: 'APPROVE', label: '강퇴 승인' }, { value: 'REJECT', label: '강퇴 기각' }];
// 결정 사유는 받지 않는다(Backend A-26: 사유는 선택이고 운영자 화면에는 입력란이 없다). 결정 값과 위반 유형만 보낸다.
const canSubmit = (r: LiveReview) => r.status === 'PENDING' && r.liveId === props.live?.liveId && !props.busy && !props.ended && !!choice[r.reviewId] && (choice[r.reviewId] !== 'CONFIRM_VIOLATION' || categoriesOf(r).length > 0);
function submit(r: LiveReview) {
  if (!canSubmit(r)) return;
  const value = choice[r.reviewId];
  if (!value) return;
  emit('decide', r, value, '', value === 'CONFIRM_VIOLATION' ? categoriesOf(r) : []);
}
const excerptOf = (r: LiveReview) => r.kind === 'KICK' ? `확정 사건 ${r.basisCaseIds.length}건` : targetText(r) ?? '';
// 결정이 반영되어 대기 목록에서 빠지면 입력값을 지운다.
watch(() => pending.value.map(r => r.reviewId), ids => { for (const id of Object.keys(choice)) if (!ids.includes(id)) { delete picked[id]; delete choice[id]; } });
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
    // AI 판정 없이 열린 검토(A-25): 조사 결과가 없고 운영자가 직접 판단한다.
    if (review && !finding) steps.push({ label: 'AI 조사', time: at(failed), detail: 'AI 결과 없음 · 마감(기본 3분) 초과 또는 분석 실패', tone: 'skip' });
    else if (failed && !finding) steps.push({ label: 'AI 조사', time: at(failed), detail: 'AI 조사 실패', tone: 'wait' });
    else if (finding) steps.push({ label: 'AI 조사', time: at(end) ?? at(start), detail: start || end ? `시작 ${at(start) ?? '-'} → 완료 ${at(end) ?? '-'}` : '완료 (시각은 이 화면을 연 뒤의 기록만 보입니다)', tone: 'done' });
    else steps.push({ label: 'AI 조사', time: at(start), detail: '조사 중', tone: 'wait' });
    steps.push(finding
      ? { label: 'AI 판정', time: null, detail: `${verdictLabels[finding.verdict]} (${finding.verdict}) · ${finding.reason}${finding.policyIds.length ? ` · 정책 ${finding.policyIds.join(', ')}` : ''}`, tone: 'done' }
      : review ? { label: 'AI 판정', time: null, detail: '없음 · 운영자가 주변 문맥을 보고 직접 결정', tone: 'skip' }
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
  const openReview = props.reviews.some(r => r.kind === 'CONTEXT' && r.caseId === c.caseId && r.status === 'PENDING');
  return { label: c.findings?.length ? '결정 대기' : openReview ? '결정 대기 · AI 결과 없음' : 'AI 조사 중', tone: 'pending' };
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

function focusReview(id:string){document.querySelector<HTMLElement>(`[data-review-id="${CSS.escape(id)}"] .review-head`)?.focus();}
async function navigateTool(action: ShortcutAction) {
 if(!props.live||props.ended||props.busy)return;
 if(action==='search'){
  goto('chats');await nextTick();document.querySelector<HTMLInputElement>('[aria-label="채팅 기록 검색"]')?.focus();return;
 }
 const items=shownQueue.value.items;if(!items.length){goto('monitor');return;}
 const active=page.value==='monitor'?items.findIndex(r=>isOpen(r)):-1;
 if(action==='toggle'){
  if(page.value!=='monitor'){goto('monitor');}
  else toggleReview(items[Math.max(0,active)]);
 }else{
  const index=active<0?(action==='next'?0:items.length-1):Math.max(0,Math.min(items.length-1,active+(action==='next'?1:-1)));
  openIds[shownQueue.value.kind]=items[index].reviewId;goto('monitor');
 }
 await nextTick();focusReview(activeOf(shownQueue.value.kind)??items[Math.max(0,active)].reviewId);
}
async function openToolAlert(reviewId:string,kind:OperatorAlert['kind']){
 const r=props.reviews.find(r=>r.reviewId===reviewId&&r.liveId===props.live?.liveId);
 if(!r||props.ended)return;
 if(kind==='failure'){
  showFlow(r.caseId);await nextTick();
  document.querySelector<HTMLElement>(`[data-case-id="${CSS.escape(r.caseId)}"] .vm-expand`)?.focus();return;
 }
 if(r.status==='PENDING'){openDecision(r);await nextTick();focusReview(r.reviewId);}
}
function openDecision(r: LiveReview) { queueTab.value = r.kind; openIds[r.kind] = r.reviewId; goto('monitor'); }

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
      <div class="topbar-right"><ModeBadge :mock="mock" :online="online"/><DecisionNotifications :reviews="ended ? [] : pending" :live-id="live?.liveId??''" :ended="ended" @settings="operatorToolsRef?.openSettings()" @activity="operatorToolsRef?.openAlerts()" @open="openToolAlert($event.reviewId, 'new')"/><span class="yt-me" :style="{background: avatarColor(nickname)}" :title="nickname">{{nickname.slice(0,1)}}</span><span class="operator-info">{{nickname}}</span><button class="yt-icon-button" title="로그아웃" aria-label="로그아웃" @click="emit('logout')"><LogOut :size="20"/></button></div></header>
    <div class="app-body">
      <div v-if="!wide && navOpen" class="nav-backdrop" @click="navOpen = false"/>
      <aside id="operator-nav" class="sidebar" :class="{open: !wide && navOpen, docked: wide && !navCollapsed}" :aria-hidden="!navVisible" :inert="!navVisible">
        <div class="sidebar-channel"><span class="yt-channel-avatar big">🎮</span><b>채널 콘텐츠 관제</b><small>{{channelName}}</small></div>
        <nav class="side-nav" aria-label="운영자 메뉴">
          <button aria-label="실시간 모니터링" :class="{active: page==='monitor'}" :aria-current="page==='monitor' ? 'page' : undefined" @click="goto('monitor')"><Radio :size="22" :stroke-width="1.8"/><span>실시간 모니터링</span><b v-if="pending.length" class="side-count">{{pending.length}}</b></button>
          <button :class="{active: page==='viewers'}" :aria-current="page==='viewers' ? 'page' : undefined" @click="goto('viewers')"><Users :size="22" :stroke-width="1.8"/><span>시청자 관리</span></button>
          <button :class="{active: page==='cases'}" :aria-current="page==='cases' ? 'page' : undefined" @click="goto('cases')"><FileClock :size="22" :stroke-width="1.8"/><span>사건 이력</span></button>
 <button :class="{active: page==='chats'}" :aria-current="page==='chats' ? 'page' : undefined" @click="goto('chats')"><MessagesSquare :size="22" :stroke-width="1.8"/><span>채팅 기록</span></button>
          <button :class="{active: page==='policy'}" :aria-current="page==='policy' ? 'page' : undefined" @click="goto('policy')"><BookOpen :size="22" :stroke-width="1.8"/><span>채팅 관제 운영 정책</span></button>
        </nav>
        <div class="sidebar-foot">운영정책 v3.2 기준</div>
      </aside>
      <div class="workspace">
        <main class="main-content">
          <div class="status-strip"><div><Sparkles :size="16"/><b>{{pageTitles[page]}}</b></div>
            <div class="status-controls"><button v-if="!mock" @click="emit('refresh')"><RefreshCcw :size="14"/> 새로고침</button><button v-if="!mock && !loading && (!live || ended)" class="primary" :disabled="busy" @click="emit('start')">방송 시작</button><button v-if="!mock && live && !ended" :disabled="busy" @click="emit('end')">방송 종료</button></div></div>
          <OperatorTools ref="operatorToolsRef" :live-id="live?.liveId??''" :ended="ended" :reviews="reviews" :progress="kickProgress" @navigate="navigateTool" @open="openToolAlert"/>
          <p v-if="error" class="error-inline" role="alert"><AlertCircle :size="17"/> {{error}}</p>
          <p v-if="notice" class="studio-notice" role="status">{{notice}}</p>
          <p v-for="k in kickStates" :key="k.review.reviewId" class="kick-progress" role="status"><span>강퇴 처리 · {{nameOf(k.review.caseId)}}: <b>{{k.state}}</b></span><slot name="kick-actions" :review-id="k.review.reviewId" :state="k.state"/></p>

          <section v-if="!live && !loading" class="card secondary-page studio-empty"><Radio :size="30"/><h2>진행 중인 방송이 없습니다</h2><p>방송을 시작하면 시청자 채팅과 AI 조사 결과를 확인할 수 있습니다.</p></section>
          <template v-else-if="live">
            <div class="studio-live-line"><span :class="ended ? 'ended' : 'on'">{{ended ? '종료' : '● LIVE'}}</span> 방송 {{live.liveId.slice(0,8)}} · {{asTime(live.startedAt)}} 시작<template v-if="ended"> · 방송이 종료되어 결정할 수 없습니다</template></div>

            <p v-if="arrivalAnnouncement" class="monitor-arrival-announcement" role="status">{{arrivalAnnouncement}}</p>
            <div v-if="page==='monitor'" class="live-monitoring-grid queue-page">
                <section v-for="q in monitorQueues" :key="q.kind" class="hitl-section decision-queue" :class="q.kind.toLowerCase()" :aria-label="q.title" @focusin="queueTab=q.kind" @click="queueTab=q.kind">
                  <header class="section-head"><span class="section-icon human"><UserX v-if="q.kind==='KICK'" :size="17"/><ClipboardCheck v-else :size="17"/></span><h2>{{q.title}}</h2><span class="pending-count">{{q.items.length}}건</span><span v-if="q.items.some(r=>freshReviews.has(r.reviewId))" class="queue-new-indicator">새 요청</span></header>
                  <p class="queue-note">{{q.note}}</p>
                  <p v-if="!q.items.length" class="section-empty">{{q.empty}}</p>
                  <article v-for="r in q.items" :key="r.reviewId" class="studio-review" :class="[r.kind.toLowerCase(), {open: isOpen(r), 'review-arrival': freshReviews.has(r.reviewId)}]" :data-review-id="r.reviewId" :data-version="r.version">
                    <button type="button" class="review-head" :aria-expanded="isOpen(r)" @click="toggleReview(r)">
                      <ChevronDown v-if="isOpen(r)" :size="16"/><ChevronRight v-else :size="16"/>
                      <b>{{nameOf(r.caseId)}}</b><span v-if="freshReviews.has(r.reviewId)" class="review-new-badge">NEW</span>
                      <span class="review-excerpt">{{excerptOf(r)}}</span>
                      <span v-if="r.kind==='CONTEXT' && findingsOf(r)[0]" class="verdict-badge" :class="verdictTone(findingsOf(r)[0].verdict)">{{verdictLabels[findingsOf(r)[0].verdict]}}</span><span v-else-if="noAiResult(r)" class="verdict-badge no-ai">AI 결과 없음</span>
                      <small :title="r.kind==='CONTEXT' && sentAt(r) ? `메시지 보낸 시각 · 검토 요청 ${asTime(r.createdAt)} · 버전 ${r.version}` : `강퇴 승인 요청 시각 · 버전 ${r.version}`">{{asTime(r.kind==='CONTEXT' && sentAt(r) ? sentAt(r) : r.createdAt)}}</small>
                    </button>
                    <div v-if="isOpen(r)" class="review-body">
                      <template v-if="r.kind==='CONTEXT'">
                        <blockquote v-if="targetText(r)" class="review-target">{{targetText(r)}}</blockquote>
                        <div v-if="noAiResult(r)" class="no-ai-box" role="note" aria-label="AI 결과 없음"><b>AI 결과 없음</b><p>{{r.summary || NO_AI_NOTICE}}</p><small>AI 판정이 마감(기본 3분) 안에 오지 않았거나 분석이 실패해 AI 결과 없이 검토가 열렸습니다. 메시지는 계속 임시 비노출입니다. 결정하면 백엔드가 바로 적용합니다. 그 전에 판정이 늦게 오면 이 카드에 AI 제안이 붙습니다.</small></div>
                        <AiEvidence v-else :findings="findingsOf(r)" :mock="mock"/>
                        <div class="review-choice" role="radiogroup" aria-label="결정"><label v-for="opt in contextChoices" :key="opt.value" :class="{on: choice[r.reviewId]===opt.value}"><input type="radio" :name="'choice-' + r.reviewId" :value="opt.value" v-model="choice[r.reviewId]" :disabled="busy || ended"/>{{opt.label}}</label></div>
                        <fieldset v-if="choice[r.reviewId]==='CONFIRM_VIOLATION'" class="review-categories"><legend>적용할 위반 유형</legend><label v-for="(name, key) in categoryLabels" :key="key"><input type="checkbox" :checked="categoriesOf(r).includes(key)" :disabled="busy || ended" @change="toggleCategory(r, key, ($event.target as HTMLInputElement).checked)"/>{{name}}</label></fieldset>
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
                        <div class="review-submit"><button class="primary" :disabled="!canSubmit(r)" @click="submit(r)">제출</button></div>
                        <details class="review-more"><summary>자세히</summary>
                          <p class="review-summary">요청 문구: {{r.summary}}</p>
                          <p class="review-foot">승인 저장은 강퇴 완료가 아닙니다. 기준 사건을 다시 확인한 뒤 이번 방송 종료까지 입장·채팅이 제한됩니다. 기각하면 기존 숨김·채팅 제한은 유지됩니다.</p>
                        </details>
                      </template>
                    </div>
                  </article>
                </section>
            <section class="monitor-grid chat-only">
              <div class="stream-panel card"><div class="stream-caption"><span class="yt-channel-avatar">🎮</span><div><b>{{mock ? '오늘도 게임하는 날! 같이 놀아요 🎮' : '오늘의 라이브'}}</b><small>{{channelName}} · <span class="live-badge">{{ended ? '방송 종료' : '● 실시간'}}</span></small></div></div></div>
              <div class="chat-panel card"><div class="panel-heading"><h2>실시간 채팅 <ChevronDown :size="17"/></h2><div class="panel-heading-end"><button v-if="feedOn !== null" class="icon-control" :class="{on: feedOn}" :title="feedOn ? '채팅 흐름 일시정지 (MOCK)' : '채팅 흐름 재생 (MOCK)'" :aria-pressed="feedOn" @click="emit('toggleFeed')"><Pause v-if="feedOn" :size="17"/><Play v-else :size="17"/></button><button class="blocked-toggle" :class="{on: filter==='private'}" :aria-pressed="filter==='private'" @click="filter = filter==='all' ? 'private' : 'all'" :title="filter==='all' ? '임시 비노출·숨김 채팅만 보기' : '전체 채팅 보기'">비공개 채팅 <b>{{privateCount}}</b></button></div></div>
                <div class="scan-wrap"><span class="ai-scan" aria-hidden="true"/><div ref="chatRef" class="chat-list" @scroll.passive="onScroll">
                  <div v-for="m in shownMessages" :key="m.messageId" :data-message-id="m.messageId" class="chat-row" :class="{held: m.visibility==='HELD', hidden: m.visibility==='HIDDEN'}"><span class="chat-avatar" :style="{background: avatarColor(m.authorAlias)}">{{m.authorAlias.slice(0,1)}}</span><span class="chat-line"><b>{{m.authorAlias}}</b><span class="chat-text">{{m.text}}</span></span><span v-if="m.visibility!=='PUBLIC'" class="state-pill" :class="m.visibility.toLowerCase()">{{visibilityLabels[m.visibility]}}</span><time class="chat-time" :datetime="iso(m.sentAt)" :title="asTime(m.sentAt)">{{hourMinute(iso(m.sentAt))}}</time></div>
                  <div v-if="!shownMessages.length" class="empty-block">표시할 채팅이 없습니다.</div></div>
                  <button v-if="unread" class="new-msg-pill" @click="toBottom()">새 메시지 {{unread}}개 <ChevronDown :size="15"/></button></div>
                <div class="chat-footer"><div class="ai-notice"><ShieldCheck :size="15"/> 임시 비노출·숨김 채팅은 작성자와 담당 운영자에게만 보입니다.</div><details v-if="$slots.demo" class="demo-fold"><summary>목업 빠른 시연</summary><slot name="demo"/></details></div>
              </div>
            </section>
            </div>

            <ViewerManage v-else-if="page==='viewers'" :rows="viewerRows" :busy="busy || ended" scope="현재 방송" @decide="onViewerDecide" @revoke="onViewerRevoke"/>

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

            <section v-else-if="page==='policy'" class="secondary-page card"><div class="secondary-heading"><div><h2><BookOpen :size="24"/> 채팅 관제 운영 정책</h2><p>운영정책 v3.2(2026-10-23) 기준의 처리 경로와 제재 기준입니다. 읽기 전용이며 제재 기간은 운영자가 정하지 않습니다. 전환 전에 열린 사건은 그 사건에 기록된 v3.1로 판정합니다.</p></div></div>
              <h3 class="studio-subhead">처리 경로</h3>
              <div class="table-scroll"><table class="data-table"><thead><tr><th>경로</th><th>조건</th><th>결정</th><th>결과</th></tr></thead><tbody><tr v-for="row in routeRows" :key="row.route"><td><b>{{routeLabels[row.route]}}</b></td><td>{{row.trigger}}</td><td>{{row.decider}}</td><td>{{row.result}}</td></tr></tbody></table></div>
              <h3 class="studio-subhead">개인정보 판단 기준 (SP-3.1 · A-28)</h3>
              <ul class="studio-rules" data-policy-pii>
                <li>본인 정보도 포함하며 실존·소유자·유효성은 확인하지 않습니다. 전화번호 형태는 경고·인용·제지 목적이어도 위반입니다. 번호 없는 경고는 정상입니다.</li>
                <li>계좌·주소·계정정보 등은 형태와 노출 문맥으로 판단합니다. 숫자 나열만으로 확정하지 않으며 형태나 문맥이 불충분하면 판단 보류입니다.</li>
                <li>필터 후보는 HELD 상태에서 AI가 조사하고 백엔드가 근거·정책을 검증합니다. 개인정보 단독 위반(PII_EXPOSURE)만 운영자 결정 없이 확정하고, 다른 판단 유형이 섞이면 운영자 검토로 넘깁니다.</li>
                <li>v3.1 사건에는 소급하지 않습니다. 당시 검증 출처 요건과 서버 판정을 유지합니다. 아래 후보 탐지 규칙이 모든 개인정보 형태를 탐지한다는 뜻은 아닙니다.</li>
              </ul>
              <h3 class="studio-subhead">괴롭힘 판단 기준 (CP-3.2 · CP-3.3)</h3>
              <ul class="studio-rules" data-policy-harassment>
                <li><b>CP-3.2 괴롭힘:</b> 특정 대상을 향한 문맥상 인신공격과 괴롭힘.</li>
                <li><b>CP-3.3 집단 대상 비하·배제 <span class="policy-new">v3.2 추가</span>:</b> 지역·출신·국적·인종·민족·종교·성별·연령·장애 등 정체성 속성으로 묶인 집단의 열등성을 단정하거나, 그 집단의 배제·차별을 요구하는 표현. 대상 집단과 열등 단정 또는 배제 표현이 모두 있어야 합니다.</li>
                <li>위반이 아닌 경우: 자조, 비판·제지 목적의 인용, 정책·정치적 주장 비판, 가벼운 고정관념. 인용·자조 형식으로 실제 비하를 퍼뜨리면 예외가 아닙니다.</li>
                <li>대상 집단이 불명확하면 AI는 판단 보류(NEEDS_REVIEW)로 넘깁니다. 집단 언급만으로는 위반이 아니며, 배제처럼 보여도 배려·경고인지 불명확하면 판단 보류입니다. 특정 팀의 팬처럼 정체성 속성이 아닌 집단은 해당하지 않습니다.</li>
                <li>새 위반 유형이 아니라 괴롭힘(HARASSMENT)에 포함되므로 제재표와 강퇴 기준은 같습니다. 필터 사전은 바뀌지 않아, 공격 표현이 있는 채팅만 AI 검토 후보가 됩니다.</li>
              </ul>
              <h3 class="studio-subhead">필터 사전</h3><p class="studio-help">Backend 필터 사전(dict-v2, 팀 확정 전 초기 목록)과 같은 단어입니다. 애매한 표현(존나·지랄·'개-' 접두어·시바 등)은 일부러 넣지 않아 그대로 공개됩니다. 링크와 전화번호·계좌번호·이메일은 사전이 아니라 코드 규칙으로 찾습니다.</p>
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
          <footer class="dashboard-footer"><span>LIVE:GUARD · API v1.0 (liveId)</span><span>프론트는 <code>/api/**</code>만 사용합니다. <code>/internal/**</code>·MCP·Agent 호출은 백엔드 담당입니다.</span></footer>
        </main>
      </div>
    </div>
  </div>
</template>
