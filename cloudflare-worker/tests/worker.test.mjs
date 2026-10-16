import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeEvents,failedFeed,writeValue,readValue,fetchFeed} from '../src/feeds.mjs';
import worker from '../src/index.mjs';
class Storage{
 constructor(){this.map=new Map();}
 async get(key){return Array.isArray(key)?new Map(key.filter(k=>this.map.has(k)).map(k=>[k,this.map.get(k)])):this.map.get(key);}
 async put(key,value){if(typeof key==='object')for(const [k,v] of Object.entries(key))this.map.set(k,v);else this.map.set(key,value);}
 async delete(keys){for(const k of Array.isArray(keys)?keys:[keys])this.map.delete(k);}
 async transaction(fn){return fn(this);}
}
test('chunked durable storage roundtrips and removes old chunks',async()=>{const s=new Storage();await writeValue(s,'test',{rows:'x'.repeat(160000)});assert.equal((await readValue(s,'test')).rows.length,160000);await writeValue(s,'test',{rows:[]});assert.deepEqual(await readValue(s,'test'),{rows:[]});assert.equal([...s.map.keys()].filter(k=>k.startsWith('part:')).length,1);});
test('incremental events deduplicate, expire old records, and exclude future records',()=>{const now=Date.parse('2026-10-16T10:00:00Z');const row=(id,time)=>({id,event_datetime:time,lat_decimal:28.5,lon_decimal:-80.6});const r=mergeEvents([row(1,'2026-10-16T09:30:00'),row(2,'2026-10-16T08:30:00')],[row(1,'2026-10-16T09:30:00'),row(3,'2026-10-16T10:01:00')],now-3600000,now);assert.deepEqual(r.map(x=>x.id),[1]);});
test('failure preserves original fetched timestamp and observations',()=>{const old={rows:[1],fetched_at:'2026-10-16T09:00:00Z'};const r=failedFeed(old,Error('timeout'),Date.now());assert.equal(r.status,'error');assert.deepEqual(r.rows,[1]);assert.equal(r.fetched_at,old.fetched_at);});
test('latest EFM timestamp is observation time; configured location fallback is preserved',async()=>{const mock=async()=>Response.json([{field_mill:13,lat:24.3259,lon:-82.5015,reading_date:'2026-10-16',reading_time:'10:00:00',value:0,flag:'X'}]);const r=await fetchFeed('efm',null,Date.parse('2026-10-16T10:01:00Z'),{rows:[{field_mill:13,lat:28.6,lon:-80.6}]},mock);assert.equal(r.observed_at,'2026-10-16T10:00:00Z');assert.equal(r.rows[0].lat,28.6);assert.equal(r.rows[0].flag,'X');});
test('public requests cannot invoke refresh and CORS is explicit',async()=>{const env={ALLOWED_ORIGINS:'https://cyclonecizek.github.io'};assert.equal((await worker.fetch(new Request('https://data.workers.dev/internal/refresh',{method:'POST'}),env)).status,405);assert.equal((await worker.fetch(new Request('https://data.workers.dev/api/observations',{headers:{Origin:'https://example.com'}}),env)).status,403);const r=await worker.fetch(new Request('https://data.workers.dev/api/observations',{method:'OPTIONS',headers:{Origin:'https://cyclonecizek.github.io'}}),env);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://cyclonecizek.github.io');});
