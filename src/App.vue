<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { AlertCircle, ArrowRight, Bell, BookOpen, CheckCircle2, ChevronDown, ClipboardCheck, EllipsisVertical, FileClock, History, LogOut, Menu, Radio, RefreshCcw, Search, ShieldCheck, ShieldQuestion, ShieldX, Bot, Pause, Play, Sparkles, UserX, Users, ClipboardList } from 'lucide-vue-next';
import { avatarColor } from './avatar';
import LoginPage from './LoginPage.vue';
import ViewerPage from './ViewerPage.vue';
import SystemPage from './SystemPage.vue';
import LiveConsole from './LiveConsole.vue';
import ViewerManage from './ViewerManage.vue';
import { groupByViewer, type ViewerCase, type ViewerReview } from './viewerManage';
import { useLiveGuard } from './stores/liveGuard';
import { categoryLabels, reviewLabels, statusLabels, visibilityLabels, type KickReview, type CaseDetail } from './contracts';
import { demoScenarios } from './mock';
import { hideLabels, needsApproval, priorColumn, priorColumns, sanctionFor, sanctionLabel, sanctionTable, timeoutText } from './sanction';
const store = useLiveGuard();
const liveV1 = import.meta.env.VITE_USE_LIVE_V1 === 'true';
const page = ref<'monitor' | 'viewers' | 'reviews' | 'policy' | 'audit' | 'cases'>('monitor');
const pageTitles: Record<typeof page.value, string> = { monitor: '실시간 채팅', viewers: '시청자 관리', reviews: '검토 대기', cases: '사건 이력', policy: '정책 근거', audit: '감사 로그 · 실행 기록' };
const filter = ref<'all' | 'flagged'>('all');
const reasons = reactive<Record<string, string>>({});
const now = ref(Date.now());
let clock: number | undefined;
const selected = computed(() => store.selectedCase);
// 채팅 따라 내려가기: 사용자가 직접 위로 스크롤했을 때만 멈추고, 그동안 온 메시지 수를 버튼으로 알려준다.
const chatListRef = ref<HTMLElement | null>(null);
const chatFollow = ref(true);
const chatUnread = ref(0);
function chatToBottom(smooth = true) { const el = chatListRef.value; if (!el) return; el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); chatFollow.value = true; chatUnread.value = 0; }
function onChatScroll() { const el = chatListRef.value; if (!el) return; const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40; chatFollow.value = atBottom; if (atBottom) chatUnread.value = 0; }
watch(chatListRef, el => { if (el) nextTick(() => chatToBottom(false)); });
watch(() => store.messages.length, async (n, old) => {
  await nextTick();
  if (chatFollow.value) chatToBottom(); else if (n > old) chatUnread.value += n - old;
});
const blockedCount = computed(() => store.messages.filter(m => m.visibility !== 'PUBLIC').length);
const visibleMessages = computed(() => filter.value === 'all' ? store.messages : store.messages.filter(m => m.visibility !== 'PUBLIC'));
const activeReview = computed(() => store.pendingReviews);
// 따로 펼친 카드가 없으면 가장 최근 interrupt를 펼쳐 둔다.
// 제재 대화 내역의 조치 배지. 사건의 위반 유형과 판정 시점 이전 확정 수로 기준표 조치를 구한다.
function caseAction(c: CaseDetail) {
  if (store.revokedCases[c.caseId]) return { label: '오판 취소', tone: 'none', title: `오판 취소: ${store.revokedCases[c.caseId]}` };
  if (c.verdict !== 'VIOLATION' || !c.category) return { label: '조치 없음', tone: 'none', title: '위반 확정이 아닌 사건' };
  const x = sanctionFor(c.category, Math.max(c.violationCount - 1, 0));
  const hide = hideLabels[x.hide];
  // 기준표상 24시간 대상이어도 이미 대기 중인 검토가 있어 검토와 연결되지 않은 사건은 숨김만 적용됐다.
  if (needsApproval(x) && !c.kickReview && c.status !== 'KICK_REVIEW_PENDING') return { label: hide, tone: 'hide', title: `${sanctionLabel(x)} 대상이지만 대기 중인 검토가 있어 숨김만 적용` };
  if (needsApproval(x)) return { label: c.kickReview?.status === 'PENDING' || c.status === 'KICK_REVIEW_PENDING' ? '강퇴 승인 대기' : '강퇴', tone: 'approval', title: sanctionLabel(x) };
  if (x.timeoutSec) return { label: `${hide} + 10분 제한`, tone: 'timeout', title: sanctionLabel(x) };
  return { label: hide, tone: 'hide', title: sanctionLabel(x) };
}
// AI가 조치한(사건이 있는) 사용자. 승인 대기 → 추가 검토 → 최근 순. 선택이 없으면 맨 앞 사용자를 보여준다.
interface QueueUser { alias: string; cases: CaseDetail[]; review: KickReview | null; violations: number; needsReview: number; last: string }
const queue = computed<QueueUser[]>(() => {
  const byUser = new Map<string, CaseDetail[]>();
  for (const c of Object.values(store.details)) byUser.set(c.userAlias, [...(byUser.get(c.userAlias) ?? []), c]);
  return [...byUser].map(([alias, list]) => {
    const cases = list.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { alias, cases, review: cases.map(c => c.kickReview).find(r => r?.status === 'PENDING') ?? null, violations: cases.filter(c => c.verdict === 'VIOLATION').length, needsReview: cases.filter(c => c.status === 'NEEDS_REVIEW').length, last: cases[cases.length - 1].createdAt };
  }).sort((a, b) => Number(!!b.review) - Number(!!a.review) || Number(b.needsReview > 0) - Number(a.needsReview > 0) || b.last.localeCompare(a.last));
});
const pendingUsers = computed(() => queue.value.filter(u => u.review));
const pickedPending = ref<string | null>(null);
const pendingUser = computed(() => pendingUsers.value.find(u => u.alias === pickedPending.value) ?? pendingUsers.value[0] ?? null);
// 채팅·표에서 승인 대기 사용자의 사건을 고르면 위 단에서 그 사용자를 연다.
watch(() => store.selectedCaseId, id => { const alias = id ? store.details[id]?.userAlias : null; if (alias && pendingUsers.value.some(u => u.alias === alias)) pickedPending.value = alias; }, { immediate: true });
// AI 자동 조치: 사람 승인 없이 Agent 판정으로 바로 적용된 조치(숨김, 숨김 + 10분 제한). 최신 순.
const autoActions = computed(() => Object.values(store.details).filter(c => ['hide', 'timeout'].includes(caseAction(c).tone)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
// 사용자 ID는 OpenAPI 응답에 없다. Mock에서만 시연용 ID를 보여주고, API 모드에서는 '-'로 둔다.
const userIdOf = (c: CaseDetail) => store.mode === 'mock' ? store.owners[c.messages[0]?.messageId ?? ''] ?? null : null;
const shortId = (id: string | null) => id ? `ID …${id.slice(-6)}` : 'ID -';
const waited = (v: string) => { const m = Math.max(0, Math.floor((now.value - new Date(v).getTime()) / 60000)); return m < 1 ? '방금' : m < 60 ? `${m}분째` : `${Math.floor(m / 60)}시간 ${m % 60}분째`; };
// CaseDetail.violationCount는 현재 사건을 포함한 판정 시점 누적 수라서 1을 빼 이전 확정 수로 쓴다.
const selectedPrior = computed(() => Math.max((selected.value?.violationCount ?? 1) - 1, 0));
const selectedSanction = computed(() => selected.value?.verdict === 'VIOLATION' && selected.value.category ? sanctionFor(selected.value.category, selectedPrior.value) : null);
const sanctionRows = Object.entries(sanctionTable) as [keyof typeof sanctionTable, (typeof sanctionTable)[keyof typeof sanctionTable]][];
const selectedPolicies = computed(() => selected.value?.policySnapshots ?? []);
const asTime = (v: string) => new Date(v).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });
const asDate = (v: string) => new Date(v).toLocaleString('ko-KR');
const categoryName = (v?: keyof typeof categoryLabels | null) => v ? categoryLabels[v] : '분석 대기';
const verdictName = (v?: string | null) => ({ VIOLATION: '위반 확정', NO_VIOLATION: '위반 아님', NEEDS_REVIEW: '추가 검토' } as Record<string, string>)[v ?? ''] ?? '분석 중';
const verdictTone = (v?: string | null) => ({ VIOLATION: 'violation', NO_VIOLATION: 'clear', NEEDS_REVIEW: 'review' } as Record<string, string>)[v ?? ''] ?? 'pending';
// 메뉴: 넓은 화면에서는 YouTube Studio처럼 왼쪽에 고정하고 ☰로 접고 편다. 좁은 화면에서는 ☰로 여닫는 서랍이다.
const navOpen = ref(false);
const navCollapsed = ref(false);
const wideQuery = window.matchMedia('(min-width: 1100px)');
const wide = ref(wideQuery.matches);
const onWide = (e: MediaQueryListEvent) => { wide.value = e.matches; navOpen.value = false; };
const navVisible = computed(() => wide.value ? !navCollapsed.value : navOpen.value);
function toggleNav() { if (wide.value) navCollapsed.value = !navCollapsed.value; else navOpen.value = !navOpen.value; }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') navOpen.value = false; }
function goto(section: typeof page.value) { page.value = section; navOpen.value = false; }
// 시청자 관리(#5): Mock 사건을 ERD 모양(확정 상태·finding·검토)으로 바꿔 시청자별로 묶는다. 이름은 Mock 시청자 닉네임이다.
const viewerRows = computed(() => {
  const all = Object.values(store.details);
  const cases: ViewerCase[] = all.map(c => {
    const revoked = !!store.revokedCases[c.caseId];
    return {
      caseId: c.caseId, name: c.userAlias, createdAt: c.createdAt, text: c.messages[0]?.text ?? null,
      confirmationStatus: revoked ? 'CANCELLED' : c.verdict === 'VIOLATION' ? 'CONFIRMED_VIOLATION' : c.verdict === 'NO_VIOLATION' ? 'CONFIRMED_NORMAL' : 'PENDING',
      findings: c.verdict === 'VIOLATION' && c.category ? [{ findingId: `${c.caseId}:${c.category}`, category: c.category, status: revoked ? 'REVOKED' : 'CONFIRMED' }] : [],
      violationCount: c.violationCount, version: c.version
    };
  });
  const reviews: ViewerReview[] = [
    ...store.kickReviews.map(r => ({ reviewId: r.reviewId, kind: 'KICK' as const, status: r.status === 'PENDING' ? 'PENDING' as const : 'DECIDED' as const, createdAt: r.createdAt, summary: r.summary, caseIds: r.caseIds })),
    ...all.filter(c => c.status === 'NEEDS_REVIEW' || store.contextDecided[c.caseId]).map(c => ({ reviewId: `ctx:${c.caseId}`, kind: 'CONTEXT' as const, status: store.contextDecided[c.caseId] ? 'DECIDED' as const : 'PENDING' as const, createdAt: c.createdAt, summary: c.reason ?? 'AI가 판단을 보류해 운영자 확인이 필요합니다.', caseIds: [c.caseId] }))
  ];
  return groupByViewer(cases, reviews);
});
// 검토 대기(문맥 / 강퇴 분리, ARCHITECTURE.md "별도 구분")
const reviewTab = ref<'CONTEXT' | 'KICK'>('CONTEXT');
const pendingItems = computed(() => viewerRows.value.flatMap(row => row.reviews.filter(r => r.status === 'PENDING').map(review => ({ name: row.name, review, text: row.cases.find(c => review.caseIds.includes(c.caseId))?.text ?? null }))));
const pendingOfKind = (kind: 'CONTEXT' | 'KICK') => pendingItems.value.filter(it => it.review.kind === kind);
async function onViewerDecide(review: ViewerReview, value: string, reason: string) {
  const ok = review.kind === 'KICK'
    ? await store.decide(review.reviewId, value as 'APPROVE' | 'REJECT', reason)
    : store.decideContext(review.caseIds[0], value as 'CONFIRM_NORMAL' | 'CONFIRM_VIOLATION' | 'DEFER', reason);
  if (ok) delete reasons[review.reviewId];
}
function onViewerRevoke(item: ViewerCase, _finding: unknown, reason: string) { store.revokeCase(item.caseId, reason); }
function openKick(name: string) { pickedPending.value = name; goto('monitor'); }
async function copyReviewId(id: string) {
  try { await navigator.clipboard.writeText(id); store.toast('검토 ID를 복사했습니다.'); }
  catch { store.toast(`검토 ID: ${id}`); }
}
async function submitKick(item: KickReview, decision: 'APPROVE' | 'REJECT') {
  const id = item.reviewId;
  if (await store.decide(id, decision, (reasons[id] ?? '').trim())) delete reasons[id];
}
function selectCase(item: CaseDetail | {caseId:string}) { store.selectCase(item.caseId); goto('monitor'); }
const viewing = computed(() => !store.loginRequired && store.me?.role === 'VIEWER');
const systemView = computed(() => !store.loginRequired && store.me?.role === 'PLATFORM_ADMIN');
onMounted(() => { window.addEventListener('keydown', onKey); wideQuery.addEventListener('change', onWide); store.init(); clock = window.setInterval(() => { now.value = Date.now(); }, 30000); });
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); wideQuery.removeEventListener('change', onWide); store.dispose(); window.clearInterval(clock); });
</script>

