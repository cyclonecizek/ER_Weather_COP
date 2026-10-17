import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateWindRule,validWindRule,advanceWindEpisode,windAlertSite} from '../dist/wind-alerts.mjs';
const now=Date.parse('2026-10-17T16:00:00Z');
const rule={id:'test',name:'Pad watch',enabled:true,towers:['0002'],metric:'peak_spd_1min',threshold:35,maxHeight:54};
const row=(extra={})=>({tower:'0002NW',prevailing:'NW',hgt:54,reading_datetime:'2026-10-17T16:00:00',peak_spd_1min:35,avg_spd_1min:20,peak_spd_10min:40,...extra});
const evaluate=(rows,extra={})=>evaluateWindRule({...rule,...extra},{status:'ok',rows},now);
test('threshold and maximum height include equality, and other towers and higher levels are excluded',()=>{
 assert.equal(evaluate([row()]).state,'active');assert.equal(evaluate([row({peak_spd_1min:34.9})]).state,'clear');
 assert.equal(evaluate([row({hgt:55}),row({tower:'0003'})]).state,'unknown');
 assert.equal(evaluate([row({hgt:12}),row({hgt:54})]).hits.length,2);
});
test('sustained and peak windows are independent',()=>{
 assert.equal(evaluate([row()],{metric:'avg_spd_1min'}).state,'clear');
 assert.equal(evaluate([row()],{metric:'peak_spd_10min',threshold:40}).state,'active');
});
test('latest report per height, then prevailing side; named pad sides are grouped',()=>{
 assert.equal(evaluate([row(),row({reading_datetime:'2026-10-17T15:59:00',peak_spd_1min:80}),row({tower:'0002SE',peak_spd_1min:50})]).hits[0].value,35);
 assert.equal(evaluate([row(),row({reading_datetime:'2026-10-17T16:00:01',peak_spd_1min:10})]).state,'clear');
 assert.equal(windAlertSite('LC39ANE'),'LC39A');assert.equal(windAlertSite('LC37W'),'LC37');assert.equal(windAlertSite('VAB_IN1'),'VAB_IN1');
 const result=evaluate([row({tower:'LC39ANE',prevailing:'NE'}),row({tower:'LC39ANW',prevailing:'NE',peak_spd_1min:70})],{towers:['LC39A']});
 assert.equal(result.hits.length,1);assert.equal(result.hits[0].value,35);
});
test('invalid, missing, stale, future and failed-source data cannot trigger or clear',()=>{
 for(const value of [null,999,9999,-1,'40',NaN])assert.equal(evaluate([row({peak_spd_1min:value})]).state,'unknown');
 assert.equal(evaluate([row({reading_datetime:'invalid'})]).state,'unknown');
 assert.equal(evaluate([row({reading_datetime:'2026-10-17T15:54:59'})]).state,'unknown');
 assert.equal(evaluate([row({reading_datetime:'2026-10-17T16:02:00'})]).state,'unknown');
 assert.equal(evaluateWindRule(rule,{status:'error',rows:[row()]},now).state,'unknown');
 assert.equal(evaluate([]).state,'unknown');
 const partial=evaluate([row()],{towers:['0002','0003']});assert.equal(partial.state,'active');assert.deepEqual(partial.gaps,['0003']);
});
test('sound episode survives gaps, acknowledgement, and duplicate snapshots; fresh clear rearms',()=>{
 const active={state:'active',gaps:[]},unknown={state:'unknown',gaps:['0002']},clear={state:'clear',gaps:[]};
 let state=advanceWindEpisode(null,active);assert.equal(state.notify,true);state.ack=true;
 state=advanceWindEpisode(state,active);assert.equal(state.notify,false);assert.equal(state.ack,true);
 state=advanceWindEpisode(state,unknown);assert.equal(state.active,true);
 state=advanceWindEpisode(state,active);assert.equal(state.notify,false);assert.equal(state.ack,true);
 state=advanceWindEpisode(state,clear);assert.equal(state.active,false);assert.equal(state.ack,false);
 assert.equal(advanceWindEpisode(state,active).notify,true);
});
test('rule validation rejects corrupted preferences; paused rules do not evaluate',()=>{
 assert.equal(validWindRule(rule),true);assert.equal(validWindRule({...rule,towers:['LC39A','VAB_IN1']}),true);
 for(const extra of [{towers:[]},{threshold:0},{threshold:Infinity},{maxHeight:-1},{metric:'bad'},{name:''},{towers:['<script>']},{enabled:'yes'}])assert.equal(validWindRule({...rule,...extra}),false);
 assert.equal(evaluate([row()],{enabled:false}).state,'paused');
});
