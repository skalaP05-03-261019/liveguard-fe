<script setup lang="ts">
defineProps<{ wifiName: string }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <aside class="connection-notice" role="alert">
    <div class="connection-notice-copy">
      <b>서버에 연결할 수 없습니다.</b>
      <p>시연에 참여하려면 ‘{{wifiName}}’ Wi-Fi에 연결한 후 다시 접속해 주세요. 연결 후에도 문제가 계속되면 진행자에게 문의해 주세요.</p>
    </div>
    <button type="button" @click="emit('retry')">다시 시도</button>
  </aside>
</template>
