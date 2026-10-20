export function initViews({document:doc=document,window:win=window,onMap=()=>{}}={}){
 const buttons=[doc.getElementById('mapViewTab'),doc.getElementById('operationsViewTab')];
 const panels=[doc.getElementById('mapViewPanel'),doc.getElementById('operationsViewPanel')];
 let current='map';
 function show(value,{focus=false,hash=true}={}){
  current=value==='operations'?'operations':'map';const index=current==='map'?0:1;
  buttons.forEach((button,i)=>{button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;});
  doc.body.dataset.view=current;
  if(hash)try{win.history.replaceState(null,'',current==='map'?'#map':'#operations');}catch{}
  if(current==='map')onMap();
  if(focus)buttons[index].focus();
 }
 buttons.forEach((button,index)=>{
  button.onclick=()=>show(index?'operations':'map');
  button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-index;show(next?'operations':'map',{focus:true});});
 });
 win.addEventListener('hashchange',()=>show(win.location.hash==='#operations'?'operations':'map',{hash:false}));
 show(win.location.hash==='#operations'?'operations':'map',{hash:false});
 return {show,get current(){return current;}};
}
