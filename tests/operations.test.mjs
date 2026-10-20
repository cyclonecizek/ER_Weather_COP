import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observationRows,lightningRows,ringActivity,monitorEvents,csv,validLog,distanceToWatch} from '../dist/operations-model.mjs';
import {insideWatch,validLightningWatch,evaluateLightningWatch} from '../dist/lightning-watches.mjs';
import {SITE_WATCHES} from '../dist/site-watches.mjs';
const now=Date.parse('2026-10-20T12:00:00Z'),MIN=60000;
const rule={id:'r',name:'Test',lat:0,lon:0,radiusNm:1,holdMinutes:30,type:'both',enabled:true,showRing:true,color:'#abcdef',polygon:[[0,0],[0,1],[1,1],[1,0]]};
test('preset boundaries are valid, preserved as polygons, and include their edges',()=>{
 assert.equal(SITE_WATCHES.length,14);assert.equal(new Set(SITE_WATCHES.map(r=>r.id)).size,14);
 for(const r of SITE_WATCHES){assert.equal(validLightningWatch(r),true);assert.equal(insideWatch(r,r.lat,r.lon),true);assert.ok(r.polygon.length>100);}
 assert.equal(insideWatch(rule,.5,.5),true);assert.equal(insideWatch(rule,0,.5),true);assert.equal(insideWatch(rule,0,0),true);assert.equal(insideWatch(rule,1.1,.5),false);
 assert.equal(validLightningWatch({...rule,polygon:[[999,0],[0,0],[1,1]]}),false);
});
test('polygon watch evaluation uses the supplied boundary rather than nominal circle; gaps block release',()=>{
 const f={status:'ok',fetched_at:new Date(now).toISOString(),window_start:new Date(now-60*MIN).toISOString(),window_end:new Date(now).toISOString(),rows:[{id:1,event_datetime:new Date(now-MIN).toISOString(),lat_decimal:.5,lon_decimal:.5}]};
 const result=evaluateLightningWatch(rule,{cg:f,cc:{...f,rows:[]}},now);
 assert.equal(result.state,'active');assert.equal(result.remainingMs,29*MIN);
 assert.equal(evaluateLightningWatch(rule,{cg:{...f,status:'error',rows:[]},cc:f},now+31*MIN,result.event).state,'unknown');
 assert.ok(Math.abs(distanceToWatch(rule,1.05,.5)-3)<.01);
});
test('table selection keeps latest preferred side for each tower and height without altering input',()=>{
 const row={tower:'0001N',prevailing:'S',hgt:54,reading_datetime:'2026-10-20T11:59:00',peak_spd_1min:20,peak_spd_10min:35};
 const rows=[row,{...row,tower:'0001S',peak_spd_10min:36},{...row,hgt:162},{...row,reading_datetime:'2026-10-20T11:58:00',peak_spd_10min:99}];
 const selected=observationRows(rows);assert.equal(selected.length,2);assert.equal(selected.find(r=>r.hgt===54).peak_spd_10min,36);assert.equal(rows[0].site,undefined);
});
test('activity and strike logs deduplicate, exclude future events and obey CC/CG selection',()=>{
 const row={id:1,event_datetime:new Date(now-MIN).toISOString(),lat_decimal:.5,lon_decimal:.5};
 const events=lightningRows({cg:{rows:[row,row,{...row,id:2,event_datetime:new Date(now+MIN).toISOString()}]},cc:{rows:[row]}},now,60);
 assert.equal(events.length,2);const activity=ringActivity({...rule,type:'cg'},events,now);assert.equal(activity.cg,1);assert.equal(activity.cc,0);assert.equal(activity.bins.reduce((a,b)=>a+b,0),1);
});
test('event history distinguishes acknowledgement, data gaps, timer resets and confirmed release',()=>{
 const active={rule,state:'active',event:{time:now},latched:true,ack:false};
 assert.deepEqual(monitorEvents([], [active],'lightning').map(x=>x.event),['Activated']);
 const unknown={...active,state:'unknown'};assert.deepEqual(monitorEvents([active],[unknown],'lightning').map(x=>x.event),['Data gap']);
 assert.deepEqual(monitorEvents([unknown],[unknown],'lightning'),[]);
 const released={...active,state:'quiet',latched:false};assert.deepEqual(monitorEvents([unknown],[released],'lightning').map(x=>x.event),['Released','Coverage restored']);
 assert.deepEqual(monitorEvents([active],[{...active,ack:true}],'wind').map(x=>x.event),['Acknowledged']);
 assert.deepEqual(monitorEvents([active],[{...active,event:{time:now+MIN},ack:false}],'lightning').map(x=>x.event),['Hold reset']);
 assert.deepEqual(monitorEvents([active],[active],'lightning'),[]);
});
test('CSV escapes delimiters, newlines and spreadsheet formulas; logs enforce age and shape',()=>{
 assert.equal(csv([['a,b','"quote"','line\nnext','=CMD()',-3]]),'"a,b","""quote""","line\nnext","\'=CMD()","\'-3"');
 const valid={time:now,category:'wind',event:'Activated',location:'Tower',detail:'35 kt',operator:'BC'};
 assert.equal(validLog([valid,{...valid,time:now-8*86400000},{...valid,time:now+MIN},{time:now}],now).length,1);
});
