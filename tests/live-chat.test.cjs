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
 await page.goto(base);await page.locator('.viewer-shell, .app-shell').waitFor();
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
// 결정 대기 카드: 접혀 있으면 펼치고, 결정을 고른 뒤 제출한다. "자세히"와 목업 빠른 시연은 접혀 있으면 연다.
async function openCard(card){if(!/\bopen\b/.test(await card.getAttribute('class')))await card.locator('.review-head').click();}
async function openMore(card){await openCard(card);const more=card.locator('details.review-more:has(> summary:text-is("자세히"))');if(!(await more.evaluate(el=>el.open)))await more.locator('> summary').click();}
async function decideCard(card,label){await openCard(card);await card.getByRole('radio',{name:label,exact:true}).check();await card.getByRole('button',{name:'제출',exact:true}).click();}
// 결정 대기는 별도 페이지다.
async function gotoQueue(page){await page.getByRole('navigation',{name:'운영자 메뉴'}).getByRole('button',{name:/^결정 대기/}).click();await page.locator('.queue-page').waitFor();}
async function gotoMonitor(page){await page.getByRole('navigation',{name:'운영자 메뉴'}).getByRole('button',{name:'실시간 관제',exact:true}).click();}
async function showQueue(page,name){if(!(await page.locator('.queue-page').count()))await gotoQueue(page);await page.getByRole('tablist',{name:'결정 대기 종류'}).getByRole('tab',{name:new RegExp('^'+name)}).click();}
async function openDemo(page){const fold=page.locator('.demo-fold');if(!(await fold.evaluate(el=>el.open)))await fold.locator('summary').click();}
async function capture(page,name){if(evidence){await fs.mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,`${name}.png`),fullPage:true,animations:'disabled'});}}
before(async()=>{
 server=http.createServer(async(req,res)=>{
  const role=req.headers['x-test-role']||'author',url=new URL(req.url,'http://fixture');
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(status<400?{data,traceId:'test-trace'}:{error:data,traceId:'test-trace'}));};
  if(url.pathname==='/api/auth/me'&&state.authError)return json(401,{code:'UNAUTHENTICATED',message:'Session expired',retryable:false});
  // admin(PLATFORM_ADMIN)은 실제 시드처럼 어느 채널에도 소속되지 않는다
  if(url.pathname==='/api/auth/me')return json(200,{userId:role,nickname:role,role:role==='operator'?'MODERATOR':role==='admin'?'PLATFORM_ADMIN':'VIEWER',channelIds:role==='admin'?[]:['channel-1']});
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
   // pageSize가 있으면 limit을 준 요청(채팅 기록)을 쪽 단위로 나눠 준다.
   const limit=Number(url.searchParams.get('limit')||0),from=Number(url.searchParams.get('cursor')||0);
   const paged=state.pageSize&&limit?items.slice(from,from+state.pageSize):items;
   const page={items:paged,nextCursor:state.pageSize&&limit&&from+state.pageSize<items.length?String(from+state.pageSize):null,timeoutUntil:state.until[role]??null};
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
beforeEach(()=>{state={active:true,liveId:'live-1',messages:[],until:{},kicked:new Set(),posts:0,historyReads:[],currentReads:0,postError:null,historyError:false,leak:false,delayHistory:0,delayCurrent:0,reviews:[],cases:[],decisions:[],pageSize:0};runtimeErrors.length=0;});
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
 // #28: 장식 요소는 같은 자리에 있고 값만 다르다. 계약에 없는 값(시청자·구독자 수)은 API에서 숨긴다.
 for(const page of [mock,api]){
  for(const sel of ['.yt-masthead-end .mode-badge','.yt-masthead-end .yt-deco[title="알림"]','.yt-channel-avatar','.yt-subscribe','.yt-actions .yt-segment'])assert.equal(await page.locator(sel).count(),1,sel);
  assert.equal(await page.locator('.yt-actions .yt-pill').count(),2);
  assert.equal(await page.locator('.yt-live-dot').innerText(),'실시간');
  assert.match(await page.locator('.yt-time').innerText(),/^\d+:\d{2}:\d{2}$/);
  assert.match(await page.locator('.yt-description b').innerText(),/^방송 시작: /);
 }
 assert.equal(await mock.locator('.mode-badge').innerText(),'MOCK 데이터');assert.match(await api.locator('.mode-badge').innerText(),/^(ON AIR|연결 대기)$/);
 assert.equal(await mock.locator('.yt-watching').count(),1);assert.equal(await api.locator('.yt-watching').count(),0);
 assert.equal(await api.getByTitle('새로고침',{exact:true}).count(),1);assert.equal(await mock.getByTitle('새로고침',{exact:true}).count(),0);
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
 await gotoQueue(first);await gotoQueue(second);await card(first).waitFor();await card(second).waitFor();
 // 두 번째 화면은 첫 번째 운영자의 보류를 아직 모르는 상태로 둔다.
 const stale={};await second.route(/\/api\/reviews\?/,async route=>{const u=route.request().url();if(!stale[u]){const r=await route.fetch();stale[u]=await r.text();}await route.fulfill({status:200,contentType:'application/json',body:stale[u]});});
 await second.getByRole('button',{name:'새로고침',exact:true}).click();await waitFor(()=>Object.keys(stale).length===2);
 await decideCard(card(first),'보류');
 await waitFor(()=>state.decisions.length===1);await first.locator('.studio-review[data-review-id="review-ctx"][data-version="2"]').waitFor();
 await decideCard(card(second),'정상 확정');
 const staleNotice=second.getByRole('status').filter({hasText:'다른 운영자가 먼저 검토를 변경했습니다'});await staleNotice.waitFor();
 // 5초 주기 재확인이 지나도 안내가 남아 있어야 한다.
 await new Promise(r=>setTimeout(r,6000));assert.equal(await staleNotice.count(),1);assert.equal(await second.getByRole('alert').count(),0);
 assert.equal(state.decisions.length,1);assert.equal(state.reviews[0].status,'PENDING');
 await second.unrouteAll({behavior:'ignoreErrors'});await second.getByRole('button',{name:'새로고침',exact:true}).click();
 await second.locator('.studio-review[data-review-id="review-ctx"][data-version="2"]').waitFor();
});

