"""Rolling timestamped replay data, separate from the live alert snapshot."""
import base64,gzip,json,re
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import datetime,timedelta,timezone
from pathlib import Path
import collect_data as c

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist/data/replay'
MIN=timedelta(minutes=1)
WIND_FIELDS=('id','reading_datetime','tower','prevailing','hgt','lat','lon','avg_dir_1min','avg_spd_1min','peak_spd_1min','peak_spd_10min','tmp','dp','rh')
FM_FIELDS=('id','reading_date','reading_time','field_mill','lat','lon','value','flag','coordinate_source')
EVENT_FIELDS=('id','event_datetime','event_date','event_time','lat_decimal','lon_decimal','signal_strength','sensor_ids')

def row_time(r,key):
 return c.dt(r['reading_datetime'] if key=='winds' else r['reading_date']+'T'+r['reading_time'] if key=='efm' else r['event_datetime'])

def merge_rows(previous,rows,key,start,end):
 merged={}
 for r in [*previous,*rows]:
  try:
   t=row_time(r,key)
   if t<start or t>end:continue
   ident=(r.get('id') if r.get('id') is not None else (t.isoformat(),r.get('tower'),r.get('hgt'),r.get('field_mill'),r.get('lat_decimal'),r.get('lon_decimal')))
   merged[ident]=r
  except (ValueError,TypeError,KeyError):continue
 return sorted(merged.values(),key=lambda r:row_time(r,key))

def range_rows(url,start,end):
 try:
  return c.array(url,{'date>':start.strftime('%Y-%m-%dT%H:%M:%S'),'date<':end.strftime('%Y-%m-%dT%H:%M:%S'),'sort':'asc'})
 except c.requests.HTTPError as exc:
  body=exc.response.text.lower().replace(',','')
  if ('100000' in body or 'too many' in body) and end-start>timedelta(seconds=2):
   mid=start+(end-start)/2
   return range_rows(url,start,mid)+range_rows(url,mid,end)
  raise

def sensor_history(key,previous,now):
 start=now-timedelta(minutes=125 if key in ('cg','cc') else 65)
 since=start
 if previous.get('status')=='ok' and previous.get('window_end'):
  since=max(start,c.dt(previous['window_end'])-5*MIN)
 urls={'winds':'https://codiapi-winds1.rad.spaceforce.mil/winds/range',
       'efm':'https://codiapi-lplws1.rad.spaceforce.mil/lplws_1min/range',
       'cg':'https://codiapi-lightningc2g.rad.spaceforce.mil/lightning_c2g/range',
       'cc':'https://codiapi-lightningc2c.rad.spaceforce.mil/lightning_c2c/range'}
 rows=range_rows(urls[key],since,now)
 if key=='winds':
  rows=[r for r in rows if r.get('tower') and r.get('hgt') is not None and r.get('lat') is not None and r.get('lon') is not None]
  fields=WIND_FIELDS
 elif key=='efm':
  configured=json.loads((ROOT/'scripts/efm_sites.json').read_text())
  rows=[r for r in rows if r.get('field_mill') in c.FM_IDS and r.get('lat') is not None and r.get('lon') is not None]
  for r in rows:
   site='FM'+str(r['field_mill']).zfill(2)
   if not (28<=r['lat']<=29.3 and -81.5<=r['lon']<=-80) and site in configured:
    r['lat'],r['lon']=configured[site];r['coordinate_source']='Configured location; API location outside Cape coverage'
  fields=FM_FIELDS
 else:fields=EVENT_FIELDS
 rows=[{k:r[k] for k in fields if k in r} for r in rows]
 merged=merge_rows(previous.get('rows',[]),rows,key,start,now)
 # Never claim older coverage than a successful fetch or the retained prior window.
 covered=start if since==start else max(start,c.dt(previous['window_start']))
 return {'rows':merged,'status':'ok','window_start':covered.isoformat(),'window_end':now.isoformat(),'source':'Timestamped '+key.upper()+' API history'}

