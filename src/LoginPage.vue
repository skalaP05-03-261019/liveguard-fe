<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ArrowRight, Eye, EyeOff, ShieldCheck, X } from 'lucide-vue-next';
import { useLiveGuard } from './stores/liveGuard';
import { feedChats, feedUsers, feedViolations } from './mock';
import { avatarColor } from './avatar';
import { streamPoster, streamSrc } from './media';

const store = useLiveGuard();
const username = ref('moderator');
const password = ref('liveguard-local');
const showPassword = ref(false);
const panel = ref(false);
const isMock = computed(() => store.mode === 'mock');
async function submit() { await store.login(username.value, password.value); password.value = ''; }
function pick(account: string) { username.value = account; password.value = 'liveguard-local'; }
// 세 역할 모두 같은 로그인 창을 거친다(계약·ERD에 역할별 로그인 차이가 없고, 화면은 서버가 준 역할로 정해진다).
// Mock에서는 누른 버튼의 데모 계정을 미리 채운다.
const panelTitles = { viewer: '시청자 로그인', moderator: '스트리머 로그인', admin: '시스템 운영자 로그인' } as const;
const panelTitle = ref('로그인');
function openLogin(account: keyof typeof panelTitles) {
  store.error = ''; panelTitle.value = panelTitles[account];
  if (isMock.value) pick(account); else { username.value = ''; password.value = ''; }
  panel.value = true;
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') panel.value = false; }

// 왼쪽 말풍선 채팅 연출: 아래에서 위로 올라가고, 가끔 악성 채팅이 AI에 의해 숨김 처리된다.
interface Bubble { id: number; alias: string; text: string; hidden: boolean }
const bubbles = ref<Bubble[]>([]);
let seq = 0;
let bubbleTimer: number | undefined;
const rand = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
function pushBubble() {
  const bad = Math.random() < 0.2;
  const src = bad ? rand(feedViolations) : { alias: rand(feedUsers).alias, text: rand(feedChats) };
  const id = ++seq;
  bubbles.value.push({ id, alias: src.alias, text: src.text, hidden: false });
  if (bubbles.value.length > 7) bubbles.value.shift();
  if (bad) window.setTimeout(() => { const b = bubbles.value.find(x => x.id === id); if (b) b.hidden = true; }, 900);
}
onMounted(() => {
  window.addEventListener('keydown', onKey);
  for (let i = 0; i < 5; i++) pushBubble();
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) bubbleTimer = window.setInterval(pushBubble, 1600);
});
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); window.clearInterval(bubbleTimer); });
</script>

<template>
  <div class="login-screen">
    <video class="login-video" :src="streamSrc" :poster="streamPoster" autoplay muted loop playsinline aria-hidden="true"/>
    <header class="login-top">
      <span class="yt-logo"><span class="yt-logo-mark"><ShieldCheck :size="15"/></span><b>LIVE<span>:</span>GUARD</b></span>
      <div class="login-top-actions">
        <button class="top-secondary" :disabled="store.busy" aria-controls="login-panel" :aria-expanded="panel" @click="openLogin('viewer')">시청자로 시작하기</button>
        <button class="top-primary" :disabled="store.busy" aria-controls="login-panel" :aria-expanded="panel" @click="openLogin('moderator')">스트리머로 시작하기</button>
        <button class="login-open ghost" :disabled="store.busy" aria-controls="login-panel" :aria-expanded="panel" @click="openLogin('admin')">시스템 운영자 전용</button>
      </div>
    </header>

    <aside class="login-chat" aria-hidden="true">
      <TransitionGroup name="bubble" tag="div" class="login-chat-list">
        <div v-for="b in bubbles" :key="b.id" class="login-bubble" :class="{hidden: b.hidden}"><span class="lb-avatar" :style="{background: avatarColor(b.alias)}">{{b.alias.slice(0,1)}}</span><div class="lb-body"><b>{{b.alias}}</b><span class="lb-text">{{b.text}}</span></div><span v-if="b.hidden" class="lb-tag">AI 숨김</span></div>
      </TransitionGroup>
    </aside>

    <div v-if="panel" class="login-panel-backdrop" @click="panel = false"/>
    <section v-if="panel" id="login-panel" class="login-box login-panel" role="dialog" aria-label="로그인">
      <div class="login-box-top"><h2>{{panelTitle}}</h2><button class="login-close" aria-label="닫기" @click="panel = false"><X :size="20"/></button></div>
      <p class="muted">{{isMock ? '데모 계정을 선택해 체험해 보세요.' : '서버에 등록된 계정으로 로그인하세요.'}}</p>
      <form @submit.prevent="submit">
        <label for="username">아이디</label><input id="username" v-model="username" autocomplete="username" required placeholder="아이디 입력" />
        <label for="password">비밀번호</label><div class="password-input"><input id="password" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" required placeholder="비밀번호 입력"/><button type="button" :aria-label="showPassword ? '비밀번호 숨기기' : '비밀번호 표시'" @click="showPassword=!showPassword"><EyeOff v-if="showPassword" :size="18"/><Eye v-else :size="18"/></button></div>
        <div v-if="store.error" class="error-message" role="alert">{{store.error}}</div>
        <button type="submit" class="primary-button login-submit" :disabled="store.busy">{{store.busy ? '로그인 중…' : '로그인'}} <ArrowRight :size="18"/></button>
      </form>
      <div v-if="isMock" class="demo-login-accounts"><span>빠른 계정 선택 · 비밀번호 liveguard-local</span><div><button @click="pick('viewer')">시청자</button><button @click="pick('moderator')">스트리머</button><button @click="pick('admin')">시스템 운영자</button></div></div>
      <small class="login-footnote">세션 쿠키(JSESSIONID) · CSRF 보호 · 역할별 접근제어</small>
    </section>

    <main class="login-hero">
      <h1>라이브 채팅,<br/>AI가 악성 채팅을 검사하고<br/><span>추방 여부는 스트리머가 결정할 수 있게 리포팅합니다</span></h1>
      <div v-if="store.error && !panel" class="error-message hero-error" role="alert">{{store.error}}</div>
    </main>
  </div>
</template>
