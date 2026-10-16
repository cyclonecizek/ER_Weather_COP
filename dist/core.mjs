export const DEFAULTS={layers:{winds:true,efm:true,cc:true,cg:true,profilers:false,radar:true},thermo:{tmp:false,dp:false,rh:false},windScale:1.3,efmScale:1.15,radarOpacity:.65,cartoKey:'',height:'54',trail:15,labels:true,gusts:false,basemap:'dark',low:500,high:1000,efmColors:['#28dc46','#ffcd19','#ff3737'],ccBreaks:[5,20,50,100,250],ccColors:['#3278f0','#1ecde6','#73e164','#f5dc3c','#fa9123','#f03c50'],windColor:'#dfedfa'};
export const KM_LAT=111.195,KM_LON=KM_LAT*Math.cos(28.5*Math.PI/180);
export function clean(v){return typeof v==='number'&&Number.isFinite(v)&&v!==999&&v!==9999?v:null;}
export function windSite(tower){const m=/^(\d{1,4})(N|NE|E|SE|S|SW|W|NW)?$/.exec(tower);return m?m[1].padStart(4,'0'):tower;}
export function windSide(r){const m=/^\d{1,4}(N|NE|E|SE|S|SW|W|NW)$/.exec(r.tower);return m&&m[1]===r.prevailing?2:1;}
export function validWind(r){return clean(r.avg_spd_1min)!==null&&r.avg_spd_1min>=0&&clean(r.avg_dir_1min)!==null&&r.avg_dir_1min>=0&&r.avg_dir_1min<=360;}
export function selectWinds(rows,height){const groups=new Map();for(const r of rows){const key=windSite(r.tower);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}const selected=[];for(const [site,all] of groups){let pool=all.filter(validWind);if(height==='surface')pool=pool.filter(r=>r.hgt<=20);else if(height==='200plus')pool=pool.filter(r=>r.hgt>=200);else if(height!=='lowest')pool=pool.filter(r=>r.hgt===Number(height));pool.sort((a,b)=>a.hgt-b.hgt||Date.parse(b.reading_datetime+'Z')-Date.parse(a.reading_datetime+'Z')||windSide(b)-windSide(a));if(pool.length)selected.push({...pool[0],site});}return selected;}
export function efmCategory(v,s){const x=Math.abs(v);return x<s.low?0:x<s.high?1:2;}
export function ccCells(rows,now,trail,settings){const t=Math.floor(now/60000)*60000;const counts=new Map();for(const r of rows){const time=Date.parse(r.event_datetime.endsWith('Z')?r.event_datetime:r.event_datetime+'Z');const lat=r.lat_decimal,lon=r.lon_decimal;if(!Number.isFinite(time)||typeof lat!=='number'||typeof lon!=='number'||time<t-trail*60000||time>=t)continue;const i=Math.floor((lon+80.6)*KM_LON),j=Math.floor((lat-28.5)*KM_LAT),key=`${i},${j}`;counts.set(key,(counts.get(key)||0)+1);}return [...counts].map(([key,count])=>{const [i,j]=key.split(',').map(Number);const index=settings.ccBreaks.findIndex(b=>count<b);return {lat:28.5+(j+.5)/KM_LAT,lon:-80.6+(i+.5)/KM_LON,count,color:settings.ccColors[index<0?5:index]};});}
export function freshAge(iso,now=Date.now()){return iso?Math.max(0,(now-Date.parse(iso))/60000):Infinity;}
export function ztime(s){return s?new Date(s.endsWith('Z')||/[+-]\d\d:\d\d$/.test(s)?s:s+'Z').toISOString():null;}
export function settingsValid(s){return typeof s.cartoKey==='string'&&s.cartoKey.length<512&&Number.isFinite(s.windScale)&&s.windScale>=.6&&s.windScale<=2.2&&Number.isFinite(s.efmScale)&&s.efmScale>=.6&&s.efmScale<=2.2&&Number.isFinite(s.radarOpacity)&&s.radarOpacity>=0&&s.radarOpacity<=1&&['tmp','dp','rh'].every(k=>typeof s.thermo[k]==='boolean')&&Number.isInteger(s.trail)&&s.trail>=1&&s.trail<=60&&['dark','light','satellite'].includes(s.basemap)&&typeof s.labels==='boolean'&&typeof s.gusts==='boolean'&&Object.values(s.layers).every(x=>typeof x==='boolean')&&s.efmColors.length===3&&s.ccColors.length===6&&Number.isFinite(s.low)&&Number.isFinite(s.high)&&s.low>=0&&s.high>s.low&&s.ccBreaks.length===5&&s.ccBreaks.every((v,i)=>Number.isFinite(v)&&v>0&&(i===0||v>s.ccBreaks[i-1]))&&[...s.efmColors,...s.ccColors,s.windColor].every(c=>/^#[0-9a-f]{6}$/i.test(c));}
export function settingsFrom(saved){try{const s={...structuredClone(DEFAULTS),...saved,layers:{...DEFAULTS.layers,...saved?.layers},thermo:{...DEFAULTS.thermo,...saved?.thermo}};return settingsValid(s)?s:structuredClone(DEFAULTS);}catch{return structuredClone(DEFAULTS);}}

export function selectWindPlots(rows,height,fields){
 const winds=new Map(selectWinds(rows,height).map(r=>[r.site,r]));
 const groups=new Map();for(const r of rows){const site=windSite(r.tower);if(!groups.has(site))groups.set(site,[]);groups.get(site).push(r);}
 const out=[];
 for(const [site,all] of groups){
  const thermo={};let representative;
  for(const key of ['tmp','dp','rh']){
   let pool=all.filter(r=>clean(r[key])!==null&&(key!=='rh'||r.rh>=0&&r.rh<=100));
   if(height==='surface')pool=pool.filter(r=>r.hgt<=10);
   else if(height==='200plus')pool=pool.filter(r=>r.hgt>=200);
   else if(height!=='lowest')pool=pool.filter(r=>r.hgt===Number(height));
   pool.sort((a,b)=>a.hgt-b.hgt||windSide(b)-windSide(a));
   if(pool[0]){thermo[key]={value:pool[0][key],height:pool[0].hgt,time:pool[0].reading_datetime};if(fields[key])representative=pool[0];}
  }
  const wind=winds.get(site);
  if(wind||representative)out.push({...wind||representative,site,hasWind:!!wind,thermo});
 }
 return out;
}
