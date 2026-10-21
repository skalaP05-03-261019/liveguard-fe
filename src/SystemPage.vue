<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { AlertTriangle, CheckCircle2, Clock3, LogOut, ShieldCheck, XCircle } from 'lucide-vue-next';
import { useLiveGuard } from './stores/liveGuard';
import { categoryLabels, type Category } from './contracts';
import { avatarColor } from './avatar';
import { sanctionFor, hideLabels } from './sanction';
import { LIVE_CHANNEL_ID, sysChannels, sysLogs, sysReports, type SysChannel, type SysLog, type SysReport, type ReportStatus } from './systemMock';

// 시스템 운영자: LIVE:GUARD Agent가 여러 방송에서 올바르게 판단하는지 모니터링한다.
// 행복한게임방은 스토어의 Mock 상태(스트리머의 실제 승인·기각 포함)를, 나머지 방송은 고정 예시를 쓴다.
const store = useLiveGuard();
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

// 실제 Mock 채널(행복한게임방). 데모 화면의 채팅 수에 오늘 앞서 검사한 양(예시 기준값)을 더해 다른 방송과 규모를 맞춘다.
const LIVE_BASE = { scanned: 1480, hidden: 27 };
const liveChannel = computed<SysChannel>(() => ({ id: LIVE_CHANNEL_ID, name: '행복한게임방', streamer: '행복한게임방', live: true, viewers: 2341, scanned: LIVE_BASE.scanned + store.messages.length, hidden: LIVE_BASE.hidden + store.messages.filter(m => m.visibility !== 'PUBLIC').length }));
const liveReports = computed<SysReport[]>(() => store.kickReviews.map(r => ({
  id: r.reviewId, channelId: LIVE_CHANNEL_ID, userAlias: r.userAlias, summary: r.summary,
  categories: r.caseIds.map(id => store.details[id]?.category).filter((c): c is Category => !!c),
  reportedAt: r.createdAt, status: (r.status === 'PENDING' ? 'PENDING' : r.status === 'REJECTED' ? 'REJECTED' : 'APPROVED') as ReportStatus,
  decidedAt: store.decidedAt[r.reviewId] ?? null, decisionReason: r.decisionReason ?? null,
  execution: r.status === 'EXECUTED' ? 'EXECUTED' : r.status === 'FAILED' ? 'FAILED' : null
})));
const liveLogs = computed<SysLog[]>(() => Object.values(store.details).map(c => {
  const action = c.kickReview ? '추방 리포팅' : c.verdict === 'NEEDS_REVIEW' ? '판단 보류' : c.verdict === 'NO_VIOLATION' ? '공개 복원'
    : c.category ? (s => s.timeoutSec === 600 ? `${hideLabels[s.hide]} + 10분 제한` : hideLabels[s.hide])(sanctionFor(c.category, Math.max(c.violationCount - 1, 0))) : '숨김';
  return { id: c.caseId, channelId: LIVE_CHANNEL_ID, at: c.createdAt, userAlias: c.userAlias, text: c.messages[0]?.text ?? '', category: c.category ?? null, verdict: c.verdict ?? 'NEEDS_REVIEW', action };
}));

const channels = computed(() => [liveChannel.value, ...sysChannels]);
const channelName = (id: string) => channels.value.find(c => c.id === id)?.name ?? id;
const channelFilter = ref<string>('ALL');
const statusFilter = ref<'ALL' | ReportStatus>('ALL');
const inChannel = <T extends { channelId?: string; id?: string }>(x: T, id = (x as { channelId?: string }).channelId ?? (x as { id: string }).id) => channelFilter.value === 'ALL' || id === channelFilter.value;

const allReports = computed(() => [...liveReports.value, ...sysReports].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)));
const reports = computed(() => allReports.value.filter(r => inChannel(r)));
const shownReports = computed(() => reports.value.filter(r => statusFilter.value === 'ALL' || r.status === statusFilter.value));
const logs = computed(() => [...liveLogs.value, ...sysLogs].filter(l => inChannel(l)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40));
const shownChannels = computed(() => channels.value.filter(c => inChannel(c, c.id)));

