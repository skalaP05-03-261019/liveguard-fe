<script setup lang="ts">
// 시청자·운영자·시스템 화면 상단의 공통 모드 표시. 목업은 "MOCK 데이터", 실제 API는 SSE 연결 상태다.
const props = withDefaults(defineProps<{ mock?: boolean; online?: boolean }>(), { mock: false, online: false });
</script>

<template>
  <span class="mode-badge" :class="props.mock ? 'mock' : props.online ? 'online' : 'waiting'" role="status"><i aria-hidden="true"/>{{props.mock ? 'MOCK 데이터' : props.online ? '실시간 연결' : '연결 대기'}}</span>
</template>