def radar_files(index,start,end):
 pattern=r'MRMS_MergedReflectivityQCComposite_00\.50_(\d{8}-\d{6})\.grib2\.gz'
 found={}
 for stamp in re.findall(pattern,index):
  t=datetime.strptime(stamp,'%Y%m%d-%H%M%S').replace(tzinfo=timezone.utc)
  if start<=t<=end:found[t]='MRMS_MergedReflectivityQCComposite_00.50_'+stamp+'.grib2.gz'
 return sorted(found.items())

def radar_history(previous,now):
 from mrms import render,BOUNDS,COLORS
 folder=OUT/'radar';folder.mkdir(parents=True,exist_ok=True)
 base='https://mrms.ncep.noaa.gov/2D/MergedReflectivityQCComposite/'
 start=now-65*MIN
 available=radar_files(c.get(base).text,start,now)
 if not available:raise ValueError('No recent MRMS archive frames listed')
 frames=[];missing=[]
 for t,name in available:
  path=folder/(t.strftime('%Y%m%dT%H%M%SZ')+'.png')
  if not path.exists():missing.append((t,name,path))
 def download(item):return item,c.get(base+item[1]).content
 failures=[]
 with ThreadPoolExecutor(max_workers=3) as pool:
  for job in as_completed([pool.submit(download,item) for item in missing]):
   try:
    (t,name,path),payload=job.result()
    # Decode in this thread, with an independent ecCodes handle per image.
    frame=render(gzip.decompress(payload),width=700,height=560)
    path.write_bytes(base64.b64decode(frame['image_data'].split(',',1)[1]))
   except Exception as exc:failures.append(str(exc))
 for t,name in available:
  path=folder/(t.strftime('%Y%m%dT%H%M%SZ')+'.png')
  if path.exists():frames.append({'observed_at':t.isoformat(),'image_url':'radar/'+path.name,'bounds':BOUNDS})
 for path in folder.glob('*.png'):
  try:
   if datetime.strptime(path.stem,'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)<start:path.unlink()
  except ValueError:pass
 return {'rows':frames,'status':'error' if failures else 'ok','error':'; '.join(failures[:2]),'source':'NOAA MRMS QC composite archive','legend':{'colors':COLORS}}

def profiler_history(previous,live,now):
 rows={}
 for r in [*previous.get('rows',[]),*live.get('rows',[])]:
  if c.dt(r['observed_at'])>=now-85*MIN:rows[(r['site'],r['observed_at'])]=r
 return {'rows':list(rows.values()),'source':live.get('source','Published profiler archive'),'status':live.get('status','error')}

def collect(previous,live,now=None):
 now=now or datetime.now(timezone.utc)
 result={'generated_at':now.isoformat(),'start':(now.replace(second=0,microsecond=0)-60*MIN).isoformat(),'end':now.replace(second=0,microsecond=0).isoformat(),'feeds':{}}
 with ThreadPoolExecutor(max_workers=5) as pool:
  jobs={key:pool.submit(sensor_history,key,previous.get('feeds',{}).get(key,{}),now) for key in ('winds','efm','cg','cc')}
  jobs['radar']=pool.submit(radar_history,previous.get('feeds',{}).get('radar',{}),now)
  for key,job in jobs.items():
   try:result['feeds'][key]=job.result()
   except Exception as exc:
    result['feeds'][key]={**previous.get('feeds',{}).get(key,{}),'status':'error','error':str(exc)}
   result['feeds'][key].setdefault('rows',[])
   print(f"Replay {key}: {result['feeds'][key]['status']}, {len(result['feeds'][key]['rows'])} records")
 result['feeds']['profilers']=profiler_history(previous.get('feeds',{}).get('profilers',{}),live.get('feeds',{}).get('profilers',{}),now)
 return result

if __name__=='__main__':
 OUT.mkdir(parents=True,exist_ok=True)
 path=OUT/'index.json'
 previous=json.loads(path.read_text()) if path.exists() else {}
 live=json.loads((ROOT/'dist/data/latest.json').read_text())
 data=collect(previous,live)
 temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data,separators=(',',':'),allow_nan=False));temp.replace(path)
