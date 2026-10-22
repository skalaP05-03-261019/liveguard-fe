<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Bell, ChevronDown, Clock, Ellipsis, EllipsisVertical, Forward, LogOut, Menu, Mic, Search, SendHorizontal, ShieldCheck, Smile, ThumbsDown, ThumbsUp, Video } from 'lucide-vue-next';
import YtPlayer from './YtPlayer.vue';
import { MAX_CHAT_LENGTH, useLiveGuard } from './stores/liveGuard';
import { reasonLabels, visibilityLabels, type Message } from './contracts';
import { avatarColor } from './avatar';
const store = useLiveGuard();
const input = ref('');
const following = ref(false);
const liked = ref(false);
const disliked = ref(false);
const theater = ref(false);
const chatOpen = ref(true);
const chatRef = ref<HTMLElement | null>(null);
const visible = computed(() => store.viewerMessages.slice(-80));
const asTime = (v: string) => new Date(v).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });
// 사용자가 직접 위로 스크롤했을 때만 따라 내려가기를 멈추고, 그동안 온 메시지 수를 버튼으로 알려준다.
const follow = ref(true);
const unread = ref(0);
function toBottom(smooth = true) { const el = chatRef.value; if (!el) return; el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); follow.value = true; unread.value = 0; }
function onScroll() { const el = chatRef.value; if (!el) return; const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40; follow.value = atBottom; if (atBottom) unread.value = 0; }
watch(chatRef, el => { if (el) nextTick(() => toBottom(false)); });
watch(() => store.viewerMessages.length, async (n, old) => {
  await nextTick();
  if (follow.value) toBottom(); else if (n > old) unread.value += n - old;
});
async function send() { if (await store.sendMessage(input.value)) input.value = ''; }
function chooseViewer(id: string) { if (store.mode !== 'mock') return; store.viewerId = id; }
const timeoutLeft = computed(() => {
  const ms = Math.max(0, new Date(store.viewerTimeoutUntil ?? 0).getTime() - store.clock);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
});
// 본인 가려진 메시지의 사유 안내. 서버 문구 → 사유 코드 라벨 → 검토 중 순으로 쓴다. 이의제기 입력은 명세에 없어 두지 않는다.
const reasonOf = (m: Message) => m.moderationNotice ?? (m.moderationReasonCode ? reasonLabels[m.moderationReasonCode] : m.visibility === 'HELD' ? '운영자 검토 중인 메시지입니다.' : null);
const reviewing = (m: Message) => m.reviewStatus === 'PENDING' || m.visibility === 'HELD';
// TIMEOUT이 실제로 적용된 메시지에만 제한 시각을 붙인다(TIMEOUT 없는 첫 욕설에는 표시하지 않음).
const timeoutNote = (m: Message) => m.timeoutUntil && new Date(m.timeoutUntil).getTime() > store.clock ? `채팅 제한 ${asTime(m.timeoutUntil)}까지` : null;
function like() { liked.value = !liked.value; if (liked.value) disliked.value = false; }
function dislike() { disliked.value = !disliked.value; if (disliked.value) liked.value = false; }
</script>
<template>
  <div class="viewer-shell">
    <header class="yt-masthead">
      <div class="yt-masthead-start"><button class="yt-icon-button" title="메뉴"><Menu :size="22"/></button><a class="yt-logo" href="#"><span class="yt-logo-mark"><ShieldCheck :size="15"/></span><b>LIVE<span>:</span>GUARD</b><sup>KR</sup></a></div>
      <div class="yt-search"><div class="yt-search-box"><input placeholder="검색" aria-label="검색"/><button title="검색"><Search :size="20"/></button></div><button class="yt-icon-button filled" title="음성으로 검색"><Mic :size="20"/></button></div>
      <div class="yt-masthead-end"><button class="yt-icon-button" title="만들기"><Video :size="22"/></button><button class="yt-icon-button" title="알림"><Bell :size="22"/><i class="yt-badge">9+</i></button><span class="yt-me" :style="{background: avatarColor(store.me?.nickname ?? '시청자')}" :title="store.me?.nickname">{{(store.me?.nickname ?? '시').slice(0,1)}}</span><button class="yt-icon-button" title="로그아웃" @click="store.logout()"><LogOut :size="20"/></button></div>
    </header>

    <div class="yt-watch" :class="{theater, 'chat-closed': !chatOpen}">
      <div class="yt-player-area">
        <YtPlayer v-if="!store.kicked" theater-button @theater="theater = !theater"/>
        <div class="viewer-kicked" v-else><ShieldCheck :size="48"/><h2>이 방송의 이용이 제한되었습니다</h2><p>운영자 승인으로 강퇴되어 이번 방송이 끝날 때까지 채팅과 시청이 제한됩니다.</p><p>운영자의 승인 없이 강퇴 조치는 적용되지 않습니다.</p></div>
      </div>

      <main class="yt-primary">
        <h1 class="yt-title">오늘도 게임하는 날! 같이 놀아요 💜 | 24시간 소통 라이브</h1>
        <div class="yt-owner-row">
          <div class="yt-owner"><span class="yt-channel-avatar">🎮</span><div><b>행복한게임방 <ShieldCheck :size="13" class="yt-verified"/></b><small>구독자 12.4만명</small></div><button class="yt-subscribe" :class="{active: following}" @click="following = !following"><Bell v-if="following" :size="17"/>{{following ? '구독중' : '구독'}}<ChevronDown v-if="following" :size="17"/></button></div>
          <div class="yt-actions">
            <div class="yt-segment"><button :class="{active: liked}" @click="like" title="이 동영상이 마음에 듭니다."><ThumbsUp :size="19" :fill="liked ? 'currentColor' : 'none'"/> {{liked ? '3.5천' : '3.4천'}}</button><button :class="{active: disliked}" @click="dislike" title="이 동영상이 마음에 들지 않습니다."><ThumbsDown :size="19" :fill="disliked ? 'currentColor' : 'none'"/></button></div>
            <button class="yt-pill"><Forward :size="19"/> 공유</button>
            <button class="yt-pill round" title="추가 작업"><Ellipsis :size="19"/></button>
          </div>
        </div>
        <section class="yt-description"><b>2,341명 시청 중 · 1시간 전 스트리밍 시작 <span>#게임 #소통 #일상</span></b><p>오늘도 편하게 이야기 나누는 공간이에요. 서로 존중하며 채팅에 참여해 주세요! ✨</p><small><ShieldCheck :size="13"/> LIVE:GUARD AI Agent가 채팅을 모니터링합니다.</small></section>
        <div class="viewer-demo" v-if="store.mode==='mock'"><b>목업 시연</b><span>시청자 계정을 변경하면 본인의 비공개 메시지 가시성을 확인할 수 있습니다.</span><select :value="store.viewerId" @change="chooseViewer(($event.target as HTMLSelectElement).value)"><option value="22222222-2222-4222-8222-222222222221">별빛시청자 (정상)</option><option value="22222222-2222-4222-8222-222222222222">어둠의유저 (10분 채팅 제한)</option><option value="22222222-2222-4222-8222-222222222223">정보왕</option></select></div>
      </main>

      <aside class="yt-secondary">
        <div v-if="chatOpen" class="yt-chat">
          <div class="yt-chat-header"><button class="yt-chat-mode">인기 채팅 <ChevronDown :size="18"/></button><button class="yt-icon-button small" title="더보기"><EllipsisVertical :size="20"/></button></div>
          <div class="yt-chat-banner"><ShieldCheck :size="16"/> 매너있는 채팅 부탁드려요! LIVE:GUARD Agent가 채팅방을 관리 중입니다.</div>
          <div class="scan-wrap"><span class="ai-scan soft" aria-hidden="true"/>
          <div ref="chatRef" class="yt-chat-items" @scroll.passive="onScroll">
            <div v-for="message in visible" :key="message.messageId" class="yt-chat-row" :class="{myHidden: message.visibility!=='PUBLIC'}">
              <span class="yt-chat-avatar" :style="{background: avatarColor(message.authorAlias)}">{{message.authorAlias.slice(0,1)}}</span>
              <div class="yt-chat-body"><time>{{asTime(message.sentAt)}}</time><span class="yt-chat-author">{{message.authorAlias}}</span><span v-if="message.visibility==='PUBLIC'" class="yt-chat-text">{{message.text}}</span><span v-else class="yt-chat-text"><em>{{visibilityLabels[message.visibility]}}</em> {{message.text}}</span><small v-if="message.visibility!=='PUBLIC'">나와 운영자에게만 표시<b v-if="reviewing(message)" class="yt-review-badge">검토 중</b></small><span v-if="message.visibility!=='PUBLIC' && reasonOf(message)" class="yt-chat-reason">{{reasonOf(message)}}<template v-if="timeoutNote(message)"> · {{timeoutNote(message)}}</template></span></div>
            </div>
          </div><button v-if="unread" class="new-msg-pill" @click="toBottom()">새 메시지 {{unread}}개 <ChevronDown :size="15"/></button></div>
          <div v-if="store.kicked" class="viewer-chat-restriction" role="status">강퇴되어 이번 방송이 끝날 때까지 채팅을 보낼 수 없습니다.</div>
          <div v-else-if="store.timedOut" class="yt-timeout" role="status"><Clock :size="20"/><div><b>채팅이 일시 제한되었습니다</b><span v-if="store.viewerLastReason">사유: {{store.viewerLastReason}}</span><span>제한 시간 동안 메시지를 보낼 수 없어요. 방송 시청은 계속할 수 있습니다.</span></div><time>{{timeoutLeft}}</time></div>
          <form v-else class="yt-compose" @submit.prevent="send">
            <div class="yt-compose-who"><span class="yt-chat-avatar" :style="{background: avatarColor(store.viewerAlias)}">{{store.viewerAlias.slice(0,1)}}</span><b>{{store.viewerAlias}}</b></div>
            <div class="yt-compose-input"><input v-model="input" :maxlength="MAX_CHAT_LENGTH" placeholder="채팅..." aria-label="채팅 메시지"/></div>
            <div class="yt-compose-bottom"><Smile :size="22"/><span class="yt-compose-count">{{input.length}}/{{MAX_CHAT_LENGTH}}</span><button :disabled="!input.trim() || store.busy" title="보내기"><SendHorizontal :size="22"/></button></div>
          </form>
          <button class="yt-chat-toggle" type="button" @click="chatOpen = false">채팅 숨기기</button>
        </div>
        <button v-else class="yt-chat-toggle standalone" @click="chatOpen = true">채팅 표시</button>
      </aside>
    </div>
  </div>
</template>
