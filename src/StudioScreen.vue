<script setup lang="ts">
// 운영자(스트리머) Studio 화면. 목업과 실제 API가 같은 화면을 쓴다(#12).
// 화면은 API v1.0 모양의 데이터와 사용자 동작만 다룬다. API·SSE 연결은 LiveConsole.vue, 목업 판정은 mockLive.ts가 맡는다.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { AlertCircle, BookOpen, Bot, ChevronDown, ClipboardCheck, FileClock, History, LogOut, Menu, Pause, Play, Radio, RefreshCcw, ShieldCheck, Sparkles, Users } from 'lucide-vue-next';
import ViewerManage from './ViewerManage.vue';
import { groupByViewer, type ViewerCase, type ViewerFinding, type ViewerReview } from './viewerManage';
import { avatarColor } from './avatar';
import {
  categoryLabels, confirmationLabels, eventLabels, reviewStatusLabels, routeLabels, verdictLabels, visibilityLabels,
  type Category, type ContextDecision, type KickDecision, type Live, type LiveCase, type LiveReview, type Message, type Verdict
} from './contracts';
import { KICK_THRESHOLD, priorColumns, routeRows, sanctionFor, sanctionLabel, sanctionTable, type Sanction } from './sanction';
import { filterDictionary } from './mock';

export interface StudioLog { id: string; time: string; event: string; detail: string }
type Page = 'monitor' | 'viewers' | 'cases' | 'policy' | 'logs';

const props = withDefaults(defineProps<{
  mock?: boolean; nickname: string; channelName?: string;
  live: Live | null; ended?: boolean; loading?: boolean; online?: boolean;
  // 운영자는 HELD·HIDDEN 원문을 받는다. 오래된 순서.
  messages: Message[]; reviews: LiveReview[]; cases: LiveCase[];
  // 사건 ID → 시청자 이름. 사건·검토 응답은 작성자를 U1로 가려서 호출자가 채팅 이력으로 찾는다.
  caseNames: Record<string, string>;
  logs: StudioLog[]; kickProgress: Record<string, string>;
  busy?: boolean; error?: string; notice?: string; feedOn?: boolean | null;
}>(), { mock: false, channelName: '내 채널', ended: false, loading: false, online: false, busy: false, error: '', notice: '', feedOn: null });
const emit = defineEmits<{
  decide: [review: LiveReview, value: ContextDecision | KickDecision, reason: string, categories: Category[]];
  revoke: [caseId: string, findingId: string, reason: string];
  page: [page: Page]; refresh: []; start: []; end: []; logout: []; toggleFeed: [];
}>();

const page = ref<Page>('monitor');
const pageTitles: Record<Page, string> = { monitor: '실시간 관제', viewers: '시청자 관리', cases: '사건 이력', policy: '정책 근거', logs: '진행 기록' };
function goto(p: Page) { page.value = p; navOpen.value = false; emit('page', p); }

// 메뉴: 넓은 화면에서는 왼쪽에 고정하고 ☰로 접고 편다. 좁은 화면에서는 ☰로 여닫는 서랍이다.
const navOpen = ref(false), navCollapsed = ref(false);
const wideQuery = window.matchMedia('(min-width: 1100px)');
const wide = ref(wideQuery.matches);
const onWide = (e: MediaQueryListEvent) => { wide.value = e.matches; navOpen.value = false; };
const navVisible = computed(() => wide.value ? !navCollapsed.value : navOpen.value);
function toggleNav() { if (wide.value) navCollapsed.value = !navCollapsed.value; else navOpen.value = !navOpen.value; }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') navOpen.value = false; }
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => { window.addEventListener('keydown', onKey); wideQuery.addEventListener('change', onWide); clock = setInterval(() => { now.value = Date.now(); }, 30000); });
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); wideQuery.removeEventListener('change', onWide); clearInterval(clock); });

