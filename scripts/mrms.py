"""Render NOAA MRMS QC composite on a Web Mercator grid for Leaflet."""
import base64,gzip,io
from datetime import datetime,timezone
import numpy as np
from PIL import Image
import eccodes as ec

URL='https://mrms.ncep.noaa.gov/2D/MergedReflectivityQCComposite/MRMS_MergedReflectivityQCComposite.latest.grib2.gz'
BOUNDS=[[26.0,-84.0],[31.0,-77.0]]
BREAKS=np.array([5,10,15,20,25,30,35,40,45,50,55,60,65,70,75])
COLORS=['#559def','#2d74e9','#2aa4cc','#00a600','#00d000','#80e000','#e8e800','#ffbe00','#ff7f00','#f62700','#d90000','#b000a0','#e000d0','#eab8ff','#ffffff']

def sample_indices(ni,nj,lat0,lon0,di,dj,width=1000,height=800):
 south,west=BOUNDS[0];north,east=BOUNDS[1]
 # Sample the image on a Mercator y grid, not a latitude-linear y grid.
 merc=lambda lat:np.log(np.tan(np.pi/4+np.radians(lat)/2))
 y=merc(north)+(np.arange(height)+.5)/height*(merc(south)-merc(north))
 lats=np.degrees(2*np.arctan(np.exp(y))-np.pi/2)
 lons=west+(np.arange(width)+.5)/width*(east-west)
 ii=np.rint(((lons%360)-lon0)/di).astype(np.int64)
 jj=np.rint((lat0-lats)/dj).astype(np.int64)
 if ii.min()<0 or ii.max()>=ni or jj.min()<0 or jj.max()>=nj:raise ValueError('MRMS bounds outside source grid')
 return (jj[:,None]*ni+ii[None,:]).ravel()

def rgba(values):
 index=np.searchsorted(BREAKS,values,side='right')-1
 colors=np.array([[int(c[i:i+2],16) for i in (1,3,5)]+[255] for c in COLORS],dtype=np.uint8)
 image=colors[np.clip(index,0,len(COLORS)-1)]
 image[(values<5)|(values>100)|~np.isfinite(values)]=0
 return image

def render(grib_bytes,width=1000,height=800):
 gid=ec.codes_new_from_message(grib_bytes)
 try:
  if ec.codes_get(gid,'iScansNegatively') or ec.codes_get(gid,'jScansPositively') or ec.codes_get(gid,'jPointsAreConsecutive'):
   raise ValueError('Unexpected MRMS scan layout')
  indices=sample_indices(ec.codes_get(gid,'Ni'),ec.codes_get(gid,'Nj'),ec.codes_get(gid,'latitudeOfFirstGridPointInDegrees'),ec.codes_get(gid,'longitudeOfFirstGridPointInDegrees'),ec.codes_get(gid,'iDirectionIncrementInDegrees'),ec.codes_get(gid,'jDirectionIncrementInDegrees'),width,height)
  unique,inverse=np.unique(indices,return_inverse=True)
  vals=np.array(ec.codes_get_elements(gid,'values',unique.tolist()))[inverse].reshape(height,width)
  image=Image.fromarray(rgba(vals))
  buf=io.BytesIO();image.save(buf,format='PNG',optimize=True)
  observed=datetime(*[int(ec.codes_get(gid,k)) for k in ['year','month','day','hour','minute','second']],tzinfo=timezone.utc)
  return {'rows':[],'observed_at':observed.isoformat(),'source':'NOAA MRMS QC composite reflectivity',
          'product':'MergedReflectivityQCComposite','bounds':BOUNDS,'units':'dBZ',
          'image_data':'data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode(),
          'legend':{'breaks':BREAKS.tolist(),'colors':COLORS},'coverage':'26–31°N, 84–77°W',
          'min_display_dbz':5}
 finally:ec.codes_release(gid)

def fetch(now,get):
 return render(gzip.decompress(get(URL).content))