const count = (list: SysReport[], s: ReportStatus) => list.filter(r => r.status === s).length;
const rate = (list: SysReport[]) => { const a = count(list, 'APPROVED'), d = a + count(list, 'REJECTED'); return d ? Math.round((a / d) * 100) : null; };
const kpi = computed(() => {
  const ch = shownChannels.value, rs = reports.value;
  const scanned = ch.reduce((n, c) => n + c.scanned, 0), hidden = ch.reduce((n, c) => n + c.hidden, 0);
  const pending = rs.filter(r => r.status === 'PENDING').sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));
  const approvalRate = rate(rs);
  return [
    { label: '모니터링 중인 방송', value: nf.format(ch.length), sub: `LIVE ${ch.filter(c => c.live).length}개` },
    { label: 'AI가 검사한 채팅', value: nf.format(scanned), sub: '오늘 누적' },
    { label: '자동 숨김', value: nf.format(hidden), sub: scanned ? `숨김률 ${(hidden / scanned * 100).toFixed(1)}%` : '숨김률 -' },
    { label: '추방 리포팅', value: nf.format(rs.length), sub: 'Agent의 interrupt() 요청' },
    { label: '스트리머 승인율', value: approvalRate === null ? '-' : `${approvalRate}%`, sub: `승인 ${count(rs, 'APPROVED')} · 기각 ${count(rs, 'REJECTED')}` },
    { label: '결정 대기', value: nf.format(pending.length), sub: pending.length ? `가장 오래 ${span(pending[0].reportedAt, now.value)}째` : '대기 없음', alert: pending.length > 0 }
  ];
});
const channelStats = computed(() => shownChannels.value.map(c => {
  const rs = allReports.value.filter(r => r.channelId === c.id);
  return { ...c, reports: rs.length, approved: count(rs, 'APPROVED'), rejected: count(rs, 'REJECTED'), pending: count(rs, 'PENDING'), rate: rate(rs), hiddenRate: c.scanned ? (c.hidden / c.scanned * 100).toFixed(1) : '-' };
}));
</script>

