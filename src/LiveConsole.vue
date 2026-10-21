<script setup lang="ts">
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import {api,type Live,type LiveReview,type LiveCase} from './api/client';
import {ApiError,type Message,categoryLabels,type Category,visibilityLabels} from './contracts';
import {useLiveGuard} from './stores/liveGuard';
import {ShieldCheck,RefreshCcw,LogOut,Radio,ClipboardCheck,Send} from 'lucide-vue-next';
import YtPlayer from './YtPlayer.vue';
const store=useLiveGuard();
const live=ref<Live|null>(null), messages=ref<Message[]>([]), reviews=ref<LiveReview[]>([]);
const caseHistory=ref<LiveCase[]>([]),revokeReasons=ref<Record<string,string>>({});
const error=ref(''),notice=ref(''),text=ref(''),busy=ref(false),online=ref(false),ended=ref(false),blocked=ref(false),loading=ref(true);
const reasons=ref<Record<string,string>>({}),categories=ref<Record<string,string[]>>({});
const logs=ref<{id:string;time:string;event:string;detail:string}[]>([]);
const operator=computed(()=>store.me?.role==='MODERATOR');
const admin=computed(()=>store.me?.role==='PLATFORM_ADMIN');
const pending=computed(()=>reviews.value.filter(r=>r.status==='PENDING'));
let generation=0;let refreshSequence=0;
const seen=new Set<string>();let streams:EventSource[]=[];let timer:ReturnType<typeof setInterval>|undefined;
const time=(s:string)=>new Date(s).toLocaleTimeString('ko-KR');
function fail(e:unknown){error.value=e instanceof ApiError?`${e.code}: ${e.message}`:'요청을 처리하지 못했습니다.';if(e instanceof ApiError&&e.code==='UNAUTHENTICATED'){generation++;disconnect();messages.value=[];reviews.value=[];caseHistory.value=[];store.clearIdentity();}}
async function sessionValid(){
 const previous=store.me?.userId;
 const current=await api.me();
 if(current.userId!==previous){
  generation++;disconnect();messages.value=[];reviews.value=[];caseHistory.value=[];logs.value=[];live.value=null;
  await store.syncIdentity(current);
  notice.value='다른 창에서 로그인 계정이 변경되어 화면을 갱신했습니다. 역할별 데모는 서로 다른 호스트나 브라우저 프로필을 사용하세요.';
  await load();return false;
 }
 return true;
}
async function refresh(){
 if(!live.value||ended.value)return;
 const expected=generation;const sequence=++refreshSequence;const id=live.value.liveId;
 try{
  if(!await sessionValid())return;
  const [page,cards,history]=await Promise.all([api.liveMessages(id),operator.value?api.liveReviews(id):Promise.resolve([]),operator.value?api.liveCases(id):Promise.resolve([])]);
  if(expected!==generation||sequence!==refreshSequence||live.value?.liveId!==id)return;
  messages.value=[...page.items].reverse();reviews.value=cards;caseHistory.value=history;
 }catch(e){if(expected===generation)fail(e);}
}
function disconnect(){streams.forEach(s=>s.close());streams=[];online.value=false;}
function connect(){
 disconnect();if(!live.value)return;
 const source=api.liveEvents(live.value.liveId);streams.push(source);
 source.onopen=()=>online.value=true;source.onerror=()=>online.value=false;
 const handle=(e:Event)=>{
  try{
   const v=JSON.parse((e as MessageEvent).data);
   if(!v.eventId||seen.has(v.eventId))return;seen.add(v.eventId);if(seen.size>1000)seen.delete(seen.values().next().value!);
   logs.value.unshift({id:v.eventId,time:v.occurredAt,event:e.type,detail:JSON.stringify(v.payload)});logs.value=logs.value.slice(0,60);
   if(e.type==='LIVE_ENDED'){ended.value=true;notice.value='방송이 종료되었습니다.';disconnect();return;}
   if(e.type==='LIVE_ACCESS_BLOCKED'&&!operator.value){blocked.value=true;notice.value='이 방송의 입장이 제한되었습니다.';disconnect();return;}
   if(e.type==='ACTION_APPLIED')notice.value=v.payload.type==='KICK'?'강퇴 적용이 확인되었습니다.':'조치 적용이 확인되었습니다.';
   refresh();
  }catch{error.value='실시간 이벤트를 확인하지 못했습니다. 새로고침해 주세요.';}
 };
 for(const name of ['CHAT','MESSAGE_VISIBILITY_CHANGED','MESSAGE_RESTORED','LIVE_ACCESS_BLOCKED','LIVE_ENDED','ACTION_APPLIED','ACTION_FAILED'])source.addEventListener(name,handle);
 if(operator.value){
  const guard=api.liveEvents(live.value.liveId,true);streams.push(guard);
  for(const name of ['CASE_CREATED','CASE_UPDATED','CONTEXT_REVIEW_REQUIRED','KICK_REVIEW_REQUIRED','REVIEW_DECIDED','ACTION_APPLIED','ACTION_FAILED','TOOL_START','TOOL_END','TASK_FAILED'])guard.addEventListener(name,handle);
 }
}
async function load(){
 error.value='';if(!store.channelId)return;
 try{live.value=await api.currentLive(store.channelId);ended.value=false;blocked.value=false;await refresh();connect();}
 catch(e){if(e instanceof ApiError&&e.code==='NOT_FOUND'){live.value=null;disconnect();}else fail(e);}finally{loading.value=false;}
}
async function start(){busy.value=true;try{live.value=await api.startLive(store.channelId);ended.value=false;await refresh();connect();}catch(e){fail(e);}finally{busy.value=false;}}
async function end(){if(!live.value)return;busy.value=true;try{await api.endLive(live.value.liveId);ended.value=true;disconnect();notice.value='방송이 종료되었습니다.';}catch(e){fail(e);}finally{busy.value=false;}}
let outgoing:{text:string;id:string}|null=null;
async function send(){
 if(!await sessionValid())return;
 if(!live.value||!text.value.trim())return;busy.value=true;error.value='';
 const value=text.value.trim();if(!outgoing||outgoing.text!==value)outgoing={text:value,id:crypto.randomUUID()};
 try{await api.sendLive(live.value.liveId,value,outgoing.id);text.value='';outgoing=null;await refresh();}
 catch(e){fail(e);}finally{busy.value=false;}
}
const requests=new Map<string,{serialized:string;id:string}>();
async function decide(r:LiveReview,value:string){
 if(!await sessionValid())return;
 const reason=(reasons.value[r.reviewId]??'').trim();if(!reason){error.value='결정 이유를 입력해 주세요.';return;}
 const body:Record<string,unknown>={expectedReviewVersion:r.version,decision:value,reason};
 if(value==='CONFIRM_VIOLATION'){
  body.categories=categories.value[r.reviewId]??[...new Set(r.findings.flatMap(f=>f.categories))];
  if(!(body.categories as string[]).length){error.value='위반 유형을 하나 이상 선택해 주세요.';return;}
  body.evidenceMessageIds=r.targetMessageIds;
 }
 const serialized=JSON.stringify(body);let req=requests.get(r.reviewId);
 if(!req||req.serialized!==serialized){req={serialized,id:crypto.randomUUID()};requests.set(r.reviewId,req);}
 body.clientRequestId=req.id;busy.value=true;error.value='';
 try{const d=await api.decideLive(r,body);notice.value=`결정 접수: ${d.value}. 실제 조치 결과를 기다립니다.`;await refresh();}
 catch(e){fail(e);if(e instanceof ApiError&&e.code==='STALE_VERSION')await refresh();}
 finally{busy.value=false;}
}
async function revoke(c:LiveCase,findingId:string){
 if(!await sessionValid())return;
 const reason=(revokeReasons.value[findingId]??'').trim();if(!reason){error.value='오판 취소 사유를 입력해 주세요.';return;}
 busy.value=true;
 const body={expectedCaseVersion:c.version,reason};const serialized=JSON.stringify(body);const key='revoke:'+findingId;let req=requests.get(key);
 if(!req||req.serialized!==serialized){req={serialized,id:crypto.randomUUID()};requests.set(key,req);}
 try{await api.revokeFinding(findingId,{...body,clientRequestId:req.id});notice.value='확정 근거를 취소하고 남은 가림 원인·제한을 재계산했습니다.';await refresh();}
 catch(e){fail(e);}finally{busy.value=false;}
}
const authChannel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('liveguard-auth');
const checkSession=()=>sessionValid().catch(fail);
onMounted(()=>{load();window.addEventListener('focus',checkSession);if(authChannel)authChannel.onmessage=checkSession;timer=setInterval(()=>{checkSession();if(!live.value&&!ended.value)load();},5000);});
onBeforeUnmount(()=>{generation++;disconnect();window.removeEventListener('focus',checkSession);authChannel?.close();if(timer)clearInterval(timer);});
</script>
<template>
 <div class="v1-shell">
  <header class="v1-top"><a class="yt-logo"><span class="yt-logo-mark"><ShieldCheck :size="16"/></span><b>LIVE:GUARD</b></a><b>{{operator?'Studio · 운영자':admin?'시스템 운영자':'라이브 시청'}}</b>
   <span class="v1-connection"><i :class="{connected:online}"/>{{online?'실시간 연결':'연결 대기'}}</span><span>{{store.me?.nickname}}</span><button @click="store.logout()"><LogOut :size="15"/> 로그아웃</button></header>
  <main class="v1-main"><p class="v1-fixture">로컬 통합 검증 · 정책 미정 항목의 시험 설정을 사용합니다. 영상은 데모 영상입니다.</p>
   <div class="v1-heading"><div><p class="v1-eyebrow">LIVE MODERATION</p><h1>{{operator?'실시간 채팅 관제':admin?'시스템 운영 현황':'오늘의 라이브'}}</h1><p>{{operator?'AI 조사 근거를 확인하고 정상·위반·보류를 결정하세요.':'채팅은 방송 정책에 따라 검사됩니다.'}}</p></div>
    <div class="v1-actions"><button @click="load"><RefreshCcw :size="16"/> 새로고침</button><button v-if="operator&&!loading&&(!live||ended)" class="v1-primary" :disabled="busy" @click="start">방송 시작</button><button v-if="operator&&live&&!ended" :disabled="busy" @click="end">방송 종료</button></div></div>
   <p v-if="error" role="alert" class="v1-error">{{error}}</p><p v-if="notice" role="status" class="v1-notice">{{notice}}</p>
   <section v-if="admin" class="v1-card"><h2>등록된 역할로 접근했습니다</h2><p>이 계정에는 담당 방송이 없습니다. 방송 검토는 담당 운영자 계정으로 확인하세요.</p><p>이 화면에는 Mock 집계를 표시하지 않습니다.</p></section>
   <section v-else-if="!live" class="v1-card v1-empty"><Radio :size="30"/><h2>진행 중인 방송이 없습니다</h2><p>{{operator?'방송을 시작하면 시청자 채팅과 AI 조사 결과를 확인할 수 있습니다.':'운영자가 방송을 시작하면 자동으로 연결됩니다.'}}</p></section>
   <template v-else>
    <div class="v1-live-id"><span :class="ended?'':'v1-live-dot'">{{ended?'종료':'LIVE'}}</span> 방송 {{live.liveId.slice(0,8)}} · {{time(live.startedAt)}} 시작</div>
    <div class="v1-columns" :class="{'viewer-only':!operator}">
     <section class="v1-card v1-chat"><YtPlayer v-if="!operator" :demo="true"/><header><h2>실시간 채팅</h2><span>{{messages.length}}건</span></header>
      <div class="v1-message-list"><article v-for="m in messages" :key="m.messageId" class="v1-message" :class="m.visibility.toLowerCase()"><span class="v1-avatar">{{m.authorAlias.slice(0,1)}}</span><div><b>{{m.authorAlias}}</b><p>{{m.text}}</p><small v-if="m.visibility!=='PUBLIC'">{{visibilityLabels[m.visibility]}} · 작성자와 담당 운영자에게만 표시</small></div><time>{{time(m.sentAt)}}</time></article><p v-if="!messages.length" class="v1-empty">아직 채팅이 없습니다.</p></div>
      <form @submit.prevent="send"><label for="live-message">채팅 보내기</label><div><input id="live-message" v-model="text" maxlength="500" placeholder="메시지를 입력하세요" :disabled="busy||ended||blocked"/><button type="submit" :disabled="busy||ended||blocked||!text.trim()" aria-label="채팅 전송"><Send :size="18"/></button></div><small>{{text.length}} / 500</small></form>
     </section>
     <section v-if="operator" class="v1-reviews"><div class="v1-review-title"><ClipboardCheck :size="21"/><h2>운영자 결정 대기</h2><b>{{pending.length}}</b></div>
      <div v-if="!pending.length" class="v1-card v1-empty">지금은 결정이 필요한 검토가 없습니다. 문맥 의심 채팅을 조사하면 이곳에 표시됩니다.</div>
      <article v-for="r in pending" :key="r.reviewId" class="v1-card v1-review" :data-review-id="r.reviewId"><header><span class="v1-kind">{{r.kind==='CONTEXT'?'문맥 검토':'강퇴 승인'}}</span><small>{{time(r.createdAt)}} · v{{r.version}}</small></header><h3>{{r.summary}}</h3>
       <p v-if="r.kind==='KICK'">기준 사건 {{r.basisCaseIds.length}}건. 승인 후 재검증을 통과하면 현재 방송 종료까지 입장이 제한됩니다.</p>
       <div v-for="f in r.findings" :key="f.messageId" class="v1-finding"><b>AI 제안 · {{f.verdict}}</b><blockquote>{{r.messages.find(m=>m.messageId===f.messageId)?.text}}</blockquote><p>{{f.reason}}</p><small>정책 {{f.policyIds.join(', ')}}</small><p v-if="f.missingFacts.length">확인 필요: {{f.missingFacts.join(', ')}}</p></div>
       <details><summary>주변 문맥과 근거 메시지</summary><p v-for="m in r.messages" :key="m.messageId"><b>{{m.authorAlias}}</b> {{m.text}} <small>{{m.messageId.slice(0,8)}}</small></p></details>
       <fieldset v-if="r.kind==='CONTEXT'"><legend>위반 확정 시 적용할 유형</legend><label v-for="(name,key) in categoryLabels" :key="key"><input type="checkbox" :checked="(categories[r.reviewId]??r.findings.flatMap(f=>f.categories)).includes(key)" @change="categories[r.reviewId]=($event.target as HTMLInputElement).checked?[...(categories[r.reviewId]??r.findings.flatMap(f=>f.categories)),key]:(categories[r.reviewId]??r.findings.flatMap(f=>f.categories)).filter(c=>c!==key)"/>{{name}}</label></fieldset>
       <label :for="'reason-'+r.reviewId">결정 이유</label><textarea :id="'reason-'+r.reviewId" v-model="reasons[r.reviewId]" maxlength="500" placeholder="확인한 근거와 결정 이유를 입력하세요" :disabled="busy||ended"/>
       <div class="v1-decision-actions"><template v-if="r.kind==='CONTEXT'"><button :disabled="busy||ended" @click="decide(r,'CONFIRM_NORMAL')">정상 확정</button><button class="v1-primary" :disabled="busy||ended" @click="decide(r,'CONFIRM_VIOLATION')">위반 확정</button><button :disabled="busy||ended" @click="decide(r,'DEFER')">보류</button></template><template v-else><button class="v1-primary" :disabled="busy||ended" @click="decide(r,'APPROVE')">강퇴 승인</button><button :disabled="busy||ended" @click="decide(r,'REJECT')">강퇴 거절</button></template></div><small>결정 접수와 실제 조치 적용은 별도입니다.</small>
      </article>
      <section class="v1-card"><h2>조치 이력 · 오판 취소</h2><details v-for="c in caseHistory.filter(c=>c.confirmedFindings.length)" :key="c.caseId" class="v1-recovery" :data-case-id="c.caseId"><summary>{{c.confirmationStatus}} · {{c.caseId.slice(0,8)}}</summary><p v-for="m in c.messages.filter(m=>c.targetMessageIds.includes(m.messageId))" :key="m.messageId">{{m.text}}</p><div v-for="f in c.confirmedFindings" :key="f.findingId"><b>{{categoryLabels[f.category as Category]}} · {{f.status}}</b><template v-if="f.status==='CONFIRMED'"><label :for="'revoke-'+f.findingId">취소 사유</label><textarea :id="'revoke-'+f.findingId" v-model="revokeReasons[f.findingId]" maxlength="500"/><button :disabled="busy" @click="revoke(c,f.findingId)">확정 근거 취소</button></template></div></details><p v-if="!caseHistory.some(c=>c.confirmedFindings.length)">아직 확정된 위반이 없습니다.</p></section>
      <section class="v1-card"><h2>진행 기록</h2><ol class="v1-log"><li v-for="l in logs" :key="l.id"><time>{{time(l.time)}}</time> <b>{{l.event}}</b></li></ol><p v-if="!logs.length">새 이벤트를 기다립니다.</p></section>
     </section>
    </div>
   </template>
  </main>
 </div>
