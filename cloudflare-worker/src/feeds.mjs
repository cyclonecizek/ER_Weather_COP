const MIN=60000;
export const FAST_FEEDS=['winds','efm','cc','cg'];
export const FM_IDS=new Set([1,2,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,24,25,26,27,28,29,30,31,32,33,34,35]);
export const asUTC=s=>s&&(/Z$|[+-]\d\d:\d\d$/.test(s)?s:s+'Z');
export function mergeEvents(previous,incoming,start,end){
 const rows=new Map();
 for(const r of [...previous,...incoming]){
  const t=Date.parse(asUTC(r.event_datetime));
  if(r.id==null||!Number.isFinite(t)||t<start||t>=end)continue;
  if(typeof r.lat_decimal!=='number'||typeof r.lon_decimal!=='number')continue;
  rows.set(r.id,Object.fromEntries(['id','event_date','event_time','event_datetime','lat_decimal','lon_decimal','signal_strength','sensor_ids'].map(k=>[k,r[k]??null])));
 }
 return [...rows.values()].sort((a,b)=>Date.parse(asUTC(a.event_datetime))-Date.parse(asUTC(b.event_datetime)));
}
export function failedFeed(previous,error,now){return {...previous,rows:previous?.rows||[],status:'error',error:String(error.message||error),failed_at:new Date(now).toISOString()};}
export async function jsonFetch(url,fetcher=fetch){
 const response=await fetcher(url,{headers:{Accept:'application/json','User-Agent':'ER-Weather-COP-Worker/1.0'},signal:AbortSignal.timeout(15000)});
 if(!response.ok){const error=new Error(`Source returned HTTP ${response.status}`);error.status=response.status;error.body=(await response.text()).slice(0,2000);throw error;}
 return response.json();
}
export async function fetchFeed(key,previous,now,baseline={},fetcher=fetch){
 const array=async url=>{const rows=await jsonFetch(url,fetcher);if(!Array.isArray(rows))throw Error('Source response was not an array');return rows;};
 const iso=new Date(now).toISOString();let result;
 if(key==='winds'){
  const rows=(await array('https://codiapi-winds1.rad.spaceforce.mil/winds/latest')).filter(r=>r.hgt!=null&&r.tower&&Number.isFinite(r.lat)&&Number.isFinite(r.lon));
  if(!rows.length)throw Error('No WINDS records returned');
  result={rows,source:'WINDS one-minute API',observed_at:asUTC(rows.map(r=>r.reading_datetime).sort().at(-1))};
 }else if(key==='efm'){
  const rows=(await array('https://codiapi-lplws1.rad.spaceforce.mil/lplws_1min/latest')).filter(r=>FM_IDS.has(r.field_mill)&&Number.isFinite(r.lat)&&Number.isFinite(r.lon));
  if(!rows.length)throw Error('No configured EFM records returned');
  const configured=new Map((baseline.rows||[]).map(r=>[r.field_mill,r]));
  for(const r of rows){
   if(!(r.lat>=28&&r.lat<=29.3&&r.lon>=-81.5&&r.lon<=-80)){
    const fallback=configured.get(r.field_mill);
    if(fallback&&fallback.lat>=28&&fallback.lat<=29.3){r.lat=fallback.lat;r.lon=fallback.lon;r.coordinate_source='Configured location; API location outside Cape coverage';}
    else{r.coordinate_source='API location outside Cape coverage; omitted';r._omit=true;}
   }
  }
  result={rows:rows.filter(r=>!r._omit),source:'LPLWS one-minute API',observed_at:asUTC(rows.map(r=>r.reading_date+'T'+r.reading_time).sort().at(-1))};
 }else{
  const kind=key==='cc'?'c2c':'c2g';
  const base=`https://codiapi-lightning${kind}.rad.spaceforce.mil/lightning_${kind}`;
  const cutoff=now-60*MIN;
  const from=previous?.fetched_at?Math.max(cutoff,Date.parse(previous.fetched_at)-2*MIN):cutoff;
  let calls=0;
  async function chunk(a,b){
   if(++calls>32)throw Error('Lightning range requires too many requests; retaining last good data');
   const url=new URL(base+'/range');
   const date=t=>new Date(t).toISOString().slice(0,19);
   for(const [k,v] of Object.entries({'date>':date(a),'date<':date(b),'lat>':26,'lat<':31,'lon>':-84,'lon<':-77,sort:'asc'}))url.searchParams.set(k,v);
   try{return await array(url.toString());}
   catch(error){if((error.body||'').replaceAll(',','').match(/100000|too many/i)&&b-a>2000){const mid=Math.floor((a+b)/2000)*1000;return [...await chunk(a,mid),...await chunk(mid,b)];}throw error;}
  }
  const incoming=[];
  // First load is bounded; later polls normally retrieve only about three minutes.
  for(let a=from;a<now;a+=10*MIN)incoming.push(...await chunk(a,Math.min(a+10*MIN,now)));
  const rows=mergeEvents(previous?.rows||[],incoming,cutoff,now);
  result={rows,source:`MERLIN ${kind.toUpperCase()} API`,window_start:new Date(cutoff).toISOString(),window_end:iso,last_event_at:rows.length?asUTC(rows.at(-1).event_datetime):previous?.last_event_at||null};
 }
 return {...result,status:'ok',fetched_at:iso,error:null};
}
export async function writeValue(storage,key,value){
 const text=JSON.stringify(value),parts=[];
 for(let i=0;i<text.length;i+=32000)parts.push(text.slice(i,i+32000));
 await storage.transaction(async tx=>{
  const old=await tx.get('meta:'+key);
  const entries=Object.fromEntries(parts.map((part,i)=>['part:'+key+':'+i,part]));
  entries['meta:'+key]={parts:parts.length};
  await tx.put(entries);
  if(old?.parts>parts.length)await tx.delete(Array.from({length:old.parts-parts.length},(_,i)=>'part:'+key+':'+(parts.length+i)));
 });
}
export async function readValue(storage,key){
 return storage.transaction(async tx=>{
  const meta=await tx.get('meta:'+key);if(!meta)return null;
  const keys=Array.from({length:meta.parts},(_,i)=>'part:'+key+':'+i);
  const parts=await tx.get(keys);
  if(keys.some(k=>!parts.has(k)))throw Error('Incomplete stored observation');
  return JSON.parse(keys.map(k=>parts.get(k)).join(''));
 });
}
