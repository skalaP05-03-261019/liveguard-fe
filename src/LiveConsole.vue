<script setup lang="ts">
// 실제 API(liveId) 연결. 시청자는 ViewerScreen, 운영자는 목업과 같은 StudioScreen에 데이터를 넘긴다.
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import {api} from './api/client';
import {EventVersions} from './eventVersions';
import {ApiError,authorNotice,type Category,type Live,type LiveCase,type LiveReview,type Message,type MessagePage} from './contracts';
import {useLiveGuard} from './stores/liveGuard';
import {uuid} from './uuid';
import ViewerScreen from './ViewerScreen.vue';
import SystemPage from './SystemPage.vue';
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
const reasonOf=(m:Message)=>m.isMine?authorNotice(m):null;
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
// 채팅 기록 페이지: 운영자용 채팅 조회를 100건씩 이전 페이지로 넘기며 불러온다.
const archive=ref<Message[]>([]),archiveCursor=ref<string|null>(null),archiveMore=ref(false),archiveLoading=ref(false);
async function loadArchive(reset:boolean){
 if(!live.value||archiveLoading.value)return;const id=live.value.liveId;archiveLoading.value=true;
 try{
  const page=await api.liveMessagesPage(id,reset?undefined:archiveCursor.value??undefined);if(live.value?.liveId!==id)return;
  const base=reset?[]:archive.value,known=new Set(base.map(m=>m.messageId));
  archive.value=[...base,...page.items.filter(m=>!known.has(m.messageId))];for(const m of page.items)names.value[m.messageId]=m.authorAlias;
  archiveCursor.value=page.nextCursor;archiveMore.value=!!page.nextCursor;
 }catch(e){fail(e);}finally{archiveLoading.value=false;}
}
function onPage(p:string){if(p==='viewers')resolveNames().catch(fail);if(p==='chats')loadArchive(true);}
const caseNames=computed(()=>Object.fromEntries(caseHistory.value.flatMap(c=>{const n=nameOf(c.targetMessageIds[0]);return n?[[c.caseId,n]]:[];})));
let generation=0;let refreshSequence=0;
const versions=new EventVersions();
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
  generation++;disconnect();resetAccess();messages.value=[];reviews.value=[];caseHistory.value=[];logs.value=[];live.value=null;names.value={};archive.value=[];archiveMore.value=false;kickProgress.value={};tried.clear();seen.clear();versions.clear();outgoing=null;text.value='';
  await store.syncIdentity(current);
  notice.value='다른 창에서 로그인 계정이 변경되어 화면을 갱신했습니다. 역할별 데모는 서로 다른 호스트나 브라우저 프로필을 사용하세요.';
  void load();return false;
 }
 return true;
}
type RefreshScope = 'all' | 'messages' | 'guard';
let refreshWork: Promise<boolean> | null = null;
let pendingMessages = false, pendingGuard = false;
let eventTimer: ReturnType<typeof setTimeout> | undefined;
function refresh(scope: RefreshScope = 'all'): Promise<boolean> {
 pendingMessages ||= scope !== 'guard'; pendingGuard ||= scope !== 'messages';
 if (!refreshWork) refreshWork = drainRefresh().finally(() => { refreshWork = null; });
 return refreshWork;
}
async function drainRefresh() {
 let result = false;
 while (pendingMessages || pendingGuard) {
  const readMessages = pendingMessages, readGuard = pendingGuard;
  pendingMessages = false; pendingGuard = false;
  result = await refreshOnce(readMessages, readGuard);
 }
 return result;
}
function scheduleRefresh(scope: RefreshScope) {
 pendingMessages ||= scope !== 'guard'; pendingGuard ||= scope !== 'messages';
 if (refreshWork || eventTimer) return;
 // Short bursts share a request batch; an in-flight batch gets one follow-up.
 eventTimer = setTimeout(() => { eventTimer = undefined; void refreshPending(); }, 80);
}
function refreshPending() {
 if (!refreshWork) refreshWork = drainRefresh().finally(() => { refreshWork = null; });
 return refreshWork;
}
async function refreshOnce(readMessages: boolean, readGuard: boolean){
 if(!live.value||ended.value)return false;
 const expected=generation;const sequence=++refreshSequence;const id=live.value.liveId;
 try{
  if(!await sessionValid())return false;
  const [page,cards,history]=await Promise.all([readMessages?api.liveMessages(id):null,readGuard&&operator.value?api.liveReviews(id):null,readGuard&&operator.value?api.liveCases(id):null]);
  if(expected!==generation||sequence!==refreshSequence||live.value?.liveId!==id)return false;
  if(blocked.value)notice.value='';
  if(page){
   const current=new Map(messages.value.map(m=>[m.messageId,m]));
   messages.value=[...page.items].reverse().flatMap(m=>{
    if(m.version<(versions.version('message',m.messageId)??-1)){
     const previous=current.get(m.messageId);
     return previous&&previous.version>=(versions.version('message',m.messageId)??-1)?[previous]:[];
    }
    versions.observe('message',m.messageId,m.version);return [m];
   });
   syncTimeout(page);blocked.value=false;accessReady.value=true;
  }
  if(cards){reviews.value=cards;for(const r of cards)versions.observe('review',r.reviewId,r.version);}
  if(history){caseHistory.value=history;for(const c of history)versions.observe('case',c.caseId,c.version);}
  if(readGuard&&operator.value)resolveNames().catch(()=>{});
  return true;
 }catch(e){if(expected===generation&&sequence===refreshSequence)fail(e);return false;}
}
// 조치 결과에는 검토 ID가 없다. 조치 사건(caseId)의 강퇴 검토, 없으면 결과를 기다리는 강퇴 검토에 붙인다.
function setKick(payload:{caseId?:string},state:string){
 const waiting=Object.keys(kickProgress.value).filter(id=>kickProgress.value[id]==='결정 접수 · 실행 결과 대기');
 const id=reviews.value.find(r=>r.kind==='KICK'&&r.caseId===payload.caseId)?.reviewId??waiting.at(-1);
 if(id)kickProgress.value[id]=state;
}
function disconnect(){if(eventTimer)clearTimeout(eventTimer);eventTimer=undefined;pendingMessages=false;pendingGuard=false;streams.forEach(s=>s.close());streams=[];online.value=false;}
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
   if(!versions.accept(e.type,v))return;
   logs.value.unshift({id:v.eventId,time:v.occurredAt,event:e.type,detail:JSON.stringify(v.payload),caseId:v.payload?.caseId,reviewId:v.payload?.reviewId});logs.value=logs.value.slice(0,200);
   if(e.type==='LIVE_ENDED'){markEnded();return;}
   if(e.type==='LIVE_ACCESS_BLOCKED'&&!operator.value){blockAccess();return;}
   if(e.type==='MESSAGE_VISIBILITY_CHANGED'&&v.payload.visibility!=='PUBLIC'&&!operator.value){
    // 재조회가 지연·실패해도 이미 공개되어 있던 타인 원문을 즉시 제거한다.
    refreshSequence++;messages.value=messages.value.filter(m=>m.messageId!==v.payload.messageId||m.isMine);
   }
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
   if(!['TOOL_START','TOOL_END'].includes(e.type))scheduleRefresh(e.type==='CHAT'?'messages':'all');
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
  if(current.liveId!==live.value?.liveId){generation++;disconnect();resetAccess();messages.value=[];reviews.value=[];caseHistory.value=[];logs.value=[];names.value={};archive.value=[];archiveMore.value=false;kickProgress.value={};tried.clear();seen.clear();versions.clear();text.value='';outgoing=null;notice.value='';}
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
 const value=text.value.trim();if(!outgoing||outgoing.text!==value)outgoing={text:value,id:uuid()};
 try{await api.sendLive(live.value.liveId,value,outgoing.id);text.value='';outgoing=null;await refresh();}
 catch(e){fail(e);}finally{busy.value=false;}
}
const requests=new Map<string,{serialized:string;id:string}>();
async function decide(r:LiveReview,value:string,reason:string,categories:Category[]){
 if(!await sessionValid())return;
 // reason은 선택이다(Backend A-26). 운영자 화면은 입력란이 없어 보내지 않는다.
 const body:Record<string,unknown>={expectedReviewVersion:r.version,decision:value};
 if(reason.trim())body.reason=reason.trim();
 if(value==='CONFIRM_VIOLATION'){
  body.categories=categories;
  if(!categories.length){error.value='위반 유형을 하나 이상 선택해 주세요.';return;}
  body.evidenceMessageIds=r.targetMessageIds;
 }
 const serialized=JSON.stringify(body);let req=requests.get(r.reviewId);
 if(!req||req.serialized!==serialized){req={serialized,id:uuid()};requests.set(r.reviewId,req);}
 body.clientRequestId=req.id;busy.value=true;error.value='';
 try{const d=await api.decideLive(r,body);notice.value=`결정 접수: ${d.value}. 실제 조치 결과를 기다립니다.`;if(r.kind==='KICK')kickProgress.value[r.reviewId]=value==='APPROVE'?'결정 접수 · 실행 결과 대기':'강퇴 기각 · 기존 제재 유지';await refresh();}
 catch(e){if(e instanceof ApiError&&e.code==='STALE_VERSION')await staleReloaded('다른 운영자가 먼저 검토를 변경했습니다. 최신 상태를 불러왔으니 확인한 뒤 다시 결정해 주세요.');else fail(e);}
 finally{busy.value=false;}
}
// 버전 충돌은 오류가 아니라 안내로 남긴다. 오류 문구는 5초 주기 재확인이 성공하면 지워지기 때문이다.
async function staleReloaded(message:string){error.value='';notice.value=message;await refresh();}
async function revoke(caseId:string,findingId:string,reason:string){
 if(!await sessionValid())return;
 const c=caseHistory.value.find(x=>x.caseId===caseId);if(!c)return;
 if(!reason.trim()){error.value='오판 취소 사유를 입력해 주세요.';return;}
 busy.value=true;
 const body={expectedCaseVersion:c.version,reason:reason.trim()};const serialized=JSON.stringify(body);const key='revoke:'+findingId;let req=requests.get(key);
 if(!req||req.serialized!==serialized){req={serialized,id:uuid()};requests.set(key,req);}
 try{await api.revokeFinding(findingId,{...body,clientRequestId:req.id});notice.value='확정 근거를 취소하고 남은 가림 원인·제한을 재계산했습니다.';await refresh();}
 catch(e){if(e instanceof ApiError&&e.code==='STALE_VERSION')await staleReloaded('사건이 먼저 변경되었습니다. 최신 상태를 불러왔으니 확인한 뒤 다시 취소해 주세요.');else fail(e);}finally{busy.value=false;}
}
const authChannel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('liveguard-auth');
const checkSession=async()=>{try{if(await sessionValid())await load();}catch(e){fail(e);}};
onMounted(()=>{load();window.addEventListener('focus',checkSession);if(authChannel)authChannel.onmessage=checkSession;timer=setInterval(checkSession,5000);clockTimer=setInterval(()=>clock.value=Date.now(),1000);});
onBeforeUnmount(()=>{generation++;disconnect();window.removeEventListener('focus',checkSession);authChannel?.close();if(timer)clearInterval(timer);if(clockTimer)clearInterval(clockTimer);});
</script>
<template>
 <ViewerScreen v-if="!operator&&!admin" v-model:draft="text" :messages="visibleMessages" :nickname="store.me?.nickname??'시청자'" :scope-key="`${store.me?.userId}:${live?.liveId??''}`" :clock="clock" :ready="accessReady" :loading="loading" :has-live="!!live" :blocked="blocked" :ended="ended" :busy="busy" :timed-out="timedOut" :timeout-until="timeoutUntil" :timeout-reason="timeoutReason" :started-at="live?.startedAt" :online="online" :error="error" :notice="notice" @send="send" @logout="store.logout()" @refresh="load"/>
 <StudioScreen v-else-if="operator" :nickname="store.me?.nickname??'스트리머'" :live="live" :ended="ended" :loading="loading" :online="online" :messages="visibleMessages" :reviews="reviews" :cases="caseHistory" :case-names="caseNames" :logs="logs" :kick-progress="kickProgress" :archive="archive" :archive-more="archiveMore" :archive-loading="archiveLoading" :busy="busy" :error="error" :notice="notice"
  @decide="decide" @revoke="revoke" @refresh="load" @start="start" @end="end" @logout="store.logout()" @page="onPage" @load-older="loadArchive(false)"/>
 <!-- 시스템 운영자: 목업과 같은 화면. 백엔드에 시스템 운영자 권한과 여러 방송 조회 API가 없어 데이터 칸은 비어 있다 -->
 <SystemPage v-else api/>
</template>