test('API kick rejection is accepted without blocking the viewer and keeps existing sanctions',async()=>{
 const masked=(id,text)=>({messageId:id,authorAlias:'U1',text,visibility:'HIDDEN',sentAt:timestamp()});
 state.messages=[1,2,3].map(n=>message('old-'+n,'author','HIDDEN'));
 state.cases=[1,2,3].map(n=>({caseId:'case-'+n,liveId:'live-1',version:2,confirmationStatus:'CONFIRMED_VIOLATION',handlingRoute:'RULE_CONFIRMED',messages:[masked('old-'+n,'욕설 '+n)],targetMessageIds:['old-'+n],confirmedFindings:[{findingId:'finding-'+n,category:'PROFANITY',status:'CONFIRMED',confirmedAt:timestamp(),revokedAt:null}],findings:[],createdAt:timestamp(),violationCount:n}));
 state.reviews=[{reviewId:'review-kick',kind:'KICK',liveId:'live-1',caseId:'case-3',status:'PENDING',version:1,createdAt:timestamp(),aiVerdict:'VIOLATION',messages:[],targetMessageIds:['old-3'],findings:[],basisCaseIds:['case-1','case-2','case-3'],summary:'서로 다른 확정 사건 3건 — 방송 종료까지 차단 승인 요청'}];
 const operator=await open('operator'),viewer=await open('author');
 await gotoQueue(operator);const kick=operator.locator('.studio-review.kick');await kick.waitFor();
 await decideCard(kick,'강퇴 기각');
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
 await gotoQueue(page);const card=page.locator('.studio-review[data-review-id="review-again"]');await card.waitFor();
 assert.equal(await card.locator('.review-head small').innerText(),'2026-10-22 22:40');
 await openMore(card);const repeats=card.locator('.review-repeats');await repeats.waitFor();
 assert.equal((await repeats.innerText()).replace(/\s+/g,' '),'같은 시청자가 같은 문장을 1번 더 보냈습니다: 2026-10-22 22:39 위반 확정');
});

test('API case flow shows AI investigation from live events, basis reasons and the decision count',async()=>{
 const masked=(id,text,visibility)=>({messageId:id,authorAlias:'U1',text,visibility,sentAt:timestamp()});
 const finding=(id,verdict,reason)=>({messageId:id,verdict,categories:['HARASSMENT'],policyIds:['CP-3.2'],reason,missingFacts:[]});
 state.messages=[message('rule-1','author','HIDDEN'),message('rule-2','author','HIDDEN'),message('ctx','author','HIDDEN'),message('held','author','HELD')];
 const confirmedCase=(caseId,id,route,findings)=>({caseId,liveId:'live-1',version:2,confirmationStatus:'CONFIRMED_VIOLATION',handlingRoute:route,messages:[masked(id,id+' 원문','HIDDEN')],targetMessageIds:[id],confirmedFindings:[{findingId:'f-'+caseId,category:route==='CONTEXT_REVIEW'?'HARASSMENT':'PROFANITY',status:'CONFIRMED',confirmedAt:timestamp(),revokedAt:null}],findings,createdAt:timestamp(),violationCount:1});
 state.cases=[confirmedCase('case-rule-1','rule-1','RULE_CONFIRMED',[]),confirmedCase('case-rule-2','rule-2','RULE_CONFIRMED',[]),confirmedCase('case-ctx','ctx','CONTEXT_REVIEW',[finding('ctx','VIOLATION','대상을 향한 공격입니다.')]),
  {caseId:'case-held',liveId:'live-1',version:1,confirmationStatus:'PENDING',handlingRoute:'CONTEXT_REVIEW',messages:[masked('held','held 원문','HELD')],targetMessageIds:['held'],confirmedFindings:[],findings:[],createdAt:timestamp(),violationCount:3}];
 state.reviews=[{reviewId:'review-ctx',kind:'CONTEXT',liveId:'live-1',caseId:'case-ctx',status:'DECIDED',version:2,createdAt:timestamp(),aiVerdict:'VIOLATION',messages:state.cases[2].messages,targetMessageIds:['ctx'],findings:state.cases[2].findings,basisCaseIds:[],summary:'AI 제안을 확인하고 최종 결정해 주세요'},
  {reviewId:'review-kick',kind:'KICK',liveId:'live-1',caseId:'case-ctx',status:'PENDING',version:1,createdAt:timestamp(),aiVerdict:'VIOLATION',messages:[],targetMessageIds:['ctx'],findings:[],basisCaseIds:['case-rule-1','case-rule-2','case-ctx'],summary:'서로 다른 확정 사건 3건 — 방송 종료까지 차단 승인 요청'}];
 const page=await open('operator');
 await gotoQueue(page);const kick=page.locator('.studio-review.kick');await kick.waitFor();
 const reasons=await kick.locator('.basis-reason').allInnerTexts();
 assert.deepEqual(reasons,['규칙 자동 확정 · AI 조사 없음','규칙 자동 확정 · AI 조사 없음','AI 위반 의심 · 대상을 향한 공격입니다.']);
 await kick.getByText('기준 사건 AI 판단 근거 · case-ctx',{exact:true}).click();
 const basis=kick.getByRole('region',{name:'AI 판단 근거'});
 await basis.getByText('대상을 향한 공격입니다.',{exact:true}).waitFor();
 assert.match(await basis.innerText(),/CP-3.2/);
 // 아직 결정되지 않은 사건의 AI 조사가 실시간으로 진행된다.
 await waitFor(()=>clients.size>=2);
 emit('TOOL_START',{caseId:'case-held',tool:'get_context',callId:'c1'});emit('TOOL_END',{caseId:'case-held',tool:'get_context',callId:'c1',status:'OK',elapsedMs:900});
 await page.getByRole('navigation',{name:'운영자 메뉴'}).getByRole('button',{name:'사건 이력',exact:true}).click();
 await page.locator('.case-row[data-case-id="case-held"]').click();
 const flow=page.locator('.case-flow');await flow.waitFor();
 const steps=await flow.locator('li').evaluateAll(items=>items.map(li=>li.querySelector('b').textContent+' / '+li.querySelector('span').textContent));
 assert.equal(steps[0].startsWith('채팅 / held 원문'),true);
 assert.match(steps.find(x=>x.startsWith('AI 조사')),/^AI 조사 \/ 조사 중$/);
 assert.equal(steps.find(x=>x.startsWith('운영자 결정')),'운영자 결정 / 결정 대기');
 await page.locator('.case-row[data-case-id="case-ctx"]').click();
 const ctxSteps=await flow.locator('li').evaluateAll(items=>items.map(li=>li.querySelector('b').textContent+' / '+li.querySelector('span').textContent));
 assert.equal(ctxSteps.find(x=>x.startsWith('AI 판정')),'AI 판정 / 위반 의심 (VIOLATION) · 대상을 향한 공격입니다. · 정책 CP-3.2');
 assert.equal(ctxSteps.find(x=>x.startsWith('운영자 결정')),'운영자 결정 / 위반 확정');
 assert.match(ctxSteps.at(-1),/^강퇴 심사 \/ 기준 사건 3건 중 하나 · 결정 대기/);
 await page.locator('.case-row[data-case-id="case-rule-1"]').click();
 const ruleSteps=await flow.locator('li').evaluateAll(items=>items.map(li=>li.querySelector('b').textContent+' / '+li.querySelector('span').textContent));
 assert.equal(ruleSteps.find(x=>x.startsWith('AI 조사')),'AI 조사 / 없음 · Backend 규칙으로 바로 확정');
 await page.getByRole('navigation',{name:'운영자 메뉴'}).getByRole('button',{name:'시청자 관리',exact:true}).click();
 await page.getByRole('status').filter({hasText:'사람 결정 필요 1명'}).waitFor();
});

