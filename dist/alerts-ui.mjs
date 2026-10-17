import {WIND_METRICS,validWindRule,evaluateWindRule,advanceWindEpisode,windAlertSite} from './wind-alerts.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);
export function initWindAlerts({onFocus}){
 const storageKey='er-cop-wind-alerts-v1';let rules=[],feed=null,editing=null,audio=null,sound=false,storageError=false;
 const episodes=new Map();
 try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))rules=saved.filter(validWindRule).slice(0,20);}catch{}
 function save(){try{localStorage.setItem(storageKey,JSON.stringify(rules));storageError=false;}catch{storageError=true;}}
 function beep(){if(!sound||!audio)return;audio.resume().then(()=>{for(const offset of [0,.35,.7]){const osc=audio.createOscillator(),gain=audio.createGain(),t=audio.currentTime+offset;osc.frequency.value=880;gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.14,t+.02);gain.gain.exponentialRampToValueAtTime(.001,t+.22);osc.connect(gain).connect(audio.destination);osc.start(t);osc.stop(t+.24);}}).catch(()=>{sound=false;$('alertSound').textContent='Enable sound';});}
 function render(){
  const results=rules.map(rule=>({rule,...evaluateWindRule(rule,feed)}));let active=0,gaps=0,notify=false;
  for(const result of results){
   const episode=advanceWindEpisode(episodes.get(result.rule.id),result);
   if(result.state==='active')active++;
   if(episode.notify)notify=true;
   if(result.gaps.length)gaps++;
   episodes.set(result.rule.id,episode);
  }
  $('windAlertsButton').textContent=active?`Wind alerts · ${active} active`:'Wind alerts';
  $('windAlertsButton').classList.toggle('has-alert',active>0);
  $('windAlertSummary').textContent=storageError?'Preferences could not be saved in this browser.':!rules.length?'Create a rule to monitor selected towers.':`${active} active · ${gaps} with data gaps · ${rules.filter(r=>r.enabled).length} enabled`;
  const cards=results.map(result=>{
   const {rule,state,hits,gaps}=result,ack=episodes.get(rule.id).ack;
   return `<article class="wind-alert-card ${state}"><div class="wind-alert-heading"><strong>${esc(rule.name)}</strong><span>${{active:ack?'ACKNOWLEDGED':'THRESHOLD MET',clear:'BELOW THRESHOLD',unknown:'DATA GAP',paused:'PAUSED'}[state]}</span></div><p>${esc(WIND_METRICS[rule.metric])} ≥ ${rule.threshold} kt · ≤ ${rule.maxHeight} ft AGL<br>Towers ${rule.towers.map(esc).join(', ')}</p>${hits.length?`<ul class="wind-alert-hits">${hits.map((r,i)=>`<li><button type="button" data-focus-rule="${esc(rule.id)}" data-hit="${i}">Tower ${r.site} · ${r.hgt} ft: <strong>${r.value} kt</strong> · ${r.observedAt.slice(11,16)}Z ↗</button></li>`).join('')}</ul>`:''}${gaps.length?`<p class="wind-alert-gap">Coverage incomplete: ${gaps.map(esc).join(', ')}. Missing, invalid, stale (>5 min), or failed-source data. Last alert remains latched until fresh observations clear it.</p>`:''}<div class="wind-alert-actions">${state==='active'&&!ack?`<button type="button" data-rule-action="ack" data-id="${esc(rule.id)}">Acknowledge</button>`:''}<button type="button" data-rule-action="toggle" data-id="${esc(rule.id)}">${rule.enabled?'Pause':'Enable'}</button><button type="button" data-rule-action="edit" data-id="${esc(rule.id)}">Edit</button><button type="button" data-rule-action="delete" data-id="${esc(rule.id)}">Delete</button></div></article>`;
  }).join('');
  $('windAlertRules').innerHTML=cards||'<p class="settings-intro">No rules yet. For example: 1-minute peak ≥35 kt on selected towers at or below 54 ft.</p>';
  const visible=results.filter(r=>r.state==='active'||r.state==='unknown');
  $('windAlertPanel').hidden=visible.length===0;
  $('windAlertPanelText').textContent=visible.map(r=>r.state==='active'?`${r.rule.name}: ${r.hits.map(h=>`${h.site} / ${h.hgt} ft / ${h.value} kt`).join('; ')}${episodes.get(r.rule.id).ack?' (acknowledged)':''}${r.gaps.length?' · incomplete coverage':''}`:`${r.rule.name}: monitoring gap${episodes.get(r.rule.id).active?' · previous alert not cleared':''}`).join(' | ');
  $('windAlertPanel').classList.toggle('active',active>0);
  if(notify)beep();
  $('windAlertRules').querySelectorAll('[data-rule-action]').forEach(b=>b.onclick=()=>{
   const rule=rules.find(r=>r.id===b.dataset.id);if(!rule)return;
   switch(b.dataset.ruleAction){case 'ack':episodes.get(rule.id).ack=true;break;case 'toggle':rule.enabled=!rule.enabled;save();break;case 'edit':edit(rule);return;case 'delete':rules=rules.filter(r=>r.id!==rule.id);episodes.delete(rule.id);if(editing===rule.id)reset();save();break;}render();
  });
  $('windAlertRules').querySelectorAll('[data-focus-rule]').forEach(b=>b.onclick=()=>{const r=results.find(r=>r.rule.id===b.dataset.focusRule)?.hits[Number(b.dataset.hit)];if(r){$('windAlertsDialog').close();onFocus(r);}});
 }
 function towerOptions(selected=[]){
  const towers=[...new Set([...(feed?.rows||[]).filter(r=>typeof r.tower==='string').map(r=>windAlertSite(r.tower)).filter(t=>/^[A-Z0-9_]{1,24}$/.test(t)),...selected])].sort();
  $('alertTowers').innerHTML=towers.map(t=>`<label><input type="checkbox" name="alertTower" value="${t}" ${selected.includes(t)?'checked':''}>${t}</label>`).join('')||'<p>Tower list will appear when observations load.</p>';
 }
 function reset(){editing=null;$('windAlertForm').reset();$('alertThreshold').value=35;$('alertHeight').value=54;$('alertRuleName').value='';$('alertFormTitle').textContent='New alert rule';$('alertSave').textContent='Add rule';$('alertFormError').textContent='';towerOptions();}
 function edit(rule){editing=rule.id;$('alertRuleName').value=rule.name;$('alertMetric').value=rule.metric;$('alertThreshold').value=rule.threshold;$('alertHeight').value=rule.maxHeight;towerOptions(rule.towers);$('alertFormTitle').textContent='Edit alert rule';$('alertSave').textContent='Save changes';$('alertFormError').textContent='';$('windAlertForm').scrollIntoView({block:'nearest'});}
 function open(){reset();render();$('windAlertsDialog').showModal();}
 $('windAlertsButton').onclick=open;$('windAlertPanel').onclick=open;$('closeWindAlerts').onclick=()=>$('windAlertsDialog').close();$('alertCancelEdit').onclick=reset;
 $('alertSelectAll').onclick=()=>{$('alertTowers').querySelectorAll('input').forEach(x=>x.checked=true);};
 $('alertSelectNone').onclick=()=>{$('alertTowers').querySelectorAll('input').forEach(x=>x.checked=false);};
 $('alertSound').onclick=async()=>{if(sound){sound=false;$('alertSound').textContent='Enable sound';return;}try{const Audio=window.AudioContext||window.webkitAudioContext;audio=audio||new Audio();await audio.resume();sound=true;$('alertSound').textContent='Sound on · mute';beep();}catch{$('alertSound').textContent='Sound unavailable';}};
 $('windAlertForm').onsubmit=e=>{
  e.preventDefault();const existing=rules.find(r=>r.id===editing);
  const rule={id:editing||crypto.randomUUID(),name:$('alertRuleName').value.trim(),enabled:existing?.enabled??true,metric:$('alertMetric').value,threshold:Number($('alertThreshold').value),maxHeight:Number($('alertHeight').value),towers:[...$('alertTowers').querySelectorAll('input:checked')].map(x=>x.value)};
  if(!validWindRule(rule)){$('alertFormError').textContent='Enter a name, select at least one tower, and use a threshold of 0–300 kt and height of 0–2000 ft (both greater than zero).';return;}
  if(!editing&&rules.length>=20){$('alertFormError').textContent='You can save up to 20 rules. Edit or delete an existing rule.';return;}
  if(editing)rules=rules.map(r=>r.id===editing?rule:r);else rules.push(rule);
  episodes.delete(rule.id);save();reset();render();
 };
 reset();render();
 return {update(next){feed=next;render();if($('windAlertsDialog').open&&!$('alertTowers').querySelector('input'))towerOptions();}};
}
