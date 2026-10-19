// Two-pass Barnes analysis, matching WINDS_Placefile's Python generator.
import {windSite,windSide,validWind,ztime} from './core.mjs';
export const BARNES={grid:500,lengthKm:10,gamma:.3,influenceKm:28,nearestKm:12,minNearby:3,hullBufferKm:12};
const R=6371000,RAD=Math.PI/180,KNOT=.5144444444444445;
export function contourStyle(level){
 const a=Math.abs(level),index=a>=10?0:a>=8?1:a>=6?2:a>=4?3:a>=2?4:5;
 const warm=['#cd1419','#f52823','#ff5519','#ff8714','#ffbe14','#ffdc4b'],cool=['#2841d2','#2369f5','#199bff','#19cdf5','#4be1eb','#9bf0eb'];
 return {color:level<0?warm[index]:level>0?cool[index]:'#f5f5f5',weight:level===0?2:a>=8?3:Math.round(a)%2===0?2:1};
}
export function prepareStations(rows,now=Date.now()){
 const stations=new Map();
 const chosen=new Map();
 for(const row of rows){
  if(row.hgt!==54||!validWind(row)||typeof row.tower!=='string')continue;
  let t;try{t=Date.parse(ztime(row.reading_datetime));}catch{continue;}
  if(!Number.isFinite(t)||t>now||now-t>5*60000||!Number.isFinite(row.lat)||!Number.isFinite(row.lon)||row.lat<26||row.lat>31||row.lon< -84||row.lon> -77||row.avg_spd_1min===9999)continue;
  const site=windSite(row.tower),old=chosen.get(site);
  if(!old||t>old.t||t===old.t&&windSide(row)>windSide(old.row))chosen.set(site,{row,t});
 }
 for(const [site,{row,t}] of [...chosen].sort(([a],[b])=>a.localeCompare(b))){
  const angle=row.avg_dir_1min*RAD,speed=row.avg_spd_1min*KNOT;
  stations.set(`${row.lat.toFixed(6)},${row.lon.toFixed(6)}`,{name:site,lat:row.lat,lon:row.lon,u:-speed*Math.sin(angle),v:-speed*Math.cos(angle),time:t});
 }
 return [...stations.values()];
}
function hull(points){
 const pts=[...new Map(points.map(p=>[p.join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(pts.length<=2)return pts;
 const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lower=[],upper=[];
 for(const p of pts){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
 for(const p of pts.slice().reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
 return [...lower.slice(0,-1),...upper.slice(0,-1)];
}
function insideBuffered(x,y,poly,buffer){
 let inside=false,nearest=Infinity;
 for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const [ax,ay]=poly[j],[bx,by]=poly[i];
  if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/den)):0;
  nearest=Math.min(nearest,Math.hypot(x-ax-t*dx,y-ay-t*dy));
 }
 return inside||nearest<=buffer;
}
function weighted(x,y,stations,scale,cutoff,residual=false){
 let u=0,v=0,den=0,nearby=0,nearest=Infinity;
 for(const s of stations){const d=(x-s.x)**2+(y-s.y)**2;nearest=Math.min(nearest,d);if(d>cutoff*cutoff)continue;nearby++;const w=Math.exp(-d/scale);den+=w;u+=w*(residual?s.ru:s.u);v+=w*(residual?s.rv:s.v);}
 return {u:den?u/den:null,v:den?v/den:null,nearby,nearest:Math.sqrt(nearest)};
}
export function divergenceGrid(u,v,mask,nx,ny,spacing){
 const out=new Float64Array(nx*ny).fill(NaN);
 for(let j=1;j<ny-1;j++)for(let i=1;i<nx-1;i++){const k=j*nx+i;if(mask[k]&&mask[k-1]&&mask[k+1]&&mask[k-nx]&&mask[k+nx])out[k]=((u[k+1]-u[k-1])+(v[k+nx]-v[k-nx]))/(2*spacing)*1e4;}
 return out;
}
const CASES=[[],[[3,0]],[[0,1]],[[3,1]],[[1,2]],[[3,2],[0,1]],[[0,2]],[[3,2]],[[2,3]],[[0,2]],[[0,3],[1,2]],[[1,2]],[[1,3]],[[0,1]],[[3,0]],[]];
export function contourSegments(div,xs,ys,level){
 const segments=[],nx=xs.length;
 for(let j=0;j<ys.length-1;j++)for(let i=0;i<nx-1;i++){
  const values=[div[j*nx+i],div[j*nx+i+1],div[(j+1)*nx+i+1],div[(j+1)*nx+i]];if(values.some(v=>!Number.isFinite(v)))continue;
  const code=values.reduce((c,v,k)=>c|(v>=level?1<<k:0),0);let edges=CASES[code];
  if(code===5||code===10){const center=values.reduce((a,b)=>a+b)/4;edges=code===5?(center>=level?[[3,0],[1,2]]:[[3,2],[0,1]]):(center>=level?[[0,1],[2,3]]:[[0,3],[1,2]]);}
  const interpolate=edge=>{
   const pairs=[[0,1],[1,2],[3,2],[0,3]],[a,b]=pairs[edge],f=values[a]===values[b]?.5:Math.max(0,Math.min(1,(level-values[a])/(values[b]-values[a])));
   return edge===0?[xs[i]+f*(xs[i+1]-xs[i]),ys[j]]:edge===1?[xs[i+1],ys[j]+f*(ys[j+1]-ys[j])]:edge===2?[xs[i]+f*(xs[i+1]-xs[i]),ys[j+1]]:[xs[i],ys[j]+f*(ys[j+1]-ys[j])];
  };
  for(const [a,b] of edges)segments.push([interpolate(a),interpolate(b)]);
 }
 return segments;
}
const pointKey=p=>`${Math.round(p[0])},${Math.round(p[1])}`;
function stitched(segments){
 const adjacency=new Map(),points=new Map(),used=new Set(),lines=[];
 segments.forEach(([a,b],index)=>{const ka=pointKey(a),kb=pointKey(b);for(const [key,p,other] of [[ka,a,kb],[kb,b,ka]]){if(!points.has(key))points.set(key,p);if(!adjacency.has(key))adjacency.set(key,[]);adjacency.get(key).push([index,other]);}});
 const ends=[...adjacency.keys()].filter(k=>adjacency.get(k).length===1),starts=[...ends,...[...adjacency.keys()].filter(k=>!ends.includes(k))];
 for(const start of starts){while(adjacency.get(start).some(([i])=>!used.has(i))){let current=start,previous=null;const line=[points.get(start)];
  while(true){const choices=adjacency.get(current).filter(([i])=>!used.has(i));if(!choices.length)break;const [index,next]=choices.find(([,key])=>key!==previous)||choices[0];used.add(index);line.push(points.get(next));previous=current;current=next;if(current===start)break;}
  if(line.length>=2)lines.push(line);
 }}return lines;
}
function smooth(points){
 if(points.length<4)return points;const closed=pointKey(points[0])===pointKey(points.at(-1)),out=closed?[]:[points[0]];
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];out.push([.75*a[0]+.25*b[0],.75*a[1]+.25*b[1]],[.25*a[0]+.75*b[0],.25*a[1]+.75*b[1]]);}
 out.push(closed?out[0]:points.at(-1));return out;
}
export function analyzeBarnes(input,options=BARNES){
 const stations=input.map(s=>({...s}));if(stations.length<5)return {status:'insufficient_stations',stations:stations.length,contours:[]};
 const lat0=stations.reduce((v,s)=>v+s.lat,0)/stations.length,lon0=stations.reduce((v,s)=>v+s.lon,0)/stations.length,coslat=Math.cos(lat0*RAD);
 for(const s of stations){s.x=R*(s.lon-lon0)*RAD*coslat;s.y=R*(s.lat-lat0)*RAD;}
 const scale=(options.lengthKm*1000)**2,cutoff=options.influenceKm*1000,buffer=options.hullBufferKm*1000;
 for(const s of stations){const first=weighted(s.x,s.y,stations,scale,cutoff);s.ru=s.u-(first.u??s.u);s.rv=s.v-(first.v??s.v);}
 const minx=Math.min(...stations.map(s=>s.x))-buffer,maxx=Math.max(...stations.map(s=>s.x))+buffer,miny=Math.min(...stations.map(s=>s.y))-buffer,maxy=Math.max(...stations.map(s=>s.y))+buffer;
 const nx=Math.max(3,Math.ceil((maxx-minx)/options.grid)+1),ny=Math.max(3,Math.ceil((maxy-miny)/options.grid)+1);
 if(nx*ny>150000)return {status:'grid_too_large',stations:stations.length,contours:[]};
 const xs=Array.from({length:nx},(_,i)=>minx+i*options.grid),ys=Array.from({length:ny},(_,j)=>miny+j*options.grid),poly=hull(stations.map(s=>[s.x,s.y]));
 const u=new Float64Array(nx*ny),v=new Float64Array(nx*ny),mask=new Uint8Array(nx*ny);
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const x=xs[i],y=ys[j];if(!insideBuffered(x,y,poly,buffer))continue;
  const first=weighted(x,y,stations,scale,cutoff);if(first.u===null||first.nearby<options.minNearby||first.nearest>options.nearestKm*1000)continue;
  const correction=weighted(x,y,stations,Math.max(scale*options.gamma,1),cutoff,true),k=j*nx+i;
  u[k]=first.u+(correction.u||0);v[k]=first.v+(correction.v||0);mask[k]=1;
 }
 const grid=divergenceGrid(u,v,mask,nx,ny,options.grid),valid=[...grid].filter(Number.isFinite);
 const contours=[];
 for(let level=-12;level<=12;level++){
  const paths=stitched(contourSegments(grid,xs,ys,level)).map(smooth).map(line=>line.map(([x,y])=>[lat0+y/R/RAD,lon0+x/(R*coslat)/RAD]));
  if(paths.length)contours.push({level,paths,...contourStyle(level)});
 }
 return {status:valid.length?'ok':'no_valid_gridpoints',stations:stations.length,contours,min:valid.length?Math.min(...valid):null,max:valid.length?Math.max(...valid):null,validPoints:valid.length,grid:[nx,ny]};
}
