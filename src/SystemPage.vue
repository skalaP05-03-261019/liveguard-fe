<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { Activity, AlertTriangle, CalendarRange, CheckCircle2, Clock3, Menu, Radio, ShieldCheck, XCircle } from 'lucide-vue-next';
import type { Component } from 'vue';
import { useLiveGuard } from './stores/liveGuard';
import { categoryLabels, type Category, type Verdict } from './contracts';
import AccountMenu from './AccountMenu.vue';
import { KICK_SUMMARY } from './mockLive';
import ChatTracking from './ChatTracking.vue';
import ModeBadge from './ModeBadge.vue';
import StackedBar, { type BarSegment } from './StackedBar.vue';
import RateBars from './RateBars.vue';
import PeriodStats from './PeriodStats.vue';
import { basisCaseCount, reportStatus, reportStatusLabels } from './reportSummary';
import { KICK_COLORS, judgmentSegments } from './chartColors';
import { LIVE_CHANNEL_ID, sysChannels, sysLogs, sysReports, type SysChannel, type SysLog, type SysReport, type ReportStatus } from './systemMock';

// 시스템 운영자: LIVE:GUARD Agent가 여러 방송에서 올바르게 판단하는지 모니터링한다.
// 목업은 행복한게임방을 목업 방송 상태(스트리머의 실제 승인·기각 포함)로, 나머지 방송은 고정 예시로 채운다.
// 실제 API(api)는 같은 메뉴·표를 쓰되 비워 둔다. 백엔드에 시스템 운영자 권한과 여러 방송 통합 조회 API가 없기 때문이다
// (권한은 채널 멤버십 기준이고 admin은 어느 채널에도 소속되지 않는다).
const props = withDefaults(defineProps<{ api?: boolean }>(), { api: false });
const NO_API = '여러 방송 조회 API가 없어 표시할 데이터가 없습니다.';
const store = useLiveGuard();
// 탭: 실시간 관제(방송 중인 채널의 지금 상태) · 기간 통계(고른 기간, 끝난 방송 포함, #41) · 채팅관제 Tracking(채팅별 판정 흐름)
type SysTab = 'overview' | 'period' | 'tracking';
const tab = ref<SysTab>('overview');
const navOpen=ref(false),navCollapsed=ref(false),navTrigger=ref<HTMLButtonElement|null>(null),navElement=ref<HTMLElement|null>(null),mainElement=ref<HTMLElement|null>(null);
const navMedia=window.matchMedia('(min-width:1100px)'),navWide=ref(navMedia.matches);
const navVisible=computed(()=>navWide.value?!navCollapsed.value:navOpen.value);
const resizeNav=(e:MediaQueryListEvent)=>{navWide.value=e.matches;navOpen.value=false;};
async function toggleNav(){if(navWide.value)navCollapsed.value=!navCollapsed.value;else navOpen.value=!navOpen.value;if(!navWide.value&&navOpen.value){await nextTick();navElement.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();}}
function closeNav(restore=false){navOpen.value=false;if(restore)navTrigger.value?.focus();}
function navKey(e:KeyboardEvent){if(e.key==='Escape'&&!e.defaultPrevented&&navOpen.value){e.preventDefault();closeNav(true);}}
async function selectTab(value:SysTab){tab.value=value;if(!navWide.value){closeNav();await nextTick();mainElement.value?.focus();}}
onMounted(()=>{navMedia.addEventListener('change',resizeNav);window.addEventListener('keydown',navKey);});
onBeforeUnmount(()=>{navMedia.removeEventListener('change',resizeNav);window.removeEventListener('keydown',navKey);});
const tabs: { key: SysTab; label: string; icon: Component }[] = [{ key: 'overview', label: '실시간 관제', icon: Radio }, { key: 'period', label: '기간 통계', icon: CalendarRange }, { key: 'tracking', label: '채팅관제 Tracking', icon: Activity }];
const now = ref(Date.now());
let timer: number | undefined;
onMounted(() => { timer = window.setInterval(() => { now.value = Date.now(); }, 30000); });
onBeforeUnmount(() => window.clearInterval(timer));

