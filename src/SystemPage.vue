<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Activity, AlertTriangle, CheckCircle2, Clock3, LayoutDashboard, LogOut, ShieldCheck, XCircle } from 'lucide-vue-next';
import type { Component } from 'vue';
import { useLiveGuard } from './stores/liveGuard';
import { categoryLabels, type Category, type Verdict } from './contracts';
import { avatarColor } from './avatar';
import { KICK_SUMMARY } from './mockLive';
import ChatTracking from './ChatTracking.vue';
import ModeBadge from './ModeBadge.vue';
import StackedBar, { type BarSegment } from './StackedBar.vue';
import { LIVE_CHANNEL_ID, sysChannels, sysLogs, sysReports, type SysChannel, type SysLog, type SysReport, type ReportStatus } from './systemMock';

// 시스템 운영자: LIVE:GUARD Agent가 여러 방송에서 올바르게 판단하는지 모니터링한다.
// 목업은 행복한게임방을 목업 방송 상태(스트리머의 실제 승인·기각 포함)로, 나머지 방송은 고정 예시로 채운다.
// 실제 API(api)는 같은 메뉴·표를 쓰되 비워 둔다. 백엔드에 시스템 운영자 권한과 여러 방송 통합 조회 API가 없기 때문이다
// (권한은 채널 멤버십 기준이고 admin은 어느 채널에도 소속되지 않는다).
const props = withDefaults(defineProps<{ api?: boolean }>(), { api: false });
const NO_API = '여러 방송 조회 API가 없어 표시할 데이터가 없습니다.';
const store = useLiveGuard();
// 탭: 시스템 현황(여러 방송 지표) · 채팅관제 Tracking(채팅별 판정 흐름)
type SysTab = 'overview' | 'tracking';
const tab = ref<SysTab>('overview');
const tabs: { key: SysTab; label: string; icon: Component }[] = [{ key: 'overview', label: '시스템 현황', icon: LayoutDashboard }, { key: 'tracking', label: '채팅관제 Tracking', icon: Activity }];
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
    categories: r.basisCaseIds.flatMap(id => mock.cases.find(c => c.caseId === id)?.confirmedFindings.map(f => f.category) ?? []),
    reportedAt: String(r.createdAt), status: (!d ? 'PENDING' : d.value === 'APPROVE' ? 'APPROVED' : 'REJECTED') as ReportStatus,
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

const channels = computed(() => props.api ? [] : [liveChannel.value, ...sysChannels]);
const channelName = (id: string) => channels.value.find(c => c.id === id)?.name ?? id;
const channelFilter = ref<string>('ALL');
const statusFilter = ref<'ALL' | ReportStatus>('ALL');
const inChannel = <T extends { channelId?: string; id?: string }>(x: T, id = (x as { channelId?: string }).channelId ?? (x as { id: string }).id) => channelFilter.value === 'ALL' || id === channelFilter.value;

const allReports = computed(() => (props.api ? [] : [...liveReports.value, ...sysReports]).sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)));
const reports = computed(() => allReports.value.filter(r => inChannel(r)));
const shownReports = computed(() => reports.value.filter(r => statusFilter.value === 'ALL' || r.status === statusFilter.value));
const logs = computed(() => (props.api ? [] : [...liveLogs.value, ...sysLogs]).filter(l => inChannel(l)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40));
const shownChannels = computed(() => channels.value.filter(c => inChannel(c, c.id)));

