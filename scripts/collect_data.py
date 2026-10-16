"""Collect same-origin COP observations; retain and flag last good data on failure."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
from pathlib import Path
import json,os,re,time
import requests

UTC=timezone.utc
ROOT=Path(__file__).resolve().parents[1]
FM_IDS=[1,2,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,24,25,26,27,28,29,30,31,32,33,34,35]
PROFILERS={
 'RWP0001':('South Cape',28.43932222,-80.57592556),
 'RWP0002':('False Cape',28.60153861,-80.58976528),
 'RWP0003':('Merritt Island',28.56139639,-80.66320472),
 'RWP0004':('Mosquito Lagoon',28.68773778,-80.71922167),
 'RWP0005':('Space Coast Regional Airport',28.50187333,-80.79437306)}

def get(url,params=None):
 for attempt in range(3):
  try:
   r=requests.get(url,params=params,timeout=35,headers={'User-Agent':'ER-Weather-COP/1.0'})
   r.raise_for_status()
   return r
  except requests.RequestException as exc:
   status=exc.response.status_code if exc.response is not None else None
   if attempt==2 or status and status<500 and status!=429:raise
   time.sleep(2**attempt)

def array(url,params=None):
 data=get(url,params).json()
 if not isinstance(data,list):raise ValueError('Expected an array of observations')
 return data

def dt(s):
 x=datetime.fromisoformat(s.replace('Z','+00:00'))
 return x.replace(tzinfo=UTC) if x.tzinfo is None else x.astimezone(UTC)

def winds(now):
 rows=array('https://codiapi-winds1.rad.spaceforce.mil/winds/latest')
 rows=[r for r in rows if r.get('hgt') is not None and r.get('tower') and r.get('lat') is not None and r.get('lon') is not None]
 if not rows:raise ValueError('No wind tower rows returned')
 return {'rows':rows,'observed_at':max(r['reading_datetime'] for r in rows)+'Z','source':'WINDS one-minute API'}

def efm(now):
 rows=array('https://codiapi-lplws1.rad.spaceforce.mil/lplws_1min/latest')
 rows=[r for r in rows if r.get('field_mill') in FM_IDS and r.get('lat') is not None and r.get('lon') is not None]
 if not rows:raise ValueError('No configured field mills returned')
 configured=json.loads((ROOT/'scripts/efm_sites.json').read_text())
 for r in rows:
  site='FM'+str(r['field_mill']).zfill(2)
  if not (28<=r['lat']<=29.3 and -81.5<=r['lon']<=-80):
   if site not in configured:continue
   r['lat'],r['lon']=configured[site]
   r['coordinate_source']='Configured location; API location outside Cape coverage'
  else:r['coordinate_source']='LPLWS API location' 
 return {'rows':rows,'observed_at':max(r['reading_date']+'T'+r['reading_time'] for r in rows)+'Z','source':'LPLWS one-minute API'}

def lightning(kind,now):
 base=f'https://codiapi-lightning{kind}.rad.spaceforce.mil/lightning_{kind}'
 def chunk(a,b):
  try:return array(base+'/range',{'date>':a.strftime('%Y-%m-%dT%H:%M:%S'),'date<':b.strftime('%Y-%m-%dT%H:%M:%S'),'sort':'asc'})
  except requests.HTTPError as exc:
   body=exc.response.text.lower().replace(',','')
   if ('100000' in body or 'too many' in body) and b-a>timedelta(seconds=2):
    mid=a+timedelta(seconds=int((b-a).total_seconds())//2)
    return chunk(a,mid)+chunk(mid,b)
   raise
 start=now-timedelta(minutes=60)
 raw=chunk(start,now)
 rows=list({r['id']:r for r in raw if r.get('id') is not None and start<=dt(r['event_datetime'])<now}.values())
 latest=array(base+'/latest',{'limit':1})
 return {'rows':rows,'window_start':start.isoformat(),'window_end':now.isoformat(),
         'last_event_at':latest[0]['event_datetime']+'Z' if latest else None,'source':f'MERLIN {kind.upper()} API'}

def profilers(now):
 base='https://raw.githubusercontent.com/cyclonecizek/ProfilerPlacefiles/main/docs/'
 meta=get(base+'ksc_915mhz_profilers.json').json()
 text=get(base+'ksc_915mhz_profilers.txt').text.replace('\\n','\n')
 rows=[]
 for p in meta.get('profiles',[]):
  site=p['site']
  if site not in PROFILERS:continue
  name,lat,lon=PROFILERS[site]
  # Each Object has duplicated hover text on marker and label; take its first table.
  match=re.search(r'Object:[\s\S]*?KSC 915 MHz Wind Profiler '+re.escape(site)+r'\n([\s\S]*?)(?:"\n|"\r)',text)
  block=match[1] if match else ''
  levels=[{'height_ft':float(h.replace(',','')),'direction_deg':float(d),'speed_kt':float(s)}
          for h,d,s in re.findall(r'([\d,]+) ft\s+(\d+) deg @ (\d+) kt',block)]
  # Duplicated hovers within a block must not duplicate altitude gates.
  levels=list({r['height_ft']:r for r in levels}.values())
  if not levels:raise ValueError(f'Could not decode wind profile for {site}')
  rows.append({'site':site,'name':name,'lat':lat,'lon':lon,'observed_at':p['observation_utc'],
               'levels':sorted(levels,key=lambda x:x['height_ft']),'valid_levels':p['valid_wind_levels']})
 if not rows:raise ValueError('No profiler profiles available')
 return {'rows':rows,'observed_at':max(r['observed_at'] for r in rows),
         'source':meta.get('source','Published profiler placefile'),
         'fallback_reason':meta.get('api_fallback_reason'),'upstream_generated_at':meta['generated_utc']}

def radar(now):
 from mrms import fetch
 return fetch(now,get)

FETCHERS={'radar':radar,'winds':winds,'efm':efm,'cc':lambda now:lightning('c2c',now),'cg':lambda now:lightning('c2g',now),'profilers':profilers}

def collect(previous=None,fetchers=None,now=None):
 previous=previous or {}
 now=now or datetime.now(UTC)
 result={'generated_at':now.isoformat(),'feeds':{}}
 with ThreadPoolExecutor(max_workers=5) as pool:
  jobs={name:pool.submit(fn,now) for name,fn in (fetchers or FETCHERS).items()}
  for name,job in jobs.items():
   try:
    result['feeds'][name]={**job.result(),'status':'ok','fetched_at':now.isoformat(),'error':None}
   except Exception as exc:
    old=previous.get('feeds',{}).get(name,{})
    result['feeds'][name]={**old,'rows':old.get('rows',[]),'status':'error','error':str(exc),'failed_at':now.isoformat()}
    print(f'{name}: {exc}')
 return result

if __name__=='__main__':
 path=ROOT/'dist/data/latest.json'
 old=json.loads(path.read_text()) if path.exists() else {}
 data=collect(old)
 path.parent.mkdir(parents=True,exist_ok=True)
 temp=path.with_suffix('.tmp')
 temp.write_text(json.dumps(data,separators=(',',':'),allow_nan=False))
 temp.replace(path)
 print(json.dumps({k:{'status':v['status'],'rows':len(v['rows'])} for k,v in data['feeds'].items()}))
 if all(v['status']=='error' for v in data['feeds'].values()):raise SystemExit('All feeds failed')
