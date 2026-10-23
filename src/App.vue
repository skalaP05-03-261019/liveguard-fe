<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { AlertCircle, CheckCircle2 } from 'lucide-vue-next';
import LoginPage from './LoginPage.vue';
import ViewerPage from './ViewerPage.vue';
import SystemPage from './SystemPage.vue';
import LiveConsole from './LiveConsole.vue';
import StudioScreen from './StudioScreen.vue';
import { useLiveGuard } from './stores/liveGuard';
import { demoScenarios } from './mock';
import { KICK_WAITING } from './mockLive';
import type { Category, ContextDecision, KickDecision, LiveReview } from './contracts';

// 역할별 화면 분기. API 모드는 모든 역할이 LiveConsole(liveId API·SSE)을 쓰고,
// 목업 모드의 운영자는 같은 StudioScreen에 목업 방송(mockLive) 데이터를 넘긴다.
const store = useLiveGuard();
const role = computed(() => store.me?.role);
const mock = store.mock.state;
const caseNames = computed(() => Object.fromEntries(mock.cases.map(c => [c.caseId, store.mock.aliasOf(c.userId)])));
function onDecide(r: LiveReview, value: ContextDecision | KickDecision, reason: string, categories: Category[]) { store.decide(r.reviewId, value, reason, categories); }
onMounted(() => store.init());
onBeforeUnmount(() => store.dispose());
</script>

<template>
  <LoginPage v-if="store.loginRequired || !store.me"/>
  <LiveConsole v-else-if="store.mode==='api'"/>
  <ViewerPage v-else-if="role==='VIEWER'"/>
  <SystemPage v-else-if="role==='PLATFORM_ADMIN'"/>
  <StudioScreen v-else mock :nickname="store.me?.nickname ?? '운영자'" channel-name="행복한게임방" :live="mock.live" :online="true" :messages="mock.messages" :reviews="mock.reviews" :cases="mock.cases" :case-names="caseNames" :logs="mock.logs" :kick-progress="mock.kickProgress" :busy="store.busy" :error="store.error" :notice="store.notice" :feed-on="store.feedOn"
    @decide="onDecide" @revoke="(caseId, findingId, reason) => store.revoke(caseId, findingId, reason)" @logout="store.logout()" @toggle-feed="store.toggleFeed()">
    <template #demo><div class="scenario-toolbar"><span>빠른 시연</span><button v-for="s in demoScenarios" :key="s.key" @click="store.mockScenario(s.key)">{{s.label}}</button></div></template>
    <template #kick-actions="{ reviewId, state }"><span v-if="state===KICK_WAITING" class="mock-kick-actions">
      <button @click="store.finishKick(reviewId,'SUCCEEDED')">모의 적용 성공</button>
      <button @click="store.finishKick(reviewId,'FAILED')">모의 적용 실패</button>
      <button @click="store.finishKick(reviewId,'UNKNOWN')">결과 미확인 시뮬레이션</button>
    </span></template>
  </StudioScreen>
  <!-- 알림: 시청자·운영자 화면은 화면 안 안내 줄(role=status)로 보여 준다. 안내 줄이 없는 시스템 운영자 화면에만 토스트를 띄운다 -->
  <div v-if="store.notice && !store.loginRequired && store.me && role==='PLATFORM_ADMIN'" class="toast" :role="store.notice === store.error ? 'alert' : 'status'"><AlertCircle v-if="store.notice === store.error" :size="18"/><CheckCircle2 v-else :size="18"/> {{store.notice}}</div>
</template>
