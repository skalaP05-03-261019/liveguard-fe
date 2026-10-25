import { LIVE_CHANNEL_ID, sysChannels } from './systemMock';
import { addDays, aggregatePeriodStats, kstDay, kstStart, type PeriodFixture, type PeriodStats } from './periodAggregation';
export { addDays, daysBetween, kstDay, kstStart } from './periodAggregation';
export type { PeriodLive, PeriodDay, PeriodStats } from './periodAggregation';

// BE #89 proposal, not an implemented API: synthetic timestamped data is aggregated by
// message sentAt/review createdAt in [from,to), using current visibility. Never slice
// a real broadcast total proportionally or attribute a cross-midnight broadcast to its start day.
const rand = (seed: number) => { const v=Math.sin(seed*12.9898)*43758.5453;return v-Math.floor(v); };
const channels=[{ id:LIVE_CHANNEL_ID,name:'행복한게임방',live:true },...sysChannels.map(c=>({ id:c.id,name:c.name,live:c.live }))];
const BASE_RATE=[2.1,2.3,2.2,1.7,1.4];
function mockFixture(now: number): PeriodFixture {
  const today=kstDay(now),fixture:PeriodFixture={ lives:[],messages:[],reviews:[] };
  for(let k=35;k>=0;k--){
    const day=addDays(today,-k);
    channels.forEach((ch,i)=>{
      const r=(j:number)=>rand(k*97+i*13+j);
      let start:number,end:number|null;
      if(k===0){if(!ch.live)return;start=now-(1+i)*3600_000;end=null;}
      else {if(r(1)>0.7)return;start=kstStart(day)+(18+i%3)*3600_000;// Keep synthetic history before the current live and never mark a future ending as finished.
        end=Math.min(start+(2+Math.floor(r(2)*3))*3600_000,ch.live?now-(1+i)*3600_000:now);}
      const liveId=`${ch.id}-${day}`,stop=Math.min(end??now,now);
      if(stop<=start)return;
      fixture.lives.push({ liveId,channelId:ch.id,channelName:ch.name,startedAt:new Date(start).toISOString(),endedAt:end===null?null:new Date(end).toISOString() });
      const scanned=300+Math.floor(r(3)*1200),rate=Math.max(0.3,BASE_RATE[i]+(k===1&&i===1?4:0)+(r(4)-0.5)*1.2);
      const hidden=Math.round(scanned*rate/100),held=k===0?Math.floor(r(5)*8):0;
      const counts={ PUBLIC:scanned-hidden-held,HIDDEN:hidden,HELD:held };
      const buckets=Math.max(1,Math.ceil((stop-start)/900_000));
      for(let b=0;b<buckets;b++){
        const sentAt=new Date(start+Math.floor((b+0.5)*(stop-start)/buckets)).toISOString();
        for(const visibility of ['PUBLIC','HIDDEN','HELD'] as const){
          const count=Math.floor(counts[visibility]*(b+1)/buckets)-Math.floor(counts[visibility]*b/buckets);
          if(count)fixture.messages.push({ liveId,sentAt,visibility,count });
        }
      }
      const review=(status:PeriodFixture['reviews'][number]['status'],fraction:number)=>fixture.reviews.push({ liveId,status,createdAt:new Date(start+(stop-start)*fraction).toISOString() });
      if(r(6)<0.3)review('approved',0.6);
      if(r(7)<0.15)review('rejected',0.8);
      if(k===0&&r(8)<0.5)review('pending',0.9);
    });
  }
  return fixture;
}
let cached: { now:number;fixture:PeriodFixture }|undefined;
export function mockPeriodStats(fromDay:string,toDay:string,now:number):PeriodStats{
  if(cached?.now!==now)cached={ now,fixture:mockFixture(now) };
  return aggregatePeriodStats(fromDay,toDay,cached.fixture);
}
