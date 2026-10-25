// Local Spring/DB evaluation only. Creates isolated synthetic users/channels, never edits existing fixtures.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {chromium,request} from 'playwright';
import {createServer} from 'vite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
if(!('local-fixture' in args))throw Error('LOCAL_FIXTURE_FLAG_REQUIRED: creates isolated local test data');
const base=process.env.LIVEGUARD_EVAL_URL??'http://127.0.0.1:8080';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('LOCAL_HOST_REQUIRED');
const participants=Number(args.sessions??100),seconds=Number(args.seconds??10),rate=Number(args.rate??100);
assert(Number.isInteger(participants)&&participants>=2&&participants<=200);
assert(Number.isInteger(seconds)&&seconds>=1&&seconds<=60);
assert(Number.isInteger(rate)&&rate>=1&&rate<=participants);
const run=randomUUID().replaceAll('-','').slice(0,12),prefix=`lgeval_${run}`;
const syllables='가나다라마바사아자차카타파하거너';
const safeText=value=>[...value].map(c=>syllables[parseInt(c,16)]).join(' ');
const corpusRun=safeText(run);let sequence=0;
const password=process.env.LIVEGUARD_TEST_PASSWORD??'liveguard-local';
const iso=()=>new Date().toISOString(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={run,startedAt:iso(),mode:'actual-local-spring-pass-traffic',corpus:'unique digit-free synthetic syllables; each POST must return PUBLIC',requested:{participants,seconds,rate},checks:[],unverified:['production HTTPS cookie attributes','real LLM/PII latency and cost','long-duration memory stability','real kick approval and revalidation under load','agreed production SLOs'],credentialsRecorded:false};
const contexts=[],streams=[],phaseMessages=new Map();
let server,browser,page,hostA,hostB,liveA,liveB;let subscribers=[];
const channelA=randomUUID(),channelB=randomUUID();
const accounts=[...Array.from({length:participants},(_,i)=>({name:`${prefix}_v${i}`,role:'VIEWER',member:'VIEWER',channel:channelA})),
 {name:`${prefix}_hosta`,role:'MODERATOR',member:'MODERATOR',channel:channelA},
 {name:`${prefix}_hostb`,role:'MODERATOR',member:'MODERATOR',channel:channelB},
 {name:`${prefix}_outsider`,role:'VIEWER',member:'VIEWER',channel:channelB},
 {name:`${prefix}_streamer`,role:'VIEWER',member:'STREAMER',channel:channelA},
 {name:`${prefix}_admin`,role:'PLATFORM_ADMIN',member:null,channel:null}].map(a=>({...a,id:randomUUID()}));
function sql(text){return execFileSync('docker',['compose','exec','-T','db','sh','-c','exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'],{cwd:path.resolve(root,'../liveguard-infra'),input:text,encoding:'utf8',maxBuffer:1024*1024}).trim();}
async function context(){const c=await request.newContext({baseURL:base,timeout:30000});contexts.push(c);return c;}
async function csrf(c){let cookies=(await c.storageState()).cookies;let token=cookies.find(v=>v.name==='XSRF-TOKEN')?.value;
 if(!token){await c.get('/api/auth/me');cookies=(await c.storageState()).cookies;token=cookies.find(v=>v.name==='XSRF-TOKEN')?.value;}return token?decodeURIComponent(token):'';}
async function api(c,method,url,data,expected=200){const headers=method==='GET'?{}:{'X-XSRF-TOKEN':await csrf(c)};
 const response=await c.fetch(url,{method,data,headers});const result=await response.json().catch(()=>null);
 if(response.status()!==expected)throw Error(`HTTP_${response.status()}_EXPECTED_${expected}_${method}_${url.split('?')[0]}_${result?.error?.code??'UNKNOWN'}`);
 return result?.data;
}
async function login(account){const c=await context();await api(c,'POST','/api/auth/login',{username:account.name,password});await api(c,'GET','/api/auth/me');return c;}
async function subscribe(c,id){const controller=new AbortController();const cookies=(await c.storageState()).cookies.map(v=>`${v.name}=${v.value}`).join('; ');
 const response=await fetch(`${base}/api/lives/${id}/events`,{headers:{Cookie:cookies},signal:controller.signal});
 assert.equal(response.status,200);const stream={controller,received:new Map(),duplicates:0,closed:false};streams.push(stream);
 stream.done=(async()=>{let buffer='';const decoder=new TextDecoder();try{for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true}).replaceAll('\r','');let at;
 while((at=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,at);buffer=buffer.slice(at+2);const event=block.split('\n').find(l=>l.startsWith('event:'))?.slice(6).trim();
 const line=block.split('\n').find(l=>l.startsWith('data:'));if(event!=='CHAT'||!line)continue;const envelope=JSON.parse(line.slice(5));const id=envelope.payload?.messageId;if(!id)continue;
 if(stream.received.has(id))stream.duplicates++;else stream.received.set(id,performance.now());}
 }}catch(e){if(!controller.signal.aborted)stream.error=e.name;}finally{stream.closed=true;}})();return stream;}
