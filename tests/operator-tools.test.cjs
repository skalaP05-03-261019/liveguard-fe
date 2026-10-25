const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');
async function model(){const source=fs.readFileSync(path.join(__dirname,'../src/operatorTools.ts'),'utf8');const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});return import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));}
test('shortcut settings reject collisions, corrupted persistence and composition/modifier/repeat events',async()=>{
 const {defaultSettings,settingsError,readSettings,shortcutAction}=await model();const s=defaultSettings();
 assert.equal(shortcutAction({key:'j'},s),'next');
 for(const flag of ['isComposing','ctrlKey','altKey','metaKey','shiftKey','repeat'])assert.equal(shortcutAction({key:'j',[flag]:true},s),null);
 assert.equal(shortcutAction({key:'j',keyCode:229},s),null);
 s.keys.next='k';assert.match(settingsError(s),/같은 단축키/);
 assert.deepEqual(readSettings(JSON.stringify(s)),defaultSettings());
 for(const raw of ['broken',null,'{}','{"version":2}','{"version":1,"notifications":true,"shortcuts":true,"keys":null}'])assert.deepEqual(readSettings(raw),defaultSettings());
 const saved=defaultSettings();saved.keys.next='n';assert.deepEqual(readSettings(JSON.stringify(saved)),saved);
 saved.waitMinutes=0;assert.match(settingsError(saved),/1~60/);
});
test('alerts contain metadata only, deduplicate, expire on decisions, and reset across account/live scopes',async()=>{
 const {AlertTracker}=await model();const t=new AlertTracker();const now=Date.parse('2026-10-25T00:00:00Z');
 const r={reviewId:'r',liveId:'live',kind:'CONTEXT',status:'PENDING',createdAt:now,text:'private original',summary:'010-1234-5678',reason:'secret'};
 assert.equal(t.update('user:live','live',true,[],{},now,5).length,0);
 let alerts=t.update('user:live','live',true,[r],{},now,5);assert.equal(alerts.length,1);
 assert(!JSON.stringify(alerts).includes('private'));assert(!JSON.stringify(alerts).includes('010'));assert(!JSON.stringify(alerts).includes('secret'));
 assert.equal(t.update('user:live','live',true,[{...r,version:2}],{},now,5).length,1);
 t.dismiss(alerts[0].key);assert.equal(t.update('user:live','live',true,[r],{},now,5).length,0);
 alerts=t.update('user:live','live',true,[r],{},now+300000,5);assert.equal(alerts.length,1);assert.equal(alerts[0].kind,'wait');
 assert.equal(t.update('user:live','live',true,[{...r,status:'DECIDED'}],{},now+300001,5).length,0);
 assert.equal(t.update('other:live','live',true,[r],{},now,5).length,0);
 assert.equal(t.update('other:next','next',true,[r],{},now,5).length,0);
});
test('unknown execution is not a failure; disabled alerts do not replay new-event backlog',async()=>{
 const {AlertTracker}=await model();const t=new AlertTracker();const r={reviewId:'kick',liveId:'live',kind:'KICK',status:'DECIDED',createdAt:0};
 assert.equal(t.update('u:l','live',true,[r],{kick:'실행 결과 확인 중 · 실패로 단정하지 않음'},1000,5).length,0);
 let a=t.update('u:l','live',true,[r],{kick:'강퇴 실행 실패 · 기존 제재 유지'},1000,5);assert.equal(a.length,1);assert.equal(a[0].kind,'failure');
 assert.equal(t.update('u:l','live',true,[{...r,status:'INVALIDATED'}],{kick:'강퇴 실행 실패'},1000,5).length,0);
 t.clear();t.update('u:l','live',false,[],{},1000,5);t.update('u:l','live',false,[{...r,status:'PENDING'}],{},1000,5);
 assert.equal(t.update('u:l','live',true,[{...r,status:'PENDING'}],{},1000,5).length,0);
});