</template>
<style scoped>
.v1-shell{min-height:100vh;background:#f8f8f8;color:#111;font-family:inherit}.v1-top{height:64px;background:white;border-bottom:1px solid #e5e5e5;display:flex;align-items:center;gap:18px;padding:0 28px}.v1-connection{margin-left:auto;font-size:12px;color:#666;display:flex;align-items:center;gap:6px}.v1-connection i{height:7px;width:7px;background:#999;border-radius:50%}.v1-connection i.connected{background:#2ea44f}.v1-main{max-width:1440px;margin:auto;padding:30px}.v1-heading{display:flex;justify-content:space-between;gap:16px;margin-bottom:22px;align-items:center}.v1-eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;color:#e00}.v1-heading h1{font-size:28px;margin:5px 0 8px;letter-spacing:-.04em}.v1-heading p{color:#666;margin:0}.v1-actions{display:flex;gap:8px}.v1-shell button{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#fff;border:1px solid #ddd;border-radius:6px;padding:9px 13px;font-weight:600;cursor:pointer}.v1-shell button:disabled{opacity:.45;cursor:default}.v1-shell .v1-primary{background:#f00;color:white;border-color:#f00}.v1-shell button:focus-visible,.v1-shell input:focus-visible,.v1-shell textarea:focus-visible{outline:2px solid #065fd4;outline-offset:2px}.v1-card{background:#fff;border:1px solid #e4e4e4;border-radius:12px;padding:20px}.v1-card h2{font-size:18px;margin:0 0 15px}.v1-live-id{font-size:12px;color:#666;display:flex;gap:10px;align-items:center;margin-bottom:15px}.v1-live-dot{color:#f00;font-weight:700}.v1-columns{display:grid;grid-template-columns:minmax(300px,1fr) minmax(350px,1fr);gap:24px;align-items:start}.v1-columns.viewer-only{max-width:900px;margin:auto;display:block}.v1-chat{padding:0;overflow:hidden}.v1-chat header{display:flex;justify-content:space-between;padding:18px;border-bottom:1px solid #eee}.v1-chat header h2{margin:0}.v1-chat header span{font-size:12px;color:#666}.v1-message-list{max-height:510px;min-height:250px;overflow:auto;padding:12px}.v1-message{display:flex;gap:10px;padding:12px 8px;border-radius:6px;margin-bottom:4px}.v1-message.held{background:#fff8df}.v1-message.hidden{background:#fceaea}.v1-message p{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}.v1-message b{font-size:12px;color:#555}.v1-message small{font-size:11px;color:#94631c}.v1-message time{margin-left:auto;color:#888;font-size:10px;flex-shrink:0}.v1-avatar{display:flex;align-items:center;justify-content:center;border-radius:50%;background:#d41766;color:white;width:27px;height:27px;flex-shrink:0}.v1-chat form{border-top:1px solid #eee;padding:18px}.v1-chat form>div{display:flex;gap:8px;margin:8px 0}.v1-chat input{width:100%;border:0;border-bottom:1px solid #bbb;padding:10px}.v1-chat form small{font-size:11px;color:#888}.v1-review-title{display:flex;align-items:center;gap:8px;margin-bottom:15px}.v1-review-title h2{font-size:20px;margin:0}.v1-review-title>b{margin-left:auto;color:#666}.v1-reviews{display:grid;gap:16px}.v1-review header{display:flex;justify-content:space-between;gap:10px}.v1-review h3{font-size:16px;margin:15px 0}.v1-review p{font-size:13px;line-height:1.6}.v1-kind{background:#ece8ff;color:#5d39bc;padding:5px 8px;font-size:12px;border-radius:4px;font-weight:700}.v1-review small{font-size:11px;color:#777}.v1-finding{background:#f8f8fb;border-left:3px solid #8170cd;padding:12px;margin:12px 0;overflow-wrap:anywhere}.v1-finding>b{font-size:12px;color:#6554a4}.v1-finding blockquote{font-size:15px;margin:10px 0;font-weight:600}.v1-review details{font-size:12px;margin:14px 0;cursor:pointer}.v1-review fieldset{border:1px solid #eee;border-radius:6px;padding:10px;margin:15px 0;display:flex;flex-wrap:wrap;gap:10px}.v1-review legend,.v1-review label{font-size:12px;color:#555}.v1-review fieldset label{display:flex;gap:4px;align-items:center}.v1-review textarea{display:block;width:100%;min-height:70px;box-sizing:border-box;margin:7px 0 12px;padding:10px;border:1px solid #ccc;border-radius:5px;resize:vertical;font:inherit;font-size:13px}.v1-decision-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.v1-empty{padding:40px;text-align:center;color:#777;line-height:1.8}.v1-error,.v1-notice{padding:13px 16px;border-radius:6px;font-size:13px}.v1-error{color:#c00;background:#ffebeb}.v1-notice{color:#275c35;background:#eaf4ec}.v1-log{padding:0;list-style:none;max-height:200px;overflow:auto;font-size:11px}.v1-log li{padding:7px 0;border-bottom:1px solid #eee}.v1-log time{color:#888;margin-right:10px}@media(max-width:850px){.v1-columns{grid-template-columns:1fr}.v1-main{padding:18px}.v1-heading{align-items:start;flex-direction:column}.v1-top{padding:0 14px;gap:8px;font-size:12px}.v1-top>.yt-logo{display:none}.v1-message-list{max-height:380px}} 
</style>
