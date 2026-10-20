import {ztime} from './core.mjs';
const MIN=60000;
function time(value){try{const n=Date.parse(ztime(value));return Number.isFinite(n)?n:NaN;}catch{return NaN;}}
const rowCache=new WeakMap();
function normalizedRows(rows){
 if(!Array.isArray(rows))return {events:[],invalid:true};
 if(rowCache.has(rows))return rowCache.get(rows);
 const events=[];let invalid=false;
 for(const r of rows){const t=time(r.event_datetime),lat=r.lat_decimal,lon=r.lon_decimal;
  if(!Number.isFinite(t)||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180){invalid=true;continue;}
  events.push({id:r.id,time:t,lat,lon});
 }
 const value={events,invalid};rowCache.set(rows,value);return value;
}
export function distanceNm(lat1,lon1,lat2,lon2){
 const rad=Math.PI/180,a=(lat2-lat1)*rad,b=(lon2-lon1)*rad;
 const h=Math.sin(a/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(b/2)**2;
 return 6371.0088/1.852*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));
}
const polygonBounds=new WeakMap();
export function insideWatch(rule,lat,lon){
 if(!rule.polygon)return distanceNm(rule.lat,rule.lon,lat,lon)<=rule.radiusNm+1e-8;
 let inside=false;const p=rule.polygon;let bounds=polygonBounds.get(p);if(!bounds){bounds=p.reduce((b,v)=>[Math.min(b[0],v[0]),Math.max(b[1],v[0]),Math.min(b[2],v[1]),Math.max(b[3],v[1])],[90,-90,180,-180]);polygonBounds.set(p,bounds);}if(lat<bounds[0]-1e-8||lat>bounds[1]+1e-8||lon<bounds[2]-1e-8||lon>bounds[3]+1e-8)return false;
 for(let i=0,j=p.length-1;i<p.length;j=i++){
  const [ay,ax]=p[j],[by,bx]=p[i],dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((lon-ax)*dx+(lat-ay)*dy)/den)):0;
  if(Math.hypot(lon-ax-t*dx,lat-ay-t*dy)<1e-8)return true;
  if((ay>lat)!==(by>lat)&&lon<(bx-ax)*(lat-ay)/(by-ay)+ax)inside=!inside;
 }return inside;
}
function validPolygon(p){return p===undefined||Array.isArray(p)&&p.length>=3&&p.length<=1000&&p.every(v=>Array.isArray(v)&&v.length===2&&Number.isFinite(v[0])&&Math.abs(v[0])<=90&&Number.isFinite(v[1])&&Math.abs(v[1])<=180);}
export function validLightningWatch(r){return !!r&&validPolygon(r.polygon)&&typeof r.id==='string'&&r.id.length>0&&r.id.length<=100&&typeof r.name==='string'&&r.name.trim().length>0&&r.name.length<=80&&Number.isFinite(r.lat)&&r.lat>=-90&&r.lat<=90&&Number.isFinite(r.lon)&&r.lon>=-180&&r.lon<=180&&Number.isFinite(r.radiusNm)&&r.radiusNm>0&&r.radiusNm<=100&&Number.isInteger(r.holdMinutes)&&r.holdMinutes>=1&&r.holdMinutes<=60&&['cg','cc','both'].includes(r.type)&&typeof r.enabled==='boolean'&&typeof r.showRing==='boolean'&&/^#[0-9a-f]{6}$/i.test(r.color);}
export function evaluateLightningWatch(rule,feeds,now=Date.now(),previousEvent=null){
 if(!rule.enabled)return {state:'paused',event:null,count:0,gaps:[],remainingMs:0};
 const types=rule.type==='both'?['cg','cc']:[rule.type],gaps=[],events=new Map();
 const cutoff=now-rule.holdMinutes*MIN;
 let latest=previousEvent&&types.includes(previousEvent.type)&&previousEvent.time<=now&&insideWatch(rule,previousEvent.lat,previousEvent.lon)?previousEvent:null;
 let through=Infinity;
 for(const type of types){
  const f=feeds?.[type],end=time(f?.window_end),start=time(f?.window_start),fetched=time(f?.fetched_at);
  const healthy=f?.status==='ok'&&Number.isFinite(fetched)&&now-fetched<=5*MIN&&fetched<=now+MIN&&Number.isFinite(end)&&end<=now+MIN&&end>=now-5*MIN&&Number.isFinite(start)&&start<=cutoff;
  if(!healthy)gaps.push(type.toUpperCase());
  through=Math.min(through,Number.isFinite(end)?end:-Infinity);
  const normalized=normalizedRows(f?.rows);
  for(const r of normalized.events){
   const {time:t,lat,lon}=r;
   if(t>now||t<cutoff)continue;
   const distance=distanceNm(rule.lat,rule.lon,lat,lon);if(!insideWatch(rule,lat,lon))continue;
   const event={time:t,lat,lon,type,distanceNm:distance};
   events.set(`${type}:${r.id??`${t}:${lat}:${lon}`}`,event);
   if(!latest||t>latest.time)latest=event;
  }
  if(normalized.invalid&&!gaps.includes(type.toUpperCase()))gaps.push(type.toUpperCase());
 }
 const remainingMs=latest?Math.max(0,latest.time+rule.holdMinutes*MIN-now):0;
 // Do not release a previous hold until a successful query covers its end time.
 if(latest&&remainingMs===0&&through<latest.time+rule.holdMinutes*MIN&&!gaps.includes('release pending'))gaps.push('release pending');
 return {state:remainingMs>0?'active':gaps.length?'unknown':'quiet',event:latest,count:events.size,gaps,remainingMs,through};
}
export function advanceLightningEpisode(previous,result){
 const next={active:previous?.active??false,ack:previous?.ack??false,event:result.event??previous?.event??null,notify:false};
 if(result.state==='active'){
  next.notify=!next.active||!!previous?.event&&result.event.time>previous.event.time;
  if(next.notify)next.ack=false;next.active=true;
 }else if(result.state==='quiet'||result.state==='paused'){next.active=false;next.ack=false;if(result.state==='paused')next.event=null;}
 return next;
}
