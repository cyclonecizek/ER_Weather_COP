import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from mrms import sample_indices,rgba
class RadarTests(unittest.TestCase):
 def test_missing_echo_and_threshold_colors(self):
  pixels=rgba(np.array([[-999,-99,0,4.9,5,20,50,75,9999]],dtype=float))
  self.assertEqual(pixels[0,:4,3].tolist(),[0,0,0,0])
  self.assertEqual(pixels[0,4:8,3].tolist(),[255]*4)
  self.assertEqual(pixels[0,5,:3].tolist(),[0,166,0])
  self.assertEqual(pixels[0,8,3],0)
 def test_sample_grid_orientation_and_region(self):
  idx=sample_indices(7000,3500,54.995,230.005,.01,.01,width=10,height=10).reshape(10,10)
  self.assertTrue(np.all(np.diff(idx,axis=1)>0))
  self.assertTrue(np.all(np.diff(idx,axis=0)>0))
  row,col=divmod(int(idx[0,0]),7000)
  self.assertTrue(30<54.995-row*.01<31)
  self.assertTrue(-84<230.005+col*.01-360<-83)
if __name__=='__main__':unittest.main()
