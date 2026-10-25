<script setup lang="ts">
import {nextTick,onBeforeUnmount,ref,watch} from 'vue';
import {X} from 'lucide-vue-next';
const props=defineProps<{scopeKey:string}>();
const open=ref(false),trigger=ref<HTMLButtonElement|null>(null),closeButton=ref<HTMLButtonElement|null>(null),list=ref<HTMLElement|null>(null);
const chats=ref<string[]>([]),running=ref(false);
let timer:ReturnType<typeof setInterval>|undefined;
const lines=['오늘 방송도 기대돼요!','다들 반가워요 👋','목소리 잘 들려요','화면도 선명하네요','오늘 주제 재밌겠어요','설명 감사합니다','다음 이야기도 궁금해요','같이 보니까 더 즐겁네요','응원하고 있어요!','좋은 방송 감사합니다'];
function stop(){if(timer)clearInterval(timer);timer=undefined;running.value=false;}
function start(){if(running.value)return;chats.value=[];running.value=true;timer=setInterval(async()=>{const n=chats.value.length;chats.value.push(`시연 시청자 ${n+1} · ${lines[n%lines.length]}`);if(chats.value.length===30)stop();await nextTick();list.value?.scrollTo({top:list.value.scrollHeight});},1000);}
async function show(){open.value=true;await nextTick();closeButton.value?.focus();}
function close(){open.value=false;stop();trigger.value?.focus();}
function key(e:KeyboardEvent){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}else if(e.key==='Tab'){const buttons=Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}
watch(()=>props.scopeKey,()=>{stop();chats.value=[];open.value=false;});
onBeforeUnmount(stop);
</script>
<template>
 <button ref="trigger" type="button" class="yt-icon-button viewer-assistant-trigger" aria-label="Gemini 시연 도우미 열기" aria-haspopup="dialog" :aria-expanded="open" @click="show"><svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><defs><linearGradient id="viewer-assistant-gradient" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#4285f4"/><stop offset=".45" stop-color="#9b72cb"/><stop offset=".72" stop-color="#d96570"/><stop offset="1" stop-color="#fbbc04"/></linearGradient></defs><path fill="url(#viewer-assistant-gradient)" d="M16 1C14 10 10 14 1 16c9 2 13 6 15 15 2-9 6-13 15-15C22 14 18 10 16 1Z"/></svg></button>
 <Teleport to="body"><template v-if="open">
 <div class="viewer-assistant-shade" @click="close"/>
 <section class="viewer-assistant" role="dialog" aria-modal="true" aria-labelledby="viewer-assistant-title" @keydown="key">
 <header><b>Gemini <small>시연 도우미</small></b><button ref="closeButton" type="button" class="yt-icon-button" aria-label="시연 도우미 닫기" @click="close"><X :size="22"/></button></header>
 <div class="viewer-assistant-content"><h2 id="viewer-assistant-title">어떤 것을 도와드릴까요?</h2><p>Gemini API가 연결되지 않은 목업 미리보기입니다. 채팅은 이 패널에만 표시되며 실제 방송에 전송되지 않습니다.</p>
 <button type="button" class="viewer-assistant-prompt" :disabled="running" @click="start">시연을 위해 목업 채팅을 만들어줘. 1초에 1개씩 30개만</button>
 <div class="viewer-assistant-progress" role="status">{{running?'목업 채팅 생성 중':chats.length===30?'생성 완료':'목업 채팅 미리보기'}} · {{chats.length}} / 30</div>
 <button v-if="running" type="button" class="viewer-assistant-stop" @click="stop">생성 중지</button>
 <p v-if="!chats.length" class="viewer-assistant-empty">버튼을 누르면 1초 뒤 첫 채팅이 표시됩니다.</p>
 <ol ref="list" class="viewer-assistant-chats" aria-label="목업 채팅 미리보기"><li v-for="(chat,i) in chats" :key="i"><span>{{chat}}</span><small>목업</small></li></ol>
 </div></section>
 </template></Teleport>
</template>