const count = (list: SysReport[], s: ReportStatus) => list.filter(r => r.status === s).length;
const rate = (list: SysReport[]) => { const a = count(list, 'APPROVED'), d = a + count(list, 'REJECTED'); return d ? Math.round((a / d) * 100) : null; };
// 대시보드 차트 색. dataviz 검증 스크립트(validate_palette.js, 라이트)로 고른 값이다. 초록·빨강은 색각 이상 구분이 안 돼(ΔE 4.1) 쓰지 않는다.
// ① 정상·비정상·판정 대기: 모든 검사 통과(최저 ΔE 15.3). ② 승인·결정 대기·기각: 구분 통과(최저 ΔE 24.4), 기각 회청색은 '조치 없음'이라 일부러 무채색에 가깝다.
const JUDGMENT_COLORS = { normal: '#2a78d6', abnormal: '#e34948', pending: '#eda100' };
const KICK_COLORS = { APPROVED: '#6250d6', PENDING: '#eda100', REJECTED: '#64748B' };
const judgmentOf = (list: SysChannel[]): BarSegment[] => {
  const scanned = list.reduce((n, c) => n + c.scanned, 0), hidden = list.reduce((n, c) => n + c.hidden, 0), held = list.reduce((n, c) => n + c.held, 0);
  return [
    { key: 'normal', label: '정상', value: Math.max(scanned - hidden - held, 0), color: JUDGMENT_COLORS.normal },
    { key: 'abnormal', label: '비정상', value: hidden, color: JUDGMENT_COLORS.abnormal },
    { key: 'pending', label: '판정 대기', value: held, color: JUDGMENT_COLORS.pending }
  ];
};
// ① 전체 채팅 판정 현황: 모수는 검사한 채팅 수
const judgment = computed(() => judgmentOf(shownChannels.value));
const judgmentTotal = computed(() => judgment.value.reduce((n, s) => n + s.value, 0));
// ② 강퇴 승인 요청 처리 현황: 모수는 강퇴 승인 요청 수(비정상 채팅 전체가 아니다)
const kickSegments = computed<BarSegment[]>(() => [
  { key: 'APPROVED', label: '스트리머 승인', value: count(reports.value, 'APPROVED'), color: KICK_COLORS.APPROVED },
  { key: 'PENDING', label: '결정 대기', value: count(reports.value, 'PENDING'), color: KICK_COLORS.PENDING },
  { key: 'REJECTED', label: '스트리머 기각', value: count(reports.value, 'REJECTED'), color: KICK_COLORS.REJECTED }
]);
const kickSummary = computed(() => {
  const pending = reports.value.filter(r => r.status === 'PENDING').sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));
  const approvalRate = rate(reports.value);
  return { approval: approvalRate === null ? '-' : `${approvalRate}%`, oldest: pending.length ? `가장 오래 ${span(pending[0].reportedAt, now.value)}째 대기` : '대기 없음', waiting: pending.length > 0 };
});
// 채팅관제 Tracking: 실제 API는 관리자용 방송 채팅·사건 조회가 없어 빈 데이터를 넘긴다.
const tracking = computed(() => props.api
  ? { channelName: '', messages: [], reviews: [], cases: [], caseNames: {}, logs: [], kickProgress: {}, traces: null }
  : { channelName: '행복한게임방', messages: mock.messages, reviews: mock.reviews, cases: mock.cases, caseNames: caseNames.value, logs: mock.logs, kickProgress: mock.kickProgress, traces: mock.traces });
// 방송별 비교: 정상이 대부분(보통 97% 이상)이라 100% 누적 막대로는 방송끼리 차이가 안 보인다.
// 그래서 비정상·판정 대기 비율만 같은 눈금(가장 높은 방송 기준, 올림한 %)에서 길이로 비교하고, 비정상 비율이 높은 순으로 놓는다.
const channelBars = computed(() => {
  const rows = shownChannels.value.map(c => ({
    id: c.id, name: c.name, live: c.live, scanned: c.scanned, segments: judgmentOf([c]).filter(s => s.key !== 'normal'),
    abnormalRate: c.scanned ? c.hidden / c.scanned * 100 : 0, pendingRate: c.scanned ? c.held / c.scanned * 100 : 0,
    kickPending: count(allReports.value.filter(r => r.channelId === c.id), 'PENDING')
  })).sort((a, b) => b.abnormalRate - a.abnormalRate);
  const maxRate = Math.max(1, Math.ceil(Math.max(0, ...rows.map(r => r.abnormalRate + r.pendingRate))));
  return { maxRate, rows: rows.map(r => ({ ...r, scale: r.scanned * maxRate / 100 })) };
});
const channelStats = computed(() => shownChannels.value.map(c => {
  const rs = allReports.value.filter(r => r.channelId === c.id);
  return { ...c, reports: rs.length, approved: count(rs, 'APPROVED'), rejected: count(rs, 'REJECTED'), pending: count(rs, 'PENDING'), rate: rate(rs), hiddenRate: c.scanned ? (c.hidden / c.scanned * 100).toFixed(1) : '-' };
}));
</script>

