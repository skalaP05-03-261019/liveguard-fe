<script setup lang="ts">
import { computed } from 'vue';
import StackedBar from './StackedBar.vue';
import { judgmentSegments } from './chartColors';

// 방송별 비교: 정상이 대부분(보통 97% 이상)이라 100% 누적 막대로는 방송끼리 차이가 안 보인다.
// 그래서 비정상·판정 대기 비율만 같은 눈금(가장 높은 방송 기준, 올림한 %)에서 길이로 비교하고, 비정상 비율이 높은 순으로 놓는다.
export interface RateRow { id: string; name: string; live: boolean; scanned: number; hidden: number; held: number; kickPending: number }
const nf = new Intl.NumberFormat('ko-KR');
const props = defineProps<{ rows: RateRow[] }>();

const legend = judgmentSegments(0, 0, 0).filter(s => s.key !== 'normal');
const bars = computed(() => {
  const rows = props.rows.map(c => ({
    ...c, segments: judgmentSegments(c.scanned, c.hidden, c.held).filter(s => s.key !== 'normal'),
    abnormalRate: c.scanned ? c.hidden / c.scanned * 100 : 0, pendingRate: c.scanned ? c.held / c.scanned * 100 : 0
  })).sort((a, b) => b.abnormalRate - a.abnormalRate);
  const maxRate = Math.max(1, Math.ceil(Math.max(0, ...rows.map(r => r.abnormalRate + r.pendingRate))));
  return { maxRate, rows: rows.map(r => ({ ...r, scale: r.scanned * maxRate / 100 })) };
});
</script>

<template>
  <div v-if="bars.rows.length" class="sys-channel-bars">
    <div class="sys-channel-key"><ul class="stacked-legend compact" aria-hidden="true"><li v-for="s in legend" :key="s.key"><span><i :style="{background: s.color}"/>{{s.label}}</span></li></ul><small>검사한 채팅 중 비율 · 자동 눈금 0–{{bars.maxRate}}%</small></div>
    <div class="rate-axis" aria-label="비율 눈금"><span>0%</span><span>{{bars.maxRate / 2}}%</span><span>{{bars.maxRate}}%</span></div>
    <div v-for="c in bars.rows" :key="c.id" class="sys-channel-bar">
      <b class="sys-channel-name"><i v-if="c.live" class="live-dot" aria-label="방송 중"/>{{c.name}}</b>
      <StackedBar :segments="c.segments" :label="`${c.name} 비정상·판정 대기 비율`" :legend="false" thin :base="c.scanned" :scale="c.scale" empty="검사한 채팅 없음"/>
      <span class="sys-channel-meta">검사 {{nf.format(c.scanned)}}건 · 비정상 {{c.abnormalRate.toFixed(1)}}% · 대기 {{c.pendingRate.toFixed(1)}}%<template v-if="c.kickPending"> · <b class="sys-waiting">강퇴 대기 {{c.kickPending}}건</b></template></span>
    </div>
  </div>
</template>