async function until(fn,label,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(50);}throw Error(`TIMEOUT_${label}`);}
function check(name,value,extra={}){report.checks.push({name,pass:!!value,...extra});assert(value,name);}
function summary(samples){const s=samples.filter(Number.isFinite).sort((a,b)=>a-b);return{count:s.length,p50:s[Math.floor((s.length-1)*.5)]??null,p95:s[Math.floor((s.length-1)*.95)]??null,p99:s[Math.floor((s.length-1)*.99)]??null,max:s.at(-1)??null};}
try{
 sql(`BEGIN;
 DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM platform.users WHERE username='viewer') THEN RAISE EXCEPTION 'LOCAL_VIEWER_FIXTURE_REQUIRED'; END IF; END $$;
 INSERT INTO platform.channels(id,name) VALUES('${channelA}','${prefix}_A'),('${channelB}','${prefix}_B');
 ${accounts.map(a=>`INSERT INTO platform.users(id,username,password_hash,nickname,role) SELECT '${a.id}','${a.name}',password_hash,'${a.name}','${a.role}' FROM platform.users WHERE username='viewer';${a.member?`INSERT INTO platform.channel_members(channel_id,user_id,member_role) VALUES('${a.channel}','${a.id}','${a.member}');`:''}`).join('\n')}
 COMMIT;`);
 report.fixture={channelA,channelB,createdUsers:accounts.length,existingUsersModified:false,cleanup:'test broadcasts ended; synthetic rows retained for reproducibility'};
 const clients=[];for(let n=0;n<accounts.length;n+=10)clients.push(...await Promise.all(accounts.slice(n,n+10).map(login)));
 hostA=clients[participants];hostB=clients[participants+1];const outsider=clients[participants+2],streamer=clients[participants+3],admin=clients[participants+4];
 report.backendImage=execFileSync('docker',['compose','images','-q','backend'],{cwd:path.resolve(root,'../liveguard-infra'),encoding:'utf8'}).trim();
 liveA=await api(hostA,'POST',`/api/channels/${channelA}/lives`,undefined,201);liveB=await api(hostB,'POST',`/api/channels/${channelB}/lives`,undefined,201);
 await api(hostA,'POST',`/api/channels/${channelA}/lives`,undefined,409);check('duplicate_start_returns_409',true);
 // Errors have no data field, so explicit status checks below do not depend on truthiness.
 const denied=async(c,method,url,data,expected=403)=>{await api(c,method,url,data,expected);check(`${method}_${url.split('?')[0]}_denied_${expected}`,true);};
 const raw=await context();let response=await raw.post('/api/auth/login',{data:{username:accounts[0].name,password}});check('login_without_csrf_denied',response.status()===403);
 response=await clients[0].post(`/api/lives/${liveA.liveId}/messages`,{data:{clientMessageId:randomUUID(),text:'검증'},headers:{'X-XSRF-TOKEN':'invalid'}});check('invalid_csrf_denied',response.status()===403);
 await denied(outsider,'GET',`/api/lives/${liveA.liveId}/messages`);
 await denied(outsider,'GET',`/api/lives/${liveA.liveId}/events`);
 await denied(outsider,'POST',`/api/lives/${liveA.liveId}/messages`,{clientMessageId:randomUUID(),text:'검증'});
 await denied(clients[0],'GET',`/api/guard/events?liveId=${liveA.liveId}`);
 await denied(clients[0],'GET',`/api/reviews?liveId=${liveA.liveId}&kind=CONTEXT`);
 await denied(streamer,'GET',`/api/guard/events?liveId=${liveA.liveId}`);
 await denied(admin,'GET',`/api/lives/${liveA.liveId}/messages`);
 await denied(clients[0],'POST',`/api/lives/${liveA.liveId}/end`);
 const authorStream=await subscribe(clients[0],liveA.liveId),observerStream=await subscribe(clients[1],liveA.liveId),moderatorStream=await subscribe(hostA,liveA.liveId);
 const hidden=await api(clients[0],'POST',`/api/lives/${liveA.liveId}/messages`,{clientMessageId:randomUUID(),text:`시발 ${run}`},201);
 report.observedPolicyVersions=sql(`SELECT DISTINCT policy_version FROM guard.cases WHERE live_id='${liveA.liveId}';`).split('\n').filter(Boolean);
 const marker=await api(clients[0],'POST',`/api/lives/${liveA.liveId}/messages`,{clientMessageId:randomUUID(),text:`확인 ${run}`},201);
 await until(()=>observerStream.received.has(marker.messageId)&&authorStream.received.has(hidden.messageId)&&moderatorStream.received.has(hidden.messageId),'visibility_streams');
 const history=await api(clients[1],'GET',`/api/lives/${liveA.liveId}/messages`);
 check('hidden_stream_only_author_and_moderator',!observerStream.received.has(hidden.messageId));
 check('hidden_absent_from_other_viewer_rest',!history.items.some(m=>m.messageId===hidden.messageId));
 const streamerHistory=await api(streamer,'GET',`/api/lives/${liveA.liveId}/messages`);
 check('streamer_membership_is_not_moderator_raw_access',!streamerHistory.items.some(m=>m.messageId===hidden.messageId));
 const duplicateId=randomUUID();const first=await api(clients[0],'POST',`/api/lives/${liveA.liveId}/messages`,{clientMessageId:duplicateId,text:`확인 반복 ${run}`},201);
 const again=await api(clients[0],'POST',`/api/lives/${liveA.liveId}/messages`,{clientMessageId:duplicateId,text:`확인 반복 ${run}`},201);
 check('client_message_id_is_idempotent',first.messageId===again.messageId);
 const cookies=(await clients[0].storageState()).cookies;report.localCookieAttributes=cookies.map(c=>({name:c.name,httpOnly:c.httpOnly,secure:c.secure,sameSite:c.sameSite}));
 for(const s of [authorStream,observerStream,moderatorStream])s.controller.abort();await Promise.all([authorStream.done,observerStream.done,moderatorStream.done]);
 subscribers=await Promise.all(clients.slice(0,participants).map(c=>subscribe(c,liveA.liveId)));
 server=await createServer({root,define:{'import.meta.env.VITE_USE_API':'"true"','import.meta.env.VITE_BACKEND_TARGET':JSON.stringify(base)},server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:base,changeOrigin:false}}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({headless:true});const browserContext=await browser.newContext({viewport:{width:1280,height:900}});await browserContext.addCookies(cookies);page=await browserContext.newPage();const errors=[],requests={};page.on('pageerror',e=>errors.push(e.name));page.on('request',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/api/'))requests[p]=(requests[p]??0)+1;});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);await page.getByLabel('채팅 검색',{exact:true}).waitFor();
 await page.evaluate(()=>{window.evalMetrics={frames:[],longTasks:[]};let last=performance.now();const frame=t=>{window.evalMetrics.frames.push(t-last);last=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);try{new PerformanceObserver(list=>window.evalMetrics.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:false});}catch{}});
 const heap=async()=>page.evaluate(()=>performance.memory?.usedJSHeapSize??null);const heapBefore=await heap(),sendLatencies=[],uiLatencies=[],dispatches=[];
 const send=async(index)=>{const start=performance.now(),id=randomUUID();dispatches.push(start);const value=await api(clients[index%participants],'POST',`/api/lives/${liveA.liveId}/messages`,{clientMessageId:id,text:`부하 확인 ${corpusRun} ${safeText((sequence++).toString(16))}`},201);if(value.visibility!=='PUBLIC')throw Error('NON_PASS_CORPUS_DETECTED');sendLatencies.push(performance.now()-start);phaseMessages.set(value.messageId,start);return value.messageId;};
 const burstStart=performance.now();await Promise.all(Array.from({length:participants},(_,i)=>send(i)));const burstElapsed=performance.now()-burstStart;
 let privateDuringLoad;const sustainedStart=performance.now();for(let wave=0;wave<seconds;wave++){
  await sleep(Math.max(0,sustainedStart+wave*1000-performance.now()));
  const waveWork=Promise.all(Array.from({length:rate},(_,i)=>send(wave*rate+i)));
  if(wave===Math.floor(seconds/2)){privateDuringLoad=await api(clients[participants-1],'POST',`/api/lives/${liveA.liveId}/messages`,{clientMessageId:randomUUID(),text:'시발 검증'},201);const at=performance.now();await page.getByLabel('채팅 검색',{exact:true}).fill('부하 확인');await page.getByLabel('채팅 검색',{exact:true}).fill('');uiLatencies.push(performance.now()-at);}
  await waveWork;
 }
 await sleep(Math.max(0,sustainedStart+seconds*1000-performance.now()));const sustainedElapsed=performance.now()-sustainedStart;
 await until(()=>subscribers.every(s=>[...phaseMessages.keys()].every(id=>s.received.has(id))),'all_sse_delivery',30000);
 if(privateDuringLoad){await until(()=>subscribers[participants-1].received.has(privateDuringLoad.messageId),'private_author_delivery');check('hidden_during_load_only_delivered_to_author',subscribers.every((s,i)=>i===participants-1||!s.received.has(privateDuringLoad.messageId)));}
 const finalId=[...phaseMessages.keys()].at(-1);await page.locator(`[data-message-id="${finalId}"]`).waitFor();
 const receiveLatencies=subscribers.flatMap(s=>[...phaseMessages].map(([id,start])=>s.received.get(id)-start));
 const telemetry=await page.evaluate(()=>window.evalMetrics);
 report.performance={burst:{messages:participants,completionMs:burstElapsed},sustained:{messages:rate*seconds,requestedRate:rate,completionMs:sustainedElapsed,observedCompletionRate:rate*seconds/(sustainedElapsed/1000)},postLatencyMs:summary(sendLatencies),sseDeliveryMs:summary(receiveLatencies),frameIntervalMs:summary(telemetry.frames),longTaskMs:summary(telemetry.longTasks),driverSearchAndClearMs:summary(uiLatencies),heap:{beforeBytes:heapBefore,afterBytes:await heap(),note:'no forced GC; short run only'},browserApiRequests:requests,receivedPerSubscriber:subscribers.map(s=>[...phaseMessages.keys()].filter(id=>s.received.has(id)).length),duplicateEvents:subscribers.reduce((n,s)=>n+s.duplicates,0),allSubscribersReceived:true,thresholds:'baseline only; no agreed production SLO'};
 check('browser_remains_operable_and_latest_message_visible',errors.length===0);
 check('stored_phase_messages_match_unique_accepted_messages',Number(sql(`SELECT count(*) FROM platform.messages WHERE live_id='${liveA.liveId}' AND text LIKE '부하 확인 ${corpusRun} %';`))===phaseMessages.size);
 check('phase_public_corpus_created_no_guard_cases',Number(sql(`SELECT count(*) FROM platform.messages WHERE live_id='${liveA.liveId}' AND text LIKE '부하 확인 ${corpusRun} %' AND case_id IS NOT NULL;`))===0);
 const blocked=await api(clients[0],'POST',`/api/lives/${liveA.liveId}/messages`,{clientMessageId:randomUUID(),text:`시발 재확인 ${run}`},201);
 await denied(clients[0],'POST',`/api/lives/${liveA.liveId}/messages`,{clientMessageId:randomUUID(),text:`제한 중 전송 ${run}`},403);
 check('second_profanity_has_timeout',!!(blocked.timeoutUntil||(await api(clients[0],'GET',`/api/lives/${liveA.liveId}/messages`)).timeoutUntil));
 const staleCookie=(await clients[1].storageState()).cookies.map(v=>`${v.name}=${v.value}`).join('; ');
 await api(clients[1],'POST','/api/auth/logout',undefined,204);await until(()=>subscribers[1].closed,'logout_closes_sse',10000);
 await denied(clients[1],'GET','/api/auth/me',undefined,401);
 response=await fetch(`${base}/api/auth/me`,{headers:{Cookie:staleCookie}});check('logged_out_session_cannot_be_reused',response.status===401);
 const oldLiveId=liveA.liveId;await api(hostA,'POST',`/api/lives/${liveA.liveId}/end`);await denied(clients[0],'POST',`/api/lives/${liveA.liveId}/messages`,{clientMessageId:randomUUID(),text:'종료 후 전송'},409);
 const next=await api(hostA,'POST',`/api/channels/${channelA}/lives`,undefined,201);liveA=next;
 check('new_live_has_distinct_id_and_empty_history',next.liveId!==oldLiveId&&(await api(clients[0],'GET',`/api/lives/${next.liveId}/messages`)).items.length===0);
 await api(clients[0],'POST',`/api/lives/${next.liveId}/messages`,{clientMessageId:randomUUID(),text:'시발 새 방송 확인'},201);
 await api(clients[0],'POST',`/api/lives/${next.liveId}/messages`,{clientMessageId:randomUUID(),text:'새 방송 정상 확인'},201);check('timeout_and_category_history_not_inherited_to_new_live',true);
 report.result='completed-observed-baseline';
}catch(error){report.deliveryDiagnostics={accepted:phaseMessages.size,received:subscribers.map(s=>({received:[...phaseMessages.keys()].filter(id=>s.received.has(id)).length,allReceived:s.received.size,duplicates:s.duplicates,closed:s.closed,error:s.error})),stored:liveA?Number(sql(`SELECT count(*) FROM platform.messages WHERE live_id='${liveA.liveId}' AND text LIKE '부하 확인 ${corpusRun} %';`)):0};report.result='failed';report.failure={name:error.name,message:error.message};process.exitCode=1;}
finally{
 for(const s of streams)s.controller.abort();await Promise.allSettled(streams.map(s=>s.done));await browser?.close();await server?.close();
 for(const [host,live] of [[hostA,liveA],[hostB,liveB]])if(host&&live)await api(host,'POST',`/api/lives/${live.liveId}/end`).catch(()=>{});
 await Promise.allSettled(contexts.map(c=>c.dispose()));report.finishedAt=iso();
 const directory=path.resolve(root,'docs/evidence/local-evaluation');await mkdir(directory,{recursive:true});const file=path.join(directory,`${run}.json`);await writeFile(file,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({run,result:report.result,checks:report.checks.length,passed:report.checks.filter(c=>c.pass).length,report:file,failure:report.failure,performance:report.performance?{messages:report.performance.postLatencyMs.count,p95PostMs:report.performance.postLatencyMs.p95,p95SseMs:report.performance.sseDeliveryMs.p95}:undefined}));
}
