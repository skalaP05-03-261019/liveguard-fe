<script setup lang="ts">
// 화면 상단의 데이터 모드 표시. 시청자·운영자·시스템 운영자 화면이 같은 자리·같은 모양으로 쓴다.
// 목업은 "MOCK 데이터", 실제 API는 실시간 연결 상태를 보여 준다.
defineProps<{ mock?: boolean; online?: boolean }>();
</script>

<template>
  <span class="mode-badge" :class="mock ? 'mock' : online ? 'on' : 'off'" role="status" data-mode-badge>
    <i aria-hidden="true"/>{{ mock ? 'MOCK 데이터' : online ? '실시간 연결' : '연결 대기' }}
  </span>
</template>
