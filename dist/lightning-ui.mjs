import {SITE_WATCHES} from './site-watches.mjs?v=ops-20261020';
import {validLightningWatch,evaluateLightningWatch,advanceLightningEpisode} from './lightning-watches.mjs?v=ops-20261020';
import {windAlertSite} from './wind-alerts.mjs';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const utc=t=>new Date(t).toISOString().slice(11,19)+'Z';
const countdown=ms=>{const seconds=Math.max(0,Math.ceil(ms/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
export function initLightningWatches({onRings,onFocus,onPick,onChange=()=>{}}){
 let rules=[],feeds={},winds=[],editing=null,sound=false,audio=null,storageError=false;
 const episodes=new Map(),key='er-cop-lightning-watches-v1';
 try{const saved=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(saved))rules=saved.filter(validLightningWatch).slice(0,30);}catch{}
 function save(){try{localStorage.setItem(key,JSON.stringify(rules));storageError=false;}catch{storageError=true;}}
 function beep(){if(!sound||!audio)return;audio.resume().then(()=>{for(const offset of [0,.25]){const osc=audio.createOscillator(),gain=audio.createGain(),t=audio.currentTime+offset;osc.frequency.value=660;gain.gain.setValueAtTime(.001,t);gain.gain.exponentialRampToValueAtTime(.13,t+.02);gain.gain.exponentialRampToValueAtTime(.001,t+.18);osc.connect(gain).connect(audio.destination);osc.start(t);osc.stop(t+.2);}}).catch(()=>{sound=false;$('lightningSound').textContent='Enable sound';});}
 function describe(r){return r.state==='active'?`HOLD · ${countdown(r.remainingMs)} remaining`:r.state==='quiet'?'NO RECENT DETECTIONS':r.state==='paused'?'PAUSED':'DATA GAP';}
 function render(){
  let notify=false;
  const results=rules.map(rule=>{
   const result=evaluateLightningWatch(rule,feeds,Date.now(),episodes.get(rule.id)?.event);
   const episode=advanceLightningEpisode(episodes.get(rule.id),result);episodes.set(rule.id,episode);notify=notify||episode.notify;
   return {rule,...result,ack:episode.ack,latched:episode.active};
  });
  const active=results.filter(r=>r.state==='active'),gaps=results.filter(r=>r.gaps.length);
  $('lightningWatchSummary').textContent=storageError?'Preferences could not be saved in this browser.':!rules.length?'Custom distance rings and hold timers':`${active.length} active · ${gaps.length} with data gaps · ${rules.filter(r=>r.enabled).length} enabled`;
  $('lightningWatchesButton').classList.toggle('has-alert',active.length>0);
  $('lightningWatchList').innerHTML=results.map(r=>`<button type="button" class="lightning-compact ${r.state}" data-open-lightning="${esc(r.rule.id)}"><span>${esc(r.rule.name)} · ${r.rule.radiusNm} nm</span><strong>${describe(r)}</strong>${r.gaps.length?'<small>Coverage incomplete</small>':''}</button>`).join('');
  $('lightningRules').innerHTML=results.map(r=>`<article class="wind-alert-card ${r.state==='quiet'?'clear':r.state}"><div class="wind-alert-heading"><strong>${esc(r.rule.name)}</strong><span>${describe(r)}</span></div><p>${r.rule.radiusNm} nm · ${r.rule.type.toUpperCase()} · ${r.rule.holdMinutes}-minute hold<br>${r.rule.lat.toFixed(4)}, ${r.rule.lon.toFixed(4)}</p>${r.event?`<p>Last detection: ${utc(r.event.time)} · ${r.event.type.toUpperCase()} · ${r.event.distanceNm.toFixed(1)} nm${r.state==='active'?`<br>Hold until ${utc(r.event.time+r.rule.holdMinutes*60000)}${r.ack?' · acknowledged':''}`:''}</p>`:'<p>No matching detection in the available window.</p>'}${r.gaps.length?`<p class="wind-alert-gap">Coverage incomplete (${r.gaps.map(esc).join(', ')}). ${r.latched&&r.state!=='active'?'Previous alert has not been cleared.':'A hold cannot be released without current data.'}</p>`:''}<div class="wind-alert-actions">${r.state==='active'&&!r.ack?`<button type="button" data-lightning-action="ack" data-id="${esc(r.rule.id)}">Acknowledge</button>`:''}${['focus','edit','toggle','ring','delete'].map(action=>`<button type="button" data-lightning-action="${action}" data-id="${esc(r.rule.id)}">${{focus:'Locate',edit:'Edit',toggle:r.rule.enabled?'Pause':'Enable',ring:r.rule.showRing?'Hide ring':'Show ring',delete:'Delete'}[action]}</button>`).join('')}</div></article>`).join('')||'<p class="settings-intro">Create a site watch below. Add multiple rules at the same location for concentric rings with different radii or hold times.</p>';
  const visible=results.filter(r=>r.state==='active'||r.state==='unknown');
  $('lightningAlertPanel').hidden=!visible.length;
  $('lightningAlertPanelText').textContent=visible.map(r=>`${r.rule.name} / ${r.rule.radiusNm} nm: ${describe(r)}${r.gaps.length?' · incomplete coverage':''}${r.ack?' · acknowledged':''}`).join(' | ');
  $('lightningAlertPanel').classList.toggle('active',active.length>0);
  const configured=new Set(rules.map(r=>r.id));
  const previews=SITE_WATCHES.filter(r=>!configured.has(r.id)).map(rule=>({rule,state:'preview',gaps:[],preview:true}));
  onRings([...results,...previews],()=>open());
  onChange(results);
  if(notify)beep();
  $('lightningWatchList').querySelectorAll('button').forEach(b=>b.onclick=open);
  $('lightningRules').querySelectorAll('[data-lightning-action]').forEach(b=>b.onclick=()=>{
   const rule=rules.find(r=>r.id===b.dataset.id);if(!rule)return;
   switch(b.dataset.lightningAction){
    case 'ack':episodes.get(rule.id).ack=true;break;
    case 'focus':$('lightningWatchesDialog').close();onFocus(rule);return;
    case 'edit':edit(rule);return;
    case 'toggle':rule.enabled=!rule.enabled;break;
    case 'ring':rule.showRing=!rule.showRing;break;
    case 'delete':rules=rules.filter(r=>r.id!==rule.id);episodes.delete(rule.id);if(editing===rule.id)reset();break;
   }save();render();
  });
 }
 function siteOptions(){
  const selected=$('lightningSite').value,sites=new Map();
  for(const r of winds){if(typeof r.tower!=='string'||!Number.isFinite(r.lat)||!Number.isFinite(r.lon))continue;const name=windAlertSite(r.tower);if(!sites.has(name))sites.set(name,{name,lat:r.lat,lon:r.lon});}
  const list=[...sites.values()].sort((a,b)=>a.name.localeCompare(b.name));
  $('lightningSite').innerHTML='<option value="">Choose a WINDS tower / launch site</option>'+list.map(r=>`<option value="${esc(r.name)}" data-lat="${r.lat}" data-lon="${r.lon}">${esc(r.name)}</option>`).join('');$('lightningSite').value=selected;
 }
 function reset(){editing=null;$('lightningForm').reset();$('lightningRadius').value=5;$('lightningHold').value=30;$('lightningLat').value='';$('lightningLon').value='';$('lightningName').value='';$('lightningFormTitle').textContent='New lightning watch';$('lightningSave').textContent='Add watch';$('lightningFormError').textContent='';siteOptions();}
 function edit(rule){editing=rule.id;$('lightningName').value=rule.name;$('lightningLat').value=rule.lat;$('lightningLon').value=rule.lon;$('lightningRadius').value=rule.radiusNm;$('lightningHold').value=rule.holdMinutes;$('lightningType').value=rule.type;$('lightningColor').value=rule.color;$('lightningSite').value='';$('lightningFormTitle').textContent='Edit lightning watch';$('lightningSave').textContent='Save changes';$('lightningFormError').textContent='';$('lightningForm').scrollIntoView({block:'nearest'});}
 function open(){reset();render();$('lightningWatchesDialog').showModal();}
 $('lightningWatchesButton').onclick=open;$('lightningAlertPanel').onclick=open;$('closeLightningWatches').onclick=()=>$('lightningWatchesDialog').close();$('lightningCancelEdit').onclick=reset;
 $('lightningSite').onchange=()=>{const option=$('lightningSite').selectedOptions[0];if(!option?.dataset.lat)return;$('lightningLat').value=Number(option.dataset.lat).toFixed(5);$('lightningLon').value=Number(option.dataset.lon).toFixed(5);if(!$('lightningName').value.trim())$('lightningName').value=option.value+' lightning';};
 $('lightningPick').onclick=()=>{$('lightningWatchesDialog').close();onPick(point=>{if(point){$('lightningLat').value=point.lat.toFixed(5);$('lightningLon').value=point.lng.toFixed(5);$('lightningSite').value='';}$('lightningWatchesDialog').showModal();});};
 $('lightningSound').onclick=async()=>{if(sound){sound=false;$('lightningSound').textContent='Enable sound';return;}try{const Audio=window.AudioContext||window.webkitAudioContext;audio=audio||new Audio();await audio.resume();sound=true;$('lightningSound').textContent='Sound on · mute';beep();}catch{$('lightningSound').textContent='Sound unavailable';}};
 $('lightningForm').onsubmit=e=>{
  e.preventDefault();const old=rules.find(r=>r.id===editing),rule={id:editing||crypto.randomUUID(),name:$('lightningName').value.trim(),lat:Number($('lightningLat').value),lon:Number($('lightningLon').value),radiusNm:Number($('lightningRadius').value),holdMinutes:Number($('lightningHold').value),type:$('lightningType').value,color:$('lightningColor').value,...(old?.polygon&&old.lat===Number($('lightningLat').value)&&old.lon===Number($('lightningLon').value)&&old.radiusNm===Number($('lightningRadius').value)?{polygon:old.polygon}:{}),enabled:old?.enabled??true,showRing:old?.showRing??true};
  if(!validLightningWatch(rule)||!$('lightningLat').value.trim()||!$('lightningLon').value.trim()){$('lightningFormError').textContent='Enter a name, valid coordinates, a radius above 0 and up to 100 nm, and a hold of 1–60 whole minutes.';return;}
  if(!editing&&rules.length>=30){$('lightningFormError').textContent='Up to 30 watches can be saved. Edit or delete one to add another.';return;}
  if(editing)rules=rules.map(r=>r.id===editing?rule:r);else rules.push(rule);episodes.delete(rule.id);save();reset();render();
 };
 reset();render();
 return {open,acknowledge(id){const episode=episodes.get(id);if(episode){episode.ack=true;render();}},addPresets(){const existing=new Set(rules.map(r=>r.id));const added=SITE_WATCHES.filter(r=>!existing.has(r.id)).slice(0,30-rules.length);rules.push(...structuredClone(added));save();render();return added.length+' site watches added; '+rules.length+' total. Preset boundaries and 30-minute holds are editable.';},update(next,snapshotFailed=false){winds=next?.feeds?.winds?.rows||[];feeds=next?.feeds||{};if(snapshotFailed)feeds={...feeds,cg:{...feeds.cg,status:'error'},cc:{...feeds.cc,status:'error'}};render();if($('lightningWatchesDialog').open&&$('lightningSite').options.length<2)siteOptions();}};
}
