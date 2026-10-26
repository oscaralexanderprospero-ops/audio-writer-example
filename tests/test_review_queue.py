import sys,tempfile,unittest

from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'companion'))

from review_queue import Queue

class Tests(unittest.TestCase):

 def setUp(self):

  self.tmp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent);self.path=str(Path(self.tmp.name)/'q.db');self.q=Queue(self.path);self.p={'kind':'review-request','reviewers':['Zephyr','Claude'],'version':{'id':'v1','hash':'h1','text':'Hi '+chr(128512)+'.'},'notes':[]};self.d=self.q.enqueue('j','w','r',self.p,{'w'})

 def tearDown(self):self.q.db.close();self.tmp.cleanup()

 def prop(self,r):return {'reviewer':r,'versionId':'v1','versionHash':'h1','patches':[{'start':3,'end':5,'before':chr(128512),'text':'world'}]}

 def test_independent_durable_claims(self):

  c=self.q.claim('Claude');other=Queue(self.path)

  with self.assertRaises(ValueError):other.claim('Claude')

  z=other.claim('Zephyr');other.db.close()

  for x in (c,z):self.q.complete(x['reviewer'],'j',x['execution'],self.d,self.prop(x['reviewer']))

  self.assertEqual(self.q.results('j',{'w'})['status'],'ready-for-owner');self.assertIsNone(self.q.claim('Claude'))

 def test_idempotency_scope(self):

  self.assertEqual(self.d,self.q.enqueue('j','w','r',self.p,{'w'}))

  with self.assertRaises(ValueError):self.q.enqueue('j','w','changed',self.p,{'w'})

  with self.assertRaises(ValueError):self.q.results('j',{'other'})

 def test_wrong_claim_and_publication(self):

  c=self.q.claim('Claude');p=self.prop('Claude')

  with self.assertRaises(ValueError):self.q.complete('Claude','j','wrong',self.d,p)

  p['publish']=True

  with self.assertRaises(ValueError):self.q.complete('Claude','j',c['execution'],self.d,p)

  self.assertEqual(self.q.results('j',{'w'})['status'],'waiting')

 def test_repeat_result_not_replacement(self):

  c=self.q.claim('Claude');p=self.prop('Claude')

  for _ in range(2):self.q.complete('Claude','j',c['execution'],self.d,p)

  p['patches'][0]['text']='other'

  with self.assertRaises(ValueError):self.q.complete('Claude','j',c['execution'],self.d,p)

if __name__=='__main__':unittest.main()



