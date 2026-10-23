<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Bell, CheckCircle2, ChevronDown, Ellipsis, Forward, LogOut, Menu, Mic, RefreshCcw, Search, SendHorizontal, ShieldCheck, Smile, ThumbsDown, ThumbsUp, Video } from 'lucide-vue-next';
import YtPlayer from './YtPlayer.vue';
import ModeBadge from './ModeBadge.vue';
import ChatTimeoutNotice from './ChatTimeoutNotice.vue';
import { timeoutEndText } from './chatTime';
import { authorNotice, visibilityLabels, type Message } from './contracts';
import { avatarColor } from './avatar';

// 화면은 데이터와 사용자 동작만 받는다. API/SSE와 목업 정책 판정은 각 호출자가 담당한다.
// 목업과 실제 API는 같은 장식(유튜브식 상단·채널·버튼)을 쓰고, 값만 다르다. 실제 API에 없는 값(시청자·구독자 수)은 목업에서만 보인다.
const props = withDefaults(defineProps<{
  messages: Message[];
  nickname: string;
  scopeKey: string;
  clock: number;
  mock?: boolean;
  ready?: boolean;
  loading?: boolean;
  hasLive?: boolean;
  blocked?: boolean;
  ended?: boolean;
  busy?: boolean;
  timedOut?: boolean;
  timeoutUntil?: string | null;
  timeoutReason?: string | null;
  startedAt?: string | null;
  online?: boolean;
  error?: string;
  notice?: string;
}>(), { mock: false, ready: true, loading: false, hasLive: true, blocked: false, ended: false, busy: false, timedOut: false, online: false });
const draft = defineModel<string>('draft', { required: true });
const emit = defineEmits<{ send: []; logout: []; refresh: [] }>();
const following = ref(false), liked = ref(false), disliked = ref(false);
const theater = ref(false), chatOpen = ref(true), query = ref('');
const searchRef = ref<HTMLInputElement | null>(null), chatRef = ref<HTMLElement | null>(null);
const restrictionRef = ref<HTMLElement | null>(null), composerRef = ref<HTMLInputElement | null>(null);
const follow = ref(true), unread = ref(0), released = ref(false);
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
const chatDisabled = computed(() => props.busy || !props.ready || !props.hasLive || props.blocked || props.ended || props.timedOut);
const showTimeout = computed(() => props.timedOut && props.hasLive && !props.blocked && !props.ended);
const visible = computed(() => props.blocked ? [] : props.messages.filter(m => !query.value || m.text.includes(query.value) || m.authorAlias.includes(query.value)).slice(-80));
const asTime = (value: string) => new Date(value).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit' });
const reasonOf = (m: Message) => authorNotice(m);
const reviewing = (m: Message) => m.reviewStatus === 'PENDING' || m.visibility === 'HELD';
const liveState = computed(() => props.ended ? '방송 종료' : props.hasLive ? 'LIVE' : '방송 대기');
function toBottom(smooth = true) {
  const el = chatRef.value; if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' }); follow.value = true; unread.value = 0;
}
function onScroll() {
  const el = chatRef.value; if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  follow.value = atBottom; if (atBottom) unread.value = 0;
}
watch(chatRef, el => { if (el) nextTick(() => toBottom(false)); });
watch([showTimeout, released], async () => {
  const wasFollowing = follow.value;
  await nextTick();
  if (wasFollowing) toBottom(false);
});
watch(() => visible.value.map(m => m.messageId), async (ids, previous) => {
  await nextTick();
  // 자동 이동은 즉시 끝내야 중간 스크롤 이벤트를 사용자의 위쪽 탐색으로 오인하지 않는다.
  if (follow.value) toBottom(false);
  else { const known = new Set(previous); unread.value += ids.filter(id => !known.has(id)).length; }
});
function clearFeedback() {
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = undefined; released.value = false;
}
watch(() => [props.scopeKey, props.timedOut, props.blocked, props.ended, props.ready, props.hasLive] as const,
  async ([scope, limited, blocked, ended, ready, hasLive], [previousScope, wasLimited]) => {
    const focusedRestriction = !!restrictionRef.value?.contains(document.activeElement);
    clearFeedback();
    if (scope !== previousScope || blocked || ended) {
      draft.value = ''; query.value = ''; unread.value = 0; follow.value = true;
    }
    if (limited && !blocked && !ended && hasLive) {
      if (!wasLimited || scope !== previousScope) {
        chatOpen.value = true;
        await nextTick();
        if (props.scopeKey === scope && showTimeout.value) restrictionRef.value?.focus({preventScroll: true});
      }
      return;
    }
    if (scope !== previousScope || blocked || ended || !ready || !hasLive || limited || !wasLimited) return;
    released.value = true;
    feedbackTimer = setTimeout(() => { released.value = false; feedbackTimer = undefined; }, 5000);
    if (focusedRestriction) {
      await nextTick();
      if (props.scopeKey === scope && !chatDisabled.value) composerRef.value?.focus({preventScroll: true});
    }
  });
