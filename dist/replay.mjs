import {ztime} from './core.mjs';
export const MINUTE=60000;
const cache=new WeakMap();
function time(value){try{return Date.parse(ztime(value));}catch{return NaN;}}
function indexed(feed,key){
 if(!feed)return [];
 if(cache.has(feed))return cache.get(feed);
 const result=(feed.rows||[]).map(row=>({row,time:time(key==='winds'?row.reading_datetime:key==='efm'?row.reading_date+'T'+row.reading_time:key==='radar'||key==='profilers'?row.observed_at:row.event_datetime)})).filter(r=>Number.isFinite(r.time)).sort((a,b)=>a.time-b.time);
 cache.set(feed,result);return result;
}
export function validReplay(history){const a=time(history?.start),b=time(history?.end);return !!history?.feeds&&Number.isFinite(a)&&Number.isFinite(b)&&b>a&&b-a<=70*MINUTE;}
export function replayBounds(history){return {start:time(history.start),end:time(history.end)};}
export function replayFrame(history,cursor,trail=15,baseUrl='https://example.com/data/replay/index.json'){
 if(!validReplay(history))throw Error('Invalid replay history');
 const feeds={},gaps=[];
 for(const key of ['winds','efm','radar','profilers','cc','cg']){
  const source=history.feeds[key]||{},rows=indexed(source,key);let selected=[];
  if(key==='winds'||key==='efm'||key==='profilers'){
   const latest=new Map(),maxAge=(key==='profilers'?20:2)*MINUTE;
   for(const r of rows){if(r.time>cursor)break;if(cursor-r.time>maxAge)continue;
    const id=key==='winds'?`${r.row.tower}:${r.row.hgt}`:key==='efm'?r.row.field_mill:r.row.site;latest.set(id,r);
   }selected=[...latest.values()];
  }else if(key==='radar'){
   const eligible=rows.filter(r=>r.time<=cursor&&cursor-r.time<=5*MINUTE);if(eligible.length)selected=[eligible.at(-1)];
  }else selected=rows.filter(r=>r.time<=cursor&&r.time>=cursor-trail*MINUTE);
  const observed=selected.length?new Date(selected.reduce((max,r)=>Math.max(max,r.time),-Infinity)).toISOString():null;
  feeds[key]={...source,rows:selected.map(r=>r.row),observed_at:observed,status:selected.length||['cc','cg'].includes(key)?source.status||'ok':'unavailable'};
  if(key==='radar'&&selected.length){const r=selected[0].row;feeds[key]={...feeds[key],...r,image_data:new URL(r.image_url,baseUrl).href};}
  if(key==='cc'||key==='cg'){
   if(time(source.window_start)>cursor-trail*MINUTE||!Number.isFinite(time(source.window_start))||time(source.window_end)<cursor-2*MINUTE||source.status!=='ok')gaps.push(key);
  }else if(!selected.length||source.status!=='ok')gaps.push(key);
 }
 return {generated_at:history.generated_at,feeds,gaps,frame_at:new Date(cursor).toISOString()};
}
export function advanceFrame(cursor,start,end,step=MINUTE){return cursor===null||cursor+step>end?start:Math.max(start,cursor+step);}
