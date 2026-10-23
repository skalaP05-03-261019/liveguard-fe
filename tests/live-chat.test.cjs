// Browser regressions with an isolated HTTP/SSE fixture. No shared DB or model calls.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');

let browser,vite,mockVite,server,base,mockBase,state;
const contexts=[],clients=new Set(),runtimeErrors=[];
let eventId=0;
const evidence=process.env.CHAT_EVIDENCE_DIR;
const timestamp=()=>new Date().toISOString();
const message=(id,owner,visibility='PUBLIC',extra={})=>({messageId:id,channelId:'channel-1',liveId:'live-1',authorAlias:owner,text:`${id} 원문`,visibility,version:1,sentAt:timestamp(),owner,...extra});
function emit(event,payload={}){
 for(const client of clients){
  if(event==='LIVE_ACCESS_BLOCKED'&&client.role!=='author')continue;
  client.res.write(`id: ${++eventId}\nevent: ${event}\ndata: ${JSON.stringify({eventId:String(eventId),occurredAt:timestamp(),payload})}\n\n`);
 }
}
async function open(role='author',clockTime){
 const context=await browser.newContext({extraHTTPHeaders:{'x-test-role':role},viewport:{width:1280,height:1000},timezoneId:'Asia/Seoul'});contexts.push(context);
 const page=await context.newPage();page.on('pageerror',e=>runtimeErrors.push(e.message));
 if(clockTime)await page.clock.install({time:new Date(clockTime)});
 await page.goto(base);await page.locator('.v1-shell, .viewer-shell, .app-shell').waitFor();
 return page;
}
async function openMock(options={}){
 const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Seoul',...options});contexts.push(context);
 const page=await context.newPage();page.on('pageerror',e=>runtimeErrors.push(e.message));
 const time=new Date('2026-10-22T05:14:50Z');
 await page.clock.install({time});await page.clock.pauseAt(time);
 await page.goto(mockBase);
 await page.getByRole('button',{name:'시청자로 시작하기',exact:true}).click();
 await page.getByRole('button',{name:'로그인',exact:true}).click();
 await page.locator('.viewer-shell').waitFor();
 return page;
}
async function openMockModerator(){
 const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Seoul'});contexts.push(context);
 const page=await context.newPage();page.on('pageerror',e=>runtimeErrors.push(e.message));
 const time=new Date('2026-10-22T05:14:50Z');await page.clock.install({time});await page.clock.pauseAt(time);
 await page.goto(mockBase);await page.getByRole('button',{name:'스트리머로 시작하기',exact:true}).click();
 await page.getByRole('button',{name:'로그인',exact:true}).click();await page.locator('.app-shell').waitFor();
 return page;
}
async function sendMock(page,text){
 await page.getByLabel('채팅 메시지',{exact:true}).fill(text);
 await page.getByRole('button',{name:'채팅 전송',exact:true}).click();
}
async function assertTimeoutComposer(page){
 const dialog=page.getByRole('dialog',{name:'채팅 제한 안내',exact:true});await dialog.waitFor();
 assert.equal(await dialog.locator('.chat-timeout-notice').isVisible(),true);
 const list=page.locator('.yt-chat-items');
 assert.equal(await list.isVisible(),true);
 assert.equal(await page.locator('.yt-chat-header').isVisible(),true);
 assert.equal(await page.locator('.yt-compose').count(),0);
 assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).count(),0);
 assert.equal(await page.getByLabel('채팅 검색',{exact:true}).isEnabled(),true);
 const rows=await list.boundingBox(),restriction=await dialog.boundingBox();
 assert(rows.height>=120,'Chat stays tall enough to read during a timeout');
 assert(rows.y+rows.height<=restriction.y+1,'Restriction stays below the messages');
 assert.equal(await page.locator('.yt-player-area video').count(),1);
}
async function waitFor(check){
 const end=Date.now()+10000;
 while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,50));}
 assert.fail('Timed out waiting for browser state');
}
async function capture(page,name){if(evidence){await fs.mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,`${name}.png`),fullPage:true,animations:'disabled'});}}
before(async()=>{
 server=http.createServer(async(req,res)=>{
  const role=req.headers['x-test-role']||'author',url=new URL(req.url,'http://fixture');
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(status<400?{data,traceId:'test-trace'}:{error:data,traceId:'test-trace'}));};
  if(url.pathname==='/api/auth/me'&&state.authError)return json(401,{code:'UNAUTHENTICATED',message:'Session expired',retryable:false});
  if(url.pathname==='/api/auth/me')return json(200,{userId:role,nickname:role,role:role==='operator'?'MODERATOR':'VIEWER',channelIds:['channel-1']});
  if(url.pathname.endsWith('/lives/current')){
   state.currentReads++;const current=state.active?{liveId:state.liveId,channelId:'channel-1',startedAt:timestamp(),endedAt:null}:null;
   if(state.delayCurrent)await new Promise(r=>setTimeout(r,state.delayCurrent));
   return current?json(200,current):json(404,{code:'NOT_FOUND',message:'No live',retryable:false});
  }
  if(url.pathname.endsWith('/events')){
   if(state.kicked.has(role))return json(403,{code:'KICKED',message:'Access blocked',retryable:false});
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(': connected\n\n');
   const client={res,role};clients.add(client);req.on('close',()=>clients.delete(client));return;
  }
  if(url.pathname.endsWith('/messages')){
   if(req.method==='POST'){
    state.posts++;
    if(state.postError){if(state.postError.code==='KICKED')state.kicked.add(role);return json(403,state.postError);}
    let body='';for await(const chunk of req)body+=chunk;
    const sent=message('sent-'+state.posts,role,'PUBLIC',{text:JSON.parse(body).text});state.messages.push(sent);return json(201,{...sent,isMine:true});
   }
   if(state.kicked.has(role))return json(403,{code:'KICKED',message:'Access blocked',retryable:false});
   if(state.historyError)return json(503,{code:'TEMPORARY_UNAVAILABLE',message:'Retry later',retryable:true});
   const items=state.messages.filter(m=>state.leak||role==='operator'||m.visibility==='PUBLIC'||m.owner===role).map(({owner,...m})=>({...m,isMine:owner===role,...(owner===role?{}:{moderationNotice:null,moderationReasonCode:null,reviewStatus:null,timeoutUntil:null})})).reverse();
   const page={items,nextCursor:null,timeoutUntil:state.until[role]??null};
   state.historyReads.push({role,page});
   // Capture the old response before a new visibility event, to exercise stale-response races.
   if(state.delayHistory){await new Promise(r=>setTimeout(r,state.delayHistory));}
   return json(200,page);
  }
  if(url.pathname==='/api/reviews')return json(200,state.reviews.filter(r=>r.kind===url.searchParams.get('kind')));
  if(url.pathname==='/api/cases')return json(200,state.cases);
  if(req.method==='POST'&&/^\/api\/(context|kick)-reviews\/[^/]+\/decision$/.test(url.pathname)){
   let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);
   const review=state.reviews.find(r=>url.pathname.includes(r.reviewId));
   // Backend처럼 검토 버전이 다르면 거부한다. 보류는 같은 검토를 PENDING으로 남기고 버전만 올린다.
   if(review&&value.expectedReviewVersion!==review.version)return json(409,{code:'STALE_VERSION',message:'Review version changed',retryable:false});
   state.decisions.push({path:url.pathname,body:value});
   if(review){review.version++;if(value.decision!=='DEFER')review.status='DECIDED';}
   return json(202,{decisionId:'decision-'+state.decisions.length,reviewId:review?.reviewId,kind:review?.kind,value:value.decision,operatorId:'operator',decidedAt:timestamp()});
  }
  json(404,{code:'NOT_FOUND',message:url.pathname,retryable:false});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 process.env.VITE_USE_API='true';process.env.VITE_API_BASE_URL='';process.env.VITE_BACKEND_TARGET=`http://127.0.0.1:${server.address().port}`;
 const {createServer}=await import('vite');
 vite=await createServer({root:path.resolve(__dirname,'..'),server:{host:'127.0.0.1',port:0},logLevel:'error'});await vite.listen();
 base=`http://127.0.0.1:${vite.httpServer.address().port}`;
 mockVite=await createServer({root:path.resolve(__dirname,'..'),define:{'import.meta.env.VITE_USE_API':'"false"'},server:{host:'127.0.0.1',port:0},logLevel:'error'});await mockVite.listen();
 mockBase=`http://127.0.0.1:${mockVite.httpServer.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
});
beforeEach(()=>{state={active:true,liveId:'live-1',messages:[],until:{},kicked:new Set(),posts:0,historyReads:[],currentReads:0,postError:null,historyError:false,leak:false,delayHistory:0,delayCurrent:0,reviews:[],cases:[],decisions:[]};runtimeErrors.length=0;});
afterEach(async()=>{await Promise.all(contexts.splice(0).map(c=>c.close()));assert.deepEqual(runtimeErrors,[]);});
after(async()=>{await browser?.close();await mockVite?.close();await vite?.close();for(const c of clients)c.res.end();server?.closeAllConnections();await new Promise(r=>server?server.close(r):r());});

test('author sees reasons and review state; observer receives no private text; operator sees private messages',async()=>{
 state.messages=[message('normal','observer'),message('held','author','HELD',{moderationNotice:'문맥 확인을 기다립니다.',reviewStatus:'PENDING'}),message('hidden','author','HIDDEN',{moderationReasonCode:'LINK_NOT_ALLOWED'})];
 const author=await open();await author.getByText('문맥 확인을 기다립니다.',{exact:true}).waitFor();await author.getByText('검토 중',{exact:true}).waitFor();await author.getByText('이 방송에서는 링크 전송이 금지되어 있습니다.',{exact:true}).waitFor();
 const observer=await open('observer');await observer.getByText('normal 원문',{exact:true}).waitFor();assert.equal(await observer.locator('[data-message-id="held"]').count(),0);assert.equal(await observer.locator('[data-message-id="hidden"]').count(),0);
 assert(state.historyReads.filter(r=>r.role==='observer').every(r=>r.page.items.every(m=>m.visibility==='PUBLIC'||m.isMine)));
 const operator=await open('operator');await operator.locator('[data-message-id="held"]').waitFor();await operator.locator('[data-message-id="hidden"]').waitFor();
 await capture(author,'author-held-hidden');await capture(observer,'observer-isolated');await capture(operator,'operator-private-messages');
});

test('author notices use policy wording per reason code and no per-message restriction note',async()=>{
 const until=new Date(Date.now()+600000).toISOString(),combined='금지된 욕설 또는 링크가 포함되어 숨김 처리되었습니다.';
 state.until.author=until;
 // 현재 Backend처럼 욕설·링크에 같은 문장을 보내고, timeoutUntil은 요청자의 현재 제한을 모든 본인 메시지에 싣는다.
 state.messages=[
  message('profanity','author','HIDDEN',{moderationReasonCode:'PROFANITY_INCLUDED',moderationNotice:combined,timeoutUntil:until}),
  message('link','author','HIDDEN',{moderationReasonCode:'LINK_NOT_ALLOWED',moderationNotice:combined,timeoutUntil:until}),
  message('context','author','HIDDEN',{moderationReasonCode:'CONTEXT_PENDING',moderationNotice:'운영자 검토로 위반이 확정되어 숨김 처리되었습니다.',timeoutUntil:until})];
 const page=await open();
 const reason=id=>page.locator(`[data-message-id="${id}"] .yt-chat-reason`);
 await reason('link').waitFor();
 assert.equal(await reason('profanity').innerText(),'메시지에 금지된 욕설이 포함되어 숨김 처리되었습니다.');
 assert.equal(await reason('link').innerText(),'이 방송에서는 링크 전송이 금지되어 있습니다.');
 assert.equal(await reason('context').innerText(),'운영자 검토로 위반이 확정되어 숨김 처리되었습니다.');
 assert.equal(await page.locator('.yt-chat-items').getByText('채팅 제한',{exact:false}).count(),0);
 await page.locator('.chat-timeout-notice').waitFor();
});

test('defensive rendering excludes other viewers private messages even from a malformed response',async()=>{
 state.leak=true;state.messages=[message('private','observer','HIDDEN'),message('public','observer')];
 const page=await open();await page.getByText('public 원문',{exact:true}).waitFor();assert.equal(await page.locator('[data-message-id="private"]').count(),0);
});

test('visibility event removes cached public text even when refresh fails, restoration comes from server',async()=>{
 state.messages=[message('changing','author')];const page=await open('observer');await page.getByText('changing 원문',{exact:true}).waitFor();
 await waitFor(()=>clients.size>0);state.messages[0].visibility='HELD';state.historyError=true;emit('MESSAGE_VISIBILITY_CHANGED',{messageId:'changing',visibility:'HELD',version:2});
 await waitFor(async()=>await page.getByText('changing 원문',{exact:true}).count()===0);
 state.historyError=false;state.messages[0].visibility='PUBLIC';emit('MESSAGE_RESTORED',{messageId:'changing',visibility:'PUBLIC',version:3});await page.getByText('changing 원문',{exact:true}).waitFor();
});

test('timeout is restored without own messages, keeps video and clears after server revocation',async()=>{
 state.until.author=new Date(Date.now()+600000).toISOString();state.messages=[message('other','observer')];
 const page=await open();await page.getByText('채팅이 일시 제한되었습니다',{exact:true}).waitFor();await assertTimeoutComposer(page);
 await page.reload();await page.getByText('채팅이 일시 제한되었습니다',{exact:true}).waitFor();await capture(page,'timeout-restored');
 state.until.author=null;emit('MESSAGE_RESTORED',{messageId:'other',visibility:'PUBLIC',version:2});await waitFor(async()=>await page.getByLabel('채팅 메시지',{exact:true}).isEnabled());
 await page.getByLabel('채팅 메시지',{exact:true}).fill('복구 후 전송');await page.getByRole('button',{name:'채팅 전송',exact:true}).click();await waitFor(()=>state.posts===1);
});

test('TIMED_OUT response disables repeated sends and input recovers at expiry',async()=>{
 const page=await open();await waitFor(async()=>await page.getByLabel('채팅 메시지',{exact:true}).isEnabled());
 const until=new Date(Date.now()+3000).toISOString();state.postError={code:'TIMED_OUT',message:'서버에서 확인한 채팅 제한',until,retryable:false};state.until.author=until;
 await page.getByLabel('채팅 메시지',{exact:true}).fill('제한 중 요청');await page.getByRole('button',{name:'채팅 전송',exact:true}).click();
 await page.getByText('채팅이 일시 제한되었습니다',{exact:true}).waitFor();await assertTimeoutComposer(page);assert.equal(state.posts,1);
 state.postError=null;await waitFor(async()=>await page.getByLabel('채팅 메시지',{exact:true}).isEnabled());
});

test('24-hour timeout displays the next-day date and explicit hours instead of total minutes',async()=>{
 state.until.author='2026-10-23T05:14:50Z';
 const page=await open('author','2026-10-22T05:27:56Z');
 const banner=page.locator('.chat-timeout-notice');await page.getByText('채팅이 일시 제한되었습니다',{exact:true}).waitFor();
 assert.match(await banner.innerText(),/2026년 10월 23일 14:14:50/);
 assert.match(await banner.innerText(),/남은 시간\s+23시간 46분 \d+초/);
 assert.match(await banner.innerText(),/한국 시간/);
 await assertTimeoutComposer(page);
 await capture(page,'timeout-next-day');
});

test('KICKED response replaces player, removes chat and remains blocked after reload',async()=>{
 state.messages=[message('old','observer')];const page=await open();await page.getByText('old 원문',{exact:true}).waitFor();
 state.postError={code:'KICKED',message:'Access blocked until live ends',retryable:false};
 await page.getByLabel('채팅 메시지',{exact:true}).fill('강퇴 확인');await page.getByRole('button',{name:'채팅 전송',exact:true}).click();
 await page.getByRole('heading',{name:'이 방송의 이용이 제한되었습니다'}).waitFor();assert.equal(await page.locator('video').count(),0);assert.equal(await page.getByText('old 원문',{exact:true}).count(),0);
 await page.reload();await page.getByRole('heading',{name:'이 방송의 이용이 제한되었습니다'}).waitFor();assert.equal(await page.locator('video').count(),0);assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).isDisabled(),true);await capture(page,'kicked-restored');
});

test('kick SSE wins over in-flight history and a new broadcast does not inherit the ban',async()=>{
 state.messages=[message('cached','observer')];const page=await open();await page.getByText('cached 원문',{exact:true}).waitFor();await waitFor(()=>clients.size>0);
 state.delayHistory=800;emit('CHAT',{});await new Promise(r=>setTimeout(r,100));state.kicked.add('author');emit('LIVE_ACCESS_BLOCKED',{});
 await page.getByRole('heading',{name:'이 방송의 이용이 제한되었습니다'}).waitFor();await new Promise(r=>setTimeout(r,1000));assert.equal(await page.locator('video').count(),0);assert.equal(await page.getByText('cached 원문',{exact:true}).count(),0);
 state.delayHistory=0;state.kicked.clear();state.liveId='live-2';state.messages=[];
 await page.getByRole('button',{name:'새로고침',exact:true}).click();await waitFor(async()=>await page.getByLabel('채팅 메시지',{exact:true}).isEnabled());assert.equal(await page.locator('video').count(),1);
});

test('live end disables chat and removes the player',async()=>{
 const page=await open();await waitFor(async()=>await page.getByLabel('채팅 메시지',{exact:true}).isEnabled());await waitFor(()=>clients.size>0);state.active=false;emit('LIVE_ENDED',{});
 await page.getByRole('heading',{name:'방송이 종료되었습니다'}).waitFor();assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).isDisabled(),true);assert.equal(await page.locator('video').count(),0);await capture(page,'live-ended');
});

test('server revocation clears the kick screen and its stale notice within the same broadcast',async()=>{
 state.kicked.add('author');const page=await open();await page.getByRole('heading',{name:'이 방송의 이용이 제한되었습니다'}).waitFor();
 state.kicked.clear();await page.getByRole('button',{name:'새로고침',exact:true}).click();await waitFor(async()=>await page.getByLabel('채팅 메시지',{exact:true}).isEnabled());
 assert.equal(await page.locator('video').count(),1);assert.equal(await page.getByText('강퇴되어 이번 방송이 끝날 때까지 채팅과 시청이 제한됩니다.',{exact:true}).count(),0);
});

test('delayed current-live response cannot reopen a broadcast after LIVE_ENDED',async()=>{
 const page=await open();await waitFor(async()=>await page.getByLabel('채팅 메시지',{exact:true}).isEnabled());await waitFor(()=>clients.size>0);
 state.delayCurrent=600;const reads=state.currentReads;await page.getByRole('button',{name:'새로고침',exact:true}).click();await waitFor(()=>state.currentReads>reads);
 state.active=false;emit('LIVE_ENDED',{});await page.getByRole('heading',{name:'방송이 종료되었습니다'}).waitFor();await new Promise(r=>setTimeout(r,800));
 assert.equal(await page.locator('video').count(),0);assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).isDisabled(),true);
});

test('mock timeout highlights the start, blocks sending and celebrates expiry with a working composer',async()=>{
 const page=await openMock();
 await page.getByRole('button',{name:'제한·해제 효과 보기',exact:true}).click();
 const banner=page.locator('.chat-timeout-notice');await banner.waitFor();
 assert.match(await banner.innerText(),/남은 시간\s+0분 10초/);
 assert.match(await banner.evaluate(el=>getComputedStyle(el).animationName),/^chat-timeout-composer-enter(?:-|$)/);
 await assertTimeoutComposer(page);
 assert.equal(await page.getByRole('dialog',{name:'채팅 제한 안내',exact:true}).evaluate(el=>el===document.activeElement),true);
 assert.equal(await page.locator('.yt-player-area video').count(),1);
 await capture(page,'mock-timeout-start');
 const beforeFeed=await page.locator('.yt-chat-row').evaluateAll(rows=>rows.map(row=>row.dataset.messageId));
 await page.evaluate(()=>{Math.random=()=>0.5;});
 await page.clock.fastForward(4500);
 await waitFor(async()=>(await page.locator('.yt-chat-row').evaluateAll(rows=>rows.map(row=>row.dataset.messageId))).some(id=>!beforeFeed.includes(id)));
 await assertTimeoutComposer(page);
 await page.clock.fastForward(5500);
 await page.getByText('채팅 제한이 해제되었습니다',{exact:true}).waitFor();
 assert.equal(await banner.count(),0);
 assert.equal(await page.locator('.yt-compose-released').count(),1);
 assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).evaluate(el=>el===document.activeElement),true);
 await page.clock.runFor(700);
 await capture(page,'mock-timeout-released');
 await page.getByLabel('채팅 메시지',{exact:true}).fill('제한 해제 후 채팅');
 await page.getByRole('button',{name:'채팅 전송',exact:true}).click();
 await page.getByText('제한 해제 후 채팅',{exact:true}).waitFor();
 await page.clock.fastForward(5000);
 assert.equal(await page.getByText('채팅 제한이 해제되었습니다',{exact:true}).count(),0);
 assert.equal(await page.locator('.yt-compose-released').count(),0);
 assert.equal(state.posts,0);
});

test('mock next-day deadline uses Korea time on mobile and respects reduced motion',async()=>{
 const page=await openMock({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles',reducedMotion:'reduce'});
 await page.getByRole('button',{name:'24시간 표시 보기',exact:true}).click();
 const banner=page.locator('.chat-timeout-notice');await banner.waitFor();
 assert.match(await banner.innerText(),/2026년 10월 23일 14:14:50/);
 assert.match(await banner.innerText(),/남은 시간\s+24시간 0분 0초/);
 assert.match(await banner.innerText(),/한국 시간/);
 assert.equal(await banner.evaluate(el=>getComputedStyle(el).animationName),'none');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await banner.scrollIntoViewIfNeeded();await capture(page,'mock-timeout-next-day-mobile');
 await page.getByRole('button',{name:'제한 해제 시연',exact:true}).click();
 await page.getByText('채팅 제한이 해제되었습니다',{exact:true}).waitFor();
 assert.equal(await page.locator('.yt-timeout-released').evaluate(el=>getComputedStyle(el).animationName),'none');
 assert.equal(await page.locator('.yt-compose').evaluate(el=>getComputedStyle(el).animationName),'none');
});

test('switching mock viewers preserves their limits and never announces another viewers release',async()=>{
 const page=await openMock();
 await page.getByRole('button',{name:'24시간 표시 보기',exact:true}).click();await page.locator('.chat-timeout-notice').waitFor();
 const select=page.getByLabel('목업 시청자 선택',{exact:true});
 await select.selectOption('22222222-2222-4222-8222-222222222223');
 await page.getByLabel('채팅 메시지',{exact:true}).waitFor();
 assert.equal(await page.locator('.yt-timeout-released').count(),0);
 await select.selectOption('22222222-2222-4222-8222-222222222221');
 await page.locator('.chat-timeout-notice').waitFor();
 await page.getByRole('button',{name:'제한 해제 시연',exact:true}).click();
 await page.getByText('채팅 제한이 해제되었습니다',{exact:true}).waitFor();
 await select.selectOption('22222222-2222-4222-8222-222222222222');
 await page.locator('.chat-timeout-notice').waitFor();
 assert.equal(await page.locator('.yt-timeout-released').count(),0);
 await assertTimeoutComposer(page);
});

test('typed mock profanity hides once per message and escalates from 10 minutes to 24 hours after expiry',async()=>{
 const page=await openMock();
 // 목업은 Backend 확정 욕설 사전을 쓴다. 띄어 쓴 표현·로마자·예외 단어는 숨기지 않는다.
 for(const text of ['안녕하세요','시 발','sibal','시발점 시발역']){
  await sendMock(page,text);
  const row=page.locator('.yt-chat-row').filter({hasText:text});
  assert.equal(await row.count(),1);
  assert.equal(await row.evaluate(el=>el.classList.contains('myHidden')),false);
 }
 const first='시발 시발 (목업 첫 번째)';await sendMock(page,first);
 assert.equal(await page.locator('.yt-chat-row.myHidden').filter({hasText:first}).count(),1);
 assert.equal(await page.locator('.chat-timeout-notice').count(),0);
 assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).isEnabled(),true);
 const select=page.getByLabel('목업 시청자 선택',{exact:true});
 await select.selectOption('22222222-2222-4222-8222-222222222223');
 assert.equal(await page.locator('.yt-chat-row').filter({hasText:first}).count(),0);
 await select.selectOption('22222222-2222-4222-8222-222222222221');
 await sendMock(page,'오늘 시발 (목업 두 번째)');
 const notice=page.locator('.chat-timeout-notice');await notice.waitFor();
 assert.match(await notice.innerText(),/남은 시간\s+10분 0초/);
 assert.match(await notice.innerText(),/금지된 욕설이 포함되어 숨김 처리/);
 await assertTimeoutComposer(page);
 assert.equal(await page.locator('.viewer-kicked').count(),0);
 await capture(page,'mock-profanity-timeout-10m');
 await page.clock.fastForward(600000);
 await page.getByText('채팅 제한이 해제되었습니다',{exact:true}).waitFor();
 await sendMock(page,'시발 (목업 세 번째)');await notice.waitFor();
 assert.match(await notice.innerText(),/남은 시간\s+24시간 0분 0초/);
 assert.match(await notice.innerText(),/2026년 10월 23일 14:24:50/);
 assert.equal(await page.locator('.viewer-kicked').count(),0);
 assert.equal(await page.locator('.yt-player-area video').count(),1);
 assert.equal(state.posts,0);
 await capture(page,'mock-profanity-timeout-24h');
});

test('typed mock profanity counts the selected viewers profanity cases separately from other categories',async()=>{
 const page=await openMock();
 await page.getByLabel('목업 시청자 선택',{exact:true}).selectOption('22222222-2222-4222-8222-222222222222');
 await page.getByRole('button',{name:'제한 해제 시연',exact:true}).click();
 // This fixture has one profanity case plus phishing and harassment cases.
 await sendMock(page,'시발 (기존 욕설 한 건 이후)');
 const notice=page.locator('.chat-timeout-notice');await notice.waitFor();
 assert.match(await notice.innerText(),/남은 시간\s+10분 0초/);
 await page.getByLabel('목업 시청자 선택',{exact:true}).selectOption('22222222-2222-4222-8222-222222222221');
 await sendMock(page,'시발 (다른 시청자의 첫 욕설)');
 assert.equal(await notice.count(),0);
 assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).isEnabled(),true);
});

test('API mode sends the same profanity text to the backend without the mock rule',async()=>{
 const page=await open();
 await waitFor(async()=>await page.getByLabel('채팅 메시지',{exact:true}).isEnabled());
 await page.getByLabel('채팅 메시지',{exact:true}).fill('시발');
 await page.getByRole('button',{name:'채팅 전송',exact:true}).click();
 await waitFor(()=>state.posts===1);
 await page.locator('.yt-chat-row').filter({hasText:'시발'}).waitFor();
 assert.equal(state.messages.at(-1).text,'시발');
 assert.equal(await page.locator('.chat-timeout-notice').count(),0);
 assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).isEnabled(),true);
});

test('mock and API viewers share desktop geometry and theater controls without invented API metrics',async()=>{
 const mock=await openMock(),api=await open();
 for(const page of [mock,api])await page.setViewportSize({width:1440,height:1000});
 async function geometry(page){
  const player=await page.locator('.yt-player-area .yt-player').boundingBox();
  const chat=await page.locator('.yt-secondary').boundingBox();
  assert(player&&chat);assert(chat.x>player.x+player.width);assert.equal(player.y,chat.y);
  return {playerX:player.x,playerY:player.y,playerWidth:player.width,chatX:chat.x,chatWidth:chat.width};
 }
 await waitFor(async()=>await api.getByLabel('채팅 메시지',{exact:true}).isEnabled());
 assert.deepEqual(await geometry(api),await geometry(mock));
 assert.equal(await api.locator('.viewer-demo').count(),0);
 assert.equal(await api.getByText('구독자 12.4만명',{exact:true}).count(),0);
 assert.doesNotMatch(await api.locator('.yt-description').innerText(),/2,341|1시간 전/);
 await capture(mock,'shared-viewer-mock-desktop');await capture(api,'shared-viewer-api-desktop');
 await api.getByTitle('영화관 모드 (t)',{exact:true}).click();
 const player=await api.locator('.yt-player-area').boundingBox(),chat=await api.locator('.yt-secondary').boundingBox();
 assert(chat.y>=player.y+player.height);
 await api.getByTitle('영화관 모드 (t)',{exact:true}).click();
 assert.deepEqual(await geometry(api),await geometry(mock));
});

test('chat hiding and searching retain SSE visibility changes without leaking cached private text',async()=>{
 state.messages=[message('changing','author'),message('public','observer')];
 const page=await open('observer');await page.locator('[data-message-id="changing"]').waitFor();await waitFor(()=>clients.size>0);
 await page.getByLabel('채팅 검색',{exact:true}).fill('changing');
 assert.equal(await page.locator('[data-message-id="public"]').count(),0);
 await page.getByRole('button',{name:'채팅 숨기기',exact:true}).click();
 state.messages[0].visibility='HELD';state.historyError=true;emit('MESSAGE_VISIBILITY_CHANGED',{messageId:'changing',visibility:'HELD',version:2});
 await new Promise(r=>setTimeout(r,100));
 await page.getByRole('button',{name:'채팅 표시',exact:true}).click();
 assert.equal(await page.locator('[data-message-id="changing"]').count(),0);
 state.historyError=false;state.messages[0].visibility='PUBLIC';emit('MESSAGE_RESTORED',{messageId:'changing',visibility:'PUBLIC',version:3});
 await page.locator('[data-message-id="changing"]').waitFor();
});

test('shared API viewer waits for a broadcast before enabling video and sending',async()=>{
 state.active=false;const page=await open();
 await page.getByRole('heading',{name:'진행 중인 방송이 없습니다',exact:true}).waitFor();
 assert.equal(await page.locator('video').count(),0);
 assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).isDisabled(),true);
 state.active=true;await page.getByRole('button',{name:'새로고침',exact:true}).click();
 await waitFor(async()=>await page.getByLabel('채팅 메시지',{exact:true}).isEnabled());
 assert.equal(await page.locator('video').count(),1);assert.equal(state.posts,0);
});

test('shared API viewer keeps readable messages above its restricted composer on mobile',async()=>{
 const until=new Date(Date.now()+86400000).toISOString();state.until.author=until;
 state.messages=[message('own','author','HIDDEN',{text:'긴 문장'.repeat(80),moderationNotice:'숨김 사유 안내',timeoutUntil:until}),message('other','observer')];
 const page=await open();await page.setViewportSize({width:390,height:844});
 const notice=page.locator('.chat-timeout-notice');await notice.waitFor();
 assert.match(await notice.innerText(),/숨김 사유 안내/);
 await page.getByText('other 원문',{exact:true}).waitFor();
 await assertTimeoutComposer(page);
 assert.equal(await page.locator('.yt-player-area video').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await waitFor(()=>page.locator('.yt-chat-items').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<2));
 await notice.scrollIntoViewIfNeeded();await capture(page,'shared-viewer-api-mobile');
});

test('session loss unmounts the shared API viewer and closes streams with cached chat and draft removed',async()=>{
 state.messages=[message('cached','observer')];const page=await open();
 await page.locator('[data-message-id="cached"]').waitFor();await waitFor(()=>clients.size>0);
 await page.getByLabel('채팅 메시지',{exact:true}).fill('보내기 전 초안');
 state.authError=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('button',{name:'시청자로 시작하기',exact:true}).waitFor();
 await waitFor(()=>clients.size===0);
 assert.equal(await page.locator('.viewer-shell').count(),0);
 assert.equal(await page.locator('[data-message-id="cached"]').count(),0);assert.equal(state.posts,0);
});

test('API operator distinguishes confirmed action failure from an unknown result',async()=>{
 const page=await open('operator');await waitFor(()=>clients.size>=2);
 emit('ACTION_FAILED',{actionId:'action-failed',liveId:'live-1',type:'KICK',status:'FAILED',observation:'CONFIRMED'});
 await page.getByRole('status').filter({hasText:'강퇴 실행 실패가 확인되었습니다'}).first().waitFor();
 emit('ACTION_FAILED',{actionId:'action-unknown',liveId:'live-1',type:'KICK',status:'RUNNING',observation:'UNKNOWN'});
 await page.getByRole('status').filter({hasText:'강퇴 실행 결과를 확인하고 있습니다'}).first().waitFor();
});

test('API operator on a stale review gets STALE_VERSION, sees the notice and reloads the newer review',async()=>{
 state.messages=[message('held-1','author','HELD')];
 state.cases=[{caseId:'case-ctx',liveId:'live-1',version:1,confirmationStatus:'PENDING',handlingRoute:'CONTEXT_REVIEW',messages:[{messageId:'held-1',authorAlias:'U1',text:'held-1 원문',visibility:'HELD',sentAt:timestamp()}],targetMessageIds:['held-1'],confirmedFindings:[],findings:[],createdAt:timestamp(),violationCount:0}];
 state.reviews=[{reviewId:'review-ctx',kind:'CONTEXT',liveId:'live-1',caseId:'case-ctx',status:'PENDING',version:1,createdAt:timestamp(),aiVerdict:'NO_VIOLATION',messages:state.cases[0].messages,targetMessageIds:['held-1'],findings:[{messageId:'held-1',verdict:'NO_VIOLATION',categories:[],policyIds:['CP-2.2'],reason:'감탄 표현입니다.',missingFacts:[]}],basisCaseIds:[],summary:'AI 제안을 확인하고 최종 결정해 주세요'}];
 const first=await open('operator'),second=await open('operator');
 const card=p=>p.locator('.studio-review[data-review-id="review-ctx"]');
 await card(first).waitFor();await card(second).waitFor();
 // 두 번째 화면은 첫 번째 운영자의 보류를 아직 모르는 상태로 둔다.
 const stale={};await second.route(/\/api\/reviews\?/,async route=>{const u=route.request().url();if(!stale[u]){const r=await route.fetch();stale[u]=await r.text();}await route.fulfill({status:200,contentType:'application/json',body:stale[u]});});
 await second.getByRole('button',{name:'새로고침',exact:true}).click();await waitFor(()=>Object.keys(stale).length===2);
 await card(first).getByLabel('결정 이유 (필수)').fill('더 확인이 필요합니다.');
 await card(first).getByRole('button',{name:'보류',exact:true}).click();
 await waitFor(()=>state.decisions.length===1);await first.locator('.studio-review[data-review-id="review-ctx"][data-version="2"]').waitFor();
 await card(second).getByLabel('결정 이유 (필수)').fill('정상으로 판단합니다.');
 await card(second).getByRole('button',{name:'정상 확정',exact:true}).click();
 const staleNotice=second.getByRole('status').filter({hasText:'다른 운영자가 먼저 검토를 변경했습니다'});await staleNotice.waitFor();
 // 5초 주기 재확인이 지나도 안내가 남아 있어야 한다.
 await new Promise(r=>setTimeout(r,6000));assert.equal(await staleNotice.count(),1);assert.equal(await second.getByRole('alert').count(),0);
 assert.equal(state.decisions.length,1);assert.equal(state.reviews[0].status,'PENDING');
 await second.unrouteAll({behavior:'ignoreErrors'});await second.getByRole('button',{name:'새로고침',exact:true}).click();
 await second.locator('.studio-review[data-review-id="review-ctx"][data-version="2"]').waitFor();
 assert.equal(await card(second).getByLabel('결정 이유 (필수)').inputValue(),'정상으로 판단합니다.');
});

test('API kick rejection is accepted without blocking the viewer and keeps existing sanctions',async()=>{
 const masked=(id,text)=>({messageId:id,authorAlias:'U1',text,visibility:'HIDDEN',sentAt:timestamp()});
 state.messages=[1,2,3].map(n=>message('old-'+n,'author','HIDDEN'));
 state.cases=[1,2,3].map(n=>({caseId:'case-'+n,liveId:'live-1',version:2,confirmationStatus:'CONFIRMED_VIOLATION',handlingRoute:'RULE_CONFIRMED',messages:[masked('old-'+n,'욕설 '+n)],targetMessageIds:['old-'+n],confirmedFindings:[{findingId:'finding-'+n,category:'PROFANITY',status:'CONFIRMED',confirmedAt:timestamp(),revokedAt:null}],findings:[],createdAt:timestamp(),violationCount:n}));
 state.reviews=[{reviewId:'review-kick',kind:'KICK',liveId:'live-1',caseId:'case-3',status:'PENDING',version:1,createdAt:timestamp(),aiVerdict:'VIOLATION',messages:[],targetMessageIds:['old-3'],findings:[],basisCaseIds:['case-1','case-2','case-3'],summary:'서로 다른 확정 사건 3건 — 방송 종료까지 차단 승인 요청'}];
 const operator=await open('operator'),viewer=await open('author');
 const kick=operator.locator('.studio-review.kick');await kick.waitFor();
 await kick.getByLabel('운영자 판단 근거 (필수)').fill('이번 방송에서는 강퇴하지 않습니다.');
 await kick.getByRole('button',{name:'강퇴 기각',exact:true}).click();
 await waitFor(()=>state.decisions.length===1);
 assert.equal(state.decisions[0].path,'/api/kick-reviews/review-kick/decision');assert.equal(state.decisions[0].body.decision,'REJECT');
 await operator.getByRole('status').filter({hasText:'강퇴 기각 · 기존 제재 유지'}).first().waitFor();
 await kick.waitFor({state:'detached'});
 await viewer.getByRole('button',{name:'새로고침',exact:true}).click();await viewer.locator('[data-message-id="old-1"]').waitFor();
 assert.equal(await viewer.getByRole('heading',{name:'이 방송의 이용이 제한되었습니다'}).count(),0);
 assert.match(await viewer.locator('[data-message-id="old-1"]').innerText(),/숨김/);
});

test('mock filter examples follow the Backend dictionary routes and fill the composer',async()=>{
 const page=await openMock();
 const routes=await page.evaluate(async()=>{
  const {filterExamples}=await import('/src/mock.ts');const {classify}=await import('/src/mockLive.ts');
  return filterExamples.map(g=>({key:g.key,items:g.items.map(i=>({label:i.label,route:classify(i.text,i.label.startsWith('도배')?3:1).route}))}));
 });
 const byKey=Object.fromEntries(routes.map(g=>[g.key,g.items]));
 for(const item of byKey.hide)assert.equal(item.route,item.label.startsWith('도배')?'FLOOD_REVIEW':'RULE_CONFIRMED',item.label);
 for(const item of byKey.held)assert.match(item.route,/^(CONTEXT_REVIEW|PII_INVESTIGATION)$/,item.label);
 for(const item of byKey.pass)assert.equal(item.route,'PASS',item.label);
 const examples=page.getByLabel('필터 사전 예시');
 await examples.getByRole('button',{name:'접어라',exact:true}).click();
 assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).inputValue(),'너 진짜 접어라');
 await page.getByRole('button',{name:'채팅 전송',exact:true}).click();
 const row=page.locator('.yt-chat-row').filter({hasText:'너 진짜 접어라'});await row.waitFor();
 assert.match(await row.innerText(),/검토 중/);
 await examples.getByRole('button',{name:'개못하네',exact:true}).click();await page.getByRole('button',{name:'채팅 전송',exact:true}).click();
 const pass=page.locator('.yt-chat-row').filter({hasText:'아 개못하네'});await pass.waitFor();
 assert.equal(await pass.evaluate(el=>el.classList.contains('myHidden')),false);
});

test('API context card shows when the message was sent and earlier cases with the same text',async()=>{
 const sent=(id,at,visibility)=>({messageId:id,authorAlias:'U1',text:'꺼져',visibility,sentAt:at});
 state.messages=[message('first','author','HIDDEN',{text:'꺼져'}),message('again','author','HELD',{text:'꺼져'}),message('other','observer','HELD',{text:'꺼져'})];
 state.cases=[
  {caseId:'case-first',liveId:'live-1',version:2,confirmationStatus:'CONFIRMED_VIOLATION',handlingRoute:'CONTEXT_REVIEW',messages:[sent('first','2026-10-22T13:39:51Z','HIDDEN')],targetMessageIds:['first'],confirmedFindings:[{findingId:'f-1',category:'HARASSMENT',status:'CONFIRMED',confirmedAt:timestamp(),revokedAt:null}],findings:[],createdAt:'2026-10-22T13:39:58Z',violationCount:1},
  {caseId:'case-again',liveId:'live-1',version:1,confirmationStatus:'PENDING',handlingRoute:'CONTEXT_REVIEW',messages:[sent('again','2026-10-22T13:40:00Z','HELD')],targetMessageIds:['again'],confirmedFindings:[],findings:[],createdAt:'2026-10-22T13:40:13Z',violationCount:1},
  {caseId:'case-other',liveId:'live-1',version:1,confirmationStatus:'PENDING',handlingRoute:'CONTEXT_REVIEW',messages:[sent('other','2026-10-22T13:41:00Z','HELD')],targetMessageIds:['other'],confirmedFindings:[],findings:[],createdAt:'2026-10-22T13:41:10Z',violationCount:0}];
 state.reviews=[{reviewId:'review-again',kind:'CONTEXT',liveId:'live-1',caseId:'case-again',status:'PENDING',version:1,createdAt:'2026-10-22T13:40:13Z',aiVerdict:'VIOLATION',messages:state.cases[1].messages,targetMessageIds:['again'],findings:[],basisCaseIds:[],summary:'AI 제안을 확인하고 최종 결정해 주세요'}];
 const page=await open('operator');
 const card=page.locator('.studio-review[data-review-id="review-again"]');await card.waitFor();
 assert.equal(await card.locator('header small').innerText(),'2026-10-22 22:40');
 const repeats=card.locator('.review-repeats');await repeats.waitFor();
 assert.equal((await repeats.innerText()).replace(/\s+/g,' '),'같은 시청자가 같은 문장을 1번 더 보냈습니다: 2026-10-22 22:39 위반 확정');
});

test('mock context review stays held on defer, then applies normal and violation decisions',async()=>{
 async function decide(label,reason){
  const page=await openMockModerator();await page.getByRole('button',{name:'공격 표현',exact:true}).click();
  const row=page.locator('.chat-row').filter({hasText:'너 같은 건 방송 접어라'});await row.waitFor();
  assert.match(await row.getAttribute('class'),/held/);
  const card=page.locator('.studio-review').filter({hasText:'너 같은 건 방송 접어라'});
  await card.getByText('AI 제안 · 위반 의심',{exact:true}).waitFor();await card.getByText('정책 CP-3.2',{exact:true}).waitFor();
  await card.getByLabel('결정 이유 (필수)').fill(reason);
  await card.getByRole('button',{name:label,exact:true}).click();
  return {page,row,card};
 }
 const deferred=await decide('보류','아직 맥락을 더 확인해야 합니다.');
 await deferred.page.getByText('보류했습니다. 검토 대기에 남습니다. (MOCK)',{exact:true}).waitFor();
 assert.match(await deferred.row.getAttribute('class'),/held/);assert.equal(await deferred.card.count(),1);
 const normal=await decide('정상 확정','위반 근거가 충분하지 않아 정상으로 확정합니다.');
 await waitFor(async()=>!(await normal.row.getAttribute('class')).includes('held'));
 assert.doesNotMatch(await normal.row.getAttribute('class'),/hidden/);assert.equal(await normal.card.count(),0);
 const violation=await decide('위반 확정','대상에 대한 공격 표현으로 판단했습니다.');
 await waitFor(async()=>(await violation.row.getAttribute('class')).includes('hidden'));
});

test('mock 24-hour timeout is automatic and the kick review lists its three basis cases',async()=>{
 const page=await openMockModerator();
 const card=page.locator('.studio-review.kick');await card.waitFor();
 assert.equal(await card.locator('tbody tr').count(),3);
 assert.match(await card.innerText(),/서로 다른 확정 사건 3건/);
 await page.getByRole('button',{name:'정책 근거',exact:true}).click();
 await page.getByText('모든 채팅 제한은 자동 적용되며, 24시간 제한도 강퇴가 아닙니다.',{exact:false}).waitFor();
 assert.equal(await page.getByText('interrupt()',{exact:false}).count(),0);
});

test('mock kick approval is explicitly simulated and blocks that viewer for the live session',async()=>{
 const page=await openMockModerator();
 const reason=page.getByLabel('운영자 판단 근거 (필수)');await reason.fill('세 건의 확정 사건을 검토했습니다.');
 await page.getByRole('button',{name:'강퇴 승인',exact:true}).click();
 await page.getByRole('status').filter({hasText:'결정 접수 · 실행 결과 대기'}).first().waitFor();
 await page.getByRole('button',{name:'로그아웃',exact:true}).click();
 await page.getByRole('button',{name:'시청자로 시작하기',exact:true}).click();
 await page.getByRole('button',{name:'로그인',exact:true}).click();await page.locator('.viewer-shell').waitFor();
 await page.getByLabel('목업 시청자 선택').selectOption('22222222-2222-4222-8222-222222222222');
 assert.equal(await page.getByRole('heading',{name:'이 방송의 이용이 제한되었습니다'}).count(),0);
 await page.getByRole('button',{name:'로그아웃',exact:true}).click();
 await page.getByRole('button',{name:'스트리머로 시작하기',exact:true}).click();
 await page.getByRole('button',{name:'로그인',exact:true}).click();await page.locator('.app-shell').waitFor();
 await page.getByRole('button',{name:'모의 적용 성공',exact:true}).click();
 await page.getByRole('status').filter({hasText:'강퇴 적용 완료'}).first().waitFor();
 await page.getByText('강퇴가 모의 적용됐습니다. (MOCK)',{exact:true}).waitFor();
 await page.getByRole('button',{name:'로그아웃',exact:true}).click();
 await page.getByRole('button',{name:'시청자로 시작하기',exact:true}).click();
 await page.getByRole('button',{name:'로그인',exact:true}).click();await page.locator('.viewer-shell').waitFor();
 await page.getByLabel('목업 시청자 선택').selectOption('22222222-2222-4222-8222-222222222222');
 await page.getByRole('heading',{name:'이 방송의 이용이 제한되었습니다'}).waitFor();
 await page.getByText('이번 방송이 끝날 때까지 채팅과 시청이 제한됩니다',{exact:false}).waitFor();
});

test('mock kick failure and unknown outcomes never apply a viewer ban',async()=>{
 for(const outcome of [
  {button:'모의 적용 실패',status:'강퇴 실행 실패 · 기존 제재 유지'},
  {button:'결과 미확인 시뮬레이션',status:'실행 결과 확인 중 · 실패로 단정하지 않음'}
 ]){
  const page=await openMockModerator();
  await page.getByLabel('운영자 판단 근거 (필수)').fill('기준 사건 검토 완료');
  await page.getByRole('button',{name:'강퇴 승인',exact:true}).click();
  await page.getByRole('button',{name:outcome.button,exact:true}).click();
  await page.getByRole('status').filter({hasText:outcome.status}).first().waitFor();
  await page.getByRole('button',{name:'로그아웃',exact:true}).click();
  await page.getByRole('button',{name:'시청자로 시작하기',exact:true}).click();
  await page.getByRole('button',{name:'로그인',exact:true}).click();await page.locator('.viewer-shell').waitFor();
  await page.getByLabel('목업 시청자 선택').selectOption('22222222-2222-4222-8222-222222222222');
  assert.equal(await page.getByRole('heading',{name:'이 방송의 이용이 제한되었습니다'}).count(),0);
 }
});

test('mock and API operators share the Studio screen and API decisions send the contract body',async()=>{
 const masked=(id,text,visibility)=>({messageId:id,authorAlias:'U1',text,visibility,sentAt:timestamp()});
 const basis=n=>({caseId:'case-'+n,liveId:'live-1',version:2,confirmationStatus:'CONFIRMED_VIOLATION',handlingRoute:'RULE_CONFIRMED',messages:[masked('old-'+n,'확정 욕설 '+n,'HIDDEN')],targetMessageIds:['old-'+n],confirmedFindings:[{findingId:'finding-'+n,category:'PROFANITY',status:'CONFIRMED',confirmedAt:timestamp(),revokedAt:null}],findings:[],createdAt:timestamp(),violationCount:n});
 state.messages=[message('old-1','author','HIDDEN'),message('old-2','author','HIDDEN'),message('old-3','author','HIDDEN'),message('held-1','author','HELD')];
 state.cases=[...[1,2,3].map(basis),{caseId:'case-ctx',liveId:'live-1',version:1,confirmationStatus:'PENDING',handlingRoute:'CONTEXT_REVIEW',messages:[masked('held-1','held-1 원문','HELD')],targetMessageIds:['held-1'],confirmedFindings:[],findings:[],createdAt:timestamp(),violationCount:3}];
 state.reviews=[
  {reviewId:'review-ctx',kind:'CONTEXT',liveId:'live-1',caseId:'case-ctx',status:'PENDING',version:1,createdAt:timestamp(),aiVerdict:'NEEDS_REVIEW',messages:[masked('held-1','held-1 원문','HELD')],targetMessageIds:['held-1'],findings:[{messageId:'held-1',verdict:'NEEDS_REVIEW',categories:['HARASSMENT'],policyIds:['CP-3.2'],reason:'대상이 분명하지 않습니다.',missingFacts:['특정 시청자를 겨냥했는지']}],basisCaseIds:[],summary:'AI 제안을 확인하고 최종 결정해 주세요'},
  {reviewId:'review-kick',kind:'KICK',liveId:'live-1',caseId:'case-3',status:'PENDING',version:1,createdAt:timestamp(),aiVerdict:'VIOLATION',messages:[],targetMessageIds:['old-3'],findings:[],basisCaseIds:['case-1','case-2','case-3'],summary:'서로 다른 확정 사건 3건 — 방송 종료까지 차단 승인 요청'}
 ];
 const api=await open('operator'),mock=await openMockModerator();
 const menus=page=>page.getByRole('navigation',{name:'운영자 메뉴'}).locator('button span').allInnerTexts();
 assert.deepEqual(await menus(api),await menus(mock));
 assert.deepEqual(await menus(api),['실시간 관제','시청자 관리','사건 이력','정책 근거','진행 기록']);
 for(const page of [api,mock]){
  for(const name of ['운영자 결정 대기','규칙 자동 숨김'])await page.locator('.section-head b').filter({hasText:name}).waitFor();
  assert.equal(await page.locator('.studio-review.kick tbody tr').count(),3);
 }
 assert.equal(await api.getByText('MOCK',{exact:false}).count(),0);assert.equal(await api.locator('.scenario-toolbar').count(),0);
 const card=api.locator('.studio-review[data-review-id="review-ctx"]');
 await card.getByText('AI 제안 · 판단 보류',{exact:true}).waitFor();await card.getByText('확인 필요: 특정 시청자를 겨냥했는지',{exact:true}).waitFor();
 await card.locator('header b').filter({hasText:'author'}).waitFor();
 await card.getByLabel('결정 이유 (필수)').fill('대상이 분명한 괴롭힘입니다.');
 await card.getByRole('button',{name:'위반 확정',exact:true}).click();
 await waitFor(()=>state.decisions.length===1);
 const {path:decisionPath,body}=state.decisions[0];
 assert.equal(decisionPath,'/api/context-reviews/review-ctx/decision');
 assert.deepEqual({...body,clientRequestId:typeof body.clientRequestId},{expectedReviewVersion:1,decision:'CONFIRM_VIOLATION',reason:'대상이 분명한 괴롭힘입니다.',categories:['HARASSMENT'],evidenceMessageIds:['held-1'],clientRequestId:'string'});
 await waitFor(async()=>await card.count()===0);
 await capture(api,'studio-api');await capture(mock,'studio-mock');
 // 강퇴: 승인 접수 → ACTION_APPLIED로 적용 완료 → 기준 사건 오판 취소로 검토가 무효가 되면 해제로 표시
 const kick=api.locator('.studio-review[data-review-id="review-kick"]');
 await kick.getByLabel('운영자 판단 근거 (필수)').fill('확정 사건 3건을 확인했습니다.');
 await kick.getByRole('button',{name:'강퇴 승인',exact:true}).click();
 await waitFor(()=>state.decisions.length===2);assert.equal(state.decisions[1].path,'/api/kick-reviews/review-kick/decision');
 await api.getByRole('status').filter({hasText:'결정 접수 · 실행 결과 대기'}).first().waitFor();
 emit('REVIEW_DECIDED',{reviewId:'review-kick',decisionId:'decision-2',kind:'KICK',value:'APPROVE'});
 emit('ACTION_APPLIED',{actionId:'action-1',caseId:'case-3',liveId:'live-1',type:'KICK',status:'SUCCEEDED',observation:'CONFIRMED'});
 await api.getByRole('status').filter({hasText:'강퇴 적용 완료'}).first().waitFor();
 state.reviews.find(r=>r.reviewId==='review-kick').status='INVALIDATED';emit('CASE_UPDATED',{caseId:'case-1'});
 await api.getByRole('status').filter({hasText:'근거 취소 · 강퇴 해제'}).first().waitFor();
 assert.equal(await api.getByRole('status').filter({hasText:'강퇴 적용 완료'}).count(),0);
});

test('shared chat keeps its scroll position during timeout and follows new messages after release',async()=>{
 state.messages=Array.from({length:45},(_,i)=>message('public-'+i,'observer'));
 const page=await open();await page.locator('[data-message-id="public-44"]').waitFor();
 await waitFor(()=>clients.size>0&&state.historyReads.length>=2);
 const list=page.locator('.yt-chat-items');
 await list.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
 state.messages.push(message('new-public','observer'));emit('CHAT',{});
 await page.getByRole('button',{name:'새 메시지 1개',exact:false}).waitFor();
 assert.equal(await list.evaluate(el=>el.scrollTop),0);
 await page.getByRole('button',{name:'새 메시지 1개',exact:false}).click();
 await waitFor(()=>list.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<2));
 const until=new Date(Date.now()+600000).toISOString();state.until.author=until;
 state.messages.push(message('new-hidden','author','HIDDEN',{moderationNotice:'목업 서버의 제한 사유',timeoutUntil:until}));emit('CHAT',{});
 await page.locator('.chat-timeout-notice').waitFor();
 await assertTimeoutComposer(page);
 await list.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
 state.messages.push(message('during-timeout','observer'));emit('CHAT',{});
 await page.locator('[data-message-id="during-timeout"]').waitFor();
 await page.getByRole('button',{name:'새 메시지 1개',exact:false}).waitFor();
 assert.equal(await list.evaluate(el=>el.scrollTop),0);
 state.until.author=null;emit('MESSAGE_RESTORED',{});
 await page.getByLabel('채팅 메시지',{exact:true}).waitFor();
 assert.equal(await list.evaluate(el=>el.scrollTop),0);
 await page.getByRole('button',{name:'새 메시지 1개',exact:false}).click();
 await waitFor(()=>list.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<2));
 await page.locator('[data-message-id="new-hidden"]').waitFor();
 await waitFor(()=>list.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<2));
 assert.equal(await page.locator('.new-msg-pill').count(),0);
 assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).isEnabled(),true);
});

test('timeout opens collapsed chat and keeps live messages, search and privacy updates usable',async()=>{
 state.messages=[message('changing','observer')];const page=await open();
 await page.locator('[data-message-id="changing"]').waitFor();await waitFor(()=>clients.size>0);
 await page.getByRole('button',{name:'채팅 숨기기',exact:true}).click();
 state.until.author=new Date(Date.now()+600000).toISOString();emit('CHAT',{});
 await assertTimeoutComposer(page);
 assert.equal(await page.getByRole('button',{name:'채팅 표시',exact:true}).count(),0);
 state.messages[0].visibility='HELD';emit('MESSAGE_VISIBILITY_CHANGED',{messageId:'changing',visibility:'HELD',version:2});
 state.messages.push(message('new-public','observer'));emit('CHAT',{});
 await page.locator('[data-message-id="new-public"]').waitFor();
 assert.equal(await page.locator('[data-message-id="changing"]').count(),0);
 await page.getByLabel('채팅 검색',{exact:true}).fill('new-public');
 assert.equal(await page.locator('.yt-chat-row').count(),1);
 await assertTimeoutComposer(page);
 await page.getByRole('button',{name:'채팅 숨기기',exact:true}).click();
 await page.getByRole('button',{name:'채팅 표시',exact:true}).click();
 await assertTimeoutComposer(page);
 await page.getByLabel('채팅 검색',{exact:true}).fill('');
 state.until.author=null;emit('CHAT',{});
 await page.getByLabel('채팅 메시지',{exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog',{name:'채팅 제한 안내',exact:true}).count(),0);
 assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).isEnabled(),true);assert.equal(state.posts,0);
});

test('timeout without a deadline replaces only the composer and shows a checking notice',async()=>{
 const page=await open();await waitFor(async()=>await page.getByLabel('채팅 메시지',{exact:true}).isEnabled());
 state.postError={code:'TIMED_OUT',message:'제한 상태를 확인하고 있습니다.',retryable:false};
 await page.getByLabel('채팅 메시지',{exact:true}).fill('전송 요청');await page.getByRole('button',{name:'채팅 전송',exact:true}).click();
 await assertTimeoutComposer(page);
 await page.getByText('제한 종료 시각을 확인하고 있습니다.',{exact:true}).waitFor();assert.equal(state.posts,1);
});

test('live end replaces an active timeout window without announcing a timeout release',async()=>{
 state.until.author=new Date(Date.now()+600000).toISOString();const page=await open();await assertTimeoutComposer(page);
 await waitFor(()=>clients.size>0);state.active=false;emit('LIVE_ENDED',{});
 await page.getByRole('heading',{name:'방송이 종료되었습니다',exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog',{name:'채팅 제한 안내',exact:true}).count(),0);
 assert.equal(await page.locator('.yt-timeout-released').count(),0);
 assert.equal(await page.getByLabel('채팅 메시지',{exact:true}).isDisabled(),true);assert.equal(await page.locator('video').count(),0);
});