<template>
  <div class="app-shell sys-shell">
    <header class="topbar"><div class="topbar-title"><span class="yt-logo"><span class="yt-logo-mark"><ShieldCheck :size="15"/></span><b>LIVE<span>:</span>GUARD</b></span><span class="console-tag">System</span></div>
      <div class="topbar-right"><ModeBadge :mock="!api"/><span class="yt-me" :style="{background: avatarColor(store.me?.nickname ?? '시스템')}">{{(store.me?.nickname ?? '시').slice(0,1)}}</span><span class="operator-info">{{store.me?.nickname}}</span><button class="header-logout" @click="store.logout()"><LogOut :size="16"/> 로그아웃</button></div></header>
    <div class="sys-layout">
    <!-- 왼쪽 메뉴: 아이콘과 이름, 고른 항목은 회색 배경 -->
    <nav class="sys-side" role="tablist" aria-orientation="vertical" aria-label="시스템 운영자 화면">
      <button v-for="t in tabs" :key="t.key" type="button" role="tab" :aria-selected="tab===t.key" :class="{on: tab===t.key}" @click="tab=t.key"><component :is="t.icon" :size="22" :stroke-width="1.8"/><span>{{t.label}}</span></button>
    </nav>
    <main class="main-content sys-main">
      <template v-if="tab==='tracking'">
      <div class="sys-head">
        <div><h1>채팅관제 Tracking</h1><p>채팅 한 줄을 누르면 백엔드 1차 분류, AI Agent 조사·판정, 백엔드 검증, 운영자 결정까지 어떤 경로로 처리됐는지 확인합니다. 조회 전용입니다.</p></div>
        <span class="sys-mock">{{api ? '관리자용 방송 채팅·사건 조회 API가 없습니다' : '행복한게임방 데모 방송과 연동'}}</span>
      </div>
      <ChatTracking :channel-name="tracking.channelName" :messages="tracking.messages" :reviews="tracking.reviews" :cases="tracking.cases" :case-names="tracking.caseNames" :logs="tracking.logs" :kick-progress="tracking.kickProgress" :traces="tracking.traces"/>
      </template>
      <template v-else>
      <div class="sys-head">
        <div><h1>AI Agent 모니터링</h1><p>여러 방송에서 LIVE:GUARD Agent가 내린 판단과, 강퇴 승인 요청에 대한 스트리머의 최종 결정을 확인합니다.</p></div>
        <span class="sys-mock">{{api ? '여러 방송 통합 조회 API가 없습니다' : '행복한게임방은 데모 상태와 연동'}}</span>
      </div>
      <div class="sys-filter" role="group" aria-label="방송 필터"><button :class="{on: channelFilter==='ALL'}" @click="channelFilter='ALL'">전체 방송</button><button v-for="c in channels" :key="c.id" :class="{on: channelFilter===c.id}" @click="channelFilter=c.id"><i v-if="c.live" class="live-dot" aria-label="방송 중"/>{{c.name}}</button></div>

      <!-- ① 전체 채팅 판정과 ② 강퇴 승인 처리를 따로 본다. 모수가 다르다(검사한 채팅 / 강퇴 승인 요청) -->
      <section class="sys-charts" aria-label="주요 지표">
        <article class="card sys-chart-card">
          <header><h2>전체 채팅 판정 현황</h2><span v-if="judgmentTotal" class="sys-base">{{nf.format(judgmentTotal)}}건 기준</span></header>
          <p class="sys-chart-note">AI가 검사한 채팅의 지금 상태입니다. 판정 대기는 AI 조사 중이거나 운영자 문맥 검토를 기다리는 채팅입니다.</p>
          <StackedBar :segments="judgment" label="전체 채팅 판정 현황" :empty="api ? '연동 API 없음' : '검사한 채팅 없음'"/>
        </article>
        <article class="card sys-chart-card">
          <header><h2>강퇴 승인 요청 처리 현황</h2><span v-if="reports.length" class="sys-base">{{nf.format(reports.length)}}건 기준</span></header>
          <p class="sys-chart-note">확정 위반 3건으로 생긴 강퇴 승인 요청을 스트리머가 처리한 결과입니다. <span v-if="reports.length">승인율 <b>{{kickSummary.approval}}</b> · <span :class="{'sys-waiting': kickSummary.waiting}">{{kickSummary.oldest}}</span></span></p>
          <StackedBar :segments="kickSegments" label="강퇴 승인 요청 처리 현황" :empty="api ? '연동 API 없음' : '강퇴 승인 요청 없음'"/>
        </article>
      </section>

      <section class="card sys-section">
        <header class="sys-section-head"><div><h2>강퇴 승인 요청 추적</h2><p>확정 위반 3건이 쌓여 생긴 강퇴 요청을 스트리머가 승인했는지, 강퇴가 실제로 적용됐는지 확인합니다.</p></div>
          <div class="sys-chips" role="group" aria-label="결정 상태 필터"><button v-for="f in ([['ALL','전체'],['PENDING','대기'],['APPROVED','승인'],['REJECTED','기각']] as const)" :key="f[0]" :class="{on: statusFilter===f[0]}" @click="statusFilter=f[0]">{{f[1]}} <b>{{f[0]==='ALL' ? reports.length : count(reports, f[0])}}</b></button></div></header>
        <div class="table-scroll"><table class="data-table sys-table">
          <thead><tr><th>요청</th><th>방송</th><th>대상 사용자</th><th>요청 사유</th><th>기준 사건</th><th>스트리머 결정</th><th>결정까지</th><th>강퇴 실행</th></tr></thead>
          <tbody>
            <tr v-for="r in shownReports" :key="r.id">
              <td class="nowrap">{{asTime(r.reportedAt)}}</td>
              <td class="nowrap">{{channelName(r.channelId)}}</td>
              <td class="nowrap"><b>{{r.userAlias}}</b></td>
              <td class="sys-reason">{{r.summary}}<small>{{r.categories.map(catName).join(' · ')}}</small></td>
              <td class="num">{{r.categories.length}}건</td>
              <td class="nowrap"><span class="decision" :class="r.status.toLowerCase()"><Clock3 v-if="r.status==='PENDING'" :size="15"/><CheckCircle2 v-else-if="r.status==='APPROVED'" :size="15"/><XCircle v-else :size="15"/>{{r.status==='PENDING' ? '대기 중' : r.status==='APPROVED' ? '승인' : '기각'}}</span><small v-if="r.status==='REJECTED'" class="disagree">AI와 다른 판단</small></td>
              <td class="nowrap">{{r.status==='PENDING' ? `${span(r.reportedAt, now)}째` : r.decidedAt ? span(r.reportedAt, new Date(r.decidedAt).getTime()) : '-'}}</td>
              <td class="nowrap"><span v-if="r.execution==='EXECUTED'" class="exec ok"><CheckCircle2 :size="14"/>실행 완료</span><span v-else-if="r.execution==='FAILED'" class="exec fail"><AlertTriangle :size="14"/>실행 실패</span><span v-else-if="r.status==='APPROVED'" class="exec wait"><Clock3 :size="14"/>실행 대기</span><span v-else class="muted-dash">-</span></td>
            </tr>
            <tr v-if="!shownReports.length"><td colspan="9" class="empty-block">{{api ? NO_API : '해당하는 강퇴 승인 요청이 없습니다.'}}</td></tr>
          </tbody>
        </table></div>
      </section>

      <section class="card sys-section">
        <header class="sys-section-head"><div><h2>방송별 현황</h2><p>방송마다 채팅 판정 분포와 강퇴 요청 결정 결과입니다. 비정상 비율이 높은 방송이 위에 옵니다.<template v-if="channels.length"> 방송 {{shownChannels.length}}개 · 방송 중 {{shownChannels.filter(c => c.live).length}}개</template></p></div></header>
        <div v-if="channelBars.rows.length" class="sys-channel-bars">
          <div class="sys-channel-key"><ul class="stacked-legend compact" aria-hidden="true"><li v-for="s in judgment.filter(x => x.key !== 'normal')" :key="s.key"><span><i :style="{background: s.color}"/>{{s.label}}</span></li></ul><small>막대 길이: 검사한 채팅 중 비율 (끝 = {{channelBars.maxRate}}%)</small></div>
          <div v-for="c in channelBars.rows" :key="c.id" class="sys-channel-bar">
            <b class="sys-channel-name"><i v-if="c.live" class="live-dot" aria-label="방송 중"/>{{c.name}}</b>
            <StackedBar :segments="c.segments" :label="`${c.name} 비정상·판정 대기 비율`" :legend="false" thin :base="c.scanned" :scale="c.scale" empty="검사한 채팅 없음"/>
            <span class="sys-channel-meta">비정상 {{c.abnormalRate.toFixed(1)}}% · 대기 {{c.pendingRate.toFixed(1)}}%<template v-if="c.kickPending"> · <b class="sys-waiting">강퇴 대기 {{c.kickPending}}건</b></template></span>
          </div>
        </div>
        <div class="table-scroll"><table class="data-table sys-table">
          <thead><tr><th>방송</th><th>스트리머</th><th>상태</th><th class="num">검사한 채팅</th><th class="num">자동 숨김</th><th class="num">판정 대기</th><th class="num">숨김률</th><th class="num">강퇴 요청</th><th class="num">승인</th><th class="num">기각</th><th class="num">대기</th><th class="num">승인율</th></tr></thead>
          <tbody><tr v-for="c in channelStats" :key="c.id"><td class="nowrap"><b>{{c.name}}</b></td><td class="nowrap">{{c.streamer}}</td><td class="nowrap"><span v-if="c.live" class="onair"><i class="live-dot"/>방송 중 · {{nf.format(c.viewers)}}명</span><span v-else class="offair">방송 종료</span></td><td class="num">{{nf.format(c.scanned)}}</td><td class="num">{{nf.format(c.hidden)}}</td><td class="num">{{nf.format(c.held)}}</td><td class="num">{{c.hiddenRate}}%</td><td class="num">{{c.reports}}</td><td class="num">{{c.approved}}</td><td class="num">{{c.rejected}}</td><td class="num" :class="{pending: c.pending}">{{c.pending}}</td><td class="num">{{c.rate === null ? '-' : `${c.rate}%`}}</td></tr>
            <tr v-if="!channelStats.length"><td colspan="12" class="empty-block">{{api ? NO_API : '방송이 없습니다.'}}</td></tr></tbody>
        </table></div>
      </section>

      <section class="card sys-section">
        <header class="sys-section-head"><div><h2>AI 모니터링 내역</h2><p>사건이 된 메시지와 확정 상태·조치입니다. 최근 40건을 보여줍니다.</p></div></header>
        <div class="table-scroll"><table class="data-table sys-table">
          <thead><tr><th>시간</th><th>방송</th><th>사용자</th><th>메시지</th><th>유형</th><th>확정 상태</th><th>조치</th></tr></thead>
          <tbody><tr v-for="l in logs" :key="l.id"><td class="nowrap">{{asTime(l.at)}}</td><td class="nowrap">{{channelName(l.channelId)}}</td><td class="nowrap"><b>{{l.userAlias}}</b></td><td class="sys-msg">{{l.text}}</td><td class="nowrap">{{catName(l.category)}}</td><td class="nowrap"><span class="verdict-badge" :class="verdictTone(l.verdict)">{{verdictName(l.verdict)}}</span></td><td class="nowrap" :class="{report: l.action==='강퇴 승인 요청'}">{{l.action}}</td></tr>
            <tr v-if="!logs.length"><td colspan="7" class="empty-block">{{api ? NO_API : '모니터링 내역이 없습니다.'}}</td></tr></tbody>
        </table></div>
      </section>
      </template>
      <footer class="dashboard-footer"><span>LIVE:GUARD · AI Agent 모니터링</span><span>실제 연동 시 여러 채널의 사건·강퇴 검토 조회 API가 필요합니다.</span></footer>
    </main>
    </div>
  </div>
</template>
