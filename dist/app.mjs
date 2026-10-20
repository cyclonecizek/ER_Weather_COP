import {initOperations} from './operations-ui.mjs?v=ops-20261020';
import {SHARED_CARTO_KEY} from './basemap-config.mjs?v=shared-map-20261019';
import {BARNES,prepareStations,analyzeBarnes} from './barnes.mjs';
import {validReplay,replayBounds,replayFrame,advanceFrame} from './replay.mjs';
import {initLightningWatches} from './lightning-ui.mjs?v=ops-20261020';
import {initWindAlerts} from './alerts-ui.mjs?v=ops-20261020';
import {DEFAULTS,clean,windSite,selectWinds,selectWindPlots,efmCategory,ccCells,ccDetections,freshAge,ztime,settingsValid,settingsFrom,normalizeDataEndpoint} from './core.mjs?v=cc-mode-20261019';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(x,n=0)=>clean(x)===null?'—':Number(x).toFixed(n);
const LABELS={winds:'WINDS towers',efm:'Electric field mills',cg:'MERLIN CG',cc:'MERLIN CC',profilers:'Wind profilers',radar:'MRMS composite',barnes:'Barnes convergence / divergence'};
let settings;try{settings=settingsFrom(JSON.parse(localStorage.getItem('er-cop-settings')||'null'));}catch{settings=settingsFrom(null);}
const replayImages=new Map(),replayImageFailures=new Set();
let replayTime=null,replayHistory=null,replayUrl='',replayPlaying=false,replayTimer=null,replayLoading=false,displaySnapshot=null;
let data=null,selected=null,refreshing=false,refreshAt=Date.now()+60000,lastRefresh=0,snapshotFailure=false,endpointFailure=false;
const map=L.map('map',{zoomControl:false,preferCanvas:true,minZoom:5,maxZoom:18}).setView([28.555,-80.63],10);
L.control.zoom({position:'topright'}).addTo(map);
L.control.scale({position:'bottomleft',imperial:true,metric:true,maxWidth:110}).addTo(map);
function cartoKey(){return settings.cartoKey.trim() || SHARED_CARTO_KEY;}
function makeBases(){
 const osm={attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',maxZoom:19,className:'osm-base'};
 const carto={attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',maxZoom:20};
 const key=encodeURIComponent(cartoKey());
 return {dark:cartoKey()?L.tileLayer('https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key='+key,carto):L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',osm),
 light:cartoKey()?L.tileLayer('https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key='+key,carto):L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',osm),
 satellite:L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles &copy; Esri, Maxar, Earthstar Geographics',maxZoom:18})};
}
let bases=makeBases();
let activeBase;
const groups={};for(const key of Object.keys(LABELS)){map.createPane(key);map.getPane(key).style.zIndex=({radar:390,barnes:400,cc:410,cg:420,winds:430,efm:440,profilers:450})[key];groups[key]=L.layerGroup().addTo(map);}
let stationIndex=[];
function save(){try{localStorage.setItem('er-cop-settings',JSON.stringify(settings));}catch{}}
function setBase(name){if(!bases[name])name='dark';if(activeBase)map.removeLayer(activeBase);activeBase=bases[name].addTo(map);settings.basemap=name;document.querySelectorAll('[data-basemap]').forEach(b=>b.classList.toggle('active',b.dataset.basemap===name));document.body.classList.toggle('light-map',name==='light');document.body.classList.toggle('osm-dark',name==='dark'&&!cartoKey());document.querySelectorAll('[data-basemap]').forEach(b=>b.title=b.dataset.basemap==='satellite'?'Esri imagery':cartoKey()?'CARTO basemap':'OpenStreetMap · no API key required');save();}
setBase(settings.basemap);
let tileFailures=0;Object.values(bases).forEach(layer=>layer.on('tileerror',()=>{if(++tileFailures>4){$('mapAlert').hidden=false;$('mapAlert').textContent='Basemap tiles could not load. Observation markers remain available; try a different basemap.';}}));
function liveFeed(name){return data?.feeds?.[name]||{rows:[],status:'loading'};}
function feed(name){return (replayTime===null?data:displaySnapshot)?.feeds?.[name]||{rows:[],status:'loading'};}
function mapTime(){return replayTime===null?Date.now():replayTime;}
function observationTime(r){return ztime(r.reading_datetime||`${r.reading_date}T${r.reading_time}`);}
function clockLabel(iso){if(!iso)return 'unavailable';const date=new Date(iso);return Number.isFinite(+date)?date.toISOString().slice(11,16)+'Z':'unavailable';}
function ageLabel(iso,reference=mapTime()){const a=freshAge(iso,reference);if(!Number.isFinite(a))return 'unknown';return a<1?'<1 min ago':a<60?Math.floor(a)+' min ago':(a/60).toFixed(1)+' hr ago';}
function staleClass(iso,key){return freshAge(iso,mapTime())>(key==='profilers'?180:15)||feed(key).status==='error'?' marker-stale':'';}
function marker(lat,lon,html,size,kind,record,tooltip){if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return;const m=L.marker([lat,lon],{pane:kind,keyboard:true,title:tooltip,icon:L.divIcon({html,className:'cop-marker',iconSize:size,iconAnchor:[size[0]/2,size[1]/2]})}).bindTooltip(esc(tooltip),{direction:'top',offset:[0,-12]});m.on('click',()=>inspect(kind,record));groups[kind].addLayer(m);return m;}
function windSvg(direction,speed,color,size=40){let knots=Math.round(speed/5)*5,paths=[],y=-25;while(knots>=50){paths.push(`<path d="M0 ${y} L12 ${y+5} L0 ${y+9}Z" fill="${color}"/>`);knots-=50;y+=10;}while(knots>=10){paths.push(`<path d="M0 ${y} L11 ${y+5}"/>`);knots-=10;y+=5;}if(knots>=5)paths.push(`<path d="M0 ${y} L6 ${y+3}"/>`);return `<svg width="${size}" height="${size}" viewBox="-32 -32 64 64" style="color:${color};stroke-width:1.7" aria-hidden="true"><g transform="rotate(${direction})">${speed<2.5?'<circle cx="0" cy="0" r="3"/>':'<path d="M0 0V-25"/>'+paths.join('')}<circle cx="0" cy="0" r="1.4" fill="${color}"/></g></svg>`;}
map.createPane('lightningRings');map.getPane('lightningRings').style.zIndex=405;
const lightningRingLayer=L.layerGroup().addTo(map);let ringSignature='';
const operations=initOperations({
 onResize:()=>requestAnimationFrame(()=>map.invalidateSize()),
 onRingFocus:r=>{map.fitBounds((r.polygon?L.polygon(r.polygon):L.circle([r.lat,r.lon],{radius:r.radiusNm*1852})).getBounds(),{padding:[35,35],maxZoom:13});},
 onConfigure:kind=>kind==='wind'?windAlerts.open():lightningWatches.open(),
 onAcknowledge:(kind,id)=>kind==='wind'?windAlerts.acknowledge(id):lightningWatches.acknowledge(id),
 onPresets:()=>lightningWatches.addPresets(),
 onSounds:()=>{if(!$('alertSound').textContent.startsWith('Sound on'))$('alertSound').click();if(!$('lightningSound').textContent.startsWith('Sound on'))$('lightningSound').click();},
 onFocus:(kind,r)=>{if(!Number.isFinite(r.lat)||!Number.isFinite(r.lon))return;settings.layers[kind]=true;if(kind==='winds')settings.height=String(r.hgt);syncControls();save();render();map.setView([r.lat,r.lon],12);inspect(kind,kind==='cc'?{...r,ccPoint:true}:kind==='winds'?{...r,site:windSite(r.tower)}:r);}
});
const lightningWatches=initLightningWatches({
 onChange:results=>operations.lightning(results),
 onRings:(results,onOpen)=>{
  const signature=JSON.stringify(results.map(r=>[r.rule,r.state,r.gaps.length]));if(signature===ringSignature)return;ringSignature=signature;lightningRingLayer.clearLayers();
  for(const result of results){const r=result.rule;if(!r.showRing)continue;
   const color=result.state==='paused'?'#8b9bae':result.gaps.length&&result.state!=='active'?'#e7ba79':result.state==='active'?'#ff675c':r.color;
   const ringOptions={pane:'lightningRings',color,weight:2,fillColor:color,fillOpacity:result.state==='active'?.07:.015,dashArray:result.gaps.length||result.state==='paused'?'7 6':null};
   const circle=r.polygon?L.polygon(r.polygon,ringOptions):L.circle([r.lat,r.lon],{...ringOptions,radius:r.radiusNm*1852});
   circle.bindTooltip(esc(`${r.name} · ${r.radiusNm} nm · ${r.type.toUpperCase()} · ${r.holdMinutes} min hold`),{sticky:true});circle.on('click',onOpen);lightningRingLayer.addLayer(circle);
   const center=L.circleMarker([r.lat,r.lon],{pane:'lightningRings',radius:3,color,weight:2,fillColor:color,fillOpacity:1});center.bindTooltip(esc(r.name));center.on('click',onOpen);lightningRingLayer.addLayer(center);
  }
 },
 onFocus:r=>map.fitBounds((r.polygon?L.polygon(r.polygon):L.circle([r.lat,r.lon],{radius:r.radiusNm*1852})).getBounds(),{padding:[50,70],maxZoom:13}),
 onPick:done=>{
  $('lightningPickHint').hidden=false;map.getContainer().style.cursor='crosshair';$('sidebar').classList.remove('open');
  function finish(point){map.getContainer().removeEventListener('click',pick,true);document.removeEventListener('keydown',cancel);$('lightningPickHint').hidden=true;map.getContainer().style.cursor='';done(point);}
  function pick(e){e.stopPropagation();e.preventDefault();finish(map.mouseEventToLatLng(e));}
  function cancel(e){if(e.key==='Escape'){e.preventDefault();finish(null);}}
  map.getContainer().addEventListener('click',pick,true);document.addEventListener('keydown',cancel);$('lightningPickCancel').onclick=()=>finish(null);
 }
});
const windAlerts=initWindAlerts({onChange:results=>operations.wind(results),onFocus:r=>{goLive();settings.layers.winds=true;settings.height=String(r.hgt);syncControls();save();render();map.setView([r.lat,r.lon],12);const plot=selectWindPlots(feed('winds').rows,settings.height,settings.thermo).find(x=>x.site===windSite(r.tower));if(plot)inspect('winds',plot);}});
function render(){if(!data)return;displaySnapshot=replayTime===null?data:replayFrame(replayHistory,replayTime,settings.trail,replayUrl);if(replayTime!==null&&replayImageFailures.has(displaySnapshot.feeds.radar.image_data)){displaySnapshot.feeds.radar.image_data=null;if(!displaySnapshot.gaps.includes('radar'))displaySnapshot.gaps.push('radar');}operations.live(data,snapshotFailure);operations.display(displaySnapshot||data,settings,mapTime(),replayTime!==null);lightningWatches.update(data,snapshotFailure);windAlerts.update(snapshotFailure?{...liveFeed('winds'),status:'error'}:liveFeed('winds'));for(const g of Object.values(groups))g.clearLayers();stationIndex=[];const now=mapTime();const winds=selectWindPlots(feed('winds').rows,settings.height,settings.thermo);renderBarnes();$('count-winds').textContent=`${winds.length} sites · ${clockLabel(feed('winds').observed_at)}`;
 for(const r of winds){
  stationIndex.push({name:r.site,kind:'winds',r,lat:r.lat,lon:r.lon});if(!settings.layers.winds)continue;
  const color=settings.basemap==='light'&&settings.windColor===DEFAULTS.windColor?'#223b50':settings.windColor;
  const scale=settings.windScale,size=40*scale,center=size/2;
  let fields='';
  for(const [key,klass,dx,dy] of [['tmp','temp-value',-26,-15],['dp','dew-value',-26,6],['rh','rh-value',17,6]]){
   const v=r.thermo[key];if(!settings.thermo[key]||!v)continue;
   fields+=`<span class="station-value ${klass}" style="left:${center+dx*scale}px;top:${center+dy*scale}px;font-size:${10*scale}px" title="${key==='rh'?'Humidity':key==='tmp'?'Temperature':'Dew point'} at ${v.height} ft">${fmt(v.value)}${key==='rh'?'%':''}</span>`;
  }
  const html=`<div class="wind-marker${staleClass(observationTime(r),'winds')}" style="width:${size}px;height:${size}px">${r.hasWind?windSvg(r.avg_dir_1min,r.avg_spd_1min,color,size):`<svg width="${size}" height="${size}" viewBox="0 0 40 40"><circle cx="20" cy="20" r="2" fill="${color}"/></svg>`}${fields}${settings.gusts&&clean(r.peak_spd_10min)!==null?`<span class="gust-label" title="10-minute peak gust (kt)" style="left:${center+15*scale}px;top:${center-14*scale}px;font-size:${10*scale}px">${fmt(r.peak_spd_10min)}</span>`:''}</div>`;
  marker(r.lat,r.lon,html,[size,size],'winds',r,`Tower ${r.site} · ${r.hgt} ft${r.hasWind?' · '+fmt(r.avg_spd_1min)+' kt':''}`);
 }
 const efms=feed('efm').rows.filter(r=>typeof r.value==='number'&&Number.isFinite(r.value));const flagged=efms.filter(r=>r.flag).length;$('count-efm').textContent=`${efms.length} mills${flagged?` · ${flagged} flagged`:''} · ${clockLabel(feed('efm').observed_at)}`;
 for(const r of efms){
  const name='FM'+String(r.field_mill).padStart(2,'0');stationIndex.push({name,kind:'efm',r,lat:r.lat,lon:r.lon});if(!settings.layers.efm)continue;
  const c=settings.efmColors[efmCategory(r.value,settings)],size=22*settings.efmScale;
  const html=`<div class="efm-marker${staleClass(observationTime(r),'efm')}" style="--color:${c};width:${size}px;height:${size}px;font-size:${7*settings.efmScale}px;${r.flag?'border-style:dashed;':''}"><span>${r.field_mill}</span>${settings.labels?`<span class="station-label" style="top:${size+5}px;font-size:${8*settings.efmScale}px">${name}</span>`:''}</div>`;
  marker(r.lat,r.lon,html,[size,size],'efm',r,`${name} · ${r.value.toFixed(0)} V/m${r.flag?' · flag '+r.flag:''}`);
 }
 const end=now,start=end-settings.trail*60000;
 const cg=feed('cg').rows.filter(r=>{const t=Date.parse(ztime(r.event_datetime));return t>=start&&t<end;});$('count-cg').textContent=`${cg.length} detections · trailing ${settings.trail} min`;
 if(settings.layers.cg)for(const r of cg)marker(r.lat_decimal,r.lon_decimal,'<div class="cg-marker">+</div>',[24,24],'cg',r,`CG detection · ${clockLabel(ztime(r.event_datetime))}`);
 const ccRecords=ccDetections(feed('cc').rows,now,settings.trail);
 if(settings.ccMode==='points'){
  $('count-cc').textContent=`${ccRecords.length} detections · individual points`;
  if(settings.layers.cc)for(const r of ccRecords){
   const dot=L.circleMarker([r.lat_decimal,r.lon_decimal],{pane:'cc',radius:2.7,weight:.7,color:'#173d67',fillColor:'#8edcff',fillOpacity:.9});
   dot.bindTooltip(esc('CC detection · '+new Date(ztime(r.event_datetime)).toISOString().slice(11,23)+'Z'),{direction:'top'});
   dot.on('click',()=>inspect('cc',{...r,ccPoint:true}));groups.cc.addLayer(dot);
  }
 }else{
  const cc=ccCells(feed('cc').rows,now,settings.trail,settings);
  $('count-cc').textContent=`${ccRecords.length} detections · ${cc.length} cells`;
  if(settings.layers.cc)for(const r of cc)marker(r.lat,r.lon,`<div class="cc-dot" style="background:${r.color}"></div>`,[12,12],'cc',r,`${r.count} CC detections · ~1 km cell`);
 }
 const profiles=feed('profilers').rows;$('count-profilers').textContent=`${profiles.length} stations${feed('profilers').source?.includes('fallback')?' · archive fallback':''}`;
 for(const r of profiles){stationIndex.push({name:r.site+' '+r.name,kind:'profilers',r,lat:r.lat,lon:r.lon});if(!settings.layers.profilers)continue;const html=`<div class="profiler-marker${staleClass(r.observed_at,'profilers')}"><svg viewBox="0 0 24 24"><path d="M12 21V9M7 21h10M6 11a8 8 0 0 1 12 0M3 7a13 13 0 0 1 18 0"/></svg>${settings.labels?`<span class="station-label">${esc(r.site)}</span>`:''}</div>`;marker(r.lat,r.lon,html,[28,28],'profilers',r,`${r.name} · ${clockLabel(r.observed_at)}`);}
 const radar=feed('radar');$('count-radar').textContent=radar.observed_at?`QC composite · ${clockLabel(radar.observed_at)}`:'Waiting for radar';
 if(settings.layers.radar&&radar.image_data&&radar.bounds&&freshAge(radar.observed_at,mapTime())<=20){
  const overlay=L.imageOverlay(radar.image_data,radar.bounds,{pane:'radar',opacity:settings.radarOpacity,interactive:false,attribution:'Radar: NOAA/NSSL MRMS'});
  groups.radar.addLayer(overlay);
 }
 const count=Object.values(settings.layers).filter(Boolean).length;$('activeLayers').textContent=count===0?'No layers selected':`${count} layer${count===1?'':'s'} visible`;$('dataTimestamp').textContent=replayTime===null?`Snapshot ${clockLabel(data.generated_at)} · refresh ${ageLabel(data.generated_at)}`:`REPLAY ${new Date(replayTime).toISOString().slice(0,16).replace('T',' ')}Z · alerts remain LIVE`;syncReplayControls();
 updateLegend();updateStatus();if(selected)refreshInspector();
}
const barnesCache=new Map();
function renderBarnes(){
 const f=feed('winds');if(!settings.layers.barnes){$('count-barnes').textContent='54 ft wind analysis';return;}
 const sourceRows=replayTime===null?f.rows:replayHistory?.feeds?.winds?.rows||f.rows;
 const stations=prepareStations(sourceRows,mapTime());
 const key=JSON.stringify(stations.map(s=>[s.name,s.lat,s.lon,s.u,s.v,s.time]));
 let analysis=barnesCache.get(key);if(!analysis){analysis=analyzeBarnes(stations);barnesCache.set(key,analysis);if(barnesCache.size>65)barnesCache.delete(barnesCache.keys().next().value);}
 $('count-barnes').title=analysis.status==='ok'?'54 ft average wind analysis; five-minute maximum sensor age':analysis.status==='insufficient_stations'?'At least five fresh 54 ft towers are required':'Not enough local station support for a valid analysis';
 const observed=stations.length?new Date(Math.max(...stations.map(s=>s.time))).toISOString():null;
 $('count-barnes').textContent=analysis.status==='ok'?`${analysis.stations} towers · 54 ft · ${clockLabel(observed)}`:`Unavailable · ${analysis.stations} fresh towers`;
 if(analysis.status!=='ok')return;
 for(const contour of analysis.contours){
  const label=contour.level<0?`Convergence: ${Math.abs(contour.level)}`:contour.level>0?`Divergence: ${contour.level}`:'Zero divergence';
  const line=L.polyline(contour.paths,{pane:'barnes',color:contour.color,weight:contour.weight,opacity:f.status==='error'?.45:.85,smoothFactor:0});
  line.bindTooltip(esc(`${label} × 10⁻⁴ s⁻¹ · 54 ft Barnes · ${analysis.stations} towers`),{sticky:true});groups.barnes.addLayer(line);
 }
}
function updateLegend(){const s=settings;const low=s.low.toLocaleString(),high=s.high.toLocaleString();$('efmMini').innerHTML=[`<${low}`,`${low}–<${high}`,`≥${high}`].map((label,i)=>`<span><i style="background:${s.efmColors[i]}"></i>${label}</span>`).join('');$('legendHeight').textContent=(s.height==='surface'?'SURFACE':s.height==='lowest'?'LOWEST':s.height==='200plus'?'200+ FT':s.height+' FT')+' WINDS';let html='';if(s.layers.winds){html+='<div class="legend-item"><span style="width:15px">↗</span>Wind barb · knots · from direction</div>';if(s.gusts)html+='<div class="legend-item">Upper right: 10-minute peak gust · kt</div>';if(s.thermo.tmp)html+='<div class="legend-item" style="color:#ff8c7c">Upper left: temperature · °F</div>';if(s.thermo.dp)html+='<div class="legend-item" style="color:#70e6a1">Lower left: dew point · °F</div>';if(s.thermo.rh)html+='<div class="legend-item" style="color:#9ed3ff">Lower right: relative humidity · %</div>';}if(s.layers.efm){html+='<div class="legend-section">';for(const [i,label] of [`|E| < ${low} V/m`,`${low} ≤ |E| < ${high} V/m`,`|E| ≥ ${high} V/m`].entries())html+=`<div class="legend-item"><i style="background:${s.efmColors[i]}"></i>${label}</div>`;html+='<div class="legend-item" style="font-size:8px;color:#7289a1">Dashed ring: API status flag present</div></div>';}
 if(s.layers.barnes)html+='<div class="legend-section"><div class="legend-item">Barnes · 54 ft winds · ×10⁻⁴ s⁻¹</div><div class="legend-item"><i style="background:#ff8714"></i>Negative: convergence</div><div class="legend-item"><i style="background:#19cdf5"></i>Positive: divergence</div><div class="legend-item"><i style="background:#f5f5f5"></i>White: zero divergence</div><div class="legend-item">500 m grid · 10 km smoothing</div></div>';
 if(s.layers.cg)html+='<div class="legend-item"><span class="plus">+</span>Cloud-to-ground detection</div>';
 if(s.layers.cc&&s.ccMode==='points')html+=`<div class="legend-section"><div class="legend-item"><i style="background:#8edcff"></i>Individual CC detections · ${s.trail} min</div></div>`;
 if(s.layers.cc&&s.ccMode==='density')html+=`<div class="legend-section"><div class="legend-item">CC records / ~1 km cell / ${s.trail} min</div><div class="density-scale">${s.ccColors.map(c=>`<i style="background:${c}"></i>`).join('')}</div><div class="density-numbers"><span>1</span>${s.ccBreaks.map(x=>`<span>${x}+</span>`).join('')}</div></div>`;
 if(s.layers.profilers)html+='<div class="legend-item"><span style="color:#b7a7df">◇</span>Profiler · click for vertical profile</div>';
 if(s.layers.radar){const r=feed('radar');const colors=r.legend?.colors||['#559def','#00a600','#ffbe00','#d90000','#e000d0'];html+=`<div class="legend-section"><div class="legend-item">MRMS QC composite · dBZ</div><div class="density-scale">${colors.map(c=>`<i style="background:${esc(c)}"></i>`).join('')}</div><div class="density-numbers"><span>5</span><span>20</span><span>35</span><span>50</span><span>65</span><span>75</span></div><div class="legend-item" style="font-size:8px">${r.observed_at?clockLabel(r.observed_at)+' · '+ageLabel(r.observed_at):'Waiting for radar'}${freshAge(r.observed_at,mapTime())>20?' · hidden':''}</div></div>`;}
 $('legendContent').innerHTML=html||'<p class="legend-empty">Turn on a layer to explore observations.</p>';
}
function updateStatus(){let warnings=[],failed=0;const lines=[];for(const [key,label] of Object.entries(LABELS)){if(key==='barnes')continue;const f=liveFeed(key);let status='ok',message='';if(f.status==='error'){status='error';message=f.rows.length?'Last good data':'Unavailable';failed++;warnings.push(`${label}: source request failed. ${f.rows.length?'Showing its last good observations.':''}`);}else if(f.status!=='ok'){status='warn';message='Connecting';}else if(['cg','cc'].includes(key)){message=f.rows.length?f.rows.length+' records / 60 min':'No events / 60 min';}else{const age=freshAge(f.observed_at);message=clockLabel(f.observed_at)+' · '+(Number.isFinite(age)?Math.floor(age)+'m':'unknown');if(age>(key==='profilers'?180:15)){status='warn';warnings.push(`${label}: latest observation is ${ageLabel(f.observed_at,Date.now())}.`);}if(key==='profilers'&&f.source?.includes('fallback'))message+=' · fallback';}lines.push(`<div class="feed-line" title="${esc((f.source||'')+(f.error?' · '+f.error:''))}"><span><i class="${status}"></i>${label}</span><span class="feed-value ${status}">${esc(message)}</span></div>`);}
 $('feedStatus').innerHTML=lines.join('');const snapshotAge=freshAge(data?.generated_at);if(endpointFailure)warnings.unshift('Minute data service unavailable. Using the GitHub snapshot fallback.');if(snapshotFailure)warnings.unshift('Snapshot refresh failed. Retaining the last downloaded observations.');else if(snapshotAge>12)warnings.unshift(`Published snapshot is ${ageLabel(data.generated_at,Date.now())}. Check data times before use.`);$('networkStatus').textContent=failed?`${failed} feed${failed===1?'':'s'} unavailable`:snapshotAge>12?'Snapshot delayed':data?.collector?.startsWith('Cloudflare')?'Minute feed connected':'GitHub snapshot';
 if(warnings.length){$('mapAlert').textContent=warnings.slice(0,2).join(' ');$('mapAlert').hidden=false;}else if(tileFailures<5)$('mapAlert').hidden=true;
}
function detail(label,value){return `<div class="detail-row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;}
function inspect(kind,r){selected={kind,id:kind==='winds'?r.site:kind==='efm'?r.field_mill:kind==='profilers'?r.site:r.id||`${r.lat},${r.lon}`,record:r};$('inspector').hidden=false;populateInspector(kind,r);if(window.innerWidth<801)$('sidebar').classList.remove('open');}
function refreshInspector(){const {kind,id}=selected;let r=selected.record;if(kind==='winds')r=selectWindPlots(feed('winds').rows,settings.height,settings.thermo).find(x=>x.site===id);else if(kind==='efm')r=feed('efm').rows.find(x=>x.field_mill===id);else if(kind==='profilers')r=feed('profilers').rows.find(x=>x.site===id);else if(kind==='cc'){if(selected.record.ccPoint){const found=ccDetections(feed('cc').rows,mapTime(),settings.trail).find(x=>selected.record.id!=null?x.id===selected.record.id:x.event_datetime===selected.record.event_datetime&&x.lat_decimal===selected.record.lat_decimal&&x.lon_decimal===selected.record.lon_decimal);r=found?{...found,ccPoint:true}:null;}else r=ccCells(feed('cc').rows,mapTime(),settings.trail,settings).find(x=>x.lat===selected.record.lat&&x.lon===selected.record.lon);}else if(kind==='cg')r=feed('cg').rows.find(x=>x.id===selected.record.id&&Date.parse(ztime(x.event_datetime))<=mapTime());if(!r){$('inspectorContent').innerHTML='<p class="detail-note">No observation at this height or in the selected window.</p>';return;}populateInspector(kind,r);}
function populateInspector(kind,r){$('inspectorKind').textContent=LABELS[kind].toUpperCase();let html='';const lat=r.lat??r.lat_decimal,lon=r.lon??r.lon_decimal;const location=`<div class="location">${Number(lat).toFixed(4)}° N &nbsp; ${Math.abs(Number(lon)).toFixed(4)}° W</div>`;
 if(kind==='winds'){const observed=observationTime(r);html=`<h2>Tower ${esc(r.site)}</h2>${location}<div class="reading">${fmt(r.avg_spd_1min)}<small>kt</small></div><div class="reading-note">1-minute mean · from ${fmt(r.avg_dir_1min)}°</div>${detail('Sensor height',r.hgt+' ft AGL')}${detail('10-minute peak gust',fmt(r.peak_spd_10min)+' kt')}${detail('1-minute peak',fmt(r.peak_spd_1min)+' kt')}${detail('Temperature',fmt(r.thermo?.tmp?.value??r.tmp,1)+' °F'+(r.thermo?.tmp?' @ '+r.thermo.tmp.height+' ft':''))}${detail('Dew point',fmt(r.thermo?.dp?.value??r.dp,1)+' °F'+(r.thermo?.dp?' @ '+r.thermo.dp.height+' ft':''))}${detail('Relative humidity',fmt(r.thermo?.rh?.value??r.rh)+' %'+(r.thermo?.rh?' @ '+r.thermo.rh.height+' ft':''))}${detail('Observation',clockLabel(observed)+' · '+ageLabel(observed))}${detail('Sensor / prevailing side',r.tower+' / '+(r.prevailing||'—'))}<p class="detail-note">${esc(feed('winds').source)}. Missing source values are shown as —.</p>`;}
 else if(kind==='efm'){const cat=efmCategory(r.value,settings),name='FM'+String(r.field_mill).padStart(2,'0');html=`<h2>${name}</h2>${location}<div class="reading" style="color:${settings.efmColors[cat]}">${r.value>0?'+':''}${r.value.toFixed(0)}<small>V/m</small></div><div class="reading-note">Signed one-minute electric potential gradient</div>${detail('Magnitude',Math.abs(r.value).toFixed(0)+' V/m')}${detail('Category',['Below lower threshold','Between thresholds','At or above upper threshold'][cat])}${detail('Observation',clockLabel(observationTime(r))+' · '+ageLabel(observationTime(r)))}${detail('API status flag',r.flag||'None reported')}${r.coordinate_source?detail('Location',r.coordinate_source):''}${r.flag?'<span class="pill warn">Flag meaning is unconfirmed</span>':''}<p class="detail-note">Flags are preserved as reported. A zero value or green display does not establish a GO decision.</p>`;}
 else if(kind==='profilers'){html=`<h2>${esc(r.site)}</h2><div class="location">${esc(r.name)}</div>${detail('Observation',clockLabel(r.observed_at)+' · '+ageLabel(r.observed_at))}${detail('Valid levels',r.valid_levels)}<span class="pill ${feed('profilers').source?.includes('fallback')?'warn':''}">${esc(feed('profilers').source?.includes('fallback')?'Archive fallback active':'Profiler observations')}</span><p class="detail-note">Altitude gates in feet, converted from source km. Wind in knots. ${feed('profilers').source?.includes('fallback')?'The profiler API feed is older than the archive.':''}</p><table class="profile-table"><thead><tr><th>Height (ft)</th><th>From</th><th>Speed (kt)</th></tr></thead><tbody>${[...r.levels].reverse().map(v=>`<tr><td>${Math.round(v.height_ft).toLocaleString()}</td><td>${Math.round(v.direction_deg)}°</td><td><span class="profile-bar" style="width:${Math.min(70,v.speed_kt)}px"></span>${Math.round(v.speed_kt)}</td></tr>`).join('')}</tbody></table>`;}
 else if(kind==='cc'&&r.ccPoint){html=`<h2>CC detection</h2>${location}${detail('Event (UTC)',r.event_datetime)}${detail('Record ID',r.id??'—')}${detail('Signal strength',r.signal_strength??'—')}${detail('Sensor IDs',r.sensor_ids||'—')}<p class="detail-note">An individual MERLIN detection at its reported coordinates, not a clustered flash. Signal strength uses source units.</p>`;}
 else if(kind==='cc'){html=`<h2>${r.count}<span style="font-size:13px;color:#8ca2b9"> detections</span></h2>${location}${detail('Cell size','Approximately 1 km')}${detail('Window',`Trailing ${settings.trail} minutes`)}<p class="detail-note">Counted detection records, not clustered flashes. Colors match your selected density thresholds.</p>`;}
 else{html=`<h2>CG detection</h2>${location}${detail('Event',r.event_date+' '+r.event_time+' UTC')}${detail('Signal strength',r.signal_strength??'—')}${detail('Sensor IDs',r.sensor_ids||'—')}<p class="detail-note">Signal strength uses source units. The API guide does not specify physical units.</p>`;}
 $('inspectorContent').innerHTML=html;
}
async function fetchJson(url){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`HTTP ${r.status}`);const d=await r.json();if(!d.feeds||!d.generated_at)throw Error('Invalid observation snapshot');return d;}
async function refresh(){if(refreshing)return;refreshing=true;$('refresh').disabled=true;$('refresh').querySelector('span').textContent='Refreshing…';const hostedOnGithub=location.hostname==='cyclonecizek.github.io';const remote='https://raw.githubusercontent.com/cyclonecizek/ER_Weather_COP/main/dist/data/latest.json';const local=new URL('./data/latest.json',location.href).href;try{let result;const standard=hostedOnGithub?local:remote;endpointFailure=false;
 try{result=await fetchJson(settings.dataEndpoint||standard);}
 catch(error){
  if(settings.dataEndpoint){endpointFailure=true;result=await fetchJson(standard);}
  else{if(data)throw error;result=await fetchJson(local);}
 }
 data=result;
 const heights=[...new Set(feed('winds').rows.map(r=>r.hgt).filter(h=>typeof h==='number'&&h>0&&h!==54&&h!==999))].sort((a,b)=>a-b);
 $('windHeight').querySelector('optgroup')?.remove();
 const optgroup=document.createElement('optgroup');optgroup.label='Exact sensor height';
 for(const height of heights){const option=document.createElement('option');option.value=String(height);option.textContent=height+' ft';optgroup.append(option);}
 $('windHeight').append(optgroup);$('windHeight').value=settings.height;
 snapshotFailure=false;lastRefresh=Date.now();render();if(replayHistory)loadReplay(false).catch(()=>{});}catch(error){snapshotFailure=true;operations.live(data,true);lightningWatches.update(data,true);$('mapAlert').hidden=false;$('mapAlert').textContent=data?'Snapshot refresh failed. Retaining last downloaded observations.':'Observations could not load. Use Refresh to try again.';if(data){updateStatus();windAlerts.update({...liveFeed('winds'),status:'error'});}else $('networkStatus').textContent='Unable to connect';}finally{refreshing=false;refreshAt=Date.now()+60000;$('loading').hidden=true;$('refresh').disabled=false;$('refresh').querySelector('span').textContent='Refresh observations';}}
function syncControls(){for(const key of Object.keys(LABELS))$('layer-'+key).checked=settings.layers[key];$('windHeight').value=settings.height;$('gusts').checked=settings.gusts;$('labels').checked=settings.labels;$('trail').value=settings.trail;$('trailLabel').textContent=settings.trail+' min';$('windOptions').hidden=!settings.layers.winds;$('ccOptions').hidden=!settings.layers.cc;$('ccMode').value=settings.ccMode;for(const key of ['tmp','dp','rh'])$('show-'+key).checked=settings.thermo[key];$('radarOptions').hidden=!settings.layers.radar;$('radarOpacity').value=Math.round(settings.radarOpacity*100);$('radarOpacityLabel').textContent=Math.round(settings.radarOpacity*100)+'%';}
for(const key of Object.keys(LABELS))$('layer-'+key).addEventListener('change',e=>{settings.layers[key]=e.target.checked;syncControls();save();render();});
$('allOff').onclick=()=>{for(const k in settings.layers)settings.layers[k]=false;syncControls();save();render();};
$('windHeight').onchange=e=>{settings.height=e.target.value;save();render();};
for(const key of ['labels','gusts'])$(key).onchange=e=>{settings[key]=e.target.checked;save();render();};
$('ccMode').onchange=e=>{settings.ccMode=e.target.value;if(selected?.kind==='cc')closeInspector();save();render();};
$('trail').oninput=e=>{settings.trail=Number(e.target.value);$('trailLabel').textContent=settings.trail+' min';save();render();};
for(const key of ['tmp','dp','rh'])$('show-'+key).onchange=e=>{settings.thermo[key]=e.target.checked;save();render();};
$('radarOpacity').oninput=e=>{settings.radarOpacity=Number(e.target.value)/100;$('radarOpacityLabel').textContent=e.target.value+'%';save();render();};
$('refresh').onclick=refresh;$('homeView').onclick=()=>map.setView([28.555,-80.63],10);$('fitStations').onclick=()=>{const points=stationIndex.filter(x=>settings.layers[x.kind]).map(x=>[x.lat,x.lon]);if(points.length)map.fitBounds(points,{padding:[55,75],maxZoom:12});};
document.querySelectorAll('[data-basemap]').forEach(b=>b.onclick=()=>{setBase(b.dataset.basemap);render();});
function closeInspector(){$('inspector').hidden=true;selected=null;}
$('closeInspector').onclick=closeInspector;
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('settings').open&&!$('windAlertsDialog').open&&!$('lightningWatchesDialog').open)closeInspector();});
$('mobileLayers').onclick=()=>{$('sidebar').classList.toggle('open');};function syncLegendState(){const expanded=$('legend').open;$('legendToggle').setAttribute('aria-expanded',String(expanded));$('legendToggle').title=expanded?'Collapse map legend':'Expand map legend';$('legendToggle').querySelector('.legend-chevron').textContent=expanded?'⌃':'⌄';}
try{$('legend').open=localStorage.getItem('er-cop-legend-collapsed')!=='true';}catch{}
syncLegendState();
$('legend').addEventListener('toggle',()=>{syncLegendState();try{localStorage.setItem('er-cop-legend-collapsed',String(!$('legend').open));}catch{}});

$('search').oninput=e=>{const query=e.target.value.trim().toLowerCase(),box=$('searchResults');if(!query){box.hidden=true;return;}const results=stationIndex.filter(s=>s.name.toLowerCase().includes(query)).slice(0,8);box.innerHTML=results.length?results.map((s,i)=>`<button data-search-index="${i}">${esc(s.name)} <span style="color:#7791ab">· ${LABELS[s.kind]}</span></button>`).join(''):'<p style="padding:10px;font-size:10px;color:#829ab4">No matching station at this height.</p>';box.hidden=false;box.querySelectorAll('button').forEach(b=>b.onclick=()=>{const s=results[Number(b.dataset.searchIndex)];settings.layers[s.kind]=true;syncControls();save();render();map.setView([s.lat,s.lon],12);inspect(s.kind,s.r);box.hidden=true;});};
function settingsControls(s){$('settingWindScale').value=s.windScale;$('settingEfmScale').value=s.efmScale;$('settingWindScaleLabel').textContent=Math.round(s.windScale*100)+'%';$('settingEfmScaleLabel').textContent=Math.round(s.efmScale*100)+'%';$('settingCartoKey').value=s.cartoKey;$('settingDataEndpoint').value=s.dataEndpoint;$('settingLow').value=s.low;$('settingHigh').value=s.high;$('settingWindColor').value=s.windColor;$('efmColors').innerHTML=s.efmColors.map((c,i)=>`<label><input type="color" data-efm-color="${i}" value="${c}" aria-label="EFM ${['low','middle','high'][i]} color">${['Low','Middle','High'][i]}</label>`).join('');$('ccSettings').innerHTML=s.ccColors.map((c,i)=>`<label class="cc-setting"><input type="color" data-cc-color="${i}" value="${c}" aria-label="CC bin ${i+1} color"><span>${i===5?'Highest bin':'Bin '+(i+1)+' · below'}</span>${i<5?`<input type="number" min="1" required data-cc-break="${i}" value="${s.ccBreaks[i]}" aria-label="CC bin ${i+1} upper threshold">`:'<span>last threshold +</span>'}</label>`).join('');$('efmPalette').value='custom';$('settingsError').textContent='';}
function openSettings(){settingsControls(settings);$('settings').showModal();} $('settingsButton').onclick=openSettings;$('customizeButton').onclick=openSettings;$('closeSettings').onclick=()=>$('settings').close();$('settings').addEventListener('click',e=>{if(e.target===$('settings')){const r=$('settings').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('settings').close();}});
$('efmPalette').onchange=e=>{const palettes={placefile:DEFAULTS.efmColors,accessible:['#56b4e9','#e69f00','#cc79a7'],muted:['#80cdb3','#edb579','#e78291']};const colors=palettes[e.target.value];if(colors)document.querySelectorAll('[data-efm-color]').forEach((input,i)=>input.value=colors[i]);};
$('settingsForm').onsubmit=e=>{e.preventDefault();const next={...settings,dataEndpoint:normalizeDataEndpoint($('settingDataEndpoint').value),windScale:Number($('settingWindScale').value),efmScale:Number($('settingEfmScale').value),cartoKey:$('settingCartoKey').value.trim(),low:Number($('settingLow').value),high:Number($('settingHigh').value),efmColors:[...document.querySelectorAll('[data-efm-color]')].map(x=>x.value),ccBreaks:[...document.querySelectorAll('[data-cc-break]')].map(x=>Number(x.value)),ccColors:[...document.querySelectorAll('[data-cc-color]')].map(x=>x.value),windColor:$('settingWindColor').value};if(!settingsValid(next)){$('settingsError').textContent='Use a valid HTTPS data service URL, an upper EFM threshold greater than the lower threshold, and increasing positive CC thresholds.';return;}const endpointChanged=settings.dataEndpoint!==next.dataEndpoint;const keyChanged=settings.cartoKey!==next.cartoKey;settings=next;if(keyChanged){bases=makeBases();setBase(settings.basemap);}save();render();$('settings').close();if(endpointChanged)refresh();};
$('resetSettings').onclick=()=>settingsControls({...settings,...{windScale:DEFAULTS.windScale,efmScale:DEFAULTS.efmScale,low:DEFAULTS.low,high:DEFAULTS.high,efmColors:DEFAULTS.efmColors,ccColors:DEFAULTS.ccColors,ccBreaks:DEFAULTS.ccBreaks,windColor:DEFAULTS.windColor}});
for(const id of ['Wind','Efm'])$('setting'+id+'Scale').oninput=e=>$('setting'+id+'ScaleLabel').textContent=Math.round(Number(e.target.value)*100)+'%';
function tick(){const now=new Date();$('clock').textContent=now.toISOString().slice(11,19);$('clockDate').textContent=now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).toUpperCase();$('refreshCountdown').textContent='AUTO · '+Math.max(0,Math.ceil((refreshAt-Date.now())/1000))+'s';if(data&&now.getSeconds()%5===0)lightningWatches.update(data,snapshotFailure);if(data&&now.getSeconds()%15===0)windAlerts.update(snapshotFailure?{...liveFeed('winds'),status:'error'}:liveFeed('winds'));if(Date.now()>=refreshAt)refresh();}
function stopReplay(){replayPlaying=false;if(replayTimer)clearInterval(replayTimer);replayTimer=null;}
function syncReplayControls(){
 const active=replayTime!==null;$('replayBar').classList.toggle('replaying',active);document.body.classList.toggle('replay-mode',active);
 $('replayMode').textContent=active?'REPLAY':'LIVE';$('replayPlay').textContent=replayLoading?'Loading…':replayPlaying?'Pause':'▶ Play';$('replayPlay').disabled=replayLoading;
 $('replayTimeline').disabled=!replayHistory;$('replayPrevious').disabled=!replayHistory;$('replayNext').disabled=!replayHistory;
 if(replayHistory){const {start,end}=replayBounds(replayHistory);$('replayTimeline').max=Math.round((end-start)/60000);$('replayTimeline').value=active?Math.round((replayTime-start)/60000):Math.round((end-start)/60000);$('replayStart').textContent=clockLabel(new Date(start).toISOString());$('replayEnd').textContent=clockLabel(new Date(end).toISOString());}
 $('replayTime').textContent=active?new Date(replayTime).toISOString().slice(11,16)+'Z':'Current observations';
 const gaps=active?(displaySnapshot?.gaps||[]).filter(k=>settings.layers[k]||k==='winds'&&settings.layers.barnes):[];
 $('replayNote').textContent=active?(gaps.length?'Missing / partial: '+gaps.map(k=>LABELS[k]).join(', '):'Historical observations · live alerts continue'):'Previous 60 minutes · alerts monitor live observations';
}
async function preloadReplayImages(history,url){
 const urls=new Set((history.feeds.radar?.rows||[]).map(r=>new URL(r.image_url,url).href));
 for(const key of replayImages.keys())if(!urls.has(key)){replayImages.delete(key);replayImageFailures.delete(key);}
 await Promise.all([...urls].map(src=>{if(replayImages.has(src))return Promise.resolve();return new Promise(resolve=>{
  const img=new Image();replayImages.set(src,img);
  const timer=setTimeout(()=>{replayImageFailures.add(src);resolve();},10000);
  img.onload=()=>{clearTimeout(timer);replayImageFailures.delete(src);resolve();};img.onerror=()=>{clearTimeout(timer);replayImageFailures.add(src);replayImages.delete(src);resolve();};img.src=src;
 });}));
}
async function loadReplay(showBusy=true){
 if(replayLoading)return;if(showBusy){replayLoading=true;syncReplayControls();}
 const url=location.hostname==='cyclonecizek.github.io'?new URL('./data/replay/index.json',location.href).href:'https://raw.githubusercontent.com/cyclonecizek/ER_Weather_COP/main/dist/data/replay/index.json';
 try{const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('HTTP '+response.status);const next=await response.json();if(!validReplay(next))throw Error('Invalid replay index');
 await preloadReplayImages(next,url);replayHistory=next;replayUrl=url;if(replayTime!==null){const {start,end}=replayBounds(next);replayTime=Math.min(end,Math.max(start,replayTime));}if(data)render();
 }catch(error){$('replayNote').textContent='Replay unavailable. Try again after the next data update.';throw error;}
 finally{replayLoading=false;$('replayPlay').disabled=false;$('replayPlay').textContent=replayPlaying?'Pause':'▶ Play';}
}
function startReplayTimer(){
 if(replayTimer)clearInterval(replayTimer);
 replayTimer=setInterval(()=>{if(!replayHistory||!replayPlaying)return;const {start,end}=replayBounds(replayHistory);replayTime=advanceFrame(replayTime,start,end);render();},1000/Number($('replaySpeed').value));
}
function goLive(){stopReplay();replayTime=null;if(data)render();else syncReplayControls();}
$('replayPlay').onclick=async()=>{if(replayPlaying){stopReplay();syncReplayControls();return;}try{if(!replayHistory)await loadReplay();if(!replayHistory)return;if(replayTime===null)replayTime=replayBounds(replayHistory).start;replayPlaying=true;render();startReplayTimer();}catch{}};
function stepReplay(direction){if(!replayHistory)return;stopReplay();const {start,end}=replayBounds(replayHistory);const current=replayTime===null?end:replayTime;replayTime=Math.max(start,Math.min(end,current+direction*60000));render();}
$('replayPrevious').onclick=()=>stepReplay(-1);$('replayNext').onclick=()=>stepReplay(1);
$('replayTimeline').oninput=e=>{if(!replayHistory)return;stopReplay();replayTime=replayBounds(replayHistory).start+Number(e.target.value)*60000;render();};
$('replayLive').onclick=goLive;$('replaySpeed').onchange=()=>{if(replayPlaying)startReplayTimer();};
syncReplayControls();syncControls();tick();setInterval(tick,1000);setInterval(()=>{if(data)render();},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRefresh>60000)refresh();});refresh();
