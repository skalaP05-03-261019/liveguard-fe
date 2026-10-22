<script setup lang="ts">
import { computed, ref } from 'vue';
import ViewerScreen from './ViewerScreen.vue';
import { useLiveGuard } from './stores/liveGuard';
import { filterExamples } from './mock';

const store = useLiveGuard();
const input = ref('');
const demoPreviews = ref<Record<string, string>>({});
const timeoutReason = computed(() => demoPreviews.value[store.viewerId] === store.viewerTimeoutUntil
  ? '채팅 제한 화면을 확인하기 위한 목업 시연입니다.' : store.viewerLastReason);
async function send() { if (await store.sendMessage(input.value)) input.value = ''; }
function chooseViewer(id: string) { store.viewerId = id; }
// UI 효과 시연만 바꾼다. 위반 사건 생성·정책 판정은 하지 않는다.
function previewTimeout(seconds: 0 | 10 | 86400) {
  if (store.kicked) return;
  const until = seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;
  if (until) demoPreviews.value[store.viewerId] = until; else delete demoPreviews.value[store.viewerId];
  store.setMockTimeout(store.viewerId, until);
}
</script>

<template>
  <ViewerScreen v-model:draft="input" :messages="store.viewerMessages" :nickname="store.viewerAlias" :scope-key="store.channelId + ':' + store.viewerId" :clock="store.clock" mock :busy="store.busy" :blocked="store.kicked" :timed-out="store.timedOut" :timeout-until="store.viewerTimeoutUntil" :timeout-reason="timeoutReason" :error="store.error" @send="send" @logout="store.logout()">
    <template #demo>
      <div class="viewer-demo">
        <b>목업 시연</b><span>시청자 계정을 변경하면 본인의 비공개 메시지 가시성을 확인할 수 있습니다.</span>
        <select aria-label="목업 시청자 선택" :value="store.viewerId" @change="chooseViewer(($event.target as HTMLSelectElement).value)"><option value="22222222-2222-4222-8222-222222222221">별빛시청자 (정상)</option><option value="22222222-2222-4222-8222-222222222222">어둠의유저 (제한 상태 확인)</option><option value="22222222-2222-4222-8222-222222222223">정보왕</option></select>
        <div class="viewer-demo-effects">
          <button type="button" :disabled="store.kicked" @click="previewTimeout(10)">제한·해제 효과 보기</button>
          <button type="button" :disabled="store.kicked" @click="previewTimeout(86400)">24시간 표시 보기</button>
          <button type="button" :disabled="store.kicked || !store.timedOut" @click="previewTimeout(0)">제한 해제 시연</button>
          <small>효과 보기는 시연을 위해 10초 후 해제됩니다. 실제 정책 시간과는 다릅니다.</small>
        </div>
        <div class="viewer-demo-filters" aria-label="필터 사전 예시">
          <p>필터 사전 예시 · Backend 사전(dict-v2)과 같은 단어입니다. 누르면 입력창에 채워집니다.</p>
          <div v-for="group in filterExamples" :key="group.key" class="filter-group" :class="group.key">
            <b>{{group.title}}</b><small>{{group.note}}</small>
            <div><button v-for="item in group.items" :key="item.label" type="button" :disabled="store.kicked" :title="item.text" @click="input = item.text">{{item.label}}</button></div>
          </div>
        </div>
      </div>
    </template>
  </ViewerScreen>
</template>