const nf = new Intl.NumberFormat('ko-KR');
const asTime = (v: string) => new Date(v).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });
const span = (from: string, to: number) => { const m = Math.max(0, Math.round((to - new Date(from).getTime()) / 60000)); return m < 1 ? '1분 미만' : m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`; };
const catName = (c: Category | null) => c ? categoryLabels[c] : '-';
const verdictName = (v: string) => ({ VIOLATION: '위반 확정', NO_VIOLATION: '위반 아님', NEEDS_REVIEW: '추가 검토' } as Record<string, string>)[v] ?? v;
const verdictTone = (v: string) => ({ VIOLATION: 'violation', NO_VIOLATION: 'clear', NEEDS_REVIEW: 'review' } as Record<string, string>)[v] ?? '';

// 목업 채널(행복한게임방). 데모 화면의 채팅 수에 오늘 앞서 검사한 양(예시 기준값)을 더해 다른 방송과 규모를 맞춘다.
const LIVE_BASE = { scanned: 1480, hidden: 27 };
const mock = store.mock.state;
const caseNames = computed(() => Object.fromEntries(mock.cases.map(c => [c.caseId, store.mock.aliasOf(c.userId)])));
const ownerOf = (caseId: string) => mock.cases.find(c => c.caseId === caseId)?.userId ?? '';
const liveChannel = computed<SysChannel>(() => ({ id: LIVE_CHANNEL_ID, name: '행복한게임방', streamer: '행복한게임방', live: true, viewers: 2341, scanned: LIVE_BASE.scanned + mock.messages.length, hidden: LIVE_BASE.hidden + mock.messages.filter(m => m.visibility === 'HIDDEN').length, held: mock.messages.filter(m => m.visibility === 'HELD').length }));
const liveReports = computed<SysReport[]>(() => mock.reviews.filter(r => r.kind === 'KICK').map(r => {
  const d = mock.decisions[r.reviewId], progress = mock.kickProgress[r.reviewId] ?? '';
  return {
    id: r.reviewId, channelId: LIVE_CHANNEL_ID, userAlias: store.mock.aliasOf(ownerOf(r.caseId)), summary: KICK_SUMMARY,
    basisCaseIds: [...new Set(r.basisCaseIds)],
    categories: r.basisCaseIds.flatMap(id => mock.cases.find(c => c.caseId === id)?.confirmedFindings.map(f => f.category) ?? []),
    reportedAt: String(r.createdAt), status: reportStatus(r.status, d),
    decidedAt: d?.decidedAt ?? null, decisionReason: d?.reason ?? null,
    execution: progress.startsWith('강퇴 적용 완료') ? 'EXECUTED' : progress.startsWith('강퇴 실행 실패') ? 'FAILED' : null
  };
}));
const liveLogs = computed<SysLog[]>(() => mock.cases.map(c => {
  const verdict: Verdict = c.confirmationStatus === 'CONFIRMED_VIOLATION' ? 'VIOLATION' : c.confirmationStatus === 'PENDING' ? 'NEEDS_REVIEW' : 'NO_VIOLATION';
  const kick = mock.reviews.some(r => r.kind === 'KICK' && r.caseId === c.caseId);
  const action = kick ? '강퇴 승인 요청' : c.confirmationStatus === 'PENDING' ? '운영자 결정 대기' : c.confirmationStatus === 'CONFIRMED_VIOLATION' ? (c.timeoutUntil ? '숨김 + 채팅 제한' : '숨김') : '공개 유지';
  const target = mock.messages.find(m => c.targetMessageIds.includes(m.messageId));
  return { id: c.caseId, channelId: LIVE_CHANNEL_ID, at: c.createdAt, userAlias: store.mock.aliasOf(c.userId), text: target?.text ?? '', category: c.confirmedFindings[0]?.category ?? c.findings?.[0]?.categories[0] ?? null, verdict, action };
}));

// 실시간 관제는 방송 중인 채널만 본다. 끝난 방송의 사건·강퇴 요청도 함께 뺀다
const allChannels = computed(() => props.api ? [] : [liveChannel.value, ...sysChannels]);
const channels = computed(() => allChannels.value.filter(c => c.live));
const offAir = computed(() => allChannels.value.length - channels.value.length);
const onAir = (channelId: string) => channels.value.some(c => c.id === channelId);
const channelName = (id: string) => channels.value.find(c => c.id === id)?.name ?? id;
const channelFilter = ref<string>('ALL');
const statusFilter = ref<'ALL' | ReportStatus>('ALL');
const executionOnly = ref(false);
const requestSection = ref<HTMLElement | null>(null);
function showRequests(kind: 'pending' | 'failed') {
  statusFilter.value = kind === 'pending' ? 'PENDING' : 'ALL';
  executionOnly.value = kind === 'failed';
  requestSection.value?.focus();
  requestSection.value?.scrollIntoView({ behavior: 'auto', block: 'start' });
}

const inChannel = <T extends { channelId?: string; id?: string }>(x: T, id = (x as { channelId?: string }).channelId ?? (x as { id: string }).id) => channelFilter.value === 'ALL' || id === channelFilter.value;

const allReports = computed(() => (props.api ? [] : [...liveReports.value, ...sysReports]).filter(r => onAir(r.channelId)).sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)));
const reports = computed(() => allReports.value.filter(r => inChannel(r)));
const shownReports = computed(() => reports.value.filter(r => (statusFilter.value === 'ALL' || r.status === statusFilter.value) && (!executionOnly.value || r.execution === 'FAILED')));
const logs = computed(() => (props.api ? [] : [...liveLogs.value, ...sysLogs]).filter(l => onAir(l.channelId) && inChannel(l)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40));
const shownChannels = computed(() => channels.value.filter(c => inChannel(c, c.id)));

const count = (list: SysReport[], s: ReportStatus) => list.filter(r => r.status === s).length;
const rate = (list: SysReport[]) => { const a = count(list, 'APPROVED'), d = a + count(list, 'REJECTED'); return d ? Math.round((a / d) * 100) : null; };
// 차트 색·조각 정의는 chartColors.ts(실시간 관제·기간 통계 공용)
const judgmentOf = (list: SysChannel[]): BarSegment[] => judgmentSegments(list.reduce((n, c) => n + c.scanned, 0), list.reduce((n, c) => n + c.hidden, 0), list.reduce((n, c) => n + c.held, 0));
// ① 전체 채팅 판정 현황: 모수는 검사한 채팅 수
const judgment = computed(() => judgmentOf(shownChannels.value));
const judgmentTotal = computed(() => judgment.value.reduce((n, s) => n + s.value, 0));
// ② 강퇴 승인 요청 처리 현황: 모수는 강퇴 승인 요청 수(비정상 채팅 전체가 아니다)
const kickSegments = computed<BarSegment[]>(() => [
  { key: 'APPROVED', label: '승인', value: count(reports.value, 'APPROVED'), color: KICK_COLORS.APPROVED },
  { key: 'PENDING', label: '결정 대기', value: count(reports.value, 'PENDING'), color: KICK_COLORS.PENDING },
  { key: 'REJECTED', label: '기각', value: count(reports.value, 'REJECTED'), color: KICK_COLORS.REJECTED }
]);
const unclassifiedReports = computed(() => reports.value.filter(r => r.status==='INVALIDATED' || r.status==='UNAVAILABLE'));
const kickTotal = computed(() => kickSegments.value.reduce((sum,s) => sum+s.value,0));
const kickSummary = computed(() => {
  const pending = reports.value.filter(r => r.status === 'PENDING').sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));
  const approvalRate = rate(reports.value);
  return { approval: approvalRate === null ? '-' : `${approvalRate}%`, oldest: pending.length ? `가장 오래 ${span(pending[0].reportedAt, now.value)}째 대기` : '대기 없음', waiting: pending.length > 0 };
});
const attention = computed(() => {
  const pending = reports.value.filter(r => r.status === 'PENDING').sort((a,b) => a.reportedAt.localeCompare(b.reportedAt));
  return { pending: pending.length, oldest: pending.length ? span(pending[0].reportedAt, now.value) : '대기 없음', failed: reports.value.filter(r => r.execution === 'FAILED').length };
});
// 채팅관제 Tracking: 실제 API는 관리자용 방송 채팅·사건 조회가 없어 빈 데이터를 넘긴다.
const tracking = computed(() => props.api
  ? { channelName: '', messages: [], reviews: [], cases: [], caseNames: {}, logs: [], kickProgress: {}, traces: null }
  : { channelName: '행복한게임방', messages: mock.messages, reviews: mock.reviews, cases: mock.cases, caseNames: caseNames.value, logs: mock.logs, kickProgress: mock.kickProgress, traces: mock.traces });
// 방송별 비교(RateBars.vue): 비정상·판정 대기 비율을 같은 눈금에서 비교하고 강퇴 대기 수를 붙인다
const rateRows = computed(() => shownChannels.value.map(c => ({ id: c.id, name: c.name, live: c.live, scanned: c.scanned, hidden: c.hidden, held: c.held, kickPending: count(allReports.value.filter(r => r.channelId === c.id), 'PENDING') })));
const channelStats = computed(() => shownChannels.value.map(c => {
  const rs = allReports.value.filter(r => r.channelId === c.id);
  return { ...c, reports: rs.length, approved: count(rs, 'APPROVED'), rejected: count(rs, 'REJECTED'), pending: count(rs, 'PENDING'), rate: rate(rs), hiddenRate: c.scanned ? (c.hidden / c.scanned * 100).toFixed(1) : '-' };
}));
</script>

<template>
  <div class="app-shell sys-shell">
    <header class="topbar"><div class="topbar-title"><button ref="navTrigger" type="button" class="yt-icon-button" :aria-label="navVisible ? '메뉴 닫기' : '메뉴 열기'" :aria-expanded="navVisible" aria-controls="system-navigation" @click="toggleNav"><Menu :size="22"/></button><span class="yt-logo"><span class="yt-logo-mark"><ShieldCheck :size="15"/></span><b>LIVE<span>:</span>GUARD</b></span><span class="console-tag">System</span></div>
      <div class="topbar-right"><ModeBadge :mock="!api"/><AccountMenu :nickname="store.me?.nickname??'관리자'" account-label="시스템 운영자 계정" @logout="store.logout()"/></div></header>
    <div class="sys-layout" :class="{'nav-collapsed':!navVisible}"><button v-if="!navWide && navOpen" type="button" class="sys-drawer-backdrop" aria-label="메뉴 닫기 배경" @click="closeNav(true)"/>
    <!-- 왼쪽 메뉴: 아이콘과 이름, 고른 항목은 회색 배경 -->
    <nav id="system-navigation" ref="navElement" class="sys-side" :class="{open:navVisible}" :inert="!navVisible" :aria-hidden="!navVisible" role="tablist" aria-orientation="vertical" aria-label="시스템 운영자 화면">
      <button v-for="t in tabs" :key="t.key" type="button" role="tab" :aria-selected="tab===t.key" :class="{on: tab===t.key}" @click="selectTab(t.key)"><component :is="t.icon" :size="22" :stroke-width="1.8"/><span>{{t.label}}</span></button>
    </nav>
    <main ref="mainElement" class="main-content sys-main" tabindex="-1" :inert="!navWide && navOpen">
      <template v-if="tab==='tracking'">
      <div class="sys-head">
        <div><h1>채팅관제 Tracking</h1><p>채팅 한 줄을 누르면 백엔드 1차 분류, AI Agent 조사·판정, 백엔드 검증, 운영자 결정까지 어떤 경로로 처리됐는지 확인합니다. 조회 전용입니다.</p></div>
        <span class="sys-mock">{{api ? '관리자용 방송 채팅·사건 조회 API가 없습니다' : '행복한게임방 데모 방송과 연동'}}</span>
      </div>
      <ChatTracking :channel-name="tracking.channelName" :messages="tracking.messages" :reviews="tracking.reviews" :cases="tracking.cases" :case-names="tracking.caseNames" :logs="tracking.logs" :kick-progress="tracking.kickProgress" :traces="tracking.traces"/>
      </template>
      <PeriodStats v-else-if="tab==='period'" :api="api"/>
      <template v-else>
      <div class="sys-head">
        <div><h1>실시간 관제</h1><p>방송 중인 채널에서 LIVE:GUARD Agent가 내린 판단과 강퇴 승인 요청 처리 상황을 봅니다.<template v-if="offAir"> 방송 중이 아닌 채널 {{offAir}}개는 제외했습니다.</template></p></div>
        <span class="sys-mock">{{api ? '여러 방송 통합 조회 API가 없습니다' : '행복한게임방은 데모 상태와 연동'}}</span>
      </div>
      <div class="sys-filter" role="group" aria-label="방송 필터"><button :class="{on: channelFilter==='ALL'}" @click="channelFilter='ALL'">전체 방송</button><button v-for="c in channels" :key="c.id" :class="{on: channelFilter===c.id}" @click="channelFilter=c.id"><i v-if="c.live" class="live-dot" aria-label="방송 중"/>{{c.name}}</button></div>

      <section class="attention-grid" aria-label="우선 확인할 항목">
        <button class="card attention-card" :disabled="api" @click="showRequests('pending')"><span>강퇴 결정 대기</span><strong>{{api ? '—' : `${attention.pending}건`}}</strong><small>{{api ? '연동 API 없음' : '대기 요청 보기 →'}}</small></button>
        <button class="card attention-card" :disabled="api" @click="showRequests('pending')"><span>최장 대기</span><strong>{{api ? '—' : attention.oldest}}</strong><small>{{api ? '연동 API 없음' : '대기 요청 보기 →'}}</small></button>
        <button class="card attention-card danger" :disabled="api" @click="showRequests('failed')"><span>강퇴 실행 실패</span><strong>{{api ? '—' : `${attention.failed}건`}}</strong><small>{{api ? '연동 API 없음' : '확인된 실패만 보기 →'}}</small></button>
      </section>
      <!-- ① 전체 채팅 판정과 ② 강퇴 승인 처리를 따로 본다. 모수가 다르다(검사한 채팅 / 강퇴 승인 요청) -->
      <section class="sys-charts" aria-label="주요 지표">
        <article class="card sys-chart-card">
          <header><h2>전체 채팅 판정 현황</h2><span v-if="judgmentTotal" class="sys-base">{{nf.format(judgmentTotal)}}건 기준</span></header>
          <p class="sys-chart-note">비정상·대기를 먼저 확인하세요. 판정 대기는 AI 조사 또는 문맥 검토 중입니다.</p>
          <StackedBar :segments="judgment" label="전체 채팅 판정 현황" :empty="api ? '연동 API 없음' : channels.length ? '검사한 채팅 없음' : '방송 중인 채널 없음'"/>
        </article>
        <article class="card sys-chart-card">
          <header><h2>강퇴 승인 요청 처리 현황</h2><span v-if="kickTotal" class="sys-base">{{nf.format(kickTotal)}}건 기준</span></header>
          <p class="sys-chart-note">확정 위반 3건으로 생긴 강퇴 승인 요청을 검토자가 처리한 결과입니다. <span v-if="reports.length">승인율 <b>{{kickSummary.approval}}</b> · <span :class="{'sys-waiting': kickSummary.waiting}">{{kickSummary.oldest}}</span></span></p>
          <StackedBar :segments="kickSegments" label="강퇴 승인 요청 처리 현황" :empty="api ? '연동 API 없음' : channels.length ? '강퇴 승인 요청 없음' : '방송 중인 채널 없음'"/>
        <p v-if="unclassifiedReports.length" class="sys-chart-note" role="status">무효·결정 미확인 {{unclassifiedReports.length}}건은 승인·기각·대기 분포와 승인율에서 제외했습니다. 요청 표에서 별도로 확인하세요.</p>

        </article>
      </section>

      <section ref="requestSection" class="card sys-section request-section" tabindex="-1" aria-label="강퇴 승인 요청 추적">
        <header class="sys-section-head"><div><h2>강퇴 승인 요청 추적</h2><p>확정 위반 3건이 쌓여 생긴 강퇴 요청을 검토자가 승인했는지, 강퇴가 실제로 적용됐는지 확인합니다.</p></div>
          <div class="sys-chips" role="group" aria-label="결정 상태 필터"><button v-for="f in ([['ALL','전체'],['PENDING','대기'],['APPROVED','승인'],['REJECTED','기각'],['INVALIDATED','무효'],['UNAVAILABLE','미확인']] as const)" :key="f[0]" :class="{on: statusFilter===f[0]}" @click="statusFilter=f[0]; executionOnly=false">{{f[1]}} <b>{{f[0]==='ALL' ? reports.length : count(reports, f[0])}}</b></button></div></header>
        <p v-if="executionOnly" class="request-filter-note" role="status">확인된 실행 실패만 표시 중 <button @click="executionOnly=false">필터 해제</button></p>
        <div class="table-scroll"><table class="data-table sys-table request-table">
          <thead><tr><th>요청</th><th>방송</th><th>대상 사용자</th><th>요청 사유</th><th>기준 사건</th><th>검토 결정</th><th>결정까지</th><th>강퇴 실행</th></tr></thead>
          <tbody>
            <tr v-for="r in shownReports" :key="r.id">
              <td class="nowrap">{{asTime(r.reportedAt)}}<details class="mobile-row-detail"><summary>요청 상세</summary><p>{{channelName(r.channelId)}} · {{r.userAlias}}</p><p>{{r.summary}}</p><p>{{r.categories.map(catName).join(' · ')}} · 기준 사건 {{basisCaseCount(r.basisCaseIds)}}건</p><p>{{r.status==='PENDING' ? `${span(r.reportedAt, now)}째 대기` : r.decidedAt ? `결정까지 ${span(r.reportedAt, new Date(r.decidedAt).getTime())}` : ''}}</p></details></td>
              <td class="nowrap">{{channelName(r.channelId)}}</td>
              <td class="nowrap"><b>{{r.userAlias}}</b></td>
              <td class="sys-reason">{{r.summary}}<small>{{r.categories.map(catName).join(' · ')}}</small></td>
              <td class="num">{{basisCaseCount(r.basisCaseIds)}}건</td>
              <td class="nowrap"><span class="decision" :class="r.status.toLowerCase()"><Clock3 v-if="r.status==='PENDING'" :size="15"/><CheckCircle2 v-else-if="r.status==='APPROVED'" :size="15"/><XCircle v-else-if="r.status==='REJECTED'" :size="15"/><AlertTriangle v-else :size="15"/>{{reportStatusLabels[r.status]}}</span><small v-if="r.status==='REJECTED'" class="disagree">AI와 다른 판단</small></td>
              <td class="nowrap">{{r.status==='PENDING' ? `${span(r.reportedAt, now)}째` : r.decidedAt ? span(r.reportedAt, new Date(r.decidedAt).getTime()) : '-'}}</td>
              <td class="nowrap"><span v-if="r.execution==='EXECUTED'" class="exec ok"><CheckCircle2 :size="14"/>실행 완료</span><span v-else-if="r.execution==='FAILED'" class="exec fail"><AlertTriangle :size="14"/>실행 실패</span><span v-else-if="r.status==='APPROVED'" class="exec wait"><Clock3 :size="14"/>실행 대기</span><span v-else class="muted-dash">-</span></td>
            </tr>
            <tr v-if="!shownReports.length"><td colspan="8" class="empty-block">{{api ? NO_API : channels.length ? '해당하는 강퇴 승인 요청이 없습니다.' : '방송 중인 채널이 없습니다.'}}</td></tr>
          </tbody>
        </table></div>
      </section>

      <section class="card sys-section">
        <header class="sys-section-head"><div><h2>방송별 현황</h2><p>방송마다 채팅 판정 분포와 강퇴 요청 결정 결과입니다. 비정상 비율이 높은 방송이 위에 옵니다.<template v-if="channels.length"> 방송 {{shownChannels.length}}개 · 방송 중 {{shownChannels.filter(c => c.live).length}}개</template></p></div></header>
        <RateBars :rows="rateRows"/>
        <div class="table-scroll"><table class="data-table sys-table channel-stats-table">
          <thead><tr><th>방송</th><th>스트리머</th><th>상태</th><th class="num">검사한 채팅</th><th class="num">자동 숨김</th><th class="num">판정 대기</th><th class="num">숨김률</th><th class="num">강퇴 요청</th><th class="num">승인</th><th class="num">기각</th><th class="num">대기</th><th class="num">승인율</th></tr></thead>
          <tbody><tr v-for="c in channelStats" :key="c.id"><td class="nowrap"><b>{{c.name}}</b><details class="mobile-row-detail"><summary>채널 상세</summary><p>{{c.streamer}} · {{c.live ? '방송 중' : '방송 종료'}}</p><p v-if="c.live">시청 {{nf.format(c.viewers)}}명</p><p>검사 {{nf.format(c.scanned)}}건 · 자동 숨김 {{nf.format(c.hidden)}}건 · 판정 대기 {{nf.format(c.held)}}건</p><p>강퇴 요청 {{c.reports}}건 · 승인 {{c.approved}}건 · 기각 {{c.rejected}}건 · 대기 {{c.pending}}건 · 승인율 {{c.rate===null ? '-' : `${c.rate}%`}}</p></details></td><td class="nowrap">{{c.streamer}}</td><td class="nowrap"><span v-if="c.live" class="onair"><i class="live-dot"/>방송 중 · {{nf.format(c.viewers)}}명</span><span v-else class="offair">방송 종료</span></td><td class="num">{{nf.format(c.scanned)}}</td><td class="num">{{nf.format(c.hidden)}}</td><td class="num">{{nf.format(c.held)}}</td><td class="num">{{c.hiddenRate}}%</td><td class="num">{{c.reports}}</td><td class="num">{{c.approved}}</td><td class="num">{{c.rejected}}</td><td class="num" :class="{pending: c.pending}">{{c.pending}}</td><td class="num">{{c.rate === null ? '-' : `${c.rate}%`}}</td></tr>
            <tr v-if="!channelStats.length"><td colspan="12" class="empty-block">{{api ? NO_API : '방송 중인 채널이 없습니다.'}}</td></tr></tbody>
        </table></div>
      </section>

      <section class="card sys-section">
        <header class="sys-section-head"><div><h2>AI 모니터링 내역</h2><p>사건이 된 메시지와 확정 상태·조치입니다. 최근 40건을 보여줍니다.</p></div></header>
        <div class="table-scroll"><table class="data-table sys-table monitor-log-table">
          <thead><tr><th>시간</th><th>방송</th><th>사용자</th><th>메시지</th><th>유형</th><th>확정 상태</th><th>조치</th></tr></thead>
          <tbody><tr v-for="l in logs" :key="l.id"><td class="nowrap">{{asTime(l.at)}}<details class="mobile-row-detail"><summary>메시지 상세</summary><p>{{channelName(l.channelId)}} · {{l.userAlias}}</p><p>{{l.text}}</p><p>{{catName(l.category)}} · {{l.action}}</p></details></td><td class="nowrap">{{channelName(l.channelId)}}</td><td class="nowrap"><b>{{l.userAlias}}</b></td><td class="sys-msg">{{l.text}}</td><td class="nowrap">{{catName(l.category)}}</td><td class="nowrap"><span class="verdict-badge" :class="verdictTone(l.verdict)">{{verdictName(l.verdict)}}</span></td><td class="nowrap" :class="{report: l.action==='강퇴 승인 요청'}">{{l.action}}</td></tr>
            <tr v-if="!logs.length"><td colspan="7" class="empty-block">{{api ? NO_API : channels.length ? '모니터링 내역이 없습니다.' : '방송 중인 채널이 없습니다.'}}</td></tr></tbody>
        </table></div>
      </section>
      </template>
      <footer class="dashboard-footer"><span>LIVE:GUARD · AI Agent 모니터링</span><span>실제 연동 시 여러 채널의 사건·강퇴 검토 조회 API가 필요합니다.</span></footer>
    </main>
    </div>
  </div>
</template>
