import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareStations,analyzeBarnes,divergenceGrid,contourStyle,contourSegments} from '../dist/barnes.mjs';
const now=Date.parse('2026-10-19T23:00:00Z');
const row=(extra={})=>({tower:'0002SE',prevailing:'SE',hgt:54,lat:28.5,lon:-80.6,avg_spd_1min:12.34,avg_dir_1min:123.45,reading_datetime:'2026-10-19T23:00:00',...extra});
test('API preparation uses fresh exact 54 ft full-precision prevailing-side winds',()=>{
 const selected=prepareStations([row(),row({tower:'0002NW',avg_spd_1min:30}),row({tower:'0003',hgt:12}),row({tower:'0004',reading_datetime:'2026-10-19T22:54:00'}),row({tower:'0005',avg_spd_1min:9999}),row({tower:'0006',reading_datetime:'invalid'}),row({tower:'0007',lat:40})],now);
 assert.equal(selected.length,1);assert.equal(selected[0].name,'0002');assert.ok(Math.abs(selected[0].u+12.34*.5144444444444445*Math.sin(123.45*Math.PI/180))<1e-10);
 assert.equal(prepareStations([row({reading_datetime:'2026-10-19T23:01:00'})],now).length,0);
});
test('derivative signs and 10^-4 units match linear divergence / convergence',()=>{
 const n=5,spacing=500,u=new Float64Array(n*n),v=new Float64Array(n*n),mask=new Uint8Array(n*n).fill(1);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){u[j*n+i]=i*spacing*1e-4;v[j*n+i]=j*spacing*2e-4;}
 assert.ok(Math.abs(divergenceGrid(u,v,mask,n,n,spacing)[12]-3)<1e-12);
 assert.ok(Math.abs(divergenceGrid(u.map(x=>-x),v.map(x=>-x),mask,n,n,spacing)[12]+3)<1e-12);
 mask[11]=0;assert.ok(Number.isNaN(divergenceGrid(u,v,mask,n,n,spacing)[12]));
});
test('Barnes browser analysis matches a fixture from the GR2 Python algorithm',()=>{
 const {stations,expected}=JSON.parse(fs.readFileSync(new URL('./fixtures/barnes-python.json',import.meta.url)));
 const result=analyzeBarnes(stations);
 assert.equal(result.status,'ok');assert.deepEqual(result.grid,[expected.grid_nx,expected.grid_ny]);assert.equal(result.validPoints,expected.valid_divergence_gridpoints);
 assert.ok(Math.abs(result.min-expected['min_divergence_x1e4_s-1'])<1e-8);assert.ok(Math.abs(result.max-expected['max_divergence_x1e4_s-1'])<1e-8);
 assert.ok(result.contours.length>0);
});
test('insufficient observations omit contours; warm/cool styles and contour masks are preserved',()=>{
 assert.equal(analyzeBarnes([]).status,'insufficient_stations');assert.deepEqual(analyzeBarnes([]).contours,[]);
 assert.equal(contourStyle(-4).color,'#ff8714');assert.equal(contourStyle(4).color,'#19cdf5');assert.equal(contourStyle(0).color,'#f5f5f5');
 assert.deepEqual(contourSegments(new Float64Array([NaN,1,2,3]),[0,1],[0,1],1),[]);
});
