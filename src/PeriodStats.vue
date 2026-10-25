<script setup lang="ts">
import { computed, ref } from 'vue';
import StackedBar, { type BarSegment } from './StackedBar.vue';
import RateBars from './RateBars.vue';
import TrendLine from './TrendLine.vue';
import { JUDGMENT_COLORS, KICK_COLORS, judgmentSegments } from './chartColors';
import { addDays, daysBetween, kstDay, mockPeriodStats, type PeriodStats } from './periodMock';

// 시스템 운영자 기간 통계(#41). 고른 기간(기본 최근 7일, 한국 시간)의 방송을 끝난 방송까지 포함해 본다.
// 실시간 관제(방송 중인 채널만)와 같은 차트·색을 쓴다. 실제 API는 기간 집계 API(Backend 요청 중)가 없어 비워 둔다.
const props = withDefaults(defineProps<{ api?: boolean }>(), { api: false });
type Preset = 'today' | '7d' | '30d' | 'custom';
const presets: [Preset, string][] = [['today', '오늘'], ['7d', '최근 7일'], ['30d', '최근 30일'], ['custom', '직접 선택']];
const MAX_DAYS = 31;

const now = Date.now(), today = kstDay(now);
const preset = ref<Preset>('7d');
const customFrom = ref(addDays(today, -6)), customTo = ref(today);
const rangeError = computed(() => {
  if (preset.value !== 'custom') return '';
  if (!customFrom.value || !customTo.value) return '시작일과 끝일을 모두 골라 주세요.';
  if (customFrom.value > customTo.value) return '시작일이 끝일보다 늦습니다.';
  if (daysBetween(customFrom.value, customTo.value) > MAX_DAYS) return `기간은 최대 ${MAX_DAYS}일입니다.`;
  return '';
});
// 한국 시간 기준 [시작일, 끝일] (끝일 포함)
const range = computed<[string, string] | null>(() => {
  if (preset.value === 'today') return [today, today];
  if (preset.value === '7d') return [addDays(today, -6), today];
  if (preset.value === '30d') return [addDays(today, -29), today];
  return rangeError.value ? null : [customFrom.value, customTo.value];
});
const dot = (day: string) => day.replaceAll('-', '.');
const rangeLabel = computed(() => range.value ? (range.value[0] === range.value[1] ? dot(range.value[0]) : `${dot(range.value[0])} ~ ${dot(range.value[1])}`) : '');

const stats = computed<PeriodStats | null>(() => props.api || !range.value ? null : mockPeriodStats(range.value[0], range.value[1], now));
const lives = computed(() => stats.value?.lives ?? []);
const sum = (pick: (l: PeriodStats['lives'][number]) => number) => lives.value.reduce((n, l) => n + pick(l), 0);
const empty = (text: string) => props.api ? '연동 API 없음' : !range.value ? '기간을 다시 골라 주세요' : lives.value.length ? text : '이 기간에 방송이 없습니다';

// ① 기간 전체 채팅 판정 ② 기간 강퇴 승인 요청 처리 (실시간 관제와 같은 정의)
const judgment = computed(() => judgmentSegments(sum(l => l.scanned), sum(l => l.hidden), sum(l => l.held)));
const judgmentTotal = computed(() => sum(l => l.scanned));
const kick = computed<BarSegment[]>(() => [
  { key: 'APPROVED', label: '승인', value: sum(l => l.kickReviews.approved), color: KICK_COLORS.APPROVED },
  { key: 'PENDING', label: '결정 대기', value: sum(l => l.kickReviews.pending), color: KICK_COLORS.PENDING },
  { key: 'REJECTED', label: '기각', value: sum(l => l.kickReviews.rejected), color: KICK_COLORS.REJECTED }
]);
const kickTotal = computed(() => kick.value.reduce((n, s) => n + s.value, 0));
const approval = computed(() => { const a = kick.value[0].value, d = a + kick.value[2].value; return d ? `${Math.round(a / d * 100)}%` : '-'; });

// 일별 비정상 비율. 방송이 없던 날은 값 없음(선이 끊김)
const nf = new Intl.NumberFormat('ko-KR');
const trend = computed(() => (stats.value?.daily ?? []).map(d => ({
  key: d.date, label: d.date.slice(5).replace('-', '.'), value: d.scanned ? d.hidden / d.scanned * 100 : null,
  detail: d.scanned ? `${nf.format(d.hidden)}/${nf.format(d.scanned)}건` : undefined
})));

// 방송별 비교: 채널마다 기간 안 방송을 합친다. 지금 진행 중인 방송이 있으면 방송 중 표시
const channelRows = computed(() => {
  const by = new Map<string, { id: string; name: string; live: boolean; scanned: number; hidden: number; held: number; kickPending: number }>();
  for (const l of lives.value) {
    const r = by.get(l.channelId) ?? { id: l.channelId, name: l.channelName, live: false, scanned: 0, hidden: 0, held: 0, kickPending: 0 };
    r.live ||= l.endedAt === null; r.scanned += l.scanned; r.hidden += l.hidden; r.held += l.held; r.kickPending += l.kickReviews.pending;
    by.set(l.channelId, r);
  }
  return [...by.values()];
});
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
</script>

