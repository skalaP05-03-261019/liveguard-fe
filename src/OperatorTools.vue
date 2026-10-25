<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {useLiveGuard} from './stores/liveGuard';
import {AlertTracker,defaultSettings,readSettings,settingsError,shortcutAction,shortcutLabels,type ToolSettings,type ShortcutAction,type OperatorAlert} from './operatorTools';
import type {LiveReview} from './contracts';
const props=defineProps<{liveId:string;ended:boolean;reviews:LiveReview[];progress:Record<string,string>}>();
const emit=defineEmits<{navigate:[action:ShortcutAction];open:[reviewId:string,kind:OperatorAlert['kind']]}>();
const store=useLiveGuard(),settings=ref<ToolSettings>(defaultSettings()),draft=ref<ToolSettings>(defaultSettings());
const account=computed(()=>store.me?.userId??'');
const storageKey=computed(()=>`liveguard.operator-tools.v1.${encodeURIComponent(account.value)}`);
const scope=computed(()=>`${account.value}:${props.liveId}`);
const active=computed(()=>!!account.value&&!!props.liveId&&!props.ended&&store.me?.role==='MODERATOR');
const status=ref(''),settingsOpen=ref(false),alertsOpen=ref(false),alerts=ref<OperatorAlert[]>([]),announcement=ref(''),clock=ref(Date.now());
const tracker=new AlertTracker();const error=computed(()=>settingsError(draft.value));
const actions=Object.keys(shortcutLabels) as ShortcutAction[];
let timer:ReturnType<typeof setInterval>|undefined;
const copy=(s:ToolSettings)=>({...s,keys:{...s.keys}});
function load(){
 try{settings.value=readSettings(localStorage.getItem(storageKey.value));status.value='';}
 catch{settings.value=defaultSettings();status.value='저장소를 사용할 수 없어 이번 화면에서만 설정을 적용합니다.';}
 draft.value=copy(settings.value);tracker.clear();alerts.value=[];announcement.value='';settingsOpen.value=false;alertsOpen.value=false;
}
watch(account,load,{immediate:true});
watch(scope,()=>{tracker.clear();alerts.value=[];announcement.value='';alertsOpen.value=false;});
watch([active,()=>props.reviews,()=>props.progress,clock,settings],()=>{
 if(!active.value){tracker.clear();alerts.value=[];announcement.value='';return;}
 if(!settings.value.notifications)announcement.value='';
 const before=new Set(alerts.value.map(a=>a.key));
 alerts.value=tracker.update(scope.value,props.liveId,settings.value.notifications,props.reviews,props.progress,clock.value,settings.value.waitMinutes);
 const added=alerts.value.filter(a=>!before.has(a.key));
 if(!alerts.value.length)announcement.value='';
 if(added.length)announcement.value=`새 관제 알림 ${added.length}건이 있습니다.`;
},{deep:true,immediate:true});
function save(){
 if(error.value)return;
 settings.value=copy(draft.value);
 try{localStorage.setItem(storageKey.value,JSON.stringify(settings.value));status.value='이 계정의 설정을 이 브라우저에 저장했습니다.';}
 catch{status.value='설정을 저장하지 못해 이번 화면에서만 적용합니다.';}
}
function defaults(){draft.value=defaultSettings();}
function dismiss(key:string){tracker.dismiss(key);alerts.value=alerts.value.filter(a=>a.key!==key);}
function openAlert(alert:OperatorAlert){
 const r=props.reviews.find(r=>r.reviewId===alert.reviewId&&r.liveId===props.liveId);
 if(!active.value||!r||r.status==='INVALIDATED'||(alert.kind!=='failure'&&r.status!=='PENDING')){dismiss(alert.key);status.value='요청 상태가 변경되었습니다. 최신 목록을 확인하세요.';return;}
 emit('open',alert.reviewId,alert.kind);alertsOpen.value=false;announcement.value='';
}
function onKey(e:KeyboardEvent){
 if(e.defaultPrevented||!active.value||settingsOpen.value)return;
 const target=e.target instanceof Element?e.target:null;
 if(target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"],.operator-tools'))return;
 const action=shortcutAction(e,settings.value);if(!action)return;
 e.preventDefault();emit('navigate',action);
}
async function toggleSettings(){settingsOpen.value=!settingsOpen.value;if(settingsOpen.value){draft.value=copy(settings.value);await nextTick();document.querySelector<HTMLElement>('.operator-settings input')?.focus();}}
onMounted(()=>{window.addEventListener('keydown',onKey);timer=setInterval(()=>clock.value=Date.now(),30000);});
onBeforeUnmount(()=>{window.removeEventListener('keydown',onKey);if(timer)clearInterval(timer);tracker.clear();});
</script>
<template>
 <section class="operator-tools" aria-label="관제 도구">
  <div class="operator-tools-bar">
   <button type="button" :aria-expanded="alertsOpen" aria-controls="operator-alerts" @click="alertsOpen=!alertsOpen">관제 알림 <b>{{alerts.length}}</b></button>
   <button type="button" :aria-expanded="settingsOpen" aria-controls="operator-settings" @click="toggleSettings">알림·단축키 설정</button>
   <small v-if="settings.shortcuts">{{settings.keys.next.toUpperCase()}} 다음 · {{settings.keys.previous.toUpperCase()}} 이전 · {{settings.keys.toggle.toUpperCase()}} 상세 · {{settings.keys.search}} 검색</small>
  </div>
  <p v-if="announcement" class="operator-announcement" role="status">{{announcement}} <button type="button" @click="alertsOpen=true;announcement=''">알림 보기</button><button type="button" aria-label="관제 알림 안내 닫기" @click="announcement=''">닫기</button></p>
  <div v-if="alertsOpen" id="operator-alerts" class="operator-alerts" role="region" aria-label="관제 알림 목록">
   <p v-if="!active">진행 중인 방송에서 관제 알림을 확인할 수 있습니다.</p>
   <p v-else-if="!settings.notifications">관제 알림이 꺼져 있습니다.</p>
   <p v-else-if="!alerts.length">새 관제 알림이 없습니다.</p>
   <ul v-else><li v-for="alert in alerts" :key="alert.key"><button type="button" @click="openAlert(alert)">{{alert.label}} →</button><button type="button" :aria-label="`${alert.label} 알림 지우기`" @click="dismiss(alert.key)">지우기</button></li></ul>
   <small>최근 20개 알림을 표시하며 채팅 원문은 담지 않습니다. 현재 상태를 확인한 뒤 결정하세요.</small>
  </div>
  <form v-if="settingsOpen" id="operator-settings" class="operator-settings" aria-label="알림·단축키 설정" @submit.prevent="save">
   <label><input v-model="draft.notifications" type="checkbox"/> 웹 안 관제 알림</label>
   <label>장기 대기 기준(분) <input v-model.number="draft.waitMinutes" type="number" min="1" max="60" required/></label>
   <label><input v-model="draft.shortcuts" type="checkbox"/> 탐색 단축키 사용</label>
   <div class="operator-key-grid"><label v-for="action in actions" :key="action">{{shortcutLabels[action]}} <input v-model="draft.keys[action]" maxlength="1" :aria-label="`${shortcutLabels[action]} 단축키`" autocomplete="off" spellcheck="false"/></label></div>
   <p>영문·숫자·/·[·] 한 글자를 사용하세요. 입력 중·한글 조합 중에는 동작하지 않습니다. 설정은 이 계정과 브라우저에만 저장됩니다.</p>
   <p v-if="error" role="alert" class="error-inline">{{error}}</p>
   <div><button type="submit" :disabled="!!error">설정 저장</button><button type="button" @click="defaults">기본값 복원</button><button type="button" @click="settingsOpen=false">설정 닫기</button></div>
  </form>
  <p v-if="status" role="status" class="operator-setting-status">{{status}}</p>
 </section>
</template>
