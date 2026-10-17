import {test} from 'node:test';
import assert from 'node:assert/strict';
import {distanceNm,validLightningWatch,evaluateLightningWatch,advanceLightningEpisode} from '../dist/lightning-watches.mjs';
const now=Date.parse('2026-10-17T16:00:00Z'),MIN=60000;
const rule={id:'test',name:'LC39A · 5 nm',lat:28.6,lon:-80.6,radiusNm:5,holdMinutes:30,type:'both',enabled:true,showRing:true,color:'#87c5e9'};
const event=(minutes=0,extra={})=>({id:'strike',event_datetime:new Date(now-minutes*MIN).toISOString(),lat_decimal:28.6,lon_decimal:-80.6,...extra});
const feed=(rows=[],extra={})=>({rows,status:'ok',fetched_at:new Date(now).toISOString(),window_start:new Date(now-60*MIN).toISOString(),window_end:new Date(now).toISOString(),...extra});
const evaluate=(cg=[],cc=[],extra={})=>evaluateLightningWatch({...rule,...extra},{cg:feed(cg),cc:feed(cc)},now);
test('great-circle distance uses nautical miles and includes the radius boundary',()=>{
 assert.equal(distanceNm(28.6,-80.6,28.6,-80.6),0);assert.ok(Math.abs(distanceNm(0,0,1,0)-60.04)<.01);
 const e=event(1,{lat_decimal:28.65}),radius=distanceNm(rule.lat,rule.lon,28.65,-80.6);
 assert.equal(evaluate([e],[],{radiusNm:radius}).state,'active');assert.equal(evaluate([e],[],{radiusNm:radius-.001}).state,'quiet');
 assert.ok(distanceNm(0,179.99,0,-179.99)<2);
});
test('CC / CG selection, exact event window, deduplication and future exclusion',()=>{
 assert.equal(evaluate([event(1)],[],{type:'cc'}).state,'quiet');assert.equal(evaluate([],[event(1)]).state,'active');
 assert.equal(evaluate([event(30)]).state,'quiet');assert.equal(evaluate([event(29)]).remainingMs,MIN);
 assert.equal(evaluate([event(-1)]).state,'quiet');assert.equal(evaluate([event(1),event(1)]).count,1);
 assert.equal(evaluate([event(1)],[event(1)]).count,2);
});
test('newest event controls hold and each newer event resets sound / acknowledgement',()=>{
 const first=evaluate([event(20)]);assert.equal(first.remainingMs,10*MIN);
 let state=advanceLightningEpisode(null,first);assert.equal(state.notify,true);state.ack=true;
 state=advanceLightningEpisode(state,first);assert.equal(state.notify,false);assert.equal(state.ack,true);
 const second=evaluate([event(20),event(2)]);assert.equal(second.remainingMs,28*MIN);
 state=advanceLightningEpisode(state,second);assert.equal(state.notify,true);assert.equal(state.ack,false);
});
test('quiet feed health uses query coverage, never the last event timestamp',()=>{
 assert.equal(evaluate().state,'quiet');
 for(const extra of [{status:'error'},{fetched_at:new Date(now-6*MIN).toISOString()},{window_start:new Date(now-10*MIN).toISOString()},{window_end:null}]){
  const result=evaluateLightningWatch(rule,{cg:feed([],extra),cc:feed()},now);assert.equal(result.state,'unknown');assert.ok(result.gaps.includes('CG'));
 }
 assert.equal(evaluateLightningWatch({...rule,type:'cg'},{cg:feed(),cc:feed([],{status:'error'})},now).state,'quiet');
 assert.equal(evaluate([event(2,{lat_decimal:null})]).state,'unknown');
});
test('known detection survives missing rows; stale feeds and query lag cannot release hold',()=>{
 const initial=evaluate([event(1)]),previous=initial.event;
 const result=evaluateLightningWatch(rule,{cg:feed(),cc:feed()},now,previous);assert.equal(result.state,'active');assert.equal(result.remainingMs,29*MIN);
 const later=now+30*MIN,old=feed([],{status:'error'});
 const unknown=evaluateLightningWatch(rule,{cg:old,cc:old},later,previous);assert.equal(unknown.state,'unknown');
 let episode=advanceLightningEpisode(null,initial);episode=advanceLightningEpisode(episode,unknown);assert.equal(episode.active,true);
 const fresh=feed([],{fetched_at:new Date(later).toISOString(),window_start:new Date(later-60*MIN).toISOString(),window_end:new Date(later).toISOString()});
 const cleared=evaluateLightningWatch(rule,{cg:fresh,cc:fresh},later,previous);assert.equal(cleared.state,'quiet');assert.equal(advanceLightningEpisode(episode,cleared).active,false);
 // A successful but slightly delayed query must cover the hold's expiry.
 const lagged=feed([],{fetched_at:new Date(later).toISOString(),window_start:new Date(later-60*MIN).toISOString(),window_end:new Date(later-2*MIN).toISOString()});
 assert.equal(evaluateLightningWatch(rule,{cg:lagged,cc:lagged},later,previous).state,'unknown');
});
test('validates preferences and bounds history; paused rules do not evaluate',()=>{
 assert.equal(validLightningWatch(rule),true);
 for(const extra of [{lat:91},{lon:-181},{radiusNm:0},{holdMinutes:61},{holdMinutes:2.5},{type:'other'},{showRing:'yes'},{color:'url(x)'},{name:''}])assert.equal(validLightningWatch({...rule,...extra}),false);
 assert.equal(evaluate([event()],[],{enabled:false}).state,'paused');
});
