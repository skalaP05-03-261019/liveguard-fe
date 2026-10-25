export type ShortcutAction = 'next' | 'previous' | 'toggle' | 'search';
export interface ToolSettings { version: 1; notifications: boolean; shortcuts: boolean; waitMinutes: number; keys: Record<ShortcutAction,string> }
export const shortcutLabels: Record<ShortcutAction,string> = { next:'다음 요청', previous:'이전 요청', toggle:'상세 펼침·접기', search:'채팅 검색' };
export function defaultSettings():ToolSettings { return {version:1,notifications:true,shortcuts:true,waitMinutes:5,keys:{next:'j',previous:'k',toggle:'o',search:'/'}}; }
export function settingsError(s:ToolSettings):string {
  const keys=Object.values(s.keys);
  if(keys.some(k=>!/^([a-z0-9/\[\]])$/.test(k)))return '단축키는 영문 소문자·숫자·/·[·] 중 한 글자로 입력하세요.';
  if(new Set(keys).size!==keys.length)return '같은 단축키를 두 동작에 지정할 수 없습니다.';
  if(!Number.isInteger(s.waitMinutes)||s.waitMinutes<1||s.waitMinutes>60)return '장기 대기 기준은 1~60분으로 설정하세요.';
  return '';
}
export function readSettings(raw:string|null):ToolSettings {
  const fallback=defaultSettings();
  try{const value=JSON.parse(raw??'null');
    if(value?.version!==1||typeof value.notifications!=='boolean'||typeof value.shortcuts!=='boolean')return fallback;
    const s:ToolSettings={version:1,notifications:value.notifications,shortcuts:value.shortcuts,waitMinutes:value.waitMinutes,keys:{next:value.keys?.next,previous:value.keys?.previous,toggle:value.keys?.toggle,search:value.keys?.search}};
    return settingsError(s)?fallback:s;
  }catch{return fallback;}
}
export function shortcutAction(e: {key:string;isComposing?:boolean;keyCode?:number;ctrlKey?:boolean;altKey?:boolean;metaKey?:boolean;shiftKey?:boolean;repeat?:boolean},s:ToolSettings):ShortcutAction|null{
  if(!s.shortcuts||e.isComposing||e.keyCode===229||e.ctrlKey||e.altKey||e.metaKey||e.shiftKey||e.repeat)return null;
  return (Object.keys(s.keys) as ShortcutAction[]).find(action=>s.keys[action]===e.key.toLowerCase())??null;
}
export interface AlertReview { reviewId:string;liveId:string;kind:'KICK'|'CONTEXT';status:string;createdAt:string|number }
export interface OperatorAlert { key:string;reviewId:string;kind:'new'|'wait'|'failure';label:string }
export class AlertTracker {
  private scope='';private initialized=false;
  private seen=new Set<string>();private waited=new Set<string>();private failed=new Set<string>();
  private alerts:OperatorAlert[]=[];
  clear(){this.scope='';this.initialized=false;this.seen.clear();this.waited.clear();this.failed.clear();this.alerts=[];}
  dismiss(key:string){this.alerts=this.alerts.filter(a=>a.key!==key);}
  update(scope:string,liveId:string,enabled:boolean,reviews:readonly AlertReview[],progress:Record<string,string>,now:number,waitMinutes:number):OperatorAlert[]{
    if(this.scope!==scope){this.clear();this.scope=scope;}
    const current=new Map(reviews.filter(r=>r.liveId===liveId).map(r=>[r.reviewId,r]));
    const add=(r:AlertReview,kind:OperatorAlert['kind'],label:string)=>this.alerts.unshift({key:`${kind}:${r.reviewId}`,reviewId:r.reviewId,kind,label});
    if(!enabled)this.alerts=[];
    for(const r of current.values()){
      if(r.status==='PENDING'){
        if(enabled&&this.initialized&&!this.seen.has(r.reviewId))add(r,'new',r.kind==='KICK'?'새 강퇴 승인 요청':'새 문맥 검토 요청');
        const at=typeof r.createdAt==='number'?r.createdAt:Date.parse(r.createdAt);
        if(enabled&&Number.isFinite(at)&&now-at>=waitMinutes*60000&&!this.waited.has(r.reviewId)){add(r,'wait',r.kind==='KICK'?'오래 기다린 강퇴 승인 요청':'오래 기다린 문맥 검토 요청');this.waited.add(r.reviewId);}
      }
      const failure=r.kind==='KICK'&&r.status!=='INVALIDATED'&&progress[r.reviewId]?.startsWith('강퇴 실행 실패');
      if(failure&&!this.failed.has(r.reviewId)){if(enabled)add(r,'failure','강퇴 실행 실패 확인');this.failed.add(r.reviewId);}
      this.seen.add(r.reviewId);
    }
    this.initialized=true;
    this.alerts=this.alerts.filter(a=>{const r=current.get(a.reviewId);return !!r&&(a.kind==='failure'?r.status!=='INVALIDATED'&&!!progress[r.reviewId]?.startsWith('강퇴 실행 실패'):r.status==='PENDING');}).slice(0,20);
    return [...this.alerts];
  }
}
