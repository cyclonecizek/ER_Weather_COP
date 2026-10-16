import sys,unittest
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import collect_data as c
class CollectorTests(unittest.TestCase):
 def test_partial_failure_preserves_data_and_timestamp(self):
  now=datetime(2026,10,16,10,tzinfo=timezone.utc)
  previous={'feeds':{'winds':{'rows':[{'tower':'0001'}],'fetched_at':'2026-10-16T09:00:00Z'}}}
  def failed(now):raise ValueError('network failed')
  result=c.collect(previous,{'winds':failed,'efm':lambda now:{'rows':[]}},now)
  self.assertEqual(result['feeds']['winds']['status'],'error')
  self.assertEqual(result['feeds']['winds']['rows'],previous['feeds']['winds']['rows'])
  self.assertEqual(result['feeds']['winds']['fetched_at'],'2026-10-16T09:00:00Z')
  self.assertEqual(result['feeds']['efm']['status'],'ok')
 def test_utc_parser(self):
  self.assertEqual(c.dt('2026-10-16T10:00:00').tzinfo,timezone.utc)
if __name__=='__main__':unittest.main()