onBeforeUnmount(clearFeedback);
function send() { if (!chatDisabled.value && draft.value.trim()) emit('send'); }
function like() { liked.value = !liked.value; if (liked.value) disliked.value = false; }
function dislike() { disliked.value = !disliked.value; if (disliked.value) liked.value = false; }
</script>

<template>
  <div class="viewer-shell" :class="{'api-viewer': !mock}">
    <header class="yt-masthead">
      <div class="yt-masthead-start"><span class="yt-icon-button" aria-hidden="true"><Menu :size="22"/></span><a class="yt-logo" href="#"><span class="yt-logo-mark"><ShieldCheck :size="15"/></span><b>LIVE<span>:</span>GUARD</b><sup>KR</sup></a></div>
      <div class="yt-search"><div class="yt-search-box"><input ref="searchRef" v-model="query" placeholder="채팅 검색" aria-label="채팅 검색"/><button title="채팅 검색" @click="searchRef?.focus()"><Search :size="20"/></button></div><button class="yt-icon-button filled yt-deco" title="음성으로 검색"><Mic :size="20"/></button></div>
      <div class="yt-masthead-end">
        <ModeBadge :mock="mock" :online="online"/>
        <button v-if="!mock" class="yt-icon-button" title="새로고침" aria-label="새로고침" @click="emit('refresh')"><RefreshCcw :size="20"/></button>
        <button class="yt-icon-button yt-deco" title="만들기"><Video :size="22"/></button><button class="yt-icon-button yt-deco" title="알림"><Bell :size="22"/><i v-if="mock" class="yt-badge">9+</i></button>
        <span class="yt-me" :style="{background: avatarColor(nickname)}" :title="nickname">{{nickname.slice(0,1)}}</span><button class="yt-icon-button" title="로그아웃" @click="emit('logout')"><LogOut :size="20"/></button>
      </div>
    </header>

    <div class="yt-watch" :class="{theater, 'chat-closed': !chatOpen}">
      <div class="yt-player-area">
        <div v-if="blocked" class="viewer-kicked" role="status"><ShieldCheck :size="48"/><h2>이 방송의 이용이 제한되었습니다</h2><p>운영자 승인으로 강퇴되어 이번 방송이 끝날 때까지 채팅과 시청이 제한됩니다.</p></div>
        <div v-else-if="ended" class="viewer-kicked" role="status"><ShieldCheck :size="48"/><h2>방송이 종료되었습니다</h2></div>
        <div v-else-if="!loading && !hasLive" class="viewer-kicked" role="status"><ShieldCheck :size="48"/><h2>진행 중인 방송이 없습니다</h2><p>운영자가 방송을 시작하면 자동으로 연결됩니다.</p></div>
        <YtPlayer v-else-if="ready" :started-at="startedAt" :viewers="mock ? '2,341' : null" theater-button @theater="theater = !theater"/>
        <div v-else class="viewer-kicked" role="status">방송 이용 상태를 확인하고 있습니다.</div>
      </div>

      <main class="yt-primary">
        <h1 class="yt-title">{{mock ? '오늘도 게임하는 날! 같이 놀아요 💜 | 24시간 소통 라이브' : '오늘의 라이브'}}</h1>
        <div class="yt-owner-row">
          <div class="yt-owner"><span class="yt-channel-avatar"><template v-if="mock">🎮</template><ShieldCheck v-else :size="22"/></span><div><b>{{mock ? '행복한게임방' : '라이브 방송'}}<ShieldCheck :size="13" class="yt-verified"/></b><small>{{liveState}}<template v-if="mock"> · 구독자 12.4만명</template></small></div><button class="yt-subscribe" :class="{active: following}" @click="following = !following"><Bell v-if="following" :size="17"/>{{following ? '구독중' : '구독'}}<ChevronDown v-if="following" :size="17"/></button></div>
          <div class="yt-actions">
            <div class="yt-segment"><button :class="{active: liked}" @click="like" title="이 동영상이 마음에 듭니다."><ThumbsUp :size="19" :fill="liked ? 'currentColor' : 'none'"/><template v-if="mock"> {{liked ? '3.5천' : '3.4천'}}</template></button><button :class="{active: disliked}" @click="dislike" title="이 동영상이 마음에 들지 않습니다."><ThumbsDown :size="19" :fill="disliked ? 'currentColor' : 'none'"/></button></div>
            <button class="yt-pill"><Forward :size="19"/> 공유</button><button class="yt-pill round" title="추가 작업"><Ellipsis :size="19"/></button>
          </div>
        </div>
        <section class="yt-description">
          <b v-if="startedAt || mock"><template v-if="mock">2,341명 시청 중 · </template><template v-if="startedAt">방송 시작: {{timeoutEndText(startedAt)}} (한국 시간)</template><span v-if="mock"> #게임 #소통 #일상</span></b>
          <p>오늘도 편하게 이야기 나누는 공간이에요. 서로 존중하며 채팅에 참여해 주세요! ✨</p><small><ShieldCheck :size="13"/> LIVE:GUARD AI Agent가 채팅을 모니터링합니다.</small>
        </section>
        <p v-if="error" class="viewer-error" role="alert">{{error}}</p><p v-if="notice" class="viewer-notice" role="status">{{notice}}</p>
        <slot name="demo"/>
      </main>

      <aside class="yt-secondary">
        <div v-if="chatOpen" class="yt-chat" :class="{'is-timeout': showTimeout}">
          <div class="yt-chat-header"><span class="yt-chat-mode">실시간 채팅 <ChevronDown :size="18"/></span><span class="viewer-message-count">{{visible.length}}건</span></div>
          <div class="yt-chat-banner"><ShieldCheck :size="16"/> 매너있는 채팅 부탁드려요! LIVE:GUARD Agent가 채팅방을 관리 중입니다.</div>
          <div class="scan-wrap"><span class="ai-scan soft" aria-hidden="true"/>
            <div ref="chatRef" class="yt-chat-items" @scroll.passive="onScroll">
              <div v-for="message in visible" :key="message.messageId" :data-message-id="message.messageId" class="yt-chat-row" :class="{myHidden: message.visibility!=='PUBLIC'}">
                <span class="yt-chat-avatar" :style="{background: avatarColor(message.authorAlias)}">{{message.authorAlias.slice(0,1)}}</span>
                <div class="yt-chat-body"><time>{{asTime(message.sentAt)}}</time><span class="yt-chat-author">{{message.authorAlias}}</span><span v-if="message.visibility==='PUBLIC'" class="yt-chat-text">{{message.text}}</span><span v-else class="yt-chat-text"><em>{{visibilityLabels[message.visibility]}}</em> {{message.text}}</span><small v-if="message.visibility!=='PUBLIC'">나와 운영자에게만 표시<b v-if="reviewing(message)" class="yt-review-badge">검토 중</b></small><span v-if="message.visibility!=='PUBLIC' && reasonOf(message)" class="yt-chat-reason">{{reasonOf(message)}}</span></div>
              </div>
              <p v-if="!visible.length" class="viewer-empty-chat">{{blocked ? '이용 제한으로 채팅을 표시하지 않습니다.' : query ? '검색 결과가 없습니다.' : '아직 채팅이 없습니다.'}}</p>
            </div>
            <button v-if="unread" class="new-msg-pill" @click="toBottom()">새 메시지 {{unread}}개 <ChevronDown :size="15"/></button>
          </div>
          <div v-if="blocked" class="viewer-chat-restriction" role="status">강퇴되어 이번 방송이 끝날 때까지 채팅을 보낼 수 없습니다.</div>
          <div v-else-if="ended" class="viewer-chat-restriction" role="status">방송이 종료되어 채팅을 보낼 수 없습니다.</div>
          <div v-if="released" class="yt-timeout-released" role="status"><CheckCircle2 :size="20" aria-hidden="true"/><div><b>채팅 제한이 해제되었습니다</b><span>이제 다시 채팅에 참여할 수 있습니다.</span></div></div>
          <section v-if="showTimeout" ref="restrictionRef" class="yt-compose-restriction" role="dialog" aria-modal="false" aria-label="채팅 제한 안내" tabindex="-1">
            <ChatTimeoutNotice :key="timeoutUntil ?? undefined" :until="timeoutUntil" :now="clock" :reason="timeoutReason" variant="composer" effects/>
          </section>
          <form v-else class="yt-compose" :class="{'yt-compose-released': released}" @submit.prevent="send">
            <div class="yt-compose-who"><span class="yt-chat-avatar" :style="{background: avatarColor(nickname)}">{{nickname.slice(0,1)}}</span><b>{{nickname}}</b></div>
            <div class="yt-compose-input"><input ref="composerRef" v-model="draft" maxlength="500" placeholder="채팅..." aria-label="채팅 메시지" :disabled="chatDisabled"/></div>
            <div class="yt-compose-bottom"><Smile :size="22"/><span class="yt-compose-count">{{draft.length}}/500</span><button :disabled="chatDisabled || !draft.trim()" title="보내기" aria-label="채팅 전송"><SendHorizontal :size="22"/></button></div>
          </form>
          <button class="yt-chat-toggle" type="button" @click="chatOpen = false">채팅 숨기기</button>
        </div>
        <button v-else class="yt-chat-toggle standalone" @click="chatOpen = true">채팅 표시</button>
      </aside>
    </div>
  </div>
</template>