<template>
  <LoginPage v-if="store.loginRequired || !store.me"/>
  <LiveConsole v-else-if="liveV1 && store.mode==='api'"/>
  <ViewerPage v-else-if="viewing"/>
  <SystemPage v-else-if="systemView"/>
  <div v-else class="app-shell">
    <header class="topbar"><div class="topbar-title"><button class="yt-icon-button" :class="{on: navVisible}" :title="navVisible ? '메뉴 닫기' : '메뉴 열기'" aria-controls="operator-nav" :aria-expanded="navVisible" @click="toggleNav"><Menu :size="22"/></button><a class="yt-logo" href="#"><span class="yt-logo-mark"><ShieldCheck :size="15"/></span><b>LIVE<span>:</span>GUARD</b></a><span class="console-tag">Studio</span></div><div class="studio-search"><Search :size="19"/><span>채널에서 사건·사용자 검색</span></div><div class="topbar-right"><span v-if="store.mode!=='mock'" class="connection"><span class="online-dot"/> {{store.online ? '실시간 연결' : 'SSE 대기'}}</span><button class="yt-icon-button" title="알림"><Bell :size="21"/></button><span class="yt-me" :style="{background: avatarColor(store.me?.nickname ?? '운영자')}" :title="store.me?.nickname">{{(store.me?.nickname ?? '운').slice(0,1)}}</span><span class="operator-info">{{store.me?.nickname}}</span><button class="header-logout" @click="store.logout()"><LogOut :size="16"/> 로그아웃</button></div></header>
    <div class="app-body">
    <div v-if="!wide && navOpen" class="nav-backdrop" @click="navOpen = false"/>
    <aside id="operator-nav" class="sidebar" :class="{open: !wide && navOpen, docked: wide && !navCollapsed}" :aria-hidden="!navVisible" :inert="!navVisible">
      <div class="sidebar-channel"><span class="yt-channel-avatar big">🎮</span><b>채널 콘텐츠 관제</b><small>행복한게임방</small></div>
      <nav class="side-nav" aria-label="운영자 메뉴">
        <button :class="{active:page==='monitor'}" @click="goto('monitor')"><Radio :size="20"/><span>실시간 채팅</span></button>
        <button :class="{active:page==='viewers'}" @click="goto('viewers')"><Users :size="20"/><span>시청자 관리</span></button>
        <button :class="{active:page==='reviews'}" @click="goto('reviews')"><ClipboardList :size="20"/><span>검토 대기</span><b v-if="pendingItems.length" class="side-count">{{pendingItems.length}}</b></button>
        <button :class="{active:page==='cases'}" @click="goto('cases')"><FileClock :size="20"/><span>사건 이력</span></button>
        <button :class="{active:page==='policy'}" @click="goto('policy')"><BookOpen :size="20"/><span>정책 근거</span></button>
        <button :class="{active:page==='audit'}" @click="goto('audit')"><History :size="20"/><span>실행 기록</span></button>
      </nav>
      <div v-if="store.mode!=='mock'" class="sidebar-foot"><span class="online-dot"/>{{store.online ? 'SSE 연결됨' : '연결 확인 중'}}</div>
    </aside>
    <div class="workspace">
      <main class="main-content">
        <div class="status-strip" :class="{'monitor-strip': page==='monitor'}"><div><Sparkles :size="16"/><b>{{pageTitles[page]}}</b><span v-if="store.mode !== 'mock'">LIVE API · 서버 권한 적용</span></div><div v-if="page==='monitor'" class="strip-right"><b>실시간 AI 채팅 관제</b></div><div class="status-controls"><button v-if="store.mode!=='mock'" @click="store.refreshMessages();store.refreshCases()"><RefreshCcw :size="14"/> 새로고침</button></div></div>
        <div v-if="store.error" class="error-inline" role="alert"><AlertCircle :size="17"/> {{store.error}}</div>

        <template v-if="page==='monitor'">
          <section class="monitor-grid">
            <div class="stream-panel card"><div class="stream-caption"><span class="yt-channel-avatar">🎮</span><div><b>오늘도 게임하는 날! 같이 놀아요 🎮</b><small>행복한게임방 · <span class="live-badge">● 실시간</span> · 게임 · 소통 · 한국어</small></div><span class="stream-note">데모 영상 루프 재생</span></div></div>
            <div class="chat-panel card"><div class="panel-heading"><h2>실시간 채팅 <ChevronDown :size="17"/></h2><div class="panel-heading-end"><button v-if="store.mode==='mock'" class="icon-control" :class="{on: store.feedOn}" :title="store.feedOn ? '채팅 흐름 일시정지 (MOCK)' : '채팅 흐름 재생 (MOCK)'" :aria-pressed="store.feedOn" @click="store.toggleFeed()"><Pause v-if="store.feedOn" :size="17"/><Play v-else :size="17"/></button><button class="blocked-toggle" :class="{on: filter==='flagged'}" :aria-pressed="filter==='flagged'" @click="filter = filter==='all' ? 'flagged' : 'all'" :title="filter==='all'?'AI가 숨긴(임시 비노출·숨김) 채팅만 보기':'전체 채팅 보기'">AI가 숨긴 채팅 <b>{{blockedCount}}</b></button><button class="icon-control" title="더보기"><EllipsisVertical :size="18"/></button></div></div>
              <div class="scan-wrap"><span class="ai-scan" aria-hidden="true"/><div ref="chatListRef" class="chat-list" @scroll.passive="onChatScroll"><button v-for="msg in visibleMessages" :key="msg.messageId" class="chat-row" :class="{held:msg.visibility==='HELD',hidden:msg.visibility==='HIDDEN',selected:store.selectedMessageId===msg.messageId}" @click="store.selectMessage(msg.messageId)"><span class="chat-avatar" :style="{background: avatarColor(msg.authorAlias)}">{{msg.authorAlias.slice(0,1)}}</span><span class="chat-line"><b>{{msg.authorAlias}}</b><span class="chat-text">{{msg.text}}</span></span><span v-if="msg.visibility!=='PUBLIC'" class="state-pill" :class="msg.visibility.toLowerCase()">{{visibilityLabels[msg.visibility]}}</span><time class="chat-time">{{asTime(msg.sentAt)}}</time></button><div v-if="!visibleMessages.length" class="empty-block">표시할 채팅이 없습니다.</div></div><button v-if="chatUnread" class="new-msg-pill" @click="chatToBottom()">새 메시지 {{chatUnread}}개 <ChevronDown :size="15"/></button></div>
              <div class="chat-footer"><div class="ai-notice"><ShieldCheck :size="15"/> 매너있는 채팅 부탁드려요! LIVE:GUARD Agent가 채팅방을 관리 중입니다.</div><div v-if="store.mode==='mock'" class="scenario-toolbar"><span>빠른 시연</span><button v-for="s in demoScenarios" :key="s.key" @click="store.mockScenario(s.key)">{{s.label}}</button></div></div>
            </div>
            <div class="work-panel card">
              <section class="hitl-section" aria-label="추방 조치 대상자">
                <header class="section-head"><span class="section-icon human"><ClipboardCheck :size="17"/></span><b>추방 조치 대상자</b><span class="section-tag">AI - 추방 대상 리포팅</span><span class="section-note human-note">강퇴 여부를 운영자가 결정합니다</span><span v-if="pendingUser" class="interrupt-wait"><i class="pulse-dot"/> 운영자 승인 대기중 {{waited(pendingUser.review!.createdAt)}}</span></header>
                <div v-if="pendingUsers.length > 1" class="pending-chips"><button v-for="u in pendingUsers" :key="u.alias" :class="{active: u.alias===pendingUser?.alias}" @click="pickedPending=u.alias">{{u.alias}}</button></div>
                <template v-if="pendingUser"><template v-for="item in [pendingUser.review!]" :key="item.reviewId">
                <ol class="escalation" aria-label="조치 진행 단계"><li v-for="(c, n) in pendingUser.cases" :key="c.caseId" :class="caseAction(c).tone"><span class="step-no">{{n + 1}}</span><span class="step-body"><b>{{caseAction(c).tone === 'approval' ? '추방 결정 (관리자 승인)' : '자동 숨김'}}</b><small>{{categoryName(c.category)}} · {{asTime(c.createdAt)}}<template v-if="caseAction(c).tone === 'timeout'"> · + 10분 제한</template></small></span></li></ol>
                <div class="interrupt-summary" aria-label="Agent 요약"><span class="agent-mark" title="LIVE:GUARD Agent"><Bot :size="16"/><Sparkles :size="9" class="agent-spark"/></span><dl><dt>AI 판정</dt><dd class="kick-reco"><b>강퇴 권장</b></dd><dt>사유</dt><dd>{{item.summary}}</dd><dt class="full">제재 대화 내역</dt><dd class="full"><table class="sanction-log user-log"><thead><tr><th>시간</th><th>사용자</th><th>유형</th><th>메시지</th><th>AI 판정</th><th>조치</th></tr></thead><tbody><tr v-for="c in pendingUser.cases" :key="c.caseId" @click="store.selectCase(c.caseId)" :class="{selected: store.selectedCaseId===c.caseId}"><td class="log-time">{{asTime(c.createdAt)}}</td><td class="log-user"><b :title="c.userAlias">{{c.userAlias}}</b><small :title="userIdOf(c) ?? '명세 응답에 사용자 ID 없음'">{{shortId(userIdOf(c))}}</small></td><td class="log-cat">{{categoryName(c.category)}}</td><td class="log-text" :title="c.messages[0]?.text">{{c.messages[0]?.text || '원문 없음'}}</td><td><span class="verdict-badge" :class="verdictTone(c.verdict)">{{verdictName(c.verdict)}}</span></td><td class="log-action" :class="caseAction(c).tone" :title="caseAction(c).title">{{caseAction(c).label}}</td></tr></tbody></table></dd></dl></div>
                <div class="review-meta-wrap"><button type="button" class="review-meta-line" :title="`검토 ID ${item.reviewId} · 클릭하면 복사`" @click="copyReviewId(item.reviewId)">REVIEW {{item.reviewId.slice(0,8)}} · v{{item.version}} · {{asTime(item.createdAt)}} 생성 · 확정 사건 {{item.caseIds.length}}건</button></div>
                <div class="kick-decision"><textarea :id="`reason-${item.reviewId}`" v-model="reasons[item.reviewId]" rows="1" maxlength="500" aria-label="운영자 판단 근거 (필수)" placeholder="운영자 판단 근거 (필수) · 최종 결정의 근거를 입력하세요"/><div class="decision-choice"><button class="active approve" :disabled="!(reasons[item.reviewId] ?? '').trim()||store.busy" :title="!(reasons[item.reviewId] ?? '').trim() ? '판단 근거를 입력하면 제출할 수 있어요' : '강퇴 승인 제출'" @click="submitKick(item, 'APPROVE')"><UserX :size="16"/> {{store.busy?'처리 중…':'강퇴 승인'}}</button><button :disabled="!(reasons[item.reviewId] ?? '').trim()||store.busy" :title="!(reasons[item.reviewId] ?? '').trim() ? '판단 근거를 입력하면 제출할 수 있어요' : '강퇴 기각 제출'" @click="submitKick(item, 'REJECT')">강퇴 기각 (가림 유지)</button></div><p class="decision-foot"><span class="interrupt-sanction">승인하면 재검증 후 <code>kick_user</code>로 이번 방송 종료까지 입장·채팅이 제한됩니다.</span><small>{{(reasons[item.reviewId] ?? '').length}} / 500</small></p></div>
                </template></template>
                <p v-else class="section-empty">지금은 사람의 결정이 필요한 건이 없습니다.</p>
              </section>
              <section class="auto-section" aria-label="숨김 대화 내역">
                <header class="section-head"><span class="agent-mark section-icon"><Bot :size="16"/><Sparkles :size="9" class="agent-spark"/></span><b>숨김 대화 내역</b><span class="section-tag">AI - 악성채팅 자동 숨김</span><span class="section-note">AI가 자동으로 숨김 처리한 대화 내용입니다 · {{autoActions.length}}건</span></header>
                <table v-if="autoActions.length" class="sanction-log auto-log"><thead><tr><th>시간</th><th>사용자</th><th>유형</th><th>메시지</th><th>자동 조치</th></tr></thead><tbody><tr v-for="c in autoActions" :key="c.caseId" @click="store.selectCase(c.caseId)" :class="{selected: store.selectedCaseId===c.caseId}"><td class="log-time">{{asTime(c.createdAt)}}</td><td class="log-user"><b :title="c.userAlias">{{c.userAlias}}</b></td><td class="log-cat">{{categoryName(c.category)}}</td><td class="log-text" :title="c.messages[0]?.text">{{c.messages[0]?.text || '원문 없음'}}</td><td class="log-action" :class="caseAction(c).tone" :title="caseAction(c).title">{{caseAction(c).label}}</td></tr></tbody></table>
                <p v-else class="section-empty">아직 AI가 숨긴 대화가 없습니다.</p>
              </section>
            </div>
          </section>
        </template>

        <ViewerManage v-else-if="page==='viewers'" :rows="viewerRows" :busy="store.busy" :scope="store.mode==='mock' ? '현재 방송(Mock 데이터)' : '현재 방송'" @decide="onViewerDecide" @revoke="onViewerRevoke"/>
        <section v-else-if="page==='reviews'" class="secondary-page card"><div class="secondary-heading"><div><h2><ClipboardList :size="24"/> 검토 대기</h2><p>사람의 결정이 필요한 검토를 문맥 검토와 강퇴 승인으로 나눠 보여 줍니다.</p></div><span>{{pendingItems.length}}건</span></div>
          <div class="vm-chips" role="group" aria-label="검토 종류"><button :class="{on: reviewTab==='CONTEXT'}" :aria-pressed="reviewTab==='CONTEXT'" @click="reviewTab='CONTEXT'">문맥 검토 <b>{{pendingOfKind('CONTEXT').length}}</b></button><button :class="{on: reviewTab==='KICK'}" :aria-pressed="reviewTab==='KICK'" @click="reviewTab='KICK'">강퇴 승인 <b>{{pendingOfKind('KICK').length}}</b></button></div>
          <div v-for="it in pendingOfKind(reviewTab)" :key="it.review.reviewId" class="vm-review"><div class="vm-review-head"><b>{{it.name}}</b><span class="vm-muted">{{asTime(it.review.createdAt)}} · {{it.review.summary}}</span></div><p v-if="it.text" class="vm-text">{{it.text}}</p>
            <textarea v-model="reasons[it.review.reviewId]" rows="2" maxlength="500" placeholder="판단 근거 (필수)" :aria-label="`${it.name} 판단 근거`"/>
            <div class="vm-actions"><template v-if="it.review.kind==='KICK'"><button class="vm-btn primary" :disabled="store.busy || !(reasons[it.review.reviewId] ?? '').trim()" @click="onViewerDecide(it.review, 'APPROVE', reasons[it.review.reviewId].trim())">강퇴 승인</button><button class="vm-btn" :disabled="store.busy || !(reasons[it.review.reviewId] ?? '').trim()" @click="onViewerDecide(it.review, 'REJECT', reasons[it.review.reviewId].trim())">기각</button><button class="vm-link" @click="openKick(it.name)">제재 대화 내역 보기 →</button></template>
              <template v-else><button class="vm-btn" :disabled="store.busy || !(reasons[it.review.reviewId] ?? '').trim()" @click="onViewerDecide(it.review, 'CONFIRM_NORMAL', reasons[it.review.reviewId].trim())">정상 확정</button><button class="vm-btn primary" :disabled="store.busy || !(reasons[it.review.reviewId] ?? '').trim()" @click="onViewerDecide(it.review, 'CONFIRM_VIOLATION', reasons[it.review.reviewId].trim())">위반 확정</button><button class="vm-btn" :disabled="store.busy || !(reasons[it.review.reviewId] ?? '').trim()" @click="onViewerDecide(it.review, 'DEFER', reasons[it.review.reviewId].trim())">보류</button></template></div></div>
          <div v-if="!pendingOfKind(reviewTab).length" class="empty-block">대기 중인 {{reviewTab==='KICK' ? '강퇴 승인' : '문맥 검토'}}가 없습니다.</div></section>
        <section v-else-if="page==='cases'" class="secondary-page card"><div class="secondary-heading"><div><h2><FileClock :size="24"/> 사건 이력</h2><p>사건 상태, 판정 결과, 운영자 검토 대상 기록을 확인합니다.</p></div><span>{{store.allCases.length}}건</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>발생 일시</th><th>작성자</th><th>1차 필터</th><th>Agent 판정</th><th>유형</th><th>상태</th><th>상세</th></tr></thead><tbody><tr v-for="item in store.allCases" :key="item.caseId"><td>{{asDate(item.createdAt)}}</td><td>{{item.userAlias}}</td><td>{{item.filterResult}}</td><td><span class="verdict-badge" :class="verdictTone(item.verdict)">{{verdictName(item.verdict)}}</span></td><td>{{categoryName(item.category)}}</td><td>{{statusLabels[item.status]}}</td><td><button class="table-link" @click="selectCase(item)">상세보기 →</button></td></tr></tbody></table></div></section>
        <section v-else-if="page==='policy'" class="secondary-page card"><div class="secondary-heading"><div><h2><BookOpen :size="24"/> 정책 근거 / RAG 스냅샷</h2><p>현재 선택 사건에 저장된 정책 원문·버전·리소스 URI를 확인합니다.</p></div><button class="secondary-button" @click="goto('monitor')">관제 화면으로</button></div><div v-if="selected" class="policy-context">선택 사건 <b>{{selected.caseId.slice(0,8)}}</b> · {{selected.userAlias}} · {{categoryName(selected.category)}}</div><div v-for="policy in selectedPolicies" :key="policy.resourceUri" class="policy-item"><div><b>{{policy.policyId}} · {{policy.title}}</b><span>Version {{policy.version}}</span></div><p>{{policy.text}}</p><small>{{policy.resourceUri}}</small></div><div v-if="!selectedPolicies.length" class="empty-block">선택 사건에 저장된 정책 스냅샷이 없습니다.</div>
          <div class="sanction-section"><h3>악성 채팅 조치 기준표</h3><p>최근 24시간 이전 확정 위반 수에 따라 조치가 정해집니다. TIMEOUT 600초는 자동 적용되고, TIMEOUT 86400초는 Agent가 <code>interrupt()</code>로 멈춘 뒤 운영자 승인을 거쳐 실행됩니다.</p>
            <div class="table-scroll"><table class="data-table sanction-table"><thead><tr><th>Category</th><th v-for="col in priorColumns" :key="col">{{col}}</th></tr></thead><tbody><tr v-for="[cat, row] in sanctionRows" :key="cat" :class="{current: selected?.category===cat}"><td><b>{{cat}}</b><small>{{categoryName(cat)}}</small></td><td v-for="(cell, i) in row" :key="i" :class="{hit: selectedSanction && selected?.category===cat && priorColumn(selectedPrior)===i, approval: needsApproval(cell)}">{{sanctionLabel(cell)}}</td></tr></tbody></table></div>
            <small class="sanction-legend"><i class="approval"/> 운영자 승인 필요 · <i class="hit"/> 선택 사건에 적용된 조치</small></div></section>
        <section v-else class="secondary-page card"><div class="secondary-heading"><div><h2><History :size="24"/> 감사 로그 / Agent 실행 이력</h2><p>SSE 이벤트와 실제 실행 단계의 진행 상태를 구분해 확인합니다.</p></div><span>{{store.audit.length}}건</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>시간</th><th>이벤트</th><th>상세 내용</th><th>상태</th></tr></thead><tbody><tr v-for="item in store.audit" :key="item.id"><td>{{item.time}}</td><td>{{item.type}}</td><td>{{item.content}}</td><td>{{item.state}}</td></tr></tbody></table></div><p class="foot-explain">기록은 현 세션의 화면 표시용입니다. 장기 감사 로그 조회 API는 현재 OpenAPI에 포함되지 않았습니다.</p></section>
        <footer class="dashboard-footer"><span>LIVE:GUARD · OpenAPI v0.5-lite</span><span>프론트는 <code>/api/**</code>만 사용합니다. <code>/internal/**</code>·MCP·Agent 호출은 백엔드 담당입니다.</span></footer>
      </main>
    </div>
    </div>
  </div>
  <!-- 시청자·운영자·시스템 화면 공통 알림. 로그인 화면은 오류를 로그인 창 안에 보여주므로 띄우지 않는다 -->
  <div v-if="store.notice && !store.loginRequired && store.me" class="toast" :role="store.notice === store.error ? 'alert' : 'status'"><AlertCircle v-if="store.notice === store.error" :size="18"/><CheckCircle2 v-else :size="18"/> {{store.notice}}</div>
</template>