const iso = (v: unknown) => typeof v === 'number' ? new Date(v).toISOString() : String(v ?? '');
const asTime = (v: unknown) => { const s = iso(v); return s ? new Date(s).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit' }) : '-'; };
const waited = (v: unknown) => { const m = Math.max(0, Math.floor((now.value - Date.parse(iso(v))) / 60000)); return m < 1 ? '방금' : m < 60 ? `${m}분째 대기` : `${Math.floor(m / 60)}시간 ${m % 60}분째 대기`; };
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
const categoriesOf = (r: LiveReview) => picked[r.reviewId] ?? [...new Set(r.findings.flatMap(f => f.categories))];
function toggleCategory(r: LiveReview, c: Category, on: boolean) { const now = categoriesOf(r); picked[r.reviewId] = on ? [...new Set([...now, c])] : now.filter(x => x !== c); }
const reasonOf = (id: string) => (reasons[id] ?? '').trim();
function decide(r: LiveReview, value: ContextDecision | KickDecision) {
  const reason = reasonOf(r.reviewId); if (!reason) return;
  emit('decide', r, value, reason, value === 'CONFIRM_VIOLATION' ? categoriesOf(r) : []);
}
// 결정이 반영되어 대기 목록에서 빠지면 입력값을 지운다.
watch(() => pending.value.map(r => r.reviewId), ids => { for (const id of Object.keys(reasons)) if (!ids.includes(id)) { delete reasons[id]; delete picked[id]; } });
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

// 규칙 자동 숨김: Backend 규칙(확정 욕설·링크·도배)으로 바로 확정된 사건. 조치는 같은 시청자의 이전 확정 수로 기준표에서 계산한다.
const ruleCases = computed(() => props.cases.filter(c => c.handlingRoute === 'RULE_CONFIRMED' || c.handlingRoute === 'FLOOD_REVIEW')
  .sort((a, b) => Date.parse(iso(b.createdAt)) - Date.parse(iso(a.createdAt))));
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
          <button :class="{active: page==='monitor'}" :aria-current="page==='monitor' ? 'page' : undefined" @click="goto('monitor')"><Radio :size="20"/><span>실시간 관제</span><b v-if="pending.length" class="side-count">{{pending.length}}</b></button>
          <button :class="{active: page==='viewers'}" :aria-current="page==='viewers' ? 'page' : undefined" @click="goto('viewers')"><Users :size="20"/><span>시청자 관리</span></button>
          <button :class="{active: page==='cases'}" :aria-current="page==='cases' ? 'page' : undefined" @click="goto('cases')"><FileClock :size="20"/><span>사건 이력</span></button>
          <button :class="{active: page==='policy'}" :aria-current="page==='policy' ? 'page' : undefined" @click="goto('policy')"><BookOpen :size="20"/><span>정책 근거</span></button>
          <button :class="{active: page==='logs'}" :aria-current="page==='logs' ? 'page' : undefined" @click="goto('logs')"><History :size="20"/><span>진행 기록</span></button>
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
            <p class="studio-live-line"><span :class="ended ? 'ended' : 'on'">{{ended ? '종료' : '● LIVE'}}</span> 방송 {{live.liveId.slice(0,8)}} · {{asTime(live.startedAt)}} 시작<template v-if="ended"> · 방송이 종료되어 결정할 수 없습니다</template></p>

            <section v-if="page==='monitor'" class="monitor-grid">
              <div class="stream-panel card"><div class="stream-caption"><span class="yt-channel-avatar">🎮</span><div><b>{{mock ? '오늘도 게임하는 날! 같이 놀아요 🎮' : '오늘의 라이브'}}</b><small>{{channelName}} · <span class="live-badge">{{ended ? '방송 종료' : '● 실시간'}}</span></small></div></div></div>
              <div class="chat-panel card"><div class="panel-heading"><h2>실시간 채팅 <ChevronDown :size="17"/></h2><div class="panel-heading-end"><button v-if="feedOn !== null" class="icon-control" :class="{on: feedOn}" :title="feedOn ? '채팅 흐름 일시정지 (MOCK)' : '채팅 흐름 재생 (MOCK)'" :aria-pressed="feedOn" @click="emit('toggleFeed')"><Pause v-if="feedOn" :size="17"/><Play v-else :size="17"/></button><button class="blocked-toggle" :class="{on: filter==='private'}" :aria-pressed="filter==='private'" @click="filter = filter==='all' ? 'private' : 'all'" :title="filter==='all' ? '임시 비노출·숨김 채팅만 보기' : '전체 채팅 보기'">비공개 채팅 <b>{{privateCount}}</b></button></div></div>
                <div class="scan-wrap"><span class="ai-scan" aria-hidden="true"/><div ref="chatRef" class="chat-list" @scroll.passive="onScroll">
                  <div v-for="m in shownMessages" :key="m.messageId" :data-message-id="m.messageId" class="chat-row" :class="{held: m.visibility==='HELD', hidden: m.visibility==='HIDDEN'}"><span class="chat-avatar" :style="{background: avatarColor(m.authorAlias)}">{{m.authorAlias.slice(0,1)}}</span><span class="chat-line"><b>{{m.authorAlias}}</b><span class="chat-text">{{m.text}}</span></span><span v-if="m.visibility!=='PUBLIC'" class="state-pill" :class="m.visibility.toLowerCase()">{{visibilityLabels[m.visibility]}}</span><time class="chat-time">{{asTime(m.sentAt)}}</time></div>
                  <div v-if="!shownMessages.length" class="empty-block">표시할 채팅이 없습니다.</div></div>
                  <button v-if="unread" class="new-msg-pill" @click="toBottom()">새 메시지 {{unread}}개 <ChevronDown :size="15"/></button></div>
                <div class="chat-footer"><div class="ai-notice"><ShieldCheck :size="15"/> 임시 비노출·숨김 채팅은 작성자와 담당 운영자에게만 보입니다.</div><slot name="demo"/></div>
              </div>
              <div class="work-panel card">
                <section class="hitl-section" aria-label="운영자 결정 대기">
                  <header class="section-head"><span class="section-icon human"><ClipboardCheck :size="17"/></span><b>운영자 결정 대기</b><span class="pending-count">{{pending.length}}건</span><span class="section-note human-note">AI 제안은 참고용입니다. 공개·위반·강퇴는 운영자가 결정합니다.</span></header>
                  <p v-if="!pending.length" class="section-empty">지금은 결정이 필요한 검토가 없습니다. 문맥 판단이 필요한 채팅이나 확정 위반 {{KICK_THRESHOLD}}건이 쌓이면 여기에 표시됩니다.</p>
                  <article v-for="r in pending" :key="r.reviewId" class="studio-review" :class="r.kind.toLowerCase()" :data-review-id="r.reviewId">
                    <header><span class="review-kind" :class="r.kind.toLowerCase()">{{r.kind==='KICK' ? '강퇴 승인' : '문맥 검토'}}</span><b>{{nameOf(r.caseId)}}</b><small :title="`검토 요청 ${asTime(r.createdAt)}`"><template v-if="r.kind==='CONTEXT' && sentAt(r)">보낸 시각 {{asTime(sentAt(r))}} · </template><template v-else>{{asTime(r.createdAt)}} · </template>{{waited(r.createdAt)}} · v{{r.version}}</small></header>
                    <template v-if="r.kind==='CONTEXT'">
                      <blockquote v-if="targetText(r)" class="review-target">{{targetText(r)}}</blockquote>
                      <p v-if="repeatsOf(r).length" class="review-repeats">같은 시청자가 같은 문장을 {{repeatsOf(r).length}}번 더 보냈습니다: <span v-for="x in repeatsOf(r)" :key="x.caseId">{{x.time}} {{x.status}}</span></p>
                      <div v-for="f in r.findings" :key="f.messageId" class="review-finding"><div class="review-finding-head"><span class="verdict-badge" :class="verdictTone(f.verdict)">AI 제안 · {{verdictLabels[f.verdict]}}</span><code :title="'AI 판정 코드'">{{f.verdict}}</code><span v-for="c in f.categories" :key="c" class="vm-cat">{{categoryName(c)}}</span></div><p>{{f.reason}}</p><small>정책 {{f.policyIds.join(', ') || '-'}}</small><p v-if="f.missingFacts.length" class="review-missing">확인 필요: {{f.missingFacts.join(', ')}}</p></div>
                      <p v-if="!r.findings.length" class="section-empty">AI 조사 결과를 기다리고 있습니다.</p>
                      <details class="review-context"><summary>마스킹된 주변 문맥 · U1 = 검토 대상 작성자</summary><ol><li v-for="m in r.messages" :key="m.messageId" :class="{target: r.targetMessageIds.includes(m.messageId)}"><b>{{m.authorAlias}}</b> {{m.text}}</li></ol></details>
                      <fieldset class="review-categories"><legend>위반 확정 시 적용할 유형</legend><label v-for="(name, key) in categoryLabels" :key="key"><input type="checkbox" :checked="categoriesOf(r).includes(key)" :disabled="busy || ended" @change="toggleCategory(r, key, ($event.target as HTMLInputElement).checked)"/>{{name}}</label></fieldset>
                      <label class="review-reason-label" :for="'reason-' + r.reviewId">결정 이유 (필수)</label><textarea :id="'reason-' + r.reviewId" v-model="reasons[r.reviewId]" rows="2" maxlength="500" placeholder="확인한 근거와 결정 이유를 입력하세요" :disabled="busy || ended"/>
                      <div class="review-actions"><button :disabled="busy || ended || !reasonOf(r.reviewId)" @click="decide(r, 'CONFIRM_NORMAL')">정상 확정</button><button class="primary" :disabled="busy || ended || !reasonOf(r.reviewId) || !categoriesOf(r).length" @click="decide(r, 'CONFIRM_VIOLATION')">위반 확정</button><button :disabled="busy || ended || !reasonOf(r.reviewId)" @click="decide(r, 'DEFER')">보류</button></div>
                      <small class="review-foot">정상 확정은 공개, 위반 확정은 숨김과 기준표의 채팅 제한, 보류는 임시 비노출을 유지합니다.</small>
                    </template>
                    <template v-else>
                      <p class="review-summary">{{r.summary}}</p>
                      <table class="sanction-log basis-log"><caption>기준 사건 {{r.basisCaseIds.length}}건</caption><thead><tr><th>시간</th><th>유형</th><th>메시지</th><th>상태</th></tr></thead><tbody>
                        <tr v-for="b in basisCases(r)" :key="b.id" :data-case-id="b.id"><td class="log-time">{{b.item ? asTime(b.item.createdAt) : '-'}}</td><td class="log-cat">{{b.item ? activeCategories(b.item).map(categoryName).join('·') || '-' : '-'}}</td><td class="log-text">{{b.item ? targetText(b.item) ?? '원문 없음' : `사건 ${b.id.slice(0,8)}`}}</td><td>{{b.item ? confirmationLabels[b.item.confirmationStatus] : '확인 중'}}</td></tr></tbody></table>
                      <label class="review-reason-label" :for="'reason-' + r.reviewId">운영자 판단 근거 (필수)</label><textarea :id="'reason-' + r.reviewId" v-model="reasons[r.reviewId]" rows="2" maxlength="500" placeholder="최종 결정의 근거를 입력하세요" :disabled="busy || ended"/>
                      <div class="review-actions"><button class="primary" :disabled="busy || ended || !reasonOf(r.reviewId)" @click="decide(r, 'APPROVE')">강퇴 승인</button><button :disabled="busy || ended || !reasonOf(r.reviewId)" @click="decide(r, 'REJECT')">강퇴 기각</button></div>
                      <small class="review-foot">승인 저장은 강퇴 완료가 아닙니다. 기준 사건을 다시 확인한 뒤 이번 방송 종료까지 입장·채팅이 제한됩니다. 기각하면 기존 숨김·채팅 제한은 유지됩니다.</small>
                    </template>
                  </article>
                </section>
                <section class="auto-section" aria-label="규칙 자동 숨김 내역">
                  <header class="section-head"><span class="agent-mark section-icon"><Bot :size="16"/></span><b>규칙 자동 숨김</b><span class="section-tag">확정 욕설 · 링크 · 도배</span><span class="section-note">Backend 규칙으로 바로 숨긴 채팅입니다 · {{ruleCases.length}}건</span></header>
                  <table v-if="ruleCases.length" class="sanction-log auto-log"><thead><tr><th>시간</th><th>시청자</th><th>유형</th><th>메시지</th><th title="같은 시청자의 이전 확정 수로 기준표에서 계산한 조치">조치</th></tr></thead><tbody>
                    <tr v-for="c in ruleCases" :key="c.caseId" :data-case-id="c.caseId"><td class="log-time">{{asTime(c.createdAt)}}</td><td class="log-user"><b :title="nameOf(c.caseId)">{{nameOf(c.caseId)}}</b></td><td class="log-cat">{{activeCategories(c).map(categoryName).join('·') || '-'}}</td><td class="log-text" :title="targetText(c) ?? ''">{{targetText(c) ?? '원문 없음'}}</td><td class="log-action" :class="ruleAction(c).tone">{{ruleAction(c).label}}</td></tr></tbody></table>
                  <p v-else class="section-empty">아직 규칙으로 숨긴 채팅이 없습니다.</p>
                </section>
              </div>
            </section>

            <ViewerManage v-else-if="page==='viewers'" :rows="viewerRows" :busy="busy || ended" :scope="mock ? '현재 방송(Mock 데이터)' : '현재 방송'" @decide="onViewerDecide" @revoke="onViewerRevoke"/>

            <section v-else-if="page==='cases'" class="secondary-page card"><div class="secondary-heading"><div><h2><FileClock :size="24"/> 사건 이력</h2><p>현재 방송에서 생긴 사건의 처리 경로, AI 제안, 확정 상태입니다.</p></div><span>{{cases.length}}건</span></div>
              <div class="table-scroll"><table class="data-table"><thead><tr><th>발생 시각</th><th>시청자</th><th>메시지 (마스킹)</th><th>처리 경로</th><th>AI 제안</th><th>확정 상태</th><th>확정 유형</th></tr></thead><tbody>
                <tr v-for="c in casesByTime" :key="c.caseId"><td>{{asTime(c.createdAt)}}</td><td>{{nameOf(c.caseId)}}</td><td class="log-text">{{targetText(c) ?? '-'}}</td><td>{{c.handlingRoute ? routeLabels[c.handlingRoute] : '-'}}</td><td><span v-if="c.findings?.length" class="verdict-badge" :class="verdictTone(c.findings[0].verdict)">{{verdictLabels[c.findings[0].verdict]}}</span><span v-else class="vm-muted">-</span></td><td>{{confirmationLabels[c.confirmationStatus] ?? c.confirmationStatus}}</td><td>{{activeCategories(c).map(categoryName).join('·') || '-'}}</td></tr></tbody></table></div>
              <p v-if="!cases.length" class="empty-block">아직 사건이 없습니다.</p>
              <h3 class="studio-subhead">검토 기록</h3>
              <div class="table-scroll"><table class="data-table"><thead><tr><th>요청 시각</th><th>종류</th><th>시청자</th><th>상태</th></tr></thead><tbody>
                <tr v-for="r in reviews" :key="r.reviewId"><td>{{asTime(r.createdAt)}}</td><td>{{r.kind==='KICK' ? '강퇴 승인' : '문맥 검토'}}</td><td>{{nameOf(r.caseId)}}</td><td>{{reviewStatusLabels[r.status] ?? r.status}}<template v-if="kickStateOf(r)"> · {{kickStateOf(r)}}</template></td></tr></tbody></table></div></section>

            <section v-else-if="page==='policy'" class="secondary-page card"><div class="secondary-heading"><div><h2><BookOpen :size="24"/> 정책 근거</h2><p>운영정책 v3.1 기준의 처리 경로와 제재 기준입니다. 읽기 전용이며 제재 기간은 운영자가 정하지 않습니다.</p></div></div>
              <h3 class="studio-subhead">처리 경로</h3>
              <div class="table-scroll"><table class="data-table"><thead><tr><th>경로</th><th>조건</th><th>결정</th><th>결과</th></tr></thead><tbody><tr v-for="row in routeRows" :key="row.route"><td><b>{{routeLabels[row.route]}}</b></td><td>{{row.trigger}}</td><td>{{row.decider}}</td><td>{{row.result}}</td></tr></tbody></table></div>
              <h3 class="studio-subhead">필터 사전</h3><p class="studio-help">Backend 필터 사전(dict-v2, 팀 확정 전 초기 목록)과 같은 단어입니다. 애매한 표현(존나·지랄·'개-' 접두어·시바 등)은 일부러 넣지 않아 그대로 공개됩니다. 링크와 전화번호·이메일은 사전이 아니라 코드 규칙으로 찾습니다.</p>
              <div class="table-scroll"><table class="data-table studio-dict"><thead><tr><th>사전</th><th>단어</th><th>처리</th></tr></thead><tbody><tr v-for="row in dictRows" :key="row.name"><td><b>{{row.name}}</b></td><td><code v-for="w in row.words" :key="w">{{w}}</code></td><td>{{row.result}}</td></tr></tbody></table></div>
              <h3 class="studio-subhead">제재 기준표 (MP-2.1)</h3><p class="studio-help">같은 방송·같은 유형의 이전 확정 사건 수로 정합니다. 모든 채팅 제한은 자동 적용되며, 24시간 제한도 강퇴가 아닙니다.</p>
              <div class="table-scroll"><table class="data-table sanction-table"><thead><tr><th>유형</th><th v-for="col in priorColumns" :key="col">{{col}}</th></tr></thead><tbody><tr v-for="[cat, row] in sanctionRows" :key="cat"><td><b>{{categoryName(cat)}}</b><small>{{cat}}</small></td><td v-for="(cell, i) in row" :key="i">{{sanctionLabel(cell)}}</td></tr></tbody></table></div>
              <h3 class="studio-subhead">강퇴 심사 (MP-4.1~4.3)</h3>
              <ul class="studio-rules"><li>유형과 관계없이 최근 24시간의 서로 다른 확정 사건이 {{KICK_THRESHOLD}}건 이상이면 강퇴 승인 요청이 만들어집니다.</li><li>운영자가 승인하면 기준 사건을 다시 확인한 뒤 실행합니다. 효력은 <b>이번 방송 종료까지</b>입니다.</li><li>승인·기각으로 결정된 요청에 쓰인 사건은 소진되어 다음 강퇴 심사에서 다시 세지 않습니다.</li><li>기준 사건이 오판 취소되면 그 강퇴 요청은 무효가 되고, 이미 실행된 강퇴도 풀립니다. 결정된 뒤 무효가 된 요청의 나머지 사건도 소진 상태로 남습니다.</li></ul></section>

            <section v-else class="secondary-page card"><div class="secondary-heading"><div><h2><History :size="24"/> 진행 기록</h2><p>이 화면이 받은 실시간 이벤트입니다. 새로고침하면 사라집니다. 장기 감사 로그 API는 없습니다.</p></div><span>{{logs.length}}건</span></div>
              <div class="table-scroll"><table class="data-table"><thead><tr><th>시간</th><th>이벤트</th><th>상세</th></tr></thead><tbody><tr v-for="l in logs" :key="l.id"><td>{{asTime(l.time)}}</td><td>{{eventLabels[l.event] ?? l.event}} <small class="vm-muted">{{l.event}}</small></td><td class="log-detail">{{l.detail}}</td></tr></tbody></table></div>
              <p v-if="!logs.length" class="empty-block">새 이벤트를 기다립니다.</p></section>
          </template>
          <footer class="dashboard-footer"><span>LIVE:GUARD · API v1.0 (liveId){{mock ? ' · MOCK' : ''}}</span><span>프론트는 <code>/api/**</code>만 사용합니다. <code>/internal/**</code>·MCP·Agent 호출은 백엔드 담당입니다.</span></footer>
        </main>
      </div>
    </div>
  </div>
</template>
