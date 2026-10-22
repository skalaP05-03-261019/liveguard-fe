<script setup lang="ts">
// 실제 API(liveId) 연결. 시청자는 ViewerScreen, 운영자는 목업과 같은 StudioScreen에 데이터를 넘긴다.
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import {api} from './api/client';
import {ApiError,type Category,type Live,type LiveCase,type LiveReview,type Message,type MessagePage,reasonLabels} from './contracts';
import {useLiveGuard} from './stores/liveGuard';
import {LogOut,ShieldCheck} from 'lucide-vue-next';
import ViewerScreen from './ViewerScreen.vue';
import StudioScreen,{type StudioLog} from './StudioScreen.vue';
const store=useLiveGuard();
const live=ref<Live|null>(null), messages=ref<Message[]>([]), reviews=ref<LiveReview[]>([]);
const caseHistory=ref<LiveCase[]>([]);
const error=ref(''),notice=ref(''),text=ref(''),busy=ref(false),online=ref(false),ended=ref(false),blocked=ref(false),loading=ref(true);
const logs=ref<StudioLog[]>([]);
// 강퇴 검토별 처리 상태: 결정 접수 → 적용 완료·실패·확인 중
const kickProgress=ref<Record<string,string>>({});
const operator=computed(()=>store.me?.role==='MODERATOR');
const admin=computed(()=>store.me?.role==='PLATFORM_ADMIN');
const accessReady=ref(false),clock=ref(Date.now()),timeoutUntil=ref<string|null>(null),timeoutUnknown=ref(false),restrictionReason=ref('');
const timedOut=computed(()=>!blocked.value&&!ended.value&&(timeoutUnknown.value||!!timeoutUntil.value&&new Date(timeoutUntil.value).getTime()>clock.value));
const chatDisabled=computed(()=>busy.value||!accessReady.value||ended.value||blocked.value||timedOut.value);
const visibleMessages=computed(()=>blocked.value?[]:messages.value.filter(m=>operator.value||m.visibility==='PUBLIC'||m.isMine));
const reasonOf=(m:Message)=>m.isMine?(m.moderationNotice??(m.moderationReasonCode?reasonLabels[m.moderationReasonCode]:null)??(m.visibility==='HELD'?'운영자 검토 중인 메시지입니다.':null)):null;
const timeoutReason=computed(()=>{
 const own=[...messages.value].reverse().find(m=>m.isMine&&m.timeoutUntil===timeoutUntil.value&&reasonOf(m));
 return own?reasonOf(own):restrictionReason.value;
});
function resetAccess(){accessReady.value=false;blocked.value=false;timeoutUntil.value=null;timeoutUnknown.value=false;restrictionReason.value='';}
function syncTimeout(page:MessagePage){
 // 목록 밖의 메시지로 생긴 제한도 서버가 현재 요청자 기준으로 반환한다.
 // 구버전 BE에서는 본인 메시지의 부가 정보로만 복원할 수 있다.
 const until=page.timeoutUntil!==undefined?page.timeoutUntil:page.items.filter(m=>m.isMine&&m.timeoutUntil).map(m=>m.timeoutUntil!).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1)??null;
 timeoutUntil.value=until;timeoutUnknown.value=false;restrictionReason.value='';clock.value=Date.now();
}
function blockAccess(){
 generation++;refreshSequence++;accessReady.value=false;blocked.value=true;timeoutUntil.value=null;timeoutUnknown.value=false;
 messages.value=[];text.value='';outgoing=null;notice.value='강퇴되어 이번 방송이 끝날 때까지 채팅과 시청이 제한됩니다.';disconnect();
}
function markEnded(){generation++;refreshSequence++;ended.value=true;accessReady.value=false;timeoutUntil.value=null;timeoutUnknown.value=false;notice.value='방송이 종료되었습니다.';disconnect();}
// 사건·검토 응답의 userAlias는 사건마다 'U1'로 가려져 시청자를 구분하지 못한다.
// 운영자 채팅 이력은 작성자 닉네임을 주므로, 사건의 대상 메시지 ID로 작성자를 찾는다(같은 liveId 범위).
const names=ref<Record<string,string>>({});
const nameOf=(id?:string)=>id?(names.value[id]??messages.value.find(m=>m.messageId===id)?.authorAlias):undefined;
// 최근 채팅에 없는 작성자는 이전 페이지(최대 5쪽)까지 찾는다. 한 번 찾지 못한 메시지는 다시 찾지 않는다.
const tried=new Set<string>();
async function resolveNames(){
 if(!live.value)return;const id=live.value.liveId;
 const missing=()=>caseHistory.value.map(c=>c.targetMessageIds[0]).filter(t=>t&&!nameOf(t)&&!tried.has(t));
 let cursor:string|undefined;
 for(let n=0;n<5&&missing().length;n++){
  const chunk=await api.liveMessagesPage(id,cursor);
  for(const m of chunk.items)names.value[m.messageId]=m.authorAlias;
  if(!chunk.nextCursor)break;cursor=chunk.nextCursor;
 }
 for(const t of missing())tried.add(t);
}
const caseNames=computed(()=>Object.fromEntries(caseHistory.value.flatMap(c=>{const n=nameOf(c.targetMessageIds[0]);return n?[[c.caseId,n]]:[];})));
let generation=0;let refreshSequence=0;
const seen=new Set<string>();let streams:EventSource[]=[];let timer:ReturnType<typeof setInterval>|undefined;let clockTimer:ReturnType<typeof setInterval>|undefined;let loadingLive=false;
function fail(e:unknown){
 if(e instanceof ApiError){
  if(e.code==='KICKED'){blockAccess();error.value='';return;}
  if(e.code==='TIMED_OUT'){timeoutUntil.value=e.until??null;timeoutUnknown.value=!e.until;restrictionReason.value=e.message;error.value='';return;}
  if(e.code==='LIVE_ENDED'){markEnded();error.value='';return;}
  if(e.code==='UNAUTHENTICATED'){generation++;disconnect();resetAccess();messages.value=[];reviews.value=[];caseHistory.value=[];store.clearIdentity();}
 }
 error.value=e instanceof ApiError?`${e.code}: ${e.message}`:'요청을 처리하지 못했습니다.';
}
async function sessionValid(){
 const previous=store.me?.userId;
 const current=await api.me();
 if(current.userId!==previous){
  generation++;disconnect();resetAccess();messages.value=[];reviews.value=[];caseHistory.value=[];logs.value=[];live.value=null;names.value={};kickProgress.value={};tried.clear();seen.clear();outgoing=null;text.value='';
  await store.syncIdentity(current);
  notice.value='다른 창에서 로그인 계정이 변경되어 화면을 갱신했습니다. 역할별 데모는 서로 다른 호스트나 브라우저 프로필을 사용하세요.';
  await load();return false;
 }
 return true;
}
async function refresh(){
 if(!live.value||ended.value)return false;
 const expected=generation;const sequence=++refreshSequence;const id=live.value.liveId;
 try{
  if(!await sessionValid())return false;
  const [page,cards,history]=await Promise.all([api.liveMessages(id),operator.value?api.liveReviews(id):Promise.resolve([]),operator.value?api.liveCases(id):Promise.resolve([])]);
  if(expected!==generation||sequence!==refreshSequence||live.value?.liveId!==id)return false;
  if(blocked.value)notice.value='';
  messages.value=[...page.items].reverse();reviews.value=cards;caseHistory.value=history;syncTimeout(page);blocked.value=false;accessReady.value=true;
  if(operator.value)resolveNames().catch(()=>{});
  return true;
 }catch(e){if(expected===generation&&sequence===refreshSequence)fail(e);return false;}
}
// 조치 결과에는 검토 ID가 없다. 조치 사건(caseId)의 강퇴 검토, 없으면 결과를 기다리는 강퇴 검토에 붙인다.
function setKick(payload:{caseId?:string},state:string){
 const waiting=Object.keys(kickProgress.value).filter(id=>kickProgress.value[id]==='결정 접수 · 실행 결과 대기');
 const id=reviews.value.find(r=>r.kind==='KICK'&&r.caseId===payload.caseId)?.reviewId??waiting.at(-1);
 if(id)kickProgress.value[id]=state;
}
function disconnect(){streams.forEach(s=>s.close());streams=[];online.value=false;}
function connect(){
 disconnect();if(!live.value||ended.value||blocked.value||!accessReady.value)return;
 const id=live.value.liveId,expected=generation;
 const current=()=>expected===generation&&live.value?.liveId===id;
 const source=api.liveEvents(id);streams.push(source);
 source.onopen=()=>{if(current()){online.value=true;refresh();}};source.onerror=()=>{if(current())online.value=false;};
 const handle=(e:Event)=>{
  if(!current())return;
  try{
   const v=JSON.parse((e as MessageEvent).data);
   if(!v.eventId||seen.has(v.eventId))return;seen.add(v.eventId);if(seen.size>1000)seen.delete(seen.values().next().value!);
   logs.value.unshift({id:v.eventId,time:v.occurredAt,event:e.type,detail:JSON.stringify(v.payload)});logs.value=logs.value.slice(0,60);
   if(e.type==='LIVE_ENDED'){markEnded();return;}
   if(e.type==='LIVE_ACCESS_BLOCKED'&&!operator.value){blockAccess();return;}
   if(e.type==='MESSAGE_VISIBILITY_CHANGED'&&v.payload.visibility!=='PUBLIC'&&!operator.value){
    // 재조회가 지연·실패해도 이미 공개되어 있던 타인 원문을 즉시 제거한다.
    refreshSequence++;messages.value=messages.value.filter(m=>m.messageId!==v.payload.messageId||m.isMine);
   }
   // 명세는 reviewKind, 현재 BE는 kind로 보낸다.
   // 명세는 reviewKind, 현재 BE는 kind로 보낸다.
   if(e.type==='REVIEW_DECIDED'&&(v.payload.reviewKind??v.payload.kind)==='KICK')kickProgress.value[v.payload.reviewId]=v.payload.value==='APPROVE'?'결정 접수 · 실행 결과 대기':'강퇴 기각 · 기존 제재 유지';
   const actionName=({KICK:'강퇴',HIDE:'메시지 숨김',TIMEOUT:'채팅 제한',RELEASE_HELD:'메시지 복원'} as Record<string,string>)[v.payload.type]??'조치';
   if(e.type==='ACTION_APPLIED'){
    notice.value=`${actionName} 적용이 확인되었습니다.`;
    if(v.payload.type==='KICK')setKick(v.payload,'강퇴 적용 완료');
   }
   if(e.type==='ACTION_FAILED'){
    if(v.payload.observation==='UNKNOWN'||v.payload.status==='PENDING'||v.payload.status==='RUNNING'){
     notice.value=`${actionName} 실행 결과를 확인하고 있습니다. 아직 실패로 확정되지 않았습니다.`;
     if(v.payload.type==='KICK')setKick(v.payload,'실행 결과 확인 중 · 실패로 단정하지 않음');
    }else if(v.payload.observation==='CONFIRMED'&&v.payload.status==='FAILED'){
     notice.value=`${actionName} 실행 실패가 확인되었습니다. 기존 제재 상태는 유지됩니다.`;
     if(v.payload.type==='KICK')setKick(v.payload,'강퇴 실행 실패 · 기존 제재 유지');
    }else notice.value=`${actionName} 결과를 확인할 수 없습니다. 서버 상태를 다시 확인해 주세요.`;
   }
   refresh();
  }catch{error.value='실시간 이벤트를 확인하지 못했습니다. 새로고침해 주세요.';}
 };
 for(const name of ['CHAT','MESSAGE_VISIBILITY_CHANGED','MESSAGE_RESTORED','LIVE_ACCESS_BLOCKED','LIVE_ENDED'])source.addEventListener(name,handle);
 if(!operator.value)for(const name of ['ACTION_APPLIED','ACTION_FAILED'])source.addEventListener(name,handle);
 if(operator.value){
  const guard=api.liveEvents(live.value.liveId,true);streams.push(guard);
  for(const name of ['CASE_CREATED','CASE_UPDATED','CONTEXT_REVIEW_REQUIRED','KICK_REVIEW_REQUIRED','REVIEW_DECIDED','ACTION_APPLIED','ACTION_FAILED','TOOL_START','TOOL_END','TASK_FAILED'])guard.addEventListener(name,handle);
 }
}
async function load(){
 if(!store.channelId||loadingLive)return;
 loadingLive=true;const expected=generation;const channel=store.channelId;
 try{
  const current=await api.currentLive(channel);if(expected!==generation||store.channelId!==channel)return;
  if(current.liveId!==live.value?.liveId){generation++;disconnect();resetAccess();messages.value=[];reviews.value=[];caseHistory.value=[];logs.value=[];names.value={};kickProgress.value={};tried.clear();seen.clear();text.value='';outgoing=null;notice.value='';}
  live.value=current;ended.value=!!current.endedAt;
  if(ended.value){markEnded();return;}
  if(await refresh()){error.value='';if(!streams.length)connect();}
 }catch(e){if(expected===generation){if(e instanceof ApiError&&e.code==='NOT_FOUND'){generation++;live.value=null;messages.value=[];resetAccess();disconnect();}else fail(e);}}
 finally{loadingLive=false;loading.value=false;}
}
async function start(){busy.value=true;try{await api.startLive(store.channelId);await load();}catch(e){fail(e);}finally{busy.value=false;}}
async function end(){if(!live.value)return;busy.value=true;try{await api.endLive(live.value.liveId);markEnded();}catch(e){fail(e);}finally{busy.value=false;}}
let outgoing:{text:string;id:string}|null=null;
async function send(){
 if(chatDisabled.value)return;
 if(!await sessionValid())return;
 if(!live.value||!text.value.trim()||chatDisabled.value)return;busy.value=true;error.value='';
 const value=text.value.trim();if(!outgoing||outgoing.text!==value)outgoing={text:value,id:crypto.randomUUID()};
 try{await api.sendLive(live.value.liveId,value,outgoing.id);text.value='';outgoing=null;await refresh();}
 catch(e){fail(e);}finally{busy.value=false;}
}
const requests=new Map<string,{serialized:string;id:string}>();
async function decide(r:LiveReview,value:string,reason:string,categories:Category[]){
 if(!await sessionValid())return;
 if(!reason.trim()){error.value='결정 이유를 입력해 주세요.';return;}
 const body:Record<string,unknown>={expectedReviewVersion:r.version,decision:value,reason:reason.trim()};
 if(value==='CONFIRM_VIOLATION'){
  body.categories=categories;
  if(!categories.length){error.value='위반 유형을 하나 이상 선택해 주세요.';return;}
  body.evidenceMessageIds=r.targetMessageIds;
 }
 const serialized=JSON.stringify(body);let req=requests.get(r.reviewId);
 if(!req||req.serialized!==serialized){req={serialized,id:crypto.randomUUID()};requests.set(r.reviewId,req);}
 body.clientRequestId=req.id;busy.value=true;error.value='';
 try{const d=await api.decideLive(r,body);notice.value=`결정 접수: ${d.value}. 실제 조치 결과를 기다립니다.`;if(r.kind==='KICK')kickProgress.value[r.reviewId]=value==='APPROVE'?'결정 접수 · 실행 결과 대기':'강퇴 기각 · 기존 제재 유지';await refresh();}
 catch(e){if(e instanceof ApiError&&e.code==='STALE_VERSION'){error.value='다른 운영자가 먼저 검토를 변경했습니다. 최신 상태를 불러왔습니다.';await refresh();}else fail(e);}
 finally{busy.value=false;}
}
async function revoke(caseId:string,findingId:string,reason:string){
 if(!await sessionValid())return;
 const c=caseHistory.value.find(x=>x.caseId===caseId);if(!c)return;
 if(!reason.trim()){error.value='오판 취소 사유를 입력해 주세요.';return;}
 busy.value=true;
 const body={expectedCaseVersion:c.version,reason:reason.trim()};const serialized=JSON.stringify(body);const key='revoke:'+findingId;let req=requests.get(key);
 if(!req||req.serialized!==serialized){req={serialized,id:crypto.randomUUID()};requests.set(key,req);}
 try{await api.revokeFinding(findingId,{...body,clientRequestId:req.id});notice.value='확정 근거를 취소하고 남은 가림 원인·제한을 재계산했습니다.';await refresh();}
 catch(e){fail(e);}finally{busy.value=false;}
}
const authChannel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('liveguard-auth');
const checkSession=async()=>{try{if(await sessionValid())await load();}catch(e){fail(e);}};
onMounted(()=>{load();window.addEventListener('focus',checkSession);if(authChannel)authChannel.onmessage=checkSession;timer=setInterval(checkSession,5000);clockTimer=setInterval(()=>clock.value=Date.now(),1000);});
onBeforeUnmount(()=>{generation++;disconnect();window.removeEventListener('focus',checkSession);authChannel?.close();if(timer)clearInterval(timer);if(clockTimer)clearInterval(clockTimer);});
</script>
<template>
 <ViewerScreen v-if="!operator&&!admin" v-model:draft="text" :messages="visibleMessages" :nickname="store.me?.nickname??'시청자'" :scope-key="`${store.me?.userId}:${live?.liveId??''}`" :clock="clock" :ready="accessReady" :loading="loading" :has-live="!!live" :blocked="blocked" :ended="ended" :busy="busy" :timed-out="timedOut" :timeout-until="timeoutUntil" :timeout-reason="timeoutReason" :started-at="live?.startedAt" :online="online" :error="error" :notice="notice" @send="send" @logout="store.logout()" @refresh="load"/>
 <StudioScreen v-else-if="operator" :nickname="store.me?.nickname??'운영자'" :live="live" :ended="ended" :loading="loading" :online="online" :messages="visibleMessages" :reviews="reviews" :cases="caseHistory" :case-names="caseNames" :logs="logs" :kick-progress="kickProgress" :busy="busy" :error="error" :notice="notice"
  @decide="decide" @revoke="revoke" @refresh="load" @start="start" @end="end" @logout="store.logout()" @page="p=>{if(p==='viewers')resolveNames().catch(fail);}"/>
 <div v-else class="v1-shell">
  <header class="v1-top"><span class="yt-logo"><span class="yt-logo-mark"><ShieldCheck :size="16"/></span><b>LIVE:GUARD</b></span><b>시스템 운영자</b><span class="v1-me">{{store.me?.nickname}}</span><button @click="store.logout()"><LogOut :size="15"/> 로그아웃</button></header>
  <main class="v1-main"><section class="v1-card"><h2>등록된 역할로 접근했습니다</h2><p>이 계정에는 담당 방송이 없습니다. 방송 검토는 담당 운영자 계정으로 확인하세요.</p><p>여러 방송의 통합 지표 API가 없어 이 화면에는 Mock 집계를 표시하지 않습니다.</p></section></main>
 </div>
</template>
<style scoped>
.v1-shell{min-height:100vh;background:#f8f8f8;color:#111}.v1-top{height:64px;background:#fff;border-bottom:1px solid #e5e5e5;display:flex;align-items:center;gap:18px;padding:0 28px}.v1-me{margin-left:auto}.v1-top button{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #ddd;border-radius:6px;padding:9px 13px;font-weight:600}.v1-main{max-width:960px;margin:auto;padding:30px}.v1-card{background:#fff;border:1px solid #e4e4e4;border-radius:12px;padding:20px;display:grid;gap:10px}.v1-card h2{font-size:18px}.v1-card p{color:#555;line-height:1.6}
@media(max-width:600px){.v1-top{padding:0 14px;gap:10px;font-size:13px}.v1-main{padding:16px}}
</style>
