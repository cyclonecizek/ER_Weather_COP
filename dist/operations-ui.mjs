import {clean,efmCategory,ztime,selectWindPlots} from './core.mjs';
import {WIND_METRICS} from './wind-alerts.mjs';
import {insideWatch} from './lightning-watches.mjs?v=ops-20261020';
import {observationRows,lightningRows,ringActivity,monitorEvents,csv,validLog,eventTime} from './operations-model.mjs?v=ops-20261020';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,n=0)=>clean(v)===null?'—':Number(v).toFixed(n);
const clock=t=>Number.isFinite(t)?new Date(t).toISOString().slice(11,19)+'Z':'—';
const countdown=ms=>{const s=Math.max(0,Math.ceil(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
const countLabel=n=>n.toLocaleString();
const stateLabel=r=>r.state==='active'?'HOLD '+countdown(r.remainingMs):r.state==='quiet'?'NO RECENT DETECTIONS':r.state==='paused'?'PAUSED':'DATA UNAVAILABLE';
export function initOperations({onResize,onFocus,onRingFocus,onConfigure,onAcknowledge,onSounds,onPresets}){
 let rings=[],winds=[],systems=[],live={},snapshot={},settings={},now=Date.now(),replay=false,tab='winds',sortKey='site',descending=false,tableRows=[],log=[],operator='',saveError=false;
 let notificationOn=false,sourceState=new Map(),ringFeed=null,ringEvents=[];
 const logKey='er-cop-event-log-v1';
 try{log=validLog(JSON.parse(localStorage.getItem(logKey)||'[]'));operator=localStorage.getItem('er-cop-operator')||'';}catch{}
 $('opsOperator').value=operator;
 function persist(){try{localStorage.setItem(logKey,JSON.stringify(log));saveError=false;}catch{saveError=true;}}
 function record(entry){log.unshift({...entry,time:Date.now(),operator});log=validLog(log);persist();if(tab==='events'&&!$('opsDock').hidden)renderTable();}
 function notify(entry){if(!notificationOn||entry.event!=='Activated')return;try{new Notification(entry.location,{body:entry.detail,tag:entry.category+':'+entry.location});}catch{}}
 function monitor(category,rows){const previous=category==='lightning'?rings:winds;for(const entry of monitorEvents(previous,rows,category)){record(entry);notify(entry);}if(category==='lightning')rings=rows;else winds=rows;renderAlerts();if(category==='lightning')renderRings();}
 function side(open){$('opsPanel').hidden=!open;$('opsButton').setAttribute('aria-expanded',String(open));try{localStorage.setItem('er-cop-ops-open',String(open));}catch{}onResize();}
 let initial=window.innerWidth>=1500;try{const saved=localStorage.getItem('er-cop-ops-open');if(saved!==null)initial=saved==='true';}catch{}side(initial);
 $('opsButton').onclick=()=>side($('opsPanel').hidden);$('opsClose').onclick=()=>side(false);
 document.querySelectorAll('[data-ops-side]').forEach(b=>b.onclick=()=>{const name=b.dataset.opsSide;document.querySelectorAll('[data-ops-side]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));$('opsRingsPanel').hidden=name!=='rings';$('opsAlertsPanel').hidden=name!=='alerts';});
 function dock(open){$('opsDock').hidden=!open;$('opsDataButton').setAttribute('aria-expanded',String(open));onResize();if(open)renderTable();}
 $('opsDataButton').onclick=()=>dock($('opsDock').hidden);$('opsDockClose').onclick=()=>dock(false);
 document.querySelectorAll('[data-ops-table]').forEach(b=>b.onclick=()=>{tab=b.dataset.opsTable;sortKey=tab==='winds'?'site':tab==='efm'?'field_mill':'time';descending=['strikes','events'].includes(tab);document.querySelectorAll('[data-ops-table]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));renderTable();});
 $('opsSearch').oninput=renderTable;$('opsHeight').onchange=renderTable;$('opsExport').onclick=exportTable;
 $('opsOperator').onchange=()=>{operator=$('opsOperator').value.trim().toUpperCase().slice(0,8);$('opsOperator').value=operator;try{localStorage.setItem('er-cop-operator',operator);}catch{}};
 $('opsNotifications').onclick=async()=>{if(!('Notification' in window)){$('opsNotifications').textContent='Notifications unavailable';return;}if(notificationOn){notificationOn=false;$('opsNotifications').textContent='Enable notifications';return;}try{notificationOn=(await Notification.requestPermission())==='granted';}catch{}$('opsNotifications').textContent=notificationOn?'Notifications on · disable':'Notifications blocked';};
 $('opsSounds').onclick=()=>{onSounds();$('opsSounds').textContent='Sound controls enabled';};
 $('opsNewWatch').onclick=()=>onConfigure('lightning');$('opsWindRules').onclick=()=>onConfigure('wind');$('opsAddPresets').onclick=()=>{const message=onPresets();$('opsPresetStatus').textContent=message;record({category:'system',event:'Site watches',location:'Ring board',detail:message});};
 function renderRings(){
  if(ringFeed!==live.feeds){ringFeed=live.feeds;ringEvents=lightningRows(live.feeds,Date.now(),60);}const events=ringEvents;
  $('opsRingCount').textContent=`${rings.filter(r=>r.state==='active').length} active / ${rings.length} watches`;
  $('opsRingBoard').innerHTML=rings.map(r=>{const activity=ringActivity(r.rule,events),max=Math.max(1,...activity.bins),bars=activity.bins.map((n,i)=>`<rect x="${i*8}" y="${24-n/max*23}" width="6" height="${Math.max(1,n/max*23)}" fill="${n?'#efb37d':'#304256'}"/>`).join('');return `<article class="ops-ring ${r.state}" style="--ring-color:${esc(r.rule.color)}"><button class="ops-ring-focus" data-ring="${esc(r.rule.id)}" title="Locate ${esc(r.rule.name)}"><span>${esc(r.rule.name)}</span><strong>${stateLabel(r)}</strong></button><div class="ops-ring-meta">${r.rule.polygon?'Site boundary':r.rule.radiusNm+' nm'} · ${r.rule.type.toUpperCase()} · ${r.rule.holdMinutes} min hold</div><svg viewBox="0 0 96 25" role="img" aria-label="Detections inside boundary per five minutes over previous hour">${bars}</svg><div class="ops-ring-meta">CG ${countLabel(activity.cg)} · CC ${countLabel(activity.cc)} · nearby ${countLabel(activity.nearby)}</div><div class="ops-ring-meta">${r.event?'Last '+clock(r.event.time)+' · '+r.event.type.toUpperCase():'No matching detection'}${r.ack?' · acknowledged':''}</div>${r.gaps.length?'<p class="ops-gap">Coverage incomplete. Hold release unavailable.</p>':''}</article>`;}).join('')||'<p class="ops-empty">Add site presets or create a custom watch to begin monitoring.</p>';
  $('opsRingBoard').querySelectorAll('[data-ring]').forEach(b=>b.onclick=()=>onRingFocus(rings.find(r=>r.rule.id===b.dataset.ring).rule));
 }
 function renderAlerts(){
  const alerts=[...rings.filter(r=>['active','unknown'].includes(r.state)).map(r=>({...r,category:'lightning'})),...winds.filter(r=>['active','unknown'].includes(r.state)).map(r=>({...r,category:'wind'})),...systems];
  const unack=alerts.filter(r=>!r.ack).length;$('opsBadge').textContent=String(unack);$('opsBadge').hidden=!unack;$('opsAlertCount').textContent=`${alerts.length} conditions · ${unack} unacknowledged`;
  $('opsAlerts').innerHTML=alerts.map(r=>{const name=r.rule?.name||r.name,id=r.rule?.id||r.id,detail=r.category==='lightning'?`${stateLabel(r)} · ${r.rule.type.toUpperCase()} · ${r.event?'last '+clock(r.event.time):'no matching detection'}`:r.category==='wind'?`${WIND_METRICS[r.rule.metric]} ≥ ${r.rule.threshold} kt · ≤ ${r.rule.maxHeight} ft${r.hits.length?' · '+r.hits.map(h=>h.site+': '+h.value+' kt @ '+h.hgt+' ft').join('; '):''}`:r.detail;
   return `<article class="ops-alert ${r.state}"><span class="ops-kicker">${r.category} · LIVE${r.ack?' · acknowledged':''}</span><h3>${esc(name)}</h3><p>${esc(detail)}</p>${r.gaps?.length?`<p class="ops-gap">Data coverage incomplete. ${r.latched?'Previous active condition is retained.':'A current release assessment is unavailable.'}</p>`:''}<div class="ops-actions">${!r.ack&&r.state==='active'?`<button data-ack="${esc(id)}" data-category="${r.category}">Acknowledge</button>`:''}${r.category!=='system'?`<button data-configure="${r.category}">Edit rules</button>`:''}</div></article>`;
  }).join('')||'<p class="ops-empty">No active conditions or monitoring gaps.</p>';
  $('opsAlerts').querySelectorAll('[data-ack]').forEach(b=>onClick(b,()=>onAcknowledge(b.dataset.category,b.dataset.ack)));
  $('opsAlerts').querySelectorAll('[data-configure]').forEach(b=>onClick(b,()=>onConfigure(b.dataset.configure)));
 }
 function onClick(button,fn){button.onclick=fn;}
 function feedsChanged(next,failed){live=next||{};systems=[];
  for(const key of ['winds','efm','cg','cc','radar','profilers']){const f=live.feeds?.[key];if(!f)continue;const fetched=eventTime(f.fetched_at),observed=eventTime(f.observed_at);const ageLimit=key==='profilers'?180:key==='radar'||key==='efm'?15:5;const time=['cg','cc'].includes(key)?fetched:observed;
   const bad=failed||f.status!=='ok'||!Number.isFinite(time)||Date.now()-time>ageLimit*60000;
   if(bad)systems.push({id:key,category:'system',name:key.toUpperCase()+' feed',state:'unknown',detail:failed?'Snapshot refresh failed. Last downloaded observations retained.':f.status!=='ok'?'Source request failed or unavailable.':'Observations or query coverage are older than '+ageLimit+' minutes.'});
   const state=bad?'gap':'ok',previous=sourceState.get(key);if(previous&&previous!==state)record({category:'system',event:bad?'Data gap':'Feed recovered',location:key.toUpperCase(),detail:bad?'Data is unavailable or stale.':'Current observations resumed.'});sourceState.set(key,state);
  }renderAlerts();renderRings();
 }
 function columns(){if(tab==='winds')return [['site','Tower'],['hgt','Height ft'],['time','Time Z'],['avg_dir_1min','From °'],['avg_spd_1min','Mean kt'],['peak_spd_1min','Peak 1m kt'],['peak_spd_10min','Peak 10m kt'],['tmp','Temp °F'],['dp','Dew °F'],['rh','RH %'],['quality','Status']];if(tab==='efm')return [['field_mill','Mill'],['time','Time Z'],['value','E V/m'],['magnitude','|E| V/m'],['flag','Flag'],['quality','Status']];if(tab==='strikes')return [['time','Time Z'],['type','Type'],['matches','Watch areas'],['lat','Latitude'],['lon','Longitude'],['signal_strength','Signal (source units)']];return [['time','Time Z'],['category','Type'],['event','Event'],['location','Location'],['detail','Detail'],['operator','By']];}
 function rowsForTable(){
  const feeds=snapshot?.feeds||{};
  if(tab==='winds')return observationRows($('opsHeight').value==='all'?feeds.winds?.rows:selectWindPlots(feeds.winds?.rows||[],settings.height,{tmp:true,dp:true,rh:true})).map(r=>({...r,quality:quality('winds',r.time)}));
  if(tab==='efm')return (feeds.efm?.rows||[]).map(r=>({...r,time:eventTime(r.reading_datetime||`${r.reading_date}T${r.reading_time}`),magnitude:clean(r.value)===null?null:Math.abs(r.value)})).map(r=>({...r,quality:quality('efm',r.time)}));
  if(tab==='strikes')return lightningRows(feeds,now,settings.trail||15).map(r=>({...r,matches:rings.filter(x=>insideWatch(x.rule,r.lat,r.lon)).map(x=>x.rule.name).join(', ')}));
  return log;
 }

 function quality(key,time){return snapshot?.feeds?.[key]?.status!=='ok'?'Source gap':time>now+60000?'Future timestamp':!Number.isFinite(time)||now-time>(key==='winds'?5:15)*60000?'Stale':'Current';}
 function cell(r,key){if(key==='time')return tab==='events'?new Date(r.time).toISOString().slice(5,10)+' '+clock(r.time):clock(r.time);if(['site','quality','flag','type','matches','category','event','location','detail','operator'].includes(key))return r[key]||'—';if(key==='field_mill')return 'FM'+String(r[key]).padStart(2,'0');return fmt(r[key],['lat','lon'].includes(key)?4:['tmp','dp'].includes(key)?1:0);}
 function renderTable(){
  if($('opsDock').hidden)return;const cols=columns(),query=$('opsSearch').value.trim().toLowerCase();
  tableRows=rowsForTable().filter(r=>!query||cols.some(([key])=>String(cell(r,key)).toLowerCase().includes(query)));
  tableRows.sort((a,b)=>{const av=a[sortKey],bv=b[sortKey];if(av==null||typeof av==='number'&&!Number.isFinite(av))return bv==null?0:1;if(bv==null||typeof bv==='number'&&!Number.isFinite(bv))return -1;const n=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true});return descending?-n:n;});
  $('opsHeight').hidden=tab!=='winds';$('opsOperatorLabel').hidden=tab!=='events';
  $('opsTableMeta').textContent=(tab==='events'?'LIVE · last 7 days · this browser':(replay?'REPLAY ':'LIVE ')+clock(now))+` · ${tableRows.length} rows`+(tab==='strikes'?` · ${settings.trail} min trail`:'')+(tab==='events'&&saveError?' · log could not be saved':'');
  $('opsTable').innerHTML='<thead><tr>'+cols.map(([key,label])=>`<th scope="col" aria-sort="${sortKey===key?(descending?'descending':'ascending'):'none'}"><button data-sort="${key}">${label}${sortKey===key?(descending?' ↓':' ↑'):''}</button></th>`).join('')+'</tr></thead><tbody>'+tableRows.slice(0,500).map((r,i)=>`<tr class="${r.quality&&r.quality!=='Current'?'ops-stale':''}">${cols.map(([key])=>{const value=esc(cell(r,key)),content=key===(tab==='winds'?'site':tab==='efm'?'field_mill':'time')&&tab!=='events'?`<button class="ops-row-link" data-row="${i}">${value} ↗</button>`:value;const color=tab==='efm'&&['value','magnitude'].includes(key)&&clean(r.value)!==null?settings.efmColors?.[efmCategory(r.value,settings)]:null;return `<td${color?` style="color:${color}"`:''}>${content}</td>`;}).join('')}</tr>`).join('')+'</tbody>';
  if(!tableRows.length)$('opsTable').innerHTML+='<caption>No matching records in this window.</caption>';
  $('opsTable').querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{descending=sortKey===b.dataset.sort?!descending:false;sortKey=b.dataset.sort;renderTable();});
  $('opsTable').querySelectorAll('[data-row]').forEach(b=>b.onclick=()=>{const r=tableRows[Number(b.dataset.row)];onFocus(tab==='winds'?'winds':tab==='efm'?'efm':r.type,r);});
 }
 function exportTable(){const cols=columns(),body=csv([cols.map(x=>x[1]),...tableRows.map(r=>cols.map(([k])=>k==='time'&&Number.isFinite(r.time)?new Date(r.time).toISOString():cell(r,k)))]),url=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='er-cop-'+tab+'-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return {wind:rows=>monitor('wind',rows),lightning:rows=>monitor('lightning',rows),live:feedsChanged,display(next,options,time,isReplay){snapshot=next;settings=options;now=time;replay=isReplay;renderTable();},tick(){if(!$('opsPanel').hidden)renderRings();},record};
}