<template>
  <div class="sys-head">
    <div><h1>기간 통계</h1><p>끝난 방송 포함 · 기간 내 채팅·요청 · 한국 시간 기준</p></div>
    <span class="sys-mock">{{api ? '기간 집계 API가 없습니다 (Backend 요청 중)' : '목업 예시 데이터'}}</span>
  </div>
  <div class="sys-filter" role="group" aria-label="기간"><button v-for="p in presets" :key="p[0]" type="button" :class="{on: preset===p[0]}" :aria-pressed="preset===p[0]" @click="preset=p[0]">{{p[1]}}</button></div>
  <div v-if="preset==='custom'" class="period-custom">
    <label>시작일 <input v-model="customFrom" type="date" :max="today"/></label>
    <label>끝일 <input v-model="customTo" type="date" :max="today"/></label>
  </div>
  <p v-if="rangeError" class="error-inline" role="alert">{{rangeError}}</p>
  <p v-if="range" class="period-range"><b>{{rangeLabel}}</b><template v-if="stats"> · 방송 {{lives.length}}개</template></p>

  <section class="sys-charts" aria-label="기간 주요 지표">
    <article class="card sys-chart-card">
      <header><h2>기간 채팅 판정 현황</h2><span v-if="judgmentTotal" class="sys-base">{{nf.format(judgmentTotal)}}건 기준</span></header>
      <details class="metric-definition"><summary>판정 기준</summary><p>선택 기간 안에 보낸 채팅을 조회 시점 가시성으로 집계한 목업입니다. 판정 대기는 AI 조사 또는 운영자 문맥 검토 중인 채팅입니다.</p></details>
      <StackedBar :segments="judgment" label="기간 채팅 판정 현황" :empty="empty('검사한 채팅 없음')"/>
    </article>
    <article class="card sys-chart-card">
      <header><h2>기간 강퇴 승인 요청 처리 현황</h2><span v-if="kickTotal" class="sys-base">{{nf.format(kickTotal)}}건 기준</span></header>
      <p class="sys-chart-note">기간 안 강퇴 요청의 처리 결과입니다. <span v-if="kickTotal">승인율 <b>{{approval}}</b></span></p>
      <StackedBar :segments="kick" label="기간 강퇴 승인 요청 처리 현황" :empty="empty('강퇴 승인 요청 없음')"/>
    </article>
  </section>

  <section class="card sys-section">
    <header class="sys-section-head"><div><h2>일별 비정상 비율</h2><p>날짜별로 검사한 채팅 중 비정상(위반 확정) 비율입니다. 집계할 채팅이 없는 날은 선이 끊깁니다.</p></div></header>
    <TrendLine :points="trend" label="일별 비정상 비율" :color="JUDGMENT_COLORS.abnormal" :empty="empty('검사한 채팅 없음')"/>
    <details v-if="trend.length && stats" class="period-table period-daily"><summary>일별 표 보기</summary>
      <div class="table-scroll"><table class="data-table sys-table">
        <thead><tr><th>날짜</th><th class="num">검사한 채팅</th><th class="num">비정상</th><th class="num">판정 대기</th><th class="num">비정상 비율</th></tr></thead>
        <tbody><tr v-for="d in stats.daily" :key="d.date"><td class="nowrap">{{dot(d.date)}}</td><td class="num">{{nf.format(d.scanned)}}</td><td class="num">{{nf.format(d.hidden)}}</td><td class="num">{{nf.format(d.held)}}</td><td class="num">{{d.scanned ? `${(d.hidden / d.scanned * 100).toFixed(1)}%` : '채팅 없음'}}</td></tr></tbody>
      </table></div>
    </details>
  </section>

  <section class="card sys-section">
    <header class="sys-section-head"><div><h2>방송별 비교</h2><p>기간 안 채팅·요청을 방송별로 집계해 채널별로 합쳤습니다. 끝난 방송도 포함하며, 비정상 비율이 높은 채널이 위에 옵니다.</p></div></header>
    <RateBars :rows="channelRows"/>
    <p v-if="!lives.length" class="stacked-empty period-empty">{{empty('방송이 없습니다.')}}</p>
    <!-- 30일이면 방송이 100개 가까이 되어 목록은 접어 둔다 -->
    <details v-else class="period-table period-lives"><summary>방송 목록 보기 ({{lives.length}}개)</summary>
    <div class="table-scroll"><table class="data-table sys-table period-lives-table">
      <thead><tr><th>방송</th><th>시작</th><th>상태</th><th class="num">검사한 채팅</th><th class="num">비정상</th><th class="num">판정 대기</th><th class="num">강퇴 승인</th><th class="num">기각</th><th class="num">대기</th></tr></thead>
      <tbody>
        <tr v-for="l in lives" :key="l.liveId"><td class="nowrap"><b>{{l.channelName}}</b><details class="mobile-row-detail"><summary>방송 상세</summary><p>검사 {{nf.format(l.scanned)}}건 · 비정상 {{nf.format(l.hidden)}}건 · 판정 대기 {{nf.format(l.held)}}건</p><p>강퇴 승인 {{l.kickReviews.approved}}건 · 기각 {{l.kickReviews.rejected}}건 · 대기 {{l.kickReviews.pending}}건</p></details></td><td class="nowrap">{{when(l.startedAt)}}</td><td class="nowrap"><span v-if="l.endedAt === null" class="onair"><i class="live-dot"/>방송 중</span><span v-else class="offair">종료 {{when(l.endedAt)}}</span></td><td class="num">{{nf.format(l.scanned)}}</td><td class="num">{{nf.format(l.hidden)}}</td><td class="num">{{nf.format(l.held)}}</td><td class="num">{{l.kickReviews.approved}}</td><td class="num">{{l.kickReviews.rejected}}</td><td class="num" :class="{pending: l.kickReviews.pending}">{{l.kickReviews.pending}}</td></tr>
      </tbody>
    </table></div>
    </details>
  </section>
</template>
