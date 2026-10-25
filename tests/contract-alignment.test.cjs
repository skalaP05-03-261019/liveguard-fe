const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
async function source(name){
 const text=fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
 const {outputText}=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
 return import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
}
test('basis cases and display decisions do not infer categories, missing decisions or roles',async()=>{
 const {basisCaseCount,reportStatus}=await source('reportSummary.ts');
 assert.equal(basisCaseCount(['case-a','case-b','case-c','case-a']),3);
 assert.equal(reportStatus('PENDING'),'PENDING');
 assert.equal(reportStatus('DECIDED',{value:'APPROVE'}),'APPROVED');
 assert.equal(reportStatus('DECIDED',{value:'REJECT'}),'REJECTED');
 assert.equal(reportStatus('DECIDED'),'UNAVAILABLE');
 assert.equal(reportStatus('PENDING',{value:'APPROVE'}),'UNAVAILABLE');
 assert.equal(reportStatus('INVALIDATED',{value:'APPROVE'}),'INVALIDATED');
 assert.equal(reportStatus('FUTURE_STATE'),'UNAVAILABLE');
});
test('SSE entity versions reject old messages and keep independent case/review ordering',async()=>{
 const {EventVersions}=await source('eventVersions.ts');const versions=new EventVersions();
 versions.observe('message','m',3);
 assert.equal(versions.accept('MESSAGE_VISIBILITY_CHANGED',{payload:{messageId:'m',version:2}}),false);
 assert.equal(versions.accept('MESSAGE_RESTORED',{entityVersion:4,payload:{messageId:'m'}}),true);
 assert.equal(versions.accept('CHAT',{entityVersion:3,payload:{messageId:'m'}}),false);
 versions.observe('case','same-id',20);versions.observe('review','same-id',2);
 assert.equal(versions.accept('REVIEW_DECIDED',{entityVersion:3,payload:{reviewId:'same-id',caseId:'same-id'}}),true);
 assert.equal(versions.accept('CASE_UPDATED',{entityVersion:19,payload:{caseId:'same-id'}}),false);
 assert.equal(versions.accept('CASE_UPDATED',{entityVersion:20,payload:{caseId:'same-id'}}),true);
 for(const event of ['TOOL_START','TOOL_END','TASK_FAILED','LIVE_ENDED','LIVE_ACCESS_BLOCKED'])assert.equal(versions.accept(event,{entityVersion:1,payload:{caseId:'same-id'}}),true);
 assert.equal(versions.accept('CONTEXT_REVIEW_REQUIRED',{payload:{reviewId:'same-id'}}),true);
 versions.clear();assert.equal(versions.accept('CHAT',{entityVersion:1,payload:{messageId:'m'}}),true);
});
test('period messages and requests use half-open timestamps and conserve daily totals across midnight',async()=>{
 const {aggregatePeriodStats,kstStart}=await source('periodAggregation.ts');
 const at=n=>new Date(kstStart('2026-10-20')+n).toISOString();
 const day=86400000;
 const fixture={lives:[
  {liveId:'cross',channelId:'channel',channelName:'자정 방송',startedAt:at(-3600000),endedAt:at(day+3600000)},
  {liveId:'end-at-from',channelId:'channel',channelName:'경계 종료',startedAt:at(-7200000),endedAt:at(0)},
  {liveId:'start-at-to',channelId:'channel',channelName:'경계 시작',startedAt:at(day),endedAt:null}
 ],messages:[
  {liveId:'cross',sentAt:at(-1),visibility:'HIDDEN',count:5},
  {liveId:'cross',sentAt:at(0),visibility:'PUBLIC',count:2},
  {liveId:'cross',sentAt:at(day-1),visibility:'HIDDEN',count:3},
  {liveId:'cross',sentAt:at(day),visibility:'HELD',count:7}
 ],reviews:[
  {liveId:'cross',createdAt:at(-1),status:'approved'},
  {liveId:'cross',createdAt:at(0),status:'rejected'},
  {liveId:'cross',createdAt:at(day),status:'pending'}
 ]};
 const single=aggregatePeriodStats('2026-10-20','2026-10-20',fixture);
 assert.deepEqual(single.lives.map(l=>l.liveId),['cross']);
 assert.equal(single.lives[0].scanned,5);assert.equal(single.lives[0].hidden,3);assert.equal(single.lives[0].held,0);
 assert.deepEqual(single.lives[0].kickReviews,{pending:0,approved:0,rejected:1,invalidated:0});
 assert.deepEqual(single.daily,[{date:'2026-10-20',scanned:5,hidden:3,held:0}]);
 const both=aggregatePeriodStats('2026-10-20','2026-10-21',fixture);
 for(const key of ['scanned','hidden','held'])assert.equal(both.lives.reduce((n,l)=>n+l[key],0),both.daily.reduce((n,d)=>n+d[key],0));
 assert.equal(both.daily[1].held,7);
 assert.equal(both.lives.find(l=>l.liveId==='cross').kickReviews.pending,1);
});
