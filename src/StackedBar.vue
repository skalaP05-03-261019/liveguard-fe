<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

// 시스템 운영자 대시보드의 누적 가로 막대(부분 대 전체). 외부 차트 라이브러리 없이 그린다.
// 조각 사이 2px 간격, 양끝만 둥글게, % 라벨은 조각 안에 들어갈 때만(안 들어가면 범례·툴팁이 맡는다).
// 색은 dataviz 검증 스크립트로 고른 값을 호출자가 준다. 색만으로 구분하지 않도록 범례에 라벨·건수·%를 함께 둔다.
export interface BarSegment { key: string; label: string; value: number; color: string }
// base: % 글자의 분모(기본은 조각 합), scale: 막대 전체 길이에 해당하는 값(기본은 조각 합). 여러 막대를 같은 눈금으로 비교할 때 scale을 준다
const props = withDefaults(defineProps<{ segments: BarSegment[]; label: string; empty?: string; legend?: boolean; thin?: boolean; base?: number | null; scale?: number | null }>(),
  { empty: '데이터 없음', legend: true, thin: false, base: null, scale: null });

const nf = new Intl.NumberFormat('ko-KR');
const total = computed(() => props.segments.reduce((n, s) => n + s.value, 0));
const base = computed(() => props.base ?? total.value);
const pct = (v: number) => base.value ? v / base.value * 100 : 0;
// 막대 길이 비율(0~100). scale이 조각 합보다 크면 남는 자리는 비워 둔다
const span = computed(() => Math.max(props.scale ?? total.value, total.value));
const share = (v: number) => span.value ? v / span.value * 100 : 0;
const rest = computed(() => span.value - total.value);
const pctText = (v: number) => `${pct(v).toFixed(pct(v) >= 10 || pct(v) === 0 ? 0 : 1)}%`;
const shown = computed(() => props.segments.filter(s => s.value > 0));
const describe = (s: BarSegment) => `${s.label} ${nf.format(s.value)}건 (${pctText(s.value)})`;
// 조각 안 % 글자색: 흰 글자가 4.5:1 이상이면 흰색, 아니면 진한 글자(노랑 위 흰 글자는 약 2:1이라 못 읽는다)
function ink(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05) >= 4.5 ? '#fff' : '#0b0b0b';
}

// 조각 안 라벨은 실제 너비를 재서 들어갈 때만 쓴다(너비는 화면 크기에 따라 바뀐다)
const track = ref<HTMLElement | null>(null), width = ref(0);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!track.value || typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(([entry]) => { width.value = entry.contentRect.width; });
  observer.observe(track.value);
});
onBeforeUnmount(() => observer?.disconnect());
const fits = (v: number) => !props.thin && share(v) / 100 * width.value >= 44;

// 마우스를 올리거나 키보드로 고른 조각의 툴팁
const active = ref<string | null>(null);
const activeSegment = computed(() => shown.value.find(s => s.key === active.value) ?? null);
const tipLeft = computed(() => {
  const i = shown.value.findIndex(s => s.key === active.value); if (i < 0) return 0;
  const before = shown.value.slice(0, i).reduce((n, s) => n + share(s.value), 0);
  return before + share(shown.value[i].value) / 2;
});
// 막대 끝 조각의 툴팁이 카드 밖으로 잘리지 않게, 가장자리에서는 툴팁을 그쪽 끝에 맞춘다
const tipStyle = computed(() => {
  const at = tipLeft.value;
  if (at < 25) return { left: '0', transform: 'none' };
  if (at > 75) return { right: '0', left: 'auto', transform: 'none' };
  return { left: `${at}%` };
});
</script>

<template>
  <div class="stacked-bar" :class="{thin}">
    <div ref="track" class="stacked-track" role="group" :aria-label="label">
      <template v-if="total">
        <span v-for="s in shown" :key="s.key" class="stacked-seg" :style="{flexGrow: s.value, background: s.color, color: ink(s.color)}" role="img" tabindex="0" :aria-label="describe(s)"
          @mouseenter="active = s.key" @mouseleave="active = null" @focus="active = s.key" @blur="active = null"><b v-if="fits(s.value)">{{pctText(s.value)}}</b></span>
        <span v-if="rest > 0" class="stacked-rest" :style="{flexGrow: rest}" aria-hidden="true"/>
      </template>
      <span v-else class="stacked-empty">{{empty}}</span>
      <div v-if="activeSegment" class="stacked-tip" role="tooltip" :style="tipStyle"><i :style="{background: activeSegment.color}"/>{{activeSegment.label}} · {{nf.format(activeSegment.value)}}건 · {{pctText(activeSegment.value)}}</div>
    </div>
    <ul v-if="legend && total" class="stacked-legend">
      <li v-for="s in segments" :key="s.key" :class="{'judgment-attention': s.key==='abnormal' || s.key==='pending', 'judgment-normal': s.key==='normal'}"><span><i :style="{background: s.color}" aria-hidden="true"/>{{s.label}}</span><b>{{nf.format(s.value)}}건</b><small>{{pctText(s.value)}}</small></li>
    </ul>
  </div>
</template>
