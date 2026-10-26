// Paired frontend comparison: phase1 vs the exact archived 60-minute-test build.
// Measures event-induced API work and rendered message rows, without AI/backend.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {execFileSync}=require('node:child_process');const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'docs/evidence/performance/recheck-2026-10-26');
const tmp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'liveguard-phase1-compare-')));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser,server,activeDist,clients=new Set(),eventId=0;
const messages=Array.from({length:1000},(_,i)=>({messageId:`m-${i}`,channelId:'channel-1',liveId:'live-1',authorAlias:'시험 시청자',text:`동일 조건 채팅 ${i}`,visibility:'PUBLIC',version:1,isMine:false,sentAt:new Date(1700000000000+i*1000).toISOString()}));
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.jpg':'image/jpeg','.mp4':'video/mp4'};
const result={measuredAt:new Date().toISOString(),browser:null,phase1Commit:execFileSync('git',['rev-parse','phase1^{commit}'],{cwd:root,encoding:'utf8'}).trim(),currentBuild:'production-build.zip: exact frontend build used for completed 60-minute run',conditions:'same laptop/browser, production API mode, 1000 input messages, 100 SSE events in one burst, 3 trials; 5-second periodic session poll disabled equally to isolate event-triggered work; empty reviews/cases; no AI calls',trials:[]};
function emit(event,payload){for(const c of clients){if(c.res.writableEnded)continue;if((event==='CHAT')===c.guard)continue;const id=String(++eventId);c.res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify({eventId:id,occurredAt:new Date().toISOString(),entityVersion:1,payload})}\n\n`);}}
async function serve(req,res){
 const u=new URL(req.url,'http://fixture'),role=req.headers['x-test-role']||'operator';
 const json=data=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data,traceId:'comparison'}));};
 if(u.pathname==='/api/auth/me')return json({userId:role,nickname:role,role:role==='operator'?'MODERATOR':'VIEWER',channelIds:['channel-1']});
 if(u.pathname.endsWith('/lives/current'))return json({liveId:'live-1',channelId:'channel-1',startedAt:new Date().toISOString(),endedAt:null});
 if(u.pathname.endsWith('/events')){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(': ready\n\n');const c={res,guard:u.pathname.includes('/guard/')};clients.add(c);req.on('close',()=>clients.delete(c));return;}
 if(u.pathname.endsWith('/messages'))return json({items:[...messages].reverse(),nextCursor:null,timeoutUntil:null});
 if(['/api/cases','/api/reviews','/api/channels'].includes(u.pathname))return json([]);
 if(u.pathname.startsWith('/api/')){res.writeHead(404);res.end();return;}
 const candidate=path.resolve(activeDist,'.'+u.pathname);const file=candidate.startsWith(activeDist+path.sep)&&fs.existsSync(candidate)&&fs.statSync(candidate).isFile()?candidate:path.join(activeDist,'index.html');res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
}
async function probe(version,scenario,trial){
 const role=scenario==='viewer-dom'?'viewer':'operator';
 const context=await browser.newContext({viewport:{width:1440,height:900},extraHTTPHeaders:{'x-test-role':role},reducedMotion:'reduce'});
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{const original=window.setInterval;window.setInterval=function(fn,delay,...args){if(delay===5000)return 0;return original(fn,delay,...args);};});
 try{
  await p.goto(`http://127.0.0.1:${server.address().port}`);const selector=version==='phase1'?'.v1-message':role==='viewer'?'.yt-chat-row':'.chat-list .chat-row';await p.locator(selector).first().waitFor();await sleep(250);
  const initialRows=await p.locator(selector).count();const requests=[];p.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/')&&!u.pathname.endsWith('/events'))requests.push(u.pathname);});
  if(scenario==='chat-burst'||scenario==='progress-burst'){
   for(let i=0;i<100;i++)emit(scenario==='chat-burst'?'CHAT':i%2?'TOOL_END':'TOOL_START',scenario==='chat-burst'?{messageId:'m-999',version:1}:{caseId:'trace-case',callId:`call-${i}`,tool:'fixed-fixture',status:'OK'});
   let last=-1,stable=0;for(let i=0;i<100;i++){await sleep(100);if(requests.length===last)stable++;else stable=0;last=requests.length;if(stable>=5)break;}
  }
  const byPath={};for(const url of requests)byPath[url]=(byPath[url]||0)+1;
  const out={version,scenario,trial,inputMessages:1000,eventCount:scenario.includes('burst')?100:0,initialRows,apiRequests:requests.length,byPath,errors};result.trials.push(out);console.log(JSON.stringify(out));
 }finally{await context.close();}
}
(async()=>{
 const source=path.join(tmp,'phase1');fs.mkdirSync(source);execFileSync('tar',['-xf','-','-C',source],{input:execFileSync('git',['archive','phase1'],{cwd:root,maxBuffer:64*1024*1024})});fs.symlinkSync(path.join(root,'node_modules'),path.join(source,'node_modules'),'dir');
 const {build}=await import('vite'),{default:vue}=await import('@vitejs/plugin-vue');const oldDist=path.join(tmp,'phase1-dist');
 await build({root:source,configFile:false,plugins:[vue()],define:{'import.meta.env.VITE_USE_API':'"true"','import.meta.env.VITE_USE_LIVE_V1':'"true"','import.meta.env.VITE_API_BASE_URL':'""'},build:{outDir:oldDist,emptyOutDir:true},logLevel:'error'});
 const currentDist=path.join(tmp,'current-dist');fs.mkdirSync(currentDist);execFileSync('unzip',['-q',path.join(evidence,'production-build.zip'),'-d',currentDist]);
 server=http.createServer((q,s)=>serve(q,s).catch(e=>{console.error(e);s.end();}));await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true});result.browser=browser.version();
 for(const [version,dist] of [['phase1',oldDist],['current',currentDist]]){activeDist=dist;for(let trial=1;trial<=3;trial++)for(const scenario of ['chat-burst','progress-burst','viewer-dom'])await probe(version,scenario,trial);}
 if(result.trials.some(x=>x.errors.length))throw new Error('Browser errors in comparison');
 fs.writeFileSync(path.join(evidence,'phase1-comparison.json'),JSON.stringify(result,null,2)+'\n');console.log('COMPARISON COMPLETE');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();for(const c of clients)c.res.end();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));});
