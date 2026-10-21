<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { streamPoster, streamSrc } from './media';
import { Captions, Maximize, Minimize, Pause, Play, RectangleHorizontal, Settings, Volume2, VolumeX } from 'lucide-vue-next';

// 유튜브 라이브 플레이어 형태의 목업. 실제 스트림 대신 짧은 루프 영상을 재생한다.
withDefaults(defineProps<{ viewers?: string; title?: string; theaterButton?: boolean }>(), { viewers: '2,341', title: '', theaterButton: false });
const emit = defineEmits<{ theater: [] }>();
const root = ref<HTMLElement | null>(null);
const video = ref<HTMLVideoElement | null>(null);
const playing = ref(true);
const muted = ref(true);
const fullscreen = ref(false);
const captions = ref(false);
const elapsed = ref('1:12:08');
const started = Date.now() - 4328_000;
let timer: number | undefined;

function fmt(ms: number) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function togglePlay() {
  const v = video.value; if (!v) return;
  if (v.paused) v.play().catch(() => { playing.value = false; }); else v.pause();
}
function toggleMute() { const v = video.value; if (!v) return; v.muted = !v.muted; muted.value = v.muted; }
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else root.value?.requestFullscreen?.().catch(() => {});
}
function onFullscreen() { fullscreen.value = document.fullscreenElement === root.value; }
onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreen);
  timer = window.setInterval(() => { elapsed.value = fmt(Date.now() - started); }, 1000);
});
onBeforeUnmount(() => { document.removeEventListener('fullscreenchange', onFullscreen); window.clearInterval(timer); });
</script>

<template>
  <div ref="root" class="yt-player" :class="{ paused: !playing }">
    <video ref="video" :src="streamSrc" :poster="streamPoster" autoplay muted loop playsinline
      @play="playing = true" @pause="playing = false" @click="togglePlay" @dblclick="toggleFullscreen"/>
    <div v-if="title" class="yt-player-title">{{ title }}</div>
    <div v-if="captions" class="yt-player-captions">LIVE:GUARD Agent가 채팅방을 관리 중입니다 · 매너있는 채팅 부탁드려요!</div>
    <button v-if="!playing" class="yt-player-bigplay" aria-label="재생" @click="togglePlay"><Play :size="34" fill="currentColor"/></button>
    <div class="yt-player-chrome">
      <div class="yt-progress"><span/></div>
      <div class="yt-controls">
        <button :title="playing ? '일시중지 (k)' : '재생 (k)'" @click="togglePlay"><Pause v-if="playing" :size="22" fill="currentColor"/><Play v-else :size="22" fill="currentColor"/></button>
        <button :title="muted ? '음소거 해제 (m)' : '음소거 (m)'" @click="toggleMute"><VolumeX v-if="muted" :size="22"/><Volume2 v-else :size="22"/></button>
        <span class="yt-live-dot">실시간</span>
        <span class="yt-time">{{ elapsed }}</span>
        <span class="yt-watching">{{ viewers }}명 시청 중</span>
        <span class="yt-controls-spacer"/>
        <button :class="{ on: captions }" title="자막" @click="captions = !captions"><Captions :size="22"/></button>
        <button title="설정"><Settings :size="21"/></button>
        <button v-if="theaterButton" title="영화관 모드 (t)" @click="emit('theater')"><RectangleHorizontal :size="22"/></button>
        <button :title="fullscreen ? '전체 화면 종료 (f)' : '전체 화면 (f)'" @click="toggleFullscreen"><Minimize v-if="fullscreen" :size="21"/><Maximize v-else :size="21"/></button>
      </div>
    </div>
  </div>
</template>
