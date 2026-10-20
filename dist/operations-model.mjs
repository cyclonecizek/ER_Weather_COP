import {clean,ztime,windSide} from './core.mjs';
import {windAlertSite,WIND_METRICS} from './wind-alerts.mjs';
import {distanceNm,insideWatch} from './lightning-watches.mjs?v=ops-20261020';
export const minute=60000;
export function eventTime(value){try{return Date.parse(ztime(value));}catch{return NaN;}}
export function observationRows(rows=[]){
 const latest=new Map();
 for(const row of rows){if(typeof row.tower!=='string'||clean(row.hgt)===null)continue;const time=eventTime(row.reading_datetime);if(!Number.isFinite(time))continue;const site=windAlertSite(row.tower),key=site+':'+row.hgt,old=latest.get(key);
  if(!old||time>old.time||time===old.time&&windSide(row)>windSide(old))latest.set(key,{...row,site,time});
 }
 return [...latest.values()];
}
export function lightningRows(feeds={},now=Date.now(),minutes=60){
 const unique=new Map();for(const type of ['cg','cc'])for(const row of feeds[type]?.rows||[]){const time=eventTime(row.event_datetime),lat=row.lat_decimal,lon=row.lon_decimal;
  if(!Number.isFinite(time)||time>now||time<now-minutes*minute||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)continue;
  const key=type+':'+(row.id??`${time}:${lat}:${lon}`);unique.set(key,{...row,type,time,lat,lon});
 }return [...unique.values()].sort((a,b)=>b.time-a.time);
}
const nearbyBounds=new WeakMap();
export function distanceToWatch(rule,lat,lon){
 if(insideWatch(rule,lat,lon))return 0;
 if(!rule.polygon)return Math.max(0,distanceNm(rule.lat,rule.lon,lat,lon)-rule.radiusNm);
 let bounds=nearbyBounds.get(rule.polygon);if(!bounds){bounds=rule.polygon.reduce((b,v)=>[Math.min(b[0],v[0]),Math.max(b[1],v[0]),Math.min(b[2],v[1]),Math.max(b[3],v[1])],[90,-90,180,-180]);nearbyBounds.set(rule.polygon,bounds);}const pad=5/59,lonPad=pad/Math.max(.01,Math.cos(lat*Math.PI/180));if(lat<bounds[0]-pad||lat>bounds[1]+pad||lon<bounds[2]-lonPad||lon>bounds[3]+lonPad)return Infinity;
 const scale=Math.cos(lat*Math.PI/180),xy=p=>[(p[1]-lon)*60*scale,(p[0]-lat)*60];let nearest=Infinity;
 for(let i=0,j=rule.polygon.length-1;i<rule.polygon.length;j=i++){
  const [ax,ay]=xy(rule.polygon[j]),[bx,by]=xy(rule.polygon[i]),dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/den)):0;nearest=Math.min(nearest,Math.hypot(ax+t*dx,ay+t*dy));
 }return nearest;
}
export function ringActivity(rule,events,now=Date.now()){
 const bins=Array(12).fill(0);let cg=0,cc=0,nearby=0;
 for(const e of events){if(rule.type!=='both'&&rule.type!==e.type)continue;const age=now-e.time;if(age<0||age>60*minute)continue;
  if(insideWatch(rule,e.lat,e.lon)){const bin=11-Math.floor(age/(5*minute));if(bin>=0)bins[bin]++;if(age<rule.holdMinutes*minute){if(e.type==='cg')cg++;else cc++;}}
  else if(age<rule.holdMinutes*minute&&distanceToWatch(rule,e.lat,e.lon)<=5)nearby++;
 }return {bins,cg,cc,nearby};
}
export function monitorEvents(previous,next,category){
 const out=[],before=new Map(previous.map(r=>[r.rule.id,r]));
 for(const row of next){const prior=before.get(row.rule.id),base={category,location:row.rule.name};
  if(row.state==='active'&&prior?.state!=='active'&&!prior?.latched)out.push({...base,event:'Activated',detail:category==='lightning'?`${row.rule.type.toUpperCase()} detection at ${new Date(row.event.time).toISOString()}; ${row.rule.holdMinutes}-minute hold started.`:`${WIND_METRICS[row.rule.metric]||'Wind'} ≥ ${row.rule.threshold} kt at or below ${row.rule.maxHeight} ft. ${(row.hits||[]).map(h=>h.site+': '+h.value+' kt at '+h.hgt+' ft ('+h.observedAt+')').join('; ')}`});
  else if(row.state==='active'&&category==='lightning'&&row.event?.time>(prior?.event?.time??Infinity))out.push({...base,event:'Hold reset',detail:`Detection at ${new Date(row.event.time).toISOString()} restarted the ${row.rule.holdMinutes}-minute hold.`});
  if(prior&&(prior.latched||prior.state==='active')&&['quiet','clear'].includes(row.state))out.push({...base,event:'Released',detail:category==='lightning'?'Hold elapsed and current coverage confirms release.':'Fresh observations are below the configured threshold.'});
  if(prior&&(row.state==='unknown'||row.gaps?.length)&&prior.state!=='unknown'&&!prior.gaps?.length)out.push({...base,event:'Data gap',detail:'Monitoring coverage incomplete; an active condition is not cleared.'});
  if((prior?.state==='unknown'||prior?.gaps?.length)&&['active','quiet','clear'].includes(row.state)&&!row.gaps?.length)out.push({...base,event:'Coverage restored',detail:'Current data is available again.'});
  if(row.ack&&!prior?.ack)out.push({...base,event:'Acknowledged',detail:'Condition remains visible while active.'});
  if(prior&&row.state==='paused'&&prior.state!=='paused')out.push({...base,event:'Paused',detail:'Monitoring disabled by this browser.'});
 }
 return out;
}
export function csv(rows){return rows.map(row=>row.map(value=>{let text=String(value??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
export function validLog(rows,now=Date.now()) {return Array.isArray(rows)?rows.filter(r=>r&&Number.isFinite(r.time)&&r.time<=now&&r.time>=now-7*86400000&&['wind','lightning','system'].includes(r.category)&&['event','location','detail','operator'].every(k=>typeof r[k]==='string')).slice(0,2000):[];}
