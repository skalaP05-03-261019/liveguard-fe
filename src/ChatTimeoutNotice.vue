<script setup lang="ts">
import { Clock } from 'lucide-vue-next';
import { timeoutEndText, timeoutRemainingText } from './chatTime';

withDefaults(defineProps<{
  until?: string | null;
  now: number;
  reason?: string | null;
  effects?: boolean;
  variant?: 'inline' | 'composer';
}>(), { effects: false, variant: 'inline' });
</script>

<template>
  <div class="chat-timeout-notice" :class="{'chat-timeout-effects': effects, 'chat-timeout-composer-notice': variant==='composer'}" :role="variant==='composer' ? undefined : 'status'">
    <span class="chat-timeout-icon" aria-hidden="true"><Clock :size="20"/></span>
    <div class="chat-timeout-body">
      <b>채팅이 일시 제한되었습니다</b>
      <p v-if="reason">사유: {{reason}}</p>
      <div v-if="until" class="chat-timeout-timing" aria-live="off">
        <p>종료: <time :datetime="until">{{timeoutEndText(until)}}</time> (한국 시간)</p>
        <p>남은 시간 <strong>{{timeoutRemainingText(until, now)}}</strong></p>
      </div>
      <p v-else>제한 종료 시각을 확인하고 있습니다.</p>
      <p>방송 시청은 계속할 수 있습니다.</p>
    </div>
  </div>
</template>

<style scoped>
.chat-timeout-notice{flex:none;display:flex;align-items:flex-start;gap:12px;padding:16px;border-top:1px solid #e8d9ad;background:#fff8e7;color:#694d13;font-size:13px;line-height:1.7;overflow-wrap:anywhere}
.chat-timeout-icon{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#ffebbc;color:#946000}
.chat-timeout-body{min-width:0}
.chat-timeout-body>b{font-size:14px;font-weight:600}
.chat-timeout-body p{margin:3px 0}
.chat-timeout-timing{margin:8px 0;font-variant-numeric:tabular-nums}
.chat-timeout-timing strong{font-size:16px;white-space:normal}
.chat-timeout-effects{animation:chat-timeout-start .7s ease-out}
.chat-timeout-effects .chat-timeout-icon{animation:chat-timeout-icon .7s ease-out}
.chat-timeout-composer-notice{width:100%;box-sizing:border-box;gap:10px;padding:12px 16px;font-size:12px;line-height:1.55}
.chat-timeout-composer-notice .chat-timeout-timing{margin:6px 0}
.chat-timeout-composer-notice.chat-timeout-effects{animation:chat-timeout-composer-enter .28s ease-out}
@keyframes chat-timeout-composer-enter{from{opacity:.3;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes chat-timeout-start{0%{background:#ffe2a0;box-shadow:inset 4px 0 #d58a00}100%{background:#fff8e7;box-shadow:inset 0 0 transparent}}
@keyframes chat-timeout-icon{0%{transform:scale(.8)}45%{transform:scale(1.12)}100%{transform:scale(1)}}
@media(prefers-reduced-motion:reduce){.chat-timeout-effects,.chat-timeout-effects .chat-timeout-icon,.chat-timeout-composer-notice.chat-timeout-effects{animation:none}}
</style>
