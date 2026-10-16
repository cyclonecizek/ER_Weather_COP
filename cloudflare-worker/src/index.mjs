import {FAST_FEEDS,fetchFeed,jsonFetch,failedFeed,writeValue,readValue} from './feeds.mjs';
const STORE_NAME='eastern-range-observations-v1';
const response=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

export class ObservationStore{
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.pending=null;}
 async refresh(){
  if(this.pending)return this.pending;
  this.pending=this.runRefresh();
  try{return await this.pending;}finally{this.pending=null;}
 }
 async runRefresh(){
  const now=Date.now();
  let baseline=await readValue(this.ctx.storage,'baseline');
  let slowError=null;
  if(!baseline||now-Date.parse(baseline.downloaded_at)>5*60000){
   try{
    const snapshot=await jsonFetch(this.env.SNAPSHOT_URL);
    if(!snapshot.feeds||!snapshot.generated_at)throw Error('Invalid GitHub baseline');
    baseline={...snapshot,downloaded_at:new Date(now).toISOString()};
    await writeValue(this.ctx.storage,'baseline',baseline);
   }catch(error){slowError=error.message;}
  }
  const statuses={};
  // Slow-feed request has a bounded timeout and never prevents the four API polls.
  await Promise.all(FAST_FEEDS.map(async key=>{
   const old=await readValue(this.ctx.storage,key)||baseline?.feeds?.[key];
   let next;
   try{next=await fetchFeed(key,old,now,baseline?.feeds?.[key]);}
   catch(error){next=failedFeed(old,error,now);}
   await writeValue(this.ctx.storage,key,next);statuses[key]=next.status;
  }));
  const poll={last_poll_at:new Date(now).toISOString(),completed_at:new Date().toISOString(),statuses,slow_feed_error:slowError};
  await writeValue(this.ctx.storage,'poll',poll);
  console.log(JSON.stringify({event:'observation_poll',...poll}));
  return poll;
 }
 async snapshot(){
  const baseline=await readValue(this.ctx.storage,'baseline');
  const poll=await readValue(this.ctx.storage,'poll');
  const feeds={};
  for(const key of FAST_FEEDS)feeds[key]=await readValue(this.ctx.storage,key)||baseline?.feeds?.[key]||{rows:[],status:'error',error:'Waiting for first collection'};
  for(const key of ['radar','profilers']){
   feeds[key]=baseline?.feeds?.[key]||{rows:[],status:'error',error:'Waiting for GitHub slow-feed baseline'};
   if(poll?.slow_feed_error)feeds[key]={...feeds[key],status:'error',error:'GitHub baseline refresh failed: '+poll.slow_feed_error};
  }
  if(!poll)return null;
  return {generated_at:poll.last_poll_at,collector:'Cloudflare one-minute polling',poll_completed_at:poll.completed_at,feeds};
 }
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path==='/internal/refresh'&&request.method==='POST')return response(await this.refresh());
  if(request.method!=='GET')return response({error:'Method not allowed'},405);
  if(path==='/health'){
   const poll=await readValue(this.ctx.storage,'poll');
   return response({status:!poll?'warming_up':Date.now()-Date.parse(poll.last_poll_at)>180000?'poll_delayed':Object.values(poll.statuses).some(x=>x==='error')?'degraded':'ok',...poll,schedule:'Every minute (UTC); upstream latency and scheduler delays can occur'});
  }
  const snapshot=await this.snapshot();
  return snapshot?response(snapshot):response({error:'Waiting for the first scheduled collection. Initial Cron activation can take up to 15 minutes.'},503);
 }
}
export default{
 async scheduled(event,env,ctx){
  const stub=env.OBSERVATIONS.get(env.OBSERVATIONS.idFromName(STORE_NAME));
  ctx.waitUntil(stub.fetch('https://internal/internal/refresh',{method:'POST'}).then(async r=>{if(!r.ok)throw Error('Scheduled collection failed: '+r.status);}));
 },
 async fetch(request,env){
  const url=new URL(request.url),origin=request.headers.get('Origin');
  const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim());
  if(origin&&!allowed.includes(origin))return response({error:'Origin not allowed'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...(origin?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}});
  if(request.method!=='GET')return response({error:'Method not allowed'},405);
  if(!['/','/health','/api/observations'].includes(url.pathname))return response({error:'Not found'},404);
  const stub=env.OBSERVATIONS.get(env.OBSERVATIONS.idFromName(STORE_NAME));
  const target=url.pathname==='/health'?'/health':'/api/observations';
  const r=await stub.fetch('https://internal'+target);
  const result=new Response(r.body,r);
  if(origin)result.headers.set('Access-Control-Allow-Origin',origin);
  result.headers.set('Vary','Origin');
  return result;
 }
};
