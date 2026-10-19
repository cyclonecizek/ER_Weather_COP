import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replayFrame,validReplay,advanceFrame,MINUTE} from '../dist/replay.mjs';
const end=Date.parse('2026-10-19T20:00:00Z'),start=end-60*MINUTE;
const stamp=t=>new Date(t).toISOString();
const wind=(t,extra={})=>({reading_datetime:stamp(t),tower:'0001',hgt:54,avg_spd_1min:10,...extra});
const feed=rows=>({rows,status:'ok',window_start:stamp(start-60*MINUTE),window_end:stamp(end)});
const history=()=>({start:stamp(start),end:stamp(end),generated_at:stamp(end),feeds:{winds:feed([]),efm:feed([]),radar:feed([]),profilers:feed([]),cg:feed([]),cc:feed([])}});
test('replay chooses past readings per sensor, never future values, and expires gaps',()=>{
 const h=history();h.feeds.winds=feed([wind(start),wind(start+MINUTE,{avg_spd_1min:30}),wind(start,{tower:'0002',hgt:6})]);
 let f=replayFrame(h,start);assert.equal(f.feeds.winds.rows[0].avg_spd_1min,10);assert.equal(f.feeds.winds.rows.length,2);
 f=replayFrame(h,start+MINUTE);assert.equal(f.feeds.winds.rows.find(r=>r.tower==='0001').avg_spd_1min,30);
 f=replayFrame(h,start+4*MINUTE);assert.equal(f.feeds.winds.rows.length,0);assert.ok(f.gaps.includes('winds'));
});
test('field mills, profiles, and radar use their own timestamps; missing radar is explicit',()=>{
 const h=history();h.feeds.efm=feed([{reading_date:'2026-10-19',reading_time:'19:00:00',field_mill:1,value:400}]);
 h.feeds.radar=feed([{observed_at:stamp(start+MINUTE),image_url:'radar/test.png',bounds:[[26,-84],[31,-77]]}]);
 h.feeds.profilers=feed([{site:'p1',observed_at:stamp(start-10*MINUTE),levels:[]}]);
 let f=replayFrame(h,start);assert.equal(f.feeds.efm.rows[0].value,400);assert.equal(f.feeds.radar.image_data,undefined);assert.ok(f.gaps.includes('radar'));assert.equal(f.feeds.profilers.rows.length,1);
 f=replayFrame(h,start+2*MINUTE,15,'https://host/path/data/replay/index.json');assert.equal(f.feeds.radar.image_data,'https://host/path/data/replay/radar/test.png');
 f=replayFrame(h,start+11*MINUTE);assert.equal(f.feeds.profilers.rows.length,0);assert.equal(f.feeds.radar.rows.length,0);
});
test('lightning trail follows selected frame and reports missing prehistory',()=>{
 const h=history();h.feeds.cg=feed([0,-5,-16,1].map((m,i)=>({id:i,event_datetime:stamp(start+m*MINUTE)})));
 let f=replayFrame(h,start,15);assert.deepEqual(f.feeds.cg.rows.map(r=>r.id),[1,0]);assert.ok(!f.gaps.includes('cg'));
 h.feeds.cg={...h.feeds.cg,window_start:stamp(start)};f=replayFrame(h,start,15);assert.ok(f.gaps.includes('cg'));
});
test('snapshot and source arrays are not mutated; large event sets do not overflow',()=>{
 const h=history();h.feeds.cc=feed(Array.from({length:150000},(_,id)=>({id,event_datetime:stamp(start)})));
 const json=h.feeds.cc.rows[0].event_datetime;const f=replayFrame(h,start);assert.equal(f.feeds.cc.rows.length,150000);assert.equal(h.feeds.cc.rows[0].event_datetime,json);
});
test('bounds validation and playback wrap / pause positions',()=>{
 const h=history();assert.equal(validReplay(h),true);assert.equal(validReplay({...h,end:'bad'}),false);
 assert.equal(advanceFrame(null,start,end),start);assert.equal(advanceFrame(end,start,end),start);assert.equal(advanceFrame(start,start,end),start+MINUTE);
});
