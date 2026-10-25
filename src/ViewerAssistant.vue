<script setup lang="ts">
import {nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {X} from 'lucide-vue-next';
const props=defineProps<{scopeKey:string;disabled:boolean;sendChat?:(text:string)=>Promise<boolean>}>();
const open=ref(false),trigger=ref<HTMLButtonElement|null>(null),closeButton=ref<HTMLButtonElement|null>(null),list=ref<HTMLElement|null>(null),panel=ref<HTMLElement|null>(null);
const chats=ref<string[]>([]),running=ref(false),failure=ref(''),pending=ref(false);
let generation=0;
let timer:ReturnType<typeof setInterval>|undefined;
const lines=['오늘 방송도 기대돼요!','다들 반가워요 👋','목소리 잘 들려요','화면도 선명하네요','오늘 주제 재밌겠어요','설명 감사합니다','다음 이야기도 궁금해요','같이 보니까 더 즐겁네요','응원하고 있어요!','좋은 방송 감사합니다'];
function stop(){generation++;if(timer)clearInterval(timer);timer=undefined;running.value=false;}
function start(){if(running.value||pending.value||props.disabled||!props.sendChat)return;chats.value=[];failure.value='';running.value=true;const run=++generation;timer=setInterval(async()=>{if(pending.value||run!==generation)return;if(props.disabled){stop();return;}pending.value=true;const n=chats.value.length;const text=`[시연 ${n+1}/30] ${lines[n%lines.length]}`;try{const ok=await props.sendChat!(text);if(run!==generation)return;if(!ok){failure.value='전송이 중단되었습니다. 방송 상태와 채팅 제한을 확인해 주세요.';stop();return;}chats.value.push(text);if(chats.value.length===30)stop();await nextTick();list.value?.scrollTo({top:list.value.scrollHeight});}catch{if(run===generation){failure.value='채팅 전송에 실패하여 중단했습니다.';stop();}}finally{pending.value=false;}},1000);}
async function show(){open.value=true;await nextTick();closeButton.value?.focus();}
async function close(){open.value=false;stop();await nextTick();trigger.value?.focus();}
function key(e:KeyboardEvent){if(!open.value)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}else if(e.key==='Tab'){const buttons=Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}
watch(()=>props.scopeKey,()=>{stop();chats.value=[];open.value=false;});
watch(()=>props.disabled,value=>{if(value&&running.value){failure.value='방송 상태 또는 채팅 제한으로 중단되었습니다.';stop();}});
onMounted(()=>document.addEventListener('keydown',key));
onBeforeUnmount(()=>{stop();document.removeEventListener('keydown',key);});
</script>
<template>
 <button ref="trigger" type="button" class="yt-icon-button viewer-assistant-trigger" aria-label="Gemini 시연 도우미 열기" aria-haspopup="dialog" :aria-expanded="open" @click="show"><svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><defs><linearGradient id="viewer-assistant-gradient" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#4285f4"/><stop offset=".45" stop-color="#9b72cb"/><stop offset=".72" stop-color="#d96570"/><stop offset="1" stop-color="#fbbc04"/></linearGradient></defs><path fill="url(#viewer-assistant-gradient)" d="M16 1C14 10 10 14 1 16c9 2 13 6 15 15 2-9 6-13 15-15C22 14 18 10 16 1Z"/></svg></button>
 <Teleport to="body"><template v-if="open">
 <div class="viewer-assistant-shade" @click="close"/>
 <section ref="panel" class="viewer-assistant" role="dialog" aria-modal="true" aria-labelledby="viewer-assistant-title">
 <header><b>Gemini <small>시연 도우미</small></b><button ref="closeButton" type="button" class="yt-icon-button" aria-label="시연 도우미 닫기" @click="close"><X :size="22"/></button></header>
 <div class="viewer-assistant-content"><h2 id="viewer-assistant-title">어떤 것을 도와드릴까요?</h2><p>버튼을 누르면 현재 로그인한 계정으로 시연 문장 30개를 실제 채팅창에 전송합니다. Gemini API 연결 전에는 준비된 예시 문장을 사용합니다.</p>
 <button type="button" class="viewer-assistant-prompt" :disabled="running||pending||disabled||!sendChat" @click="start">시연을 위해 목업 채팅을 만들어줘. 1초에 1개씩 30개만</button>
 <div class="viewer-assistant-progress" role="status">{{running?'채팅창에 전송 중':chats.length===30?'전송 완료':'전송한 시연 채팅'}} · {{chats.length}} / 30</div>
 <p v-if="disabled">방송 중이며 채팅할 수 있는 상태에서 실행할 수 있습니다.</p><p v-if="failure" role="alert">{{failure}}</p>
 <button v-if="running" type="button" class="viewer-assistant-stop" @click="stop">생성 중지</button>
 <p v-if="!chats.length" class="viewer-assistant-empty">버튼을 누르면 1초 뒤 첫 채팅을 전송합니다.</p>
 <ol ref="list" class="viewer-assistant-chats" aria-label="전송한 시연 채팅"><li v-for="(chat,i) in chats" :key="i"><span>{{chat}}</span><small>전송됨</small></li></ol>
 </div></section>
 </template></Teleport>
</template>