<template>
  <div class="app-shell sys-shell">
    <header class="topbar"><div class="topbar-title"><span class="yt-logo"><span class="yt-logo-mark"><ShieldCheck :size="15"/></span><b>LIVE<span>:</span>GUARD</b></span><span class="console-tag">System</span></div>
      <div class="topbar-right"><span class="yt-me" :style="{background: avatarColor(store.me?.nickname ?? '시스템')}">{{(store.me?.nickname ?? '시').slice(0,1)}}</span><span class="operator-info">{{store.me?.nickname}}</span><button class="header-logout" @click="store.logout()"><LogOut :size="16"/> 로그아웃</button></div></header>
    <main class="main-content sys-main">
      <div class="sys-head">
        <div><h1>AI Agent 모니터링</h1><p>여러 방송에서 LIVE:GUARD Agent가 내린 판단과, 추방 리포팅에 대한 스트리머의 최종 결정을 확인합니다.</p></div>
        <span class="sys-mock">Mock 데이터 · 행복한게임방은 데모 상태와 연동</span>
      </div>
      <div class="sys-filter" role="group" aria-label="방송 필터"><button :class="{on: channelFilter==='ALL'}" @click="channelFilter='ALL'">전체 방송</button><button v-for="c in channels" :key="c.id" :class="{on: channelFilter===c.id}" @click="channelFilter=c.id"><i v-if="c.live" class="live-dot" aria-label="방송 중"/>{{c.name}}</button></div>

      <section class="sys-kpis" aria-label="주요 지표">
        <div v-for="k in kpi" :key="k.label" class="sys-tile" :class="{alert: k.alert}"><span>{{k.label}}</span><b>{{k.value}}</b><small>{{k.sub}}</small></div>
      </section>

      <section class="card sys-section">
        <header class="sys-section-head"><div><h2>추방 리포팅 추적</h2><p>Agent가 <code>interrupt()</code>로 올린 추방 요청을 스트리머가 실제로 승인했는지, <code>kick_user</code>가 실행됐는지 확인합니다.</p></div>
          <div class="sys-chips" role="group" aria-label="결정 상태 필터"><button v-for="f in ([['ALL','전체'],['PENDING','대기'],['APPROVED','승인'],['REJECTED','기각']] as const)" :key="f[0]" :class="{on: statusFilter===f[0]}" @click="statusFilter=f[0]">{{f[1]}} <b>{{f[0]==='ALL' ? reports.length : count(reports, f[0])}}</b></button></div></header>
        <div class="table-scroll"><table class="data-table sys-table">
          <thead><tr><th>리포팅</th><th>방송</th><th>대상 사용자</th><th>AI 리포팅 사유</th><th>위반</th><th>스트리머 결정</th><th>결정까지</th><th>kick_user</th><th>스트리머 판단 근거</th></tr></thead>
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
              <td class="sys-note">{{r.decisionReason ?? '-'}}</td>
            </tr>
            <tr v-if="!shownReports.length"><td colspan="9" class="empty-block">해당하는 추방 리포팅이 없습니다.</td></tr>
          </tbody>
        </table></div>
      </section>

      <section class="card sys-section">
        <header class="sys-section-head"><div><h2>방송별 현황</h2><p>방송마다 Agent가 검사·숨김·리포팅한 양과 스트리머의 결정 결과입니다.</p></div></header>
        <div class="table-scroll"><table class="data-table sys-table">
          <thead><tr><th>방송</th><th>스트리머</th><th>상태</th><th class="num">검사한 채팅</th><th class="num">자동 숨김</th><th class="num">숨김률</th><th class="num">추방 리포팅</th><th class="num">승인</th><th class="num">기각</th><th class="num">대기</th><th class="num">승인율</th></tr></thead>
          <tbody><tr v-for="c in channelStats" :key="c.id"><td class="nowrap"><b>{{c.name}}</b></td><td class="nowrap">{{c.streamer}}</td><td class="nowrap"><span v-if="c.live" class="onair"><i class="live-dot"/>방송 중 · {{nf.format(c.viewers)}}명</span><span v-else class="offair">방송 종료</span></td><td class="num">{{nf.format(c.scanned)}}</td><td class="num">{{nf.format(c.hidden)}}</td><td class="num">{{c.hiddenRate}}%</td><td class="num">{{c.reports}}</td><td class="num">{{c.approved}}</td><td class="num">{{c.rejected}}</td><td class="num" :class="{pending: c.pending}">{{c.pending}}</td><td class="num">{{c.rate === null ? '-' : `${c.rate}%`}}</td></tr></tbody>
        </table></div>
      </section>

      <section class="card sys-section">
        <header class="sys-section-head"><div><h2>AI 모니터링 내역</h2><p>Agent가 판단한 메시지와 적용한 조치입니다. 최근 40건을 보여줍니다.</p></div></header>
        <div class="table-scroll"><table class="data-table sys-table">
          <thead><tr><th>시간</th><th>방송</th><th>사용자</th><th>메시지</th><th>유형</th><th>AI 판정</th><th>AI 조치</th></tr></thead>
          <tbody><tr v-for="l in logs" :key="l.id"><td class="nowrap">{{asTime(l.at)}}</td><td class="nowrap">{{channelName(l.channelId)}}</td><td class="nowrap"><b>{{l.userAlias}}</b></td><td class="sys-msg">{{l.text}}</td><td class="nowrap">{{catName(l.category)}}</td><td class="nowrap"><span class="verdict-badge" :class="verdictTone(l.verdict)">{{verdictName(l.verdict)}}</span></td><td class="nowrap" :class="{report: l.action==='추방 리포팅'}">{{l.action}}</td></tr></tbody>
        </table></div>
      </section>
      <footer class="dashboard-footer"><span>LIVE:GUARD · AI Agent 모니터링 (Mock)</span><span>실제 연동 시 여러 채널의 사건·강퇴 검토 조회 API가 필요합니다.</span></footer>
    </main>
  </div>
</template>
