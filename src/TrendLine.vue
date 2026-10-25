<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

// 날짜별 값 하나를 잇는 선 그래프(축 하나). 값이 없는 날(방송 없음)은 0으로 그리지 않고 선을 끊는다.
// 마우스를 올리거나 키보드로 고른 날짜에 세로선과 툴팁을 보인다. 표 보기는 호출자가 함께 둔다.
export interface TrendPoint { key: string; label: string; value: number | null; detail?: string }
const props = withDefaults(defineProps<{ points: TrendPoint[]; label: string; color: string; empty?: string }>(), { empty: '데이터 없음' });

const H = 200, M = { l: 44, r: 14, t: 14, b: 28 };
const wrap = ref<HTMLElement | null>(null), width = ref(640);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!wrap.value || typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(([entry]) => { width.value = Math.max(240, entry.contentRect.width); });
  observer.observe(wrap.value);
});
onBeforeUnmount(() => observer?.disconnect());

const values = computed(() => props.points.map(p => p.value).filter((v): v is number => v !== null));
const max = computed(() => Math.max(1, Math.ceil(Math.max(0, ...values.value))));
const plotW = computed(() => width.value - M.l - M.r);
const x = (i: number) => M.l + (props.points.length <= 1 ? plotW.value / 2 : i * plotW.value / (props.points.length - 1));
const y = (v: number) => M.t + (1 - v / max.value) * (H - M.t - M.b);
// 값이 없는 날에서 선을 끊는다
const paths = computed(() => {
  const out: string[] = []; let d = '';
  props.points.forEach((p, i) => {
    if (p.value === null) { if (d) out.push(d); d = ''; return; }
    d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  if (d) out.push(d);
  return out;
});
const ticks = computed(() => [0, max.value / 2, max.value]);
const tickText = (t: number) => `${t.toFixed(max.value < 4 && t % 1 ? 1 : 0)}%`;
// x 라벨은 겹치지 않게 건너뛴다(라벨 하나에 약 52px)
const labelStep = computed(() => Math.max(1, Math.ceil(props.points.length / Math.max(1, Math.floor(plotW.value / 52)))));
// 마지막 날짜는 항상 보이고, 그 바로 앞의 정기 라벨은 겹치므로 뺀다
const showLabel = (i: number) => { const last = props.points.length - 1; return i === last || (i % labelStep.value === 0 && last - i >= labelStep.value); };
const colW = computed(() => props.points.length ? plotW.value / Math.max(1, props.points.length - 1 || 1) : 0);

const active = ref<number | null>(null);
const activePoint = computed(() => active.value === null ? null : props.points[active.value] ?? null);
const tipStyle = computed(() => {
  if (active.value === null) return {};
  const at = x(active.value), w = width.value;
  return at < w * 0.25 ? { left: `${at}px`, transform: 'none' } : at > w * 0.75 ? { left: `${at}px`, transform: 'translateX(-100%)' } : { left: `${at}px` };
});
const summary = computed(() => {
  const withValue = props.points.filter(p => p.value !== null);
  if (!withValue.length) return props.empty;
  const top = withValue.reduce((a, b) => (b.value! > a.value! ? b : a));
  return `${props.label}. ${withValue.length}일, 가장 높은 날 ${top.label} ${top.value!.toFixed(1)}%`;
});
function onKey(e: KeyboardEvent) {
  const n = props.points.length; if (!n) return;
  if (e.key === 'ArrowRight') active.value = Math.min(n - 1, (active.value ?? -1) + 1);
  else if (e.key === 'ArrowLeft') active.value = Math.max(0, (active.value ?? n) - 1);
  else return;
  e.preventDefault();
}
</script>

<template>
  <div ref="wrap" class="trend-wrap">
    <p v-if="!values.length" class="stacked-empty trend-empty">{{empty}}</p>
    <template v-else>
      <svg :width="width" :height="H" role="img" :aria-label="summary" tabindex="0" @keydown="onKey" @blur="active = null" @mouseleave="active = null">
        <g class="trend-grid">
          <template v-for="t in ticks" :key="t"><line :x1="M.l" :x2="width - M.r" :y1="y(t)" :y2="y(t)"/><text :x="M.l - 8" :y="y(t) + 4" text-anchor="end">{{tickText(t)}}</text></template>
        </g>
        <g class="trend-x"><text v-for="(p, i) in points" v-show="showLabel(i)" :key="p.key" :x="x(i)" :y="H - 8" text-anchor="middle">{{p.label}}</text></g>
        <line v-if="active !== null" class="trend-cross" :x1="x(active)" :x2="x(active)" :y1="M.t" :y2="H - M.b"/>
        <path v-for="(d, i) in paths" :key="i" :d="d" fill="none" :stroke="color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <template v-for="(p, i) in points" :key="'m' + p.key"><circle v-if="p.value !== null" :cx="x(i)" :cy="y(p.value)" :r="active === i ? 5 : 4" :fill="color" class="trend-marker"/></template>
        <rect v-for="(p, i) in points" :key="'h' + p.key" class="trend-hit" :x="x(i) - colW / 2" :y="M.t" :width="Math.max(colW, 8)" :height="H - M.t - M.b" @mouseenter="active = i"/>
      </svg>
      <div v-if="activePoint" class="stacked-tip trend-tip" role="tooltip" :style="tipStyle"><i :style="{background: color}"/>{{activePoint.label}} · {{activePoint.value === null ? '방송 없음' : `${activePoint.value.toFixed(1)}%`}}<template v-if="activePoint.detail"> · {{activePoint.detail}}</template></div>
    </template>
  </div>
</template>
