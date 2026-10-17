import {clean,windSite,windSide,ztime} from './core.mjs';

export function windAlertSite(tower){const match=/^(LC\d+[AB]?)(NE|NW|SE|SW|N|E|S|W)$/.exec(tower);return match?match[1]:windSite(tower);}
function preferred(r){const side=/^(?:\d{1,4}|LC\d+[AB]?)(NE|NW|SE|SW|N|E|S|W)$/.exec(r.tower)?.[1];return side&&side===r.prevailing?2:windSide(r);}
export const WIND_METRICS={avg_spd_1min:'Sustained · 1-minute mean',peak_spd_1min:'Peak · 1 minute',peak_spd_10min:'Peak · 10 minutes'};
export function validWindRule(r){
 return !!r&&typeof r.id==='string'&&r.id.length>0&&r.id.length<=100&&typeof r.name==='string'&&r.name.trim().length>0&&r.name.length<=80&&typeof r.enabled==='boolean'&&Array.isArray(r.towers)&&r.towers.length>0&&r.towers.length<=200&&r.towers.every(t=>typeof t==='string'&&/^[A-Z0-9_]{1,24}$/.test(t))&&Object.hasOwn(WIND_METRICS,r.metric)&&Number.isFinite(r.threshold)&&r.threshold>0&&r.threshold<=300&&Number.isFinite(r.maxHeight)&&r.maxHeight>0&&r.maxHeight<=2000;
}
export function evaluateWindRule(rule,feed,now=Date.now()){
 if(!rule.enabled)return {state:'paused',hits:[],gaps:[]};
 const latest=new Map();
 for(const r of feed?.rows||[]){
  if(typeof r.tower!=='string'||!rule.towers.includes(windAlertSite(r.tower))||clean(r.hgt)===null||r.hgt<=0||r.hgt>rule.maxHeight)continue;
  let time;try{time=Date.parse(ztime(r.reading_datetime));}catch{continue;}
  if(!Number.isFinite(time))continue;
  const key=`${windAlertSite(r.tower)}:${r.hgt}`,old=latest.get(key);
  if(!old||time>old.time||time===old.time&&preferred(r)>preferred(old.r))latest.set(key,{r,time});
 }
 const hits=[],gaps=[];
 for(const tower of rule.towers){
  const sensors=[...latest.values()].filter(x=>windAlertSite(x.r.tower)===tower);let valid=0,missing=0;
  for(const {r,time} of sensors){
   const value=clean(r[rule.metric]);
   if(feed?.status!=='ok'||now-time>5*60000||time-now>60000||value===null||value<0){missing++;continue;}
   valid++;
   if(value>=rule.threshold)hits.push({...r,site:tower,value,observedAt:new Date(time).toISOString()});
  }
  if(!valid||missing)gaps.push(tower);
 }
 hits.sort((a,b)=>b.value-a.value||a.site.localeCompare(b.site)||a.hgt-b.hgt);
 return {state:hits.length?'active':gaps.length?'unknown':'clear',hits,gaps};
}

export function advanceWindEpisode(previous,result){
 const next={active:previous?.active??false,ack:previous?.ack??false,notify:false};
 if(result.state==='active'){next.notify=!next.active;if(next.notify)next.ack=false;next.active=true;}
 else if((result.state==='clear'&&result.gaps.length===0)||result.state==='paused'){next.active=false;next.ack=false;}
 return next;
}
