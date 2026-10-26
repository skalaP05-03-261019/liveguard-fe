// Frontend acceptance measurements against deterministic HTTP/SSE fixtures.
// No model, shared database, credentials, or real moderation actions are used.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const quick = process.argv.includes('--quick');
const root = path.resolve(__dirname, '..');
const output = process.env.PERF_SUITE_OUTPUT || path.join(root, 'docs/evidence/performance/recheck-2026-10-26/frontend-suite.json');
const results = { status: 'running', startedAt: new Date().toISOString(), quick,
  scope: 'production frontend with deterministic HTTP/SSE fixtures; no backend capacity or AI evaluation',
  environment: { hostname: os.hostname(), platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: +(os.totalmem()/2**30).toFixed(2), node: process.version,
    commit: execFileSync('git', ['rev-parse','HEAD'], {cwd:root,encoding:'utf8'}).trim(), workingTree: execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}).trim() }, tc: {}, heapSamples: [], errors: [] };
const save = () => { fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n'); };
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const percentile = (values,p) => values.length ? +[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1].toFixed(2) : null;
const clients = new Set();
let messages=[],reviews=[],cases=[],eventId=0,sequence=0,decisionRequests=[],denyStreams=false,dist,browser,server;
const now=()=>new Date().toISOString();
const makeMessage=(id,visibility='PUBLIC')=>({messageId:id,channelId:'channel-1',liveId:'live-1',authorAlias:'시연 시청자',text:`성능 확인 ${id}`,visibility,version:1,sentAt:now(),isMine:false});
function emit(event,payload){const id=String(++eventId);for(const c of clients){if(c.res.writableEnded||c.res.destroyed)continue;if((event==='CHAT'||event.startsWith('MESSAGE_'))&&c.guard)continue;if(event==='KICK_REVIEW_REQUIRED'&&!c.guard)continue;c.res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify({eventId:id,occurredAt:now(),entityVersion:payload.version,payload})}\n\n`);}}
function addMessage(prefix){const m=makeMessage(`${prefix}-${++sequence}`);messages.push(m);if(messages.length>1200)messages.splice(0,messages.length-1200);emit('CHAT',{messageId:m.messageId,version:1});return m;}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4'};
async function serve(req,res){
 const url=new URL(req.url,'http://fixture'),role=req.headers['x-test-role']||'viewer';
 const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(status<400?{data,traceId:'perf'}:{error:data,traceId:'perf'}));};
 if(url.pathname==='/api/auth/me')return json({userId:role,nickname:role,role:role==='operator'?'MODERATOR':role==='admin'?'PLATFORM_ADMIN':'VIEWER',channelIds:role==='admin'?[]:['channel-1']});
 if(url.pathname.endsWith('/lives/current'))return json({liveId:'live-1',channelId:'channel-1',startedAt:results.startedAt,endedAt:null});
 if(url.pathname.endsWith('/events')){
  if(denyStreams)return json({code:'TEMPORARY_UNAVAILABLE',message:'Controlled interruption',retryable:true},503);
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(': connected\n\n');
  const c={res,role,guard:url.pathname.includes('/guard/')};clients.add(c);req.on('close',()=>clients.delete(c));return;
 }
 if(url.pathname.endsWith('/messages'))return json({items:messages.filter(m=>role==='operator'||m.visibility==='PUBLIC').slice(-200).reverse(),nextCursor:null,timeoutUntil:null});
 if(url.pathname==='/api/reviews')return json(reviews.filter(r=>r.kind===url.searchParams.get('kind')));
 if(url.pathname==='/api/cases')return json(cases);
 if(req.method==='POST'&&/^\/api\/kick-reviews\/[^/]+\/decision$/.test(url.pathname)){
  let body='';for await(const chunk of req)body+=chunk;
  const review=reviews.find(r=>url.pathname.includes(r.reviewId));const value=JSON.parse(body);
  decisionRequests.push({reviewId:review?.reviewId,...value});await sleep(120);
  if(review){review.status='DECIDED';review.version++;}
  return json({decisionId:`d-${decisionRequests.length}`,reviewId:review?.reviewId,kind:'KICK',value:value.decision,operatorId:'operator',decidedAt:now()},202);
 }
 if(url.pathname.startsWith('/api/'))return json({code:'NOT_FOUND',message:url.pathname,retryable:false},404);
 const candidate=path.resolve(dist,'.'+decodeURIComponent(url.pathname));
 const file=candidate.startsWith(dist+path.sep)&&fs.existsSync(candidate)&&fs.statSync(candidate).isFile()?candidate:path.join(dist,'index.html');
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
}
function instrumentation(){
 const state=window.__measurement={received:new Map(),dom:[],frame:[],frames:[],longTasks:[],observed:0,visibility:[],enabled:false};
 const Native=window.EventSource;
 window.EventSource=class extends Native{constructor(...args){super(...args);for(const type of ['CHAT','MESSAGE_VISIBILITY_CHANGED'])this.addEventListener(type,e=>{if(!state.enabled)return;const v=JSON.parse(e.data),p=v.payload;state.received.set(p.messageId,{at:performance.now(),type,visibility:p.visibility});});}};
 let queued=false;
 const scan=()=>{if(!state.enabled||queued)return;queued=true;queueMicrotask(()=>{
  queued=false;const at=performance.now();const seen=new Map([...document.querySelectorAll('[data-message-id]')].map(el=>[el.dataset.messageId,el]));
  for(const [id,event] of state.received){const row=seen.get(id),isOperator=!!document.querySelector('.studio-shell');
   const correct=event.type==='CHAT'?!!row:isOperator?!!row&&(row.classList.contains('held')||row.classList.contains('hidden')):!row;
   if(!correct)continue;state.received.delete(id);state.observed++;state.dom.push(at-event.at);
   requestAnimationFrame(()=>{state.frame.push(performance.now()-event.at);});
  }
 });};
 new MutationObserver(scan).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
 let last=performance.now();const frame=t=>{if(state.enabled){state.frames.push(t-last);if(state.frames.length>25000)state.frames.splice(0,5000);}last=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);
 new PerformanceObserver(list=>{if(state.enabled)state.longTasks.push(...list.getEntries().map(e=>e.duration));}).observe({type:'longtask',buffered:true});
 window.__webVitals={lcp:[],cls:0,events:[]};
 new PerformanceObserver(list=>window.__webVitals.lcp.push(...list.getEntries().map(e=>e.startTime))).observe({type:'largest-contentful-paint',buffered:true});
 new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.__webVitals.cls+=e.value;}).observe({type:'layout-shift',buffered:true});
 try{new PerformanceObserver(list=>{window.__webVitals.events.push(...list.getEntries().filter(e=>e.interactionId).map(e=>({id:e.interactionId,duration:e.duration,name:e.name})));}).observe({type:'event',durationThreshold:16,buffered:true});}catch{}
}
async function newPage(role,viewport={width:1440,height:900}){
 const ctx=await browser.newContext({viewport,timezoneId:'Asia/Seoul',extraHTTPHeaders:{'x-test-role':role},reducedMotion:'reduce'});const p=await ctx.newPage();p.on('pageerror',e=>results.errors.push(e.message));await p.addInitScript(instrumentation);await p.goto(`http://127.0.0.1:${server.address().port}`);await p.locator(role==='operator'?'.studio-shell':role==='admin'?'.sys-shell':'.viewer-shell').waitFor({timeout:15000});return p;
}
async function reset(p){await p.evaluate(()=>{const s=window.__measurement;s.received.clear();s.dom=[];s.frame=[];s.frames=[];s.longTasks=[];s.observed=0;s.enabled=true;});}
async function read(p){return p.evaluate(()=>{const s=window.__measurement;s.enabled=false;return{observed:s.observed,pending:s.received.size,dom:s.dom,frame:s.frame,frames:s.frames,longTasks:s.longTasks,ids:[...document.querySelectorAll('.chat-list .chat-row[data-message-id],.yt-chat-items .yt-chat-row[data-message-id]')].map(e=>e.dataset.messageId)};});}
async function measureHeap(p){const cdp=await p.context().newCDPSession(p);await cdp.send('HeapProfiler.collectGarbage');const h=await cdp.send('Runtime.getHeapUsage');const counters=await cdp.send('Memory.getDOMCounters');await cdp.detach();return{heapMiB:+(h.usedSize/2**20).toFixed(2),...counters};}
function summary(d){return{observed:d.observed,pending:d.pending,domP95Ms:percentile(d.dom,.95),nextFrameP95Ms:percentile(d.frame,.95),frameGapP95Ms:percentile(d.frames,.95),longTasksOver50ms:d.longTasks.filter(x=>x>=50).length,rows:d.ids.length,duplicates:d.ids.length-new Set(d.ids).size};}
async function stream(pages,rate,durationMs,prefix){
 const cpu=await Promise.all(pages.map(async p=>{const c=await p.context().newCDPSession(p);await c.send('Performance.enable');const before=(await c.send('Performance.getMetrics')).metrics.find(m=>m.name==='TaskDuration').value;return{c,before};}));
 await Promise.all(pages.map(reset));const start=Date.now();let emitted=0;
 while(Date.now()-start<durationMs){const target=Math.min(Math.round(rate*durationMs/1000),Math.floor((Date.now()-start)*rate/1000));while(emitted<target){addMessage(prefix);emitted++;}await sleep(5);}
 const total=Math.round(rate*durationMs/1000);while(emitted<total){addMessage(prefix);emitted++;}await sleep(400);
 const data=await Promise.all(pages.map(read));const busy=await Promise.all(cpu.map(async({c,before})=>{const after=(await c.send('Performance.getMetrics')).metrics.find(m=>m.name==='TaskDuration').value;await c.detach();return +((after-before)*100000/(Date.now()-start)).toFixed(2);}));return{rate,durationMs,emitted,screens:data.map((d,i)=>({role:i?'viewer':'operator',...summary(d),mainThreadBusyPercent:busy[i],latestWindowMatches:JSON.stringify(d.ids)===JSON.stringify(messages.filter(m=>i?m.visibility==='PUBLIC':true).slice(-(i?80:200)).map(m=>m.messageId))})),pass:data.every((d,i)=>d.observed===emitted&&d.ids.length===new Set(d.ids).size&&percentile(d.frame,.95)<=100&&JSON.stringify(d.ids)===JSON.stringify(messages.slice(-(i?80:200)).map(m=>m.messageId)))};
}
async function statusTest(pages){
 messages=Array.from({length:1000},(_,i)=>makeMessage(`status-${i}`));emit('CHAT',{messageId:'status-999',version:1});await sleep(350);await Promise.all(pages.map(reset));
 for(const m of messages.slice(-200)){m.visibility='HELD';m.version=2;emit('MESSAGE_VISIBILITY_CHANGED',{messageId:m.messageId,visibility:'HELD',version:2});}
 await sleep(700);const data=await Promise.all(pages.map(read));const rows=await pages[0].locator('.chat-list .chat-row.held').count();const leaked=await pages[1].locator('[data-message-id^="status-"]').evaluateAll(els=>els.filter(e=>Number(e.dataset.messageId.split('-')[1])>=800).length);
 return{messages:1000,changed:200,heldRows:rows,privateRowsVisibleToOtherViewer:leaked,screens:data.map(summary),pass:rows===200&&leaked===0&&data.every(d=>percentile(d.frame,.95)<=100)};
}
async function decisionTest(operator){
 messages=[1,2,3].map(n=>makeMessage(`basis-${n}`,'HIDDEN'));cases=messages.map((m,i)=>({caseId:`case-${i}`,liveId:'live-1',version:2,confirmationStatus:'CONFIRMED_VIOLATION',handlingRoute:'RULE_CONFIRMED',messages:[m],targetMessageIds:[m.messageId],confirmedFindings:[{findingId:`f-${i}`,category:'PROFANITY',status:'CONFIRMED',confirmedAt:now(),revokedAt:null}],findings:[],createdAt:now(),violationCount:i+1}));
 const timings=[],duplicates=[];decisionRequests=[];
 for(let i=0;i<(quick?3:50);i++){
  const id=`perf-review-${i}`;reviews=[{reviewId:id,kind:'KICK',liveId:'live-1',caseId:'case-2',status:'PENDING',version:1,createdAt:now(),messages:[],targetMessageIds:['basis-3'],findings:[],basisCaseIds:cases.map(c=>c.caseId),summary:'성능 시험 고정 검토'}];emit('KICK_REVIEW_REQUIRED',{reviewId:id,caseId:'case-2',version:1});
  const card=operator.locator(`[data-review-id="${id}"]`);await card.waitFor();if(!await card.locator('.review-body').count())await card.locator('.review-head').click();await card.getByRole('radio',{name:i%2?'강퇴 기각':'강퇴 승인',exact:true}).check();
  await card.getByRole('button',{name:'제출',exact:true}).evaluate(button=>{
   window.__clickFeedback=null;button.addEventListener('click',()=>{const t=performance.now();const observer=new MutationObserver(()=>{if(button.disabled){requestAnimationFrame(()=>{window.__clickFeedback=performance.now()-t;observer.disconnect();});}});observer.observe(document,{subtree:true,attributes:true,attributeFilter:['disabled']});},{once:true});
  });
  const button=card.getByRole('button',{name:'제출',exact:true});await button.click();
  await operator.waitForFunction(()=>window.__clickFeedback!==null);timings.push(await operator.evaluate(()=>window.__clickFeedback));await card.waitFor({state:'detached'});duplicates.push(decisionRequests.filter(r=>r.reviewId===id).length);
 }
 reviews=[];return{requests:decisionRequests.length,interactions:timings.length,clickToDisabledNextFrameP95Ms:percentile(timings,.95),duplicateRequests:duplicates.filter(n=>n!==1).length,pass:duplicates.every(n=>n===1)&&percentile(timings,.95)<=200};
}
async function reconnectTest(pages){const rounds=[];
 for(let n=0;n<3;n++){
  denyStreams=true;for(const c of [...clients])c.res.end();const disconnected=Date.now();
  const end=Date.now()+(quick?300:10000);while(Date.now()<end){addMessage(`offline-${n}`);await sleep(100);}
  denyStreams=false;const enabled=Date.now();
  const latest=messages.at(-1).messageId;await Promise.all(pages.map(p=>p.locator(`[data-message-id="${latest}"]`).waitFor({timeout:20000})));await sleep(200);
  const data=await Promise.all(pages.map(read));const matches=data.map((d,i)=>JSON.stringify(d.ids)===JSON.stringify(messages.filter(m=>i?m.visibility==='PUBLIC':true).slice(-(i?80:200)).map(m=>m.messageId)));
  rounds.push({offlineMs:enabled-disconnected,recoveryMs:Date.now()-enabled,matches,duplicates:data.map(d=>d.ids.length-new Set(d.ids).size)});
 }
 return{rounds,criterion:'recovery <=10s after service restored; exact latest window and no duplicates',pass:rounds.every(r=>r.recoveryMs<=10000&&r.matches.every(Boolean)&&r.duplicates.every(x=>x===0))};}
async function vitalsTest(){const rows=[];
 for(const role of ['viewer','operator','admin'])for(const viewport of [{width:1440,height:900},{width:390,height:844}])for(let n=0;n<(quick?1:3);n++){
  const p=await newPage(role,viewport);
  for(const navigation of ['cold','revisit']){
   if(navigation==='revisit'){await p.reload();await p.locator(role==='operator'?'.studio-shell':role==='admin'?'.sys-shell':'.viewer-shell').waitFor();}
   await sleep(350);const search=p.getByRole('button',{name:'계정 메뉴',exact:true});await search.click();await sleep(100);await p.keyboard.press('Escape');
   const v=await p.evaluate(()=>{const v=window.__webVitals;return{lcpMs:v.lcp.at(-1)??null,cls:v.cls,eventTiming:v.events,interactionUpperBoundMs:Math.max(16,...v.events.map(e=>e.duration)),overflow:document.documentElement.scrollWidth>innerWidth};});rows.push({role,viewport,trial:n+1,navigation,...v});
  }await p.context().close();
 }return{method:'laboratory LCP/CLS and Event Timing (durationThreshold=16ms); interaction worst case over these gestures, not field INP or field p75',rows,pass:rows.every(r=>r.lcpMs!==null&&r.lcpMs<=2500&&r.cls<=.1&&!r.overflow&&r.interactionUpperBoundMs<=200)};}
(async()=>{
 save();const {build}=await import('vite');dist=fs.mkdtempSync(path.join(os.tmpdir(),'liveguard-fe-perf-'));await build({root,define:{'import.meta.env.VITE_USE_API':'"true"','import.meta.env.VITE_API_BASE_URL':'""'},build:{outDir:dist,emptyOutDir:true},logLevel:'error'});
 server=http.createServer((req,res)=>serve(req,res).catch(e=>{results.errors.push(e.message);res.end();}));await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true});results.environment.browser=browser.version();
 const operator=await newPage('operator'),viewer=await newPage('viewer'),pages=[operator,viewer];
 results.tc['TC-03']=await statusTest(pages);save();console.log('TC-03',JSON.stringify(results.tc['TC-03']));await operator.screenshot({path:path.join(path.dirname(output),'tc03-operator.png'),fullPage:true});
 results.tc['TC-04']=await decisionTest(operator);save();console.log('TC-04',JSON.stringify(results.tc['TC-04']));
 results.tc['TC-06']=await reconnectTest(pages);save();console.log('TC-06',JSON.stringify(results.tc['TC-06']));
 await Promise.all(pages.map(p=>p.context().close()));results.tc['TC-07']=await vitalsTest();save();console.log('TC-07',results.tc['TC-07'].pass);
 // Stable two-page workload: TC-01/02 are also the first ten minutes of TC-05.
 messages=[];cases=[];reviews=[];const active=[await newPage('operator'),await newPage('viewer')];const soakStart=Date.now();
 const sample=async(label)=>{results.heapSamples.push({label,elapsedMs:Date.now()-soakStart,operator:await measureHeap(active[0]),viewer:await measureHeap(active[1])});save();console.log('heap',JSON.stringify(results.heapSamples.at(-1)));};await sample('start');
 results.tc['TC-01']=await stream(active,10,quick?2000:300000,'normal');save();console.log('TC-01',JSON.stringify(results.tc['TC-01']));
 results.tc['TC-02']=await stream(active,100,quick?2000:300000,'burst');save();console.log('TC-02',JSON.stringify(results.tc['TC-02']));
 const soakMs=quick?6000:3600000;let nextSample=quick?0:900000;
 while(Date.now()-soakStart<soakMs){await stream(active,10,Math.min(quick?1000:60000,soakMs-(Date.now()-soakStart)),'soak');if(Date.now()-soakStart>=nextSample){await sample('interval');nextSample+=900000;}}
 await sample('end');const samples=results.heapSamples;const warm=samples.filter(x=>x.elapsedMs>=(quick?0:900000));const first=warm[0],last=warm.at(-1);const growth={operator:last.operator.heapMiB-first.operator.heapMiB,viewer:last.viewer.heapMiB-first.viewer.heapMiB};
 const finalRows=await Promise.all(active.map(p=>p.locator('.chat-list .chat-row,.yt-chat-items .yt-chat-row').count()));
 results.tc['TC-05']={elapsedMs:Date.now()-soakStart,samples:samples.length,growthAfterWarmupMiB:growth,finalRows,criterion:'after 15min warmup: heap increase <=5 MiB per screen, bounded 200/80 chat rows, no browser errors; trend also reported',pass:growth.operator<=5&&growth.viewer<=5&&finalRows[0]<=200&&finalRows[1]<=80&&results.errors.length===0};results.status=quick?'quick-validation-complete':'completed';results.completedAt=now();save();await active[0].screenshot({path:path.join(path.dirname(output),'tc05-final-operator.png'),fullPage:true});console.log('COMPLETE',output);
 if(!quick&&Object.values(results.tc).some(item=>!item.pass))process.exitCode=1;
})().catch(e=>{results.status='failed';results.failure=e.stack;save();console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();for(const c of clients)c.res.end();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));});
