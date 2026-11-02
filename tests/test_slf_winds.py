import sys, unittest
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from collect_slf_winds import build

class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026,11,2,19,tzinfo=timezone.utc)
        self.t = int(self.now.timestamp()*1000)
        self.row = dict(tower='0511', hgt=30, reading_datetime='2026-11-02T18:59:00', avg_spd_1min=8, avg_dir_1min=120, peak_spd_1min=12, peak_dir_1min=130)
    def test_exact_sensor_and_missing_values(self):
        rows=[self.row, {**self.row,'tower':'0512','hgt':6}, {**self.row,'tower':'0513','avg_spd_1min':999,'peak_spd_1min':999}]
        d=build({}, {'feeds':{'winds':{'rows':rows,'status':'ok'}}}, {}, self.now)
        self.assertEqual([len(d['towers'][k]) for k in d['towers']], [1,0,0])
        self.assertEqual(d['towers']['0511'][0]['pkdir'],130)
    def test_retention_dedup_and_failed_feed(self):
        p={'towers':{'0511':[{'t':self.t-25*3600000,'hgt':30}, {'t':self.t-3600000,'hgt':30,'spd':0}]}}
        d=build(p, {'feeds':{'winds':{'rows':[self.row,self.row],'status':'error','error':'offline'}}}, {}, self.now)
        self.assertEqual(len(d['towers']['0511']),2)
        self.assertEqual(d['source_status'],'error')
        self.assertEqual(d['towers']['0511'][0]['spd'],0)
    def test_replay_does_not_erase_peak_direction(self):
        live={'feeds':{'winds':{'rows':[self.row],'status':'ok'}}}
        p=build({},live,{},self.now)
        r={k:v for k,v in self.row.items() if k!='peak_dir_1min'}
        d=build(p,{}, {'feeds':{'winds':{'rows':[r]}}},self.now)
        self.assertEqual(d['towers']['0511'][0]['pkdir'],130)
    def test_future_and_invalid_rows(self):
        rows=[{**self.row,'reading_datetime':'bad'}, {**self.row,'reading_datetime':'2026-11-02T20:00:00'}]
        self.assertEqual(build({}, {'feeds':{'winds':{'rows':rows}}}, {}, self.now)['towers']['0511'],[])
