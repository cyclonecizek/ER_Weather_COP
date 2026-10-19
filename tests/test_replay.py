import sys,unittest
from pathlib import Path
from datetime import datetime,timedelta,timezone
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import collect_replay as r
class ReplayTests(unittest.TestCase):
 def setUp(self):self.now=datetime(2026,10,19,20,tzinfo=timezone.utc)
 def test_merge_deduplicates_corrected_records_and_excludes_future(self):
  a={'id':1,'tower':'0001','hgt':54,'reading_datetime':'2026-10-19T19:59:00','tmp':80}
  result=r.merge_rows([a],[{**a,'tmp':81},{**a,'id':2,'reading_datetime':'2026-10-19T20:01:00'}],'winds',self.now-timedelta(hours=1),self.now)
  self.assertEqual(len(result),1);self.assertEqual(result[0]['tmp'],81)
 def test_incremental_fetch_preserves_history_and_covers_overlap(self):
  old={'id':1,'tower':'0001','hgt':54,'lat':28,'lon':-80,'reading_datetime':'2026-10-19T19:10:00'}
  previous={'status':'ok','window_start':'2026-10-19T18:54:00Z','window_end':'2026-10-19T19:59:00Z','rows':[old]}
  with patch.object(r,'range_rows',return_value=[]) as query:
   result=r.sensor_history('winds',previous,self.now)
  self.assertEqual(query.call_args.args[1],self.now-timedelta(minutes=6));self.assertEqual(result['rows'],[old]);self.assertEqual(result['status'],'ok')
 def test_radar_index_filters_deduplicates_and_keeps_only_window(self):
  name='MRMS_MergedReflectivityQCComposite_00.50_20261019-195939.grib2.gz'
  result=r.radar_files(name+' '+name+' MRMS_MergedReflectivityQCComposite_00.50_20261019-200139.grib2.gz',self.now-timedelta(hours=1),self.now)
  self.assertEqual(len(result),1);self.assertEqual(result[0][1],name)
 def test_efm_fallback_matches_live_coordinates(self):
  row={'id':2,'field_mill':13,'lat':0,'lon':0,'reading_date':'2026-10-19','reading_time':'19:59:00','value':100}
  with patch.object(r,'range_rows',return_value=[row]):result=r.sensor_history('efm',{},self.now)
  self.assertGreater(result['rows'][0]['lat'],28);self.assertIn('coordinate_source',result['rows'][0])
