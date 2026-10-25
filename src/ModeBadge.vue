<script setup lang="ts">
// 시청자·운영자·시스템 화면 상단의 공통 모드 표시. 목업은 "MOCK 데이터", 실제 API는 SSE 연결 상태다.
// 연결되면 생방송처럼 "ON AIR"(빨간 배경)로 보이고, 화면 낭독기에는 "실시간 연결"이라고 함께 읽힌다.
const props = withDefaults(defineProps<{ mock?: boolean; online?: boolean }>(), { mock: false, online: false });
</script>

<template>
  <span class="mode-badge" :class="props.mock ? 'mock' : props.online ? 'online' : 'waiting'" role="status" :aria-label="props.mock ? 'MOCK 데이터' : props.online ? 'ON AIR · 실시간 연결' : 'OFF AIR · 실시간 연결 대기'"><i aria-hidden="true"/><span class="mode-badge-label">{{props.mock ? 'MOCK 데이터' : props.online ? 'ON AIR' : 'OFF AIR'}}</span></span>
</template>