test('mock review card opens the case flow for that case',async()=>{
 const page=await openMockModerator();
 await showQueue(page,'문맥 검토');const card=page.locator('.studio-review.context').first();await card.waitFor();
 await openMore(card);const text=await card.locator('.review-target').innerText();
 await card.getByRole('button',{name:'처리 흐름 보기 →',exact:true}).click();
 const flow=page.locator('.case-flow');await flow.waitFor();
 assert.match(await flow.locator('li').first().innerText(),new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.match(await flow.innerText(),/결정 대기/);
});

test('API chat archive lists every message for the operator, pages older chats and filters',async()=>{
 state.pageSize=2;
 state.messages=[message('old-public','observer',undefined,{text:'오래된 공개 채팅'}),message('hidden-1','author','HIDDEN',{text:'숨긴 욕설 채팅'}),message('new-public','observer',undefined,{text:'최근 공개 채팅'})];
 state.cases=[{caseId:'case-hidden',liveId:'live-1',version:2,confirmationStatus:'CONFIRMED_VIOLATION',handlingRoute:'RULE_CONFIRMED',messages:[{messageId:'hidden-1',authorAlias:'U1',text:'숨긴 욕설 채팅',visibility:'HIDDEN',sentAt:timestamp()}],targetMessageIds:['hidden-1'],confirmedFindings:[{findingId:'f-h',category:'PROFANITY',status:'CONFIRMED',confirmedAt:timestamp(),revokedAt:null}],findings:[],createdAt:timestamp(),violationCount:1}];
 const page=await open('operator');
 await page.getByRole('navigation',{name:'운영자 메뉴'}).getByRole('button',{name:'채팅 기록',exact:true}).click();
 const more=page.getByRole('button',{name:'이전 채팅 더 불러오기',exact:true});await more.waitFor();
 await more.click();await more.waitFor({state:'detached'});
 const rows=page.locator('.chat-db tbody tr');await waitFor(async()=>await rows.count()===3);
 assert.match(await rows.first().innerText(),/최근 공개 채팅/);
 const hidden=page.locator('.chat-db tr[data-message-id="hidden-1"]');
 assert.match(await hidden.innerText(),/숨김/);assert.match(await hidden.innerText(),/위반 확정/);
 await page.getByRole('group',{name:'채팅 상태 필터'}).getByRole('button',{name:/^비공개/}).click();
 assert.equal(await rows.count(),1);
 await page.getByRole('group',{name:'채팅 상태 필터'}).getByRole('button',{name:/^전체/}).click();
 await page.getByLabel('채팅 기록 검색').fill('오래된');assert.equal(await rows.count(),1);
});

test('mock chat archive links a moderated message to its case flow',async()=>{
 const page=await openMockModerator();
 await page.getByRole('navigation',{name:'운영자 메뉴'}).getByRole('button',{name:'채팅 기록',exact:true}).click();
 await page.getByRole('group',{name:'채팅 상태 필터'}).getByRole('button',{name:/^사건 있음/}).click();
 const row=page.locator('.chat-db tbody tr').first();const text=await row.locator('.chat-db-text').innerText();
 await row.getByRole('button',{name:'처리 흐름 →',exact:true}).click();
 const flow=page.locator('.case-flow');await flow.waitFor();
 assert.equal(await page.locator('.status-strip b').first().innerText(),'사건 이력');
 assert.match(await flow.locator('li').first().innerText(),new RegExp(text.slice(0,6).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

// 판정 흐름 그래프의 노드·선 상태(path·wait·skip·unknown·later)를 한 번에 읽는다.
const flowTones=(detail,kind='node')=>detail.locator(kind==='node'?'.flow-graph [data-flow-node]':'[data-flow-edge]').evaluateAll((els,kind)=>Object.fromEntries(els.map(el=>[el.dataset[kind==='node'?'flowNode':'flowEdge'],['path','wait','skip','unknown','later'].find(c=>el.classList.contains(c))])),kind);
const pathOf=async detail=>Object.entries(await flowTones(detail)).filter(([,t])=>t==='path').map(([k])=>k);

// 시스템 운영자 화면의 '채팅관제 Tracking' 탭을 연다(목업).
async function openTracking(){
 const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Seoul'});contexts.push(context);
 const page=await context.newPage();page.on('pageerror',e=>runtimeErrors.push(e.message));
 const time=new Date('2026-10-22T05:14:50Z');await page.clock.install({time});await page.clock.pauseAt(time);
 await page.goto(mockBase);await page.getByRole('button',{name:'시스템 운영자 전용',exact:true}).click();
 await page.getByRole('button',{name:'로그인',exact:true}).click();
 await page.getByRole('tab',{name:'채팅관제 Tracking',exact:true}).click();
 await page.locator('.tracking-grid').waitFor();
 return page;
}

test('streamer monitor shows only the stream and the live chat; chat tracking lives in the admin page',async()=>{
 const page=await openMockModerator();
 await page.locator('.chat-panel').waitFor();
 assert.equal(await page.locator('.chat-detail').count(),0);
 assert.equal(await page.locator('.chat-row[role=button]').count(),0,'chat rows are not selectable on the streamer screen');
 const chat=await page.locator('.chat-panel').boundingBox(),stream=await page.locator('.stream-panel').boundingBox();
 assert.equal(Math.round(chat.width),Math.round(stream.width));
 // 채팅 시각은 시:분, 마우스를 올리면 날짜까지.
 const time=page.locator('.chat-row .chat-time').first();
 assert.match(await time.innerText(),/^\d{2}:\d{2}$/);assert.match(await time.getAttribute('title'),/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('admin chat tracking: an AI-decided case is released by the backend without an operator (v3.2 §5)',async()=>{
 const page=await openTracking();const detail=page.locator('.chat-detail');
 const row=page.locator('.tracking-grid .chat-row').filter({hasText:'고객센터 help@game-corp.example'});
 assert.equal(await row.locator('.state-pill').count(),0);
 await row.click();
 await detail.locator('[data-flow-outcome]').getByText('개인정보 정상 · 가림 해제',{exact:true}).waitFor();
 await detail.locator('[data-flow-outcome]').getByText('판단: Agent · 검증·해제: 백엔드 · 운영자 검토 없음',{exact:true}).waitFor();
 assert.deepEqual(await pathOf(detail),['input','classify','agent','policy','verify','normal']);
 assert.equal((await flowTones(detail)).wait,'skip');assert.equal((await flowTones(detail,'edge'))['verify-normal'],'path');
 await detail.locator('.flow-graph [data-flow-node="policy"]').click();
 await detail.locator('[data-flow-evidence]').getByText('AI 제안 위반 아님 (NO_VIOLATION)',{exact:true}).waitFor();
 await detail.locator('.flow-graph [data-flow-node="verify"]').click();
 await detail.locator('[data-flow-evidence]').getByText('결과: 가림 해제',{exact:true}).waitFor();
 await detail.locator('[data-flow-history]').getByText(/개인정보 정상 판정 → 운영자 검토 없이 공개/).waitFor();
});

test('admin chat tracking shows the filter result, rule outcome and AI judgment without inventing one',async()=>{
 const page=await openTracking();const detail=page.locator('.chat-detail'),outcome=detail.locator('[data-flow-outcome]'),evidence=detail.locator('[data-flow-evidence]'),historyBox=detail.locator('[data-flow-history]');
 await detail.getByText('채팅을 누르면',{exact:false}).waitFor();
 const pick=text=>page.locator('.tracking-grid .chat-row').filter({hasText:text}).first().click();
 await pick('오늘 몇 시까지 하세요?');
 // 목업 Backend는 통과한 채팅도 처리 기록을 남긴다. 기록에 근거해 통과 경로만 칠한다.
 await outcome.getByText('필터 통과 (목업 기록)',{exact:true}).waitFor();await outcome.getByText('백엔드에서 통과',{exact:true}).waitFor();
 assert.deepEqual(await pathOf(detail),['input','classify','public']);
 await historyBox.getByText('사전에 걸린 단어 없음',{exact:true}).waitFor();
 await pick('시발 너 진짜 못하네');
 await outcome.getByText('규칙 자동 확정',{exact:true}).waitFor();await outcome.getByText('백엔드만으로 처리됨',{exact:true}).waitFor();
 const nodes=await flowTones(detail);
 assert.deepEqual(await pathOf(detail),['input','classify','rule','sanction']);
 for(const id of ['public','agent','policy','verify','wait','normal'])assert.equal(nodes[id],'skip',id);
 await evidence.locator('.evidence-stage').getByText('숨김 · 제재 적용').waitFor();
 await evidence.getByText('위반 유형 욕설',{exact:true}).waitFor();
 assert.equal(await detail.locator('[data-mock-trace]').count(),0);
 await detail.locator('.flow-graph [data-flow-node="classify"]').click();
 await evidence.getByText("사전 검사: 확정 욕설 '시발'",{exact:true}).waitFor();
 // 운영자 결정 대기 중인 문맥 검토: Agent 판단 과정(목업)과 백엔드 검증. 조회 전용이라 결정 버튼이 없다.
 await pick('아 진짜 노잼이네 꺼져라');
 await outcome.getByText('AI 제안 · 위반 의심',{exact:true}).waitFor();await outcome.getByText('AI 제안 · 운영자 결정 대기',{exact:true}).waitFor();
 assert.equal((await flowTones(detail)).wait,'wait');
 assert.equal(await detail.getByRole('button',{name:'결정하러 가기 →'}).count(),0);
 await detail.locator('.flow-graph [data-flow-node="policy"]').click();
 const mockTrace=evidence.locator('[data-mock-trace]');
 await mockTrace.getByText(/실제 Agent는 판단 과정을 보내지 않고/).waitFor();
 await mockTrace.getByText("공격 표현 '꺼져'이 들어 있습니다.",{exact:true}).waitFor();
 assert.match(await mockTrace.locator('.trace-answer').innerText(),/"verdict": "VIOLATION"/);
 for(const tool of ['search_policy','get_policy_section'])await mockTrace.getByText(tool,{exact:true}).waitFor();
 await detail.locator('.flow-graph [data-flow-node="verify"]').click();
 await evidence.getByText('결과: 운영자 결정 대기',{exact:true}).waitFor();
 assert.equal(await evidence.locator('[data-mock-trace]').count(),0);
 // 운영자가 정상 확정한 채팅(목업 시작 데이터).
 await pick('와 방금 컨트롤 미쳤다');
 await outcome.getByText('운영자 정상 확정 · 공개',{exact:true}).waitFor();
 assert.deepEqual(await pathOf(detail),['input','classify','agent','policy','verify','wait','normal']);
 await historyBox.getByText('정상 확정 → 공개',{exact:true}).waitFor();
 // 1 : 2 배치. 넓은 화면에서 채팅 상세는 2열(왼쪽 결과·근거·기록, 오른쪽 흐름도).
 await page.setViewportSize({width:1440,height:1000});
 const chat=await page.locator('.tracking-grid .chat-panel').boundingBox(),side=await detail.boundingBox();
 assert(Math.abs(side.width/chat.width-2)<0.08,`detail:chat = ${side.width}:${chat.width}`);
 const mainBox=await detail.locator('.flow-main').boundingBox(),sideBox=await detail.locator('.flow-side').boundingBox();
 assert(sideBox.x>=mainBox.x+mainBox.width);assert(Math.abs(sideBox.y-mainBox.y)<2);
 assert((await detail.locator('.chat-row.detail-message').boundingBox()).height>=20);
 // 임시 비노출과 숨김은 같은 회색 표시다.
 const look=sel=>page.locator(sel).first().evaluate(el=>{const c=getComputedStyle(el);return c.backgroundColor+'|'+c.color;});
 assert.equal(await look('.tracking-grid .chat-row.held .state-pill'),await look('.tracking-grid .chat-row.hidden .state-pill'));
 assert.equal(await look('.tracking-grid .chat-row.held'),await look('.tracking-grid .chat-row.hidden'));
});

test('policy v3.2: the policy page explains CP-3.3 and the mock shows v3.2',async()=>{
 const page=await openMockModerator();
 await page.locator('.sidebar-foot').getByText('운영정책 v3.2 기준',{exact:true}).waitFor();await page.locator('.topbar .mode-badge').getByText('MOCK 데이터',{exact:true}).waitFor();
 await page.getByRole('navigation',{name:'운영자 메뉴'}).getByRole('button',{name:'정책 근거',exact:true}).click();
 await page.getByText(/운영정책 v3\.2\(2026-10-23\) 기준/).waitFor();
 const rules=page.locator('[data-policy-harassment]');
 await rules.getByText('CP-3.3 집단 대상 비하·배제',{exact:false}).waitFor();
 await rules.getByText(/대상 집단이 불명확하면 AI는 판단 보류/).waitFor();
 await page.getByText(/전화번호·계좌번호\(하이픈 묶음 10자리 이상\)·이메일 형식/).waitFor();
 assert.equal(await page.getByText('운영정책 v3.1',{exact:false}).count(),0);
});

test('mock follows the Backend v3.2 personal-data candidate rules (rules-v2)',async()=>{
 const page=await openMockModerator();
 const r=await page.evaluate(async()=>{const m=await import('/src/mockLive.ts');
  const cases=['제 번호 010-1234-5678','010 1234 5678','02-123-4567 사무실','+82 10-1234-5678','후원은 123-456-789012','메일 a.b@mail.example','주문번호 1234567890123','2026-10-23 방송','https://user@site.example/x'];
  return cases.map(t=>({t,tags:m.piiTags(t),masked:m.maskText(t)}));});
 const byText=Object.fromEntries(r.map(x=>[x.t,x]));
 assert.deepEqual(byText['제 번호 010-1234-5678'].tags,['PII_PHONE']);
 assert.deepEqual(byText['010 1234 5678'].tags,['PII_PHONE']);
 assert.deepEqual(byText['02-123-4567 사무실'].tags,['PII_PHONE']);
 assert.deepEqual(byText['+82 10-1234-5678'].tags,['PII_PHONE']);
 assert.deepEqual(byText['후원은 123-456-789012'].tags,['PII_ACCOUNT']);assert.equal(byText['후원은 123-456-789012'].masked,'후원은 [ACCOUNT]');
 assert.deepEqual(byText['메일 a.b@mail.example'].tags,['PII_EMAIL']);
 // 하이픈 없는 숫자 나열은 후보가 아니지만 가린다(AC-06). 날짜는 계좌가 아니다. 스킴 있는 주소 안의 @는 이메일이 아니다.
 assert.deepEqual(byText['주문번호 1234567890123'].tags,[]);assert.equal(byText['주문번호 1234567890123'].masked,'주문번호 [ACCOUNT]');
 assert.deepEqual(byText['2026-10-23 방송'].tags,[]);
 assert.deepEqual(byText['https://user@site.example/x'].tags,[]);
 // 계좌번호 채팅은 개인정보 조사로 임시 비노출된다.
 await openDemo(page);await page.getByRole('button',{name:'계좌번호',exact:true}).click();
 const row=page.locator('.chat-row').filter({hasText:'후원은 123-456-789012'});await row.waitFor();
 assert.match(await row.getAttribute('class'),/held/);
});

test('mock CP-3.3 example: group exclusion goes to context review with an AI suggestion citing CP-3.3',async()=>{
 const page=await openMockModerator();await openDemo(page);
 await page.getByRole('button',{name:'집단 배제 (v3.2)',exact:true}).click();
 const row=page.locator('.chat-row').filter({hasText:'○○ 출신은 다 꺼져라'});await row.waitFor();
 assert.match(await row.getAttribute('class'),/held/);
 await showQueue(page,'문맥 검토');
 const card=page.locator('.studio-review').filter({hasText:'○○ 출신은 다 꺼져라'});await openCard(card);
 const evidence=card.getByRole('region',{name:'AI 판단 근거'});
 await evidence.getByText('CP-3.3',{exact:true}).waitFor();await evidence.getByText('괴롭힘',{exact:true}).waitFor();
 await card.getByText('AI 제안 · 위반 의심',{exact:true}).waitFor();
 // 시청자 관리의 누적 열은 v3.2 계약의 뜻(같은 방송의 다른 확정 사건 수)으로 표시한다.
 await page.getByRole('navigation',{name:'운영자 메뉴'}).getByRole('button',{name:'시청자 관리',exact:true}).click();
 await page.getByRole('columnheader',{name:'다른 확정 사건'}).waitFor();
 assert.equal(await page.getByText('판정 시점 누적',{exact:true}).count(),0);
});

test('API review opened without an AI judgment (A-25) shows "AI 결과 없음", then takes the late judgment',async()=>{
 const held={messageId:'held-1',authorAlias:'U1',text:'held-1 원문',visibility:'HELD',sentAt:timestamp()};
 state.messages=[message('held-1','author','HELD')];
 state.cases=[{caseId:'case-ctx',liveId:'live-1',version:1,confirmationStatus:'PENDING',handlingRoute:'CONTEXT_REVIEW',messages:[held],targetMessageIds:['held-1'],confirmedFindings:[],findings:[],createdAt:timestamp(),violationCount:0}];
 state.reviews=[{reviewId:'review-ctx',kind:'CONTEXT',liveId:'live-1',caseId:'case-ctx',status:'PENDING',version:1,createdAt:timestamp(),aiVerdict:'NEEDS_REVIEW',messages:[held],targetMessageIds:['held-1'],findings:[],basisCaseIds:[],summary:'AI 분석 결과를 받지 못했습니다. 주변 문맥을 확인하고 직접 결정해 주세요'}];
 const page=await open('operator');await waitFor(()=>clients.size>=1);
 await showQueue(page,'문맥 검토');
 const card=page.locator('.studio-review[data-review-id="review-ctx"]');await card.waitFor();
 // AI가 판단을 보류한 것(판단 보류)이 아니라 AI 결과가 아예 없다.
 await card.locator('.review-head').getByText('AI 결과 없음',{exact:true}).waitFor();
 await openCard(card);
 const box=card.getByRole('note',{name:'AI 결과 없음'});
 await box.getByText('AI 분석 결과를 받지 못했습니다. 주변 문맥을 확인하고 직접 결정해 주세요',{exact:true}).waitFor();
 assert.equal(await card.getByText('판단 보류',{exact:false}).count(),0);
 assert.equal(await card.getByRole('region',{name:'AI 판단 근거'}).count(),0);
 // 사건 이력도 "AI 조사 중"이 아니라 결정 대기 · AI 결과 없음으로 보인다.
 await page.getByRole('navigation',{name:'운영자 메뉴'}).getByRole('button',{name:'사건 이력',exact:true}).click();
 await page.getByText('결정 대기 · AI 결과 없음',{exact:true}).first().waitFor();
 // 결정 전에 판정이 늦게 오면 같은 검토에 붙고 버전이 오른다. 카드는 AI 제안으로 바뀐다.
 const finding={messageId:'held-1',verdict:'VIOLATION',categories:['HARASSMENT'],policyIds:['CP-3.2'],reason:'특정 시청자를 반복해서 공격합니다.',missingFacts:[]};
 state.cases[0].findings=[finding];Object.assign(state.reviews[0],{version:2,aiVerdict:'VIOLATION',findings:[finding],summary:'AI 제안을 확인하고 최종 결정해 주세요'});
 emit('CONTEXT_REVIEW_REQUIRED',{reviewId:'review-ctx',caseId:'case-ctx',aiVerdict:'VIOLATION'});
 await gotoQueue(page);await showQueue(page,'문맥 검토');
 await page.locator('.studio-review[data-review-id="review-ctx"][data-version="2"]').waitFor();
 await card.locator('.review-head').getByText('위반 의심',{exact:true}).waitFor();
 await openCard(card);await card.getByRole('region',{name:'AI 판단 근거'}).getByText('특정 시청자를 반복해서 공격합니다.',{exact:true}).waitFor();
 assert.equal(await card.getByRole('note',{name:'AI 결과 없음'}).count(),0);
 await decideCard(card,'정상 확정');await waitFor(()=>state.decisions.length===1);
 assert.equal(state.decisions[0].body.expectedReviewVersion,2);
});

test('mock "Agent 응답 없음" (A-25): the card says AI 결과 없음 and the decision is applied right away',async()=>{
 const page=await openMockModerator();await openDemo(page);
 await page.getByRole('button',{name:'Agent 응답 없음 (A-25)',exact:true}).click();
 const row=page.locator('.chat-row').filter({hasText:'진짜 미쳤냐 그만 좀 해'});await row.waitFor();
 assert.match(await row.getAttribute('class'),/held/);
 await showQueue(page,'문맥 검토');
 const card=page.locator('.studio-review').filter({hasText:'진짜 미쳤냐 그만 좀 해'});await openCard(card);
 await card.getByRole('note',{name:'AI 결과 없음'}).waitFor();
 await decideCard(card,'정상 확정');
 await gotoMonitor(page);await waitFor(async()=>!/held/.test(await row.getAttribute('class')));
});

test('admin chat tracking shows the no-AI path (A-25) and counts real DEFER decisions, not version bumps',async()=>{
 const page=await openTracking();const detail=page.locator('.chat-detail'),outcome=detail.locator('[data-flow-outcome]'),evidence=detail.locator('[data-flow-evidence]');
 await page.locator('.tracking-grid .chat-row').filter({hasText:'방송 왜 이래 미쳤나 진짜'}).first().click();
 await outcome.getByText('AI 결과 없음 · 운영자 결정 대기',{exact:true}).waitFor();
 assert.deepEqual(await pathOf(detail),['input','classify','agent']);
 const nodes=await flowTones(detail),edges=await flowTones(detail,'edge');
 assert.equal(nodes.wait,'wait');assert.equal(nodes.policy,'skip');assert.equal(nodes.verify,'skip');
 assert.equal(edges['agent-wait'],'path');assert.equal(edges['agent-policy'],'skip');
 await detail.locator('[data-flow-edge="agent-wait"]').getByText('AI 결과 없음',{exact:true}).waitFor();
 await detail.locator('.flow-graph [data-flow-node="agent"]').click();
 await evidence.getByText(/AI 분석 결과를 받지 못했습니다/).waitFor();await evidence.getByText('A-25',{exact:true}).waitFor();
 await detail.locator('.flow-graph [data-flow-node="wait"]').click();
 await evidence.getByText('AI 결과 없음 · 운영자가 주변 문맥을 보고 직접 판단',{exact:true}).waitFor();
 assert.equal(await evidence.getByText(/^보류 /).count(),0,'no defer was recorded');
 await detail.locator('[data-flow-history]').getByText('판정 마감 초과',{exact:true}).waitFor();
});

test('admin chat tracking shows a real DEFER as "보류 1회" (from the decision event, not the review version)',async()=>{
 const page=await openMockModerator();
 await showQueue(page,'문맥 검토');
 const card=page.locator('.studio-review').filter({hasText:'아 진짜 노잼이네 꺼져라'});await openCard(card);
 await decideCard(card,'보류');await page.waitForTimeout(200);
 await page.getByRole('button',{name:'로그아웃',exact:true}).click();
 await page.getByRole('button',{name:'시스템 운영자 전용',exact:true}).click();await page.getByRole('button',{name:'로그인',exact:true}).click();
 await page.getByRole('tab',{name:'채팅관제 Tracking',exact:true}).click();
 const detail=page.locator('.chat-detail');
 await page.locator('.tracking-grid .chat-row').filter({hasText:'아 진짜 노잼이네 꺼져라'}).first().click();
 await detail.locator('.flow-graph [data-flow-node="wait"]').click();
 await detail.locator('[data-flow-evidence]').getByText(/^보류 1회 · 같은 검토로 다시 결정 대기/).waitFor();
});

test('mock context review stays held on defer, then applies normal and violation decisions',async()=>{
 async function decide(label,reason){
  const page=await openMockModerator();await openDemo(page);await page.getByRole('button',{name:'공격 표현',exact:true}).click();
  const row=page.locator('.chat-row').filter({hasText:'너 같은 건 방송 접어라'});await row.waitFor();
  assert.match(await row.getAttribute('class'),/held/);
  await showQueue(page,'문맥 검토');const card=page.locator('.studio-review').filter({hasText:'너 같은 건 방송 접어라'});await openCard(card);
  await card.getByText('AI 제안 · 위반 의심',{exact:true}).waitFor();await card.getByRole('region',{name:'AI 판단 근거'}).getByText('CP-3.2',{exact:true}).waitFor();
  await decideCard(card,label);await page.waitForTimeout(200);const remaining=await card.count();
  await gotoMonitor(page);
  return {page,row,card,remaining};
 }
 const deferred=await decide('보류','아직 맥락을 더 확인해야 합니다.');
 await deferred.page.locator('.studio-notice').getByText('보류했습니다. 검토 대기에 남습니다.',{exact:true}).waitFor();
 // #28: 운영자 안내는 화면 안 줄로만. 토스트는 로그인 직후 알림뿐이다
 assert.equal(await deferred.page.locator('.toast').filter({hasText:'보류했습니다'}).count(),0);
 assert.match(await deferred.row.getAttribute('class'),/held/);assert.equal(deferred.remaining,1);
 const normal=await decide('정상 확정','위반 근거가 충분하지 않아 정상으로 확정합니다.');
 await waitFor(async()=>!(await normal.row.getAttribute('class')).includes('held'));
 assert.doesNotMatch(await normal.row.getAttribute('class'),/hidden/);assert.equal(normal.remaining,0);
 const violation=await decide('위반 확정','대상에 대한 공격 표현으로 판단했습니다.');
 await waitFor(async()=>(await violation.row.getAttribute('class')).includes('hidden'));
});

test('mock 24-hour timeout is automatic and the kick review lists its three basis cases',async()=>{
 const page=await openMockModerator();await gotoQueue(page);
 const card=page.locator('.studio-review.kick');await card.waitFor();
 assert.equal(await card.locator('tbody tr').count(),3);
 assert.equal(await card.locator('.review-excerpt').innerText(),'확정 사건 3건');
 await openMore(card);assert.match(await card.locator('.review-summary').innerText(),/서로 다른 확정 사건 3건/);
 await page.getByRole('button',{name:'정책 근거',exact:true}).click();
 await page.getByText('모든 채팅 제한은 자동 적용되며, 24시간 제한도 강퇴가 아닙니다.',{exact:false}).waitFor();
 assert.equal(await page.getByText('interrupt()',{exact:false}).count(),0);
});

test('mock kick approval is explicitly simulated and blocks that viewer for the live session',async()=>{
 const page=await openMockModerator();await gotoQueue(page);
 await decideCard(page.locator('.studio-review.kick'),'강퇴 승인');
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
 await page.locator('.studio-notice').getByText('강퇴가 모의 적용됐습니다.',{exact:true}).waitFor();
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
  const page=await openMockModerator();await gotoQueue(page);
  await decideCard(page.locator('.studio-review.kick'),'강퇴 승인');
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
 assert.deepEqual(await menus(api),['실시간 관제','결정 대기','시청자 관리','사건 이력','채팅 기록','정책 근거']);
 for(const page of [api,mock]){
  // 강퇴 승인과 문맥 검토는 탭으로 나뉜다. 강퇴 요청이 있으면 강퇴 탭이 먼저 보이고, 다른 탭에는 대기 표시가 붙는다.
  assert.equal(await page.locator('.studio-review').count(),0);await gotoQueue(page);
  const tabs=page.getByRole('tablist',{name:'결정 대기 종류'});
  assert.deepEqual((await tabs.getByRole('tab').allInnerTexts()).map(x=>x.replace(/\s+/g,' ').trim()),['강퇴 승인 1',`문맥 검토 ${page===mock?2:1}`]); // 목업은 'AI 결과 없음' 검토(A-25)가 하나 더 있다
  assert.match(await tabs.getByRole('tab',{selected:true}).innerText(),/^강퇴 승인/);
  assert.equal(await page.locator('.studio-review.context').count(),0);assert.equal(await tabs.locator('.tab-alert').count(),1);
  await showQueue(page,'문맥 검토');assert.equal(await page.locator('.studio-review.kick').count(),0);assert.equal(await page.locator('.studio-review.context.open').count(),1);
  await showQueue(page,'강퇴 승인');
  assert.equal(await page.locator('.auto-section').count(),0);
  assert.equal(await page.locator('.studio-review.kick tbody tr').count(),3);
 }
 assert.equal(await api.getByText('MOCK',{exact:false}).count(),0);assert.equal(await api.locator('.scenario-toolbar').count(),0);
 const card=api.locator('.studio-review[data-review-id="review-ctx"]');
 await showQueue(api,'문맥 검토');await openMore(card);await card.getByText('AI 제안 · 판단 보류',{exact:true}).waitFor();await card.getByRole('region',{name:'AI 판단 근거'}).getByText('특정 시청자를 겨냥했는지',{exact:true}).waitFor();
 await card.locator('.review-head b').filter({hasText:'author'}).waitFor();
 // 결정 사유 입력란이 없고(A-26) 요청 본문에도 reason을 보내지 않는다.
 assert.equal(await card.locator('textarea').count(),0,'no decision reason input');
 await decideCard(card,'위반 확정');
 await waitFor(()=>state.decisions.length===1);
 const {path:decisionPath,body}=state.decisions[0];
 assert.equal(decisionPath,'/api/context-reviews/review-ctx/decision');
 assert.deepEqual({...body,clientRequestId:typeof body.clientRequestId},{expectedReviewVersion:1,decision:'CONFIRM_VIOLATION',categories:['HARASSMENT'],evidenceMessageIds:['held-1'],clientRequestId:'string'});
 await waitFor(async()=>await card.count()===0);
 await capture(api,'studio-api');await capture(mock,'studio-mock');
 // 강퇴: 승인 접수 → ACTION_APPLIED로 적용 완료 → 기준 사건 오판 취소로 검토가 무효가 되면 해제로 표시
 const kick=api.locator('.studio-review[data-review-id="review-kick"]');
 await showQueue(api,'강퇴 승인');await openCard(kick);
 assert.equal(await kick.locator('textarea').count(),0,'no kick decision reason input');
 await decideCard(kick,'강퇴 승인');
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

test('API decision evidence uses persisted findings, refreshes on SSE and renders reasons as text',async()=>{
 const f={messageId:'evidence-msg',verdict:'NEEDS_REVIEW',categories:[],policyIds:['CP-3.2'],reason:'<img src=x onerror="alert(1)"> 문맥 확인 필요',missingFacts:['공격 대상과 대화 맥락 확인']};
 state.messages=[message('evidence-msg','author','HELD')];
 const c={caseId:'case-evidence',liveId:'live-1',version:1,confirmationStatus:'PENDING',handlingRoute:'CONTEXT_REVIEW',messages:[{messageId:'evidence-msg',authorAlias:'U1',text:'검토 대상',visibility:'HELD',sentAt:timestamp()}],targetMessageIds:['evidence-msg'],confirmedFindings:[],findings:[f],createdAt:timestamp(),violationCount:0};
 state.cases=[c];
 state.reviews=[{reviewId:'review-evidence',kind:'CONTEXT',liveId:'live-1',caseId:c.caseId,status:'PENDING',version:1,createdAt:timestamp(),aiVerdict:'NEEDS_REVIEW',messages:c.messages,targetMessageIds:c.targetMessageIds,findings:[],basisCaseIds:[],summary:'검토 요청'}];
 const page=await open('operator');await gotoQueue(page);
 const evidence=page.getByRole('region',{name:'AI 판단 근거'});
 await evidence.getByText(f.reason,{exact:true}).waitFor();
 await evidence.getByText('공격 대상과 대화 맥락 확인',{exact:true}).waitFor();
 assert.match(await evidence.innerText(),/서버에 저장된 AI 조사 결과/);
 assert.match(await evidence.innerText(),/CP-3.2/);
 assert.equal(await evidence.locator('img').count(),0);
 await waitFor(()=>clients.size>=2);
 c.findings=[{...f,verdict:'VIOLATION',categories:['HARASSMENT'],reason:'서버에서 갱신한 판단 근거',missingFacts:[]}];
 emit('CASE_UPDATED',{caseId:c.caseId});
 await evidence.getByText('서버에서 갱신한 판단 근거',{exact:true}).waitFor();
 assert.equal(await evidence.getByText('공격 대상과 대화 맥락 확인',{exact:true}).count(),0);
 state.reviews[0].findings=[{...f,verdict:'NO_VIOLATION',reason:'검토 API가 반환한 최신 근거',policyIds:[],missingFacts:[]}];
 emit('CASE_UPDATED',{caseId:c.caseId});
 await evidence.getByText('검토 API가 반환한 최신 근거',{exact:true}).waitFor();
 await evidence.getByText('제출된 정책 근거 없음',{exact:true}).waitFor();
});

test('API admin shows the same system screen as the mock with empty data and no invented metrics',async()=>{
 const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Seoul'});contexts.push(context);
 const mock=await context.newPage();mock.on('pageerror',e=>runtimeErrors.push(e.message));
 await mock.goto(mockBase);await mock.getByRole('button',{name:'시스템 운영자 전용',exact:true}).click();
 await mock.getByRole('button',{name:'로그인',exact:true}).click();await mock.locator('.sys-shell').waitFor();
 const api=await open('admin');await api.locator('.sys-shell').waitFor();
 // API admin: 같은 메뉴·지표·표 제목, 값만 비어 있다. 백엔드에 시스템 운영자 권한과 여러 방송 조회 API가 없다
 const shape=async page=>({
  tabs:await page.getByRole('tab').allInnerTexts(),
  charts:await page.locator('.sys-chart-card h2').allInnerTexts(),
  sections:await page.locator('.sys-section h2').allInnerTexts()
 });
 assert.deepEqual(await shape(api),await shape(mock));
 assert.equal(await api.locator('.mode-badge').innerText(),'연결 대기');assert.equal(await mock.locator('.mode-badge').innerText(),'MOCK 데이터');
 // 차트도 가짜 0 없이 비워 둔다
 assert.equal(await api.locator('.sys-chart-card .stacked-empty').filter({hasText:'연동 API 없음'}).count(),2);
 assert.equal(await api.locator('.sys-chart-card .stacked-legend, .sys-base').count(),0);
 assert.equal(await api.locator('.sys-table .empty-block').filter({hasText:'여러 방송 조회 API가 없어 표시할 데이터가 없습니다.'}).count(),3);
 const text=await api.locator('.sys-shell').innerText();
 for(const invented of ['행복한게임방','2,341','명 시청','LIVE 1'])assert(!text.includes(invented),invented);
 await capture(mock,'admin-mock');await capture(api,'admin-api');
 await api.getByRole('tab',{name:'채팅관제 Tracking',exact:true}).click();
 await api.locator('.tracking-grid').getByText('표시할 채팅이 없습니다.',{exact:true}).waitFor();
 await capture(api,'admin-api-tracking');
});

test('admin dashboard charts split chat judgment from kick approval and rank channels by abnormal rate',async()=>{
 const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Seoul'});contexts.push(context);
 const page=await context.newPage();page.on('pageerror',e=>runtimeErrors.push(e.message));
 await page.goto(mockBase);await page.getByRole('button',{name:'시스템 운영자 전용',exact:true}).click();
 await page.getByRole('button',{name:'로그인',exact:true}).click();await page.locator('.sys-shell').waitFor();
 const [judgment,kick]=await page.locator('.sys-chart-card').all();
 const count=t=>Number(t.replace(/[^0-9]/g,''));
 // ① 모수는 검사한 채팅, ② 모수는 강퇴 승인 요청. 범례 합이 각 모수와 같다
 for(const [card,labels] of [[judgment,['정상','비정상','판정 대기']],[kick,['스트리머 승인','결정 대기','스트리머 기각']]]){
  assert.deepEqual(await card.locator('.stacked-legend span').allInnerTexts(),labels);
  const sum=(await card.locator('.stacked-legend b').allInnerTexts()).map(count).reduce((a,b)=>a+b,0);
  assert.equal(sum,count(await card.locator('.sys-base').innerText()));
 }
 assert(count(await kick.locator('.sys-base').innerText())<count(await judgment.locator('.sys-base').innerText()));
 // 조각에 마우스를 올리면 라벨·건수·% 툴팁
 await judgment.locator('.stacked-seg').first().hover();
 assert.match(await page.getByRole('tooltip').innerText(),/^정상 · [0-9,]+건 · [0-9.]+%$/);
 // 방송별 분포는 비정상 비율이 높은 순
 const rates=(await page.locator('.sys-channel-meta').allInnerTexts()).map(t=>Number(/비정상 ([0-9.]+)%/.exec(t)[1]));
 assert.equal(rates.length,5);assert.deepEqual(rates,[...rates].sort((a,b)=>b-a));
 await capture(page,'admin-dashboard-charts');
});
