"""Offline completeness regression, including installed SDK + MockTransport."""
import importlib.util
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from worker.detectors.effect_rank_observation import IncompleteRankReadError
from worker.tests import test_effect_rank_observation as f


class Pagination(unittest.TestCase):
    def assert_rejected(self, response, rows=None):
        class Query(f.Query):
            def execute(self):
                return response(self) if callable(response) else response
        class Client(f.Client):
            def table(self, name):
                return Query(self.rows)
        for module in f.MODULES:
            with self.subTest(detector=module.__name__), patch.object(f, 'Client', Client):
                with self.assertRaises(IncompleteRankReadError):
                    f.EffectRanks().detect(module, rows or [f.row(-1,80),f.row(1,20)])

    def test_null_second_page(self):
        rows=[dict(f.row(-1,80),id=f'{i:04}') for i in range(999)]
        rows += [dict(f.row(1,20),id='0999'),dict(f.row(-1,25),id='1000')]
        calls=[]
        def response(query):
            calls.append(len(query.rows))
            return SimpleNamespace(data=query.rows if len(query.rows)==1000 else None,
                                   count=query.count)
        self.assert_rejected(response,rows)
        self.assertEqual(calls,[1000,1]*3)

    def test_short_page_with_remaining_total(self):
        self.assert_rejected(SimpleNamespace(data=[f.row(-1,80),f.row(1,20)],count=1001))

    def test_empty_without_completion_evidence(self):
        for response in (SimpleNamespace(data=None,count=0),SimpleNamespace(data=[]),
                         SimpleNamespace(data=[],count=1)):
            self.assert_rejected(response)

    def test_invalid_count_or_body(self):
        for count in (None,-1,True,'2',2.0):
            self.assert_rejected(SimpleNamespace(data=[f.row(-1,80),f.row(1,20)],count=count))
        for data in ({'error':'synthetic'},'bad body',[None]):
            self.assert_rejected(SimpleNamespace(data=data,count=1))

    def test_count_changes_abort(self):
        rows=[dict(f.row(-1,80),id=f'{i:04}') for i in range(1000)]
        rows += [dict(f.row(1,20),id='1000')]
        self.assert_rejected(lambda q: SimpleNamespace(data=q.rows,
                                 count=1001 if len(q.rows)==1000 else 1002), rows)

    def test_query_exception_propagates_unchanged(self):
        failure=RuntimeError('synthetic page failure')
        class Query(f.Query):
            def execute(self):
                raise failure
        class Client(f.Client):
            def table(self,name):
                return Query(self.rows)
        for module in f.MODULES:
            with self.subTest(detector=module.__name__),patch.object(f,'Client',Client):
                with self.assertRaises(RuntimeError) as caught:
                    f.EffectRanks().detect(module,[f.row(-1,80),f.row(1,20)])
                self.assertIs(caught.exception,failure)

    def test_totals_reset_for_each_product_chunk(self):
        products=['1']+[str(i) for i in range(2,502)]
        for module in f.MODULES:
            with self.subTest(detector=module.__name__):
                result=module._load_ranking_window(f.Client([f.row(-1,80),f.row(1,20)]),
                                                  products,f.DAY-f.timedelta(days=3),
                                                  f.DAY+f.timedelta(days=5))
                self.assertEqual(len(result['1']),2)

    def test_later_product_chunk_failure_aborts_entire_read(self):
        class Query(f.Query):
            def execute(self):
                return SimpleNamespace(data=self.rows if self.count else None,count=self.count)
        class Client(f.Client):
            def table(self,name):
                return Query(self.rows)
        for module in f.MODULES:
            with self.subTest(detector=module.__name__):
                with self.assertRaises(IncompleteRankReadError):
                    module._load_ranking_window(Client([f.row(-1,80),f.row(1,20)]),
                          ['1']+[str(i) for i in range(2,502)],f.DAY-f.timedelta(days=3),
                          f.DAY+f.timedelta(days=5))

    def test_normal_final_and_empty_pages(self):
        for size,expected_calls in ((0,[0]),(2,[0]),(1000,[0]),(1001,[0,1000]),(2000,[0,1000])):
            for module in f.MODULES:
                with self.subTest(size=size,detector=module.__name__):
                    calls=[]
                    class Query(f.Query):
                        def range(self,lo,hi):
                            calls.append(lo)
                            return super().range(lo,hi)
                    class Client(f.Client):
                        def table(self,name):
                            return Query(self.rows)
                    rows=[dict(f.row(-1,80),id=f'{i:04}') for i in range(size)]
                    if size>=2:
                        rows[-1]=dict(f.row(1,20),id=f'{size-1:04}')
                    with patch.object(f,'Client',Client):
                        result=f.EffectRanks().detect(module,rows)
                    self.assertEqual(calls,expected_calls)
                    self.assertEqual([a.severity for a in result],['high'] if size else [])


@unittest.skipUnless(importlib.util.find_spec('postgrest'), 'existing SDK required')
class SDKPagination(unittest.TestCase):
    def run_sdk(self,handler,expected=None,error=None):
        import httpx
        from postgrest import SyncPostgrestClient
        # All traffic is intercepted by MockTransport; accidental sockets fail.
        for module in f.MODULES:
            with self.subTest(detector=module.__name__),patch('socket.socket.connect',
                            side_effect=AssertionError('live network forbidden')):
                def guarded(request):
                    self.assertEqual(request.url.host,'offline-effect.invalid')
                    self.assertIn('count=exact',request.headers['prefer'])
                    self.assertEqual(request.url.params['age_filter'],'eq.AGE_BAND_ALL')
                    return handler(request)
                with httpx.Client(transport=httpx.MockTransport(guarded)) as http:
                    with SyncPostgrestClient('https://offline-effect.invalid',http_client=http) as sdk:
                        with patch.object(f,'Client',lambda rows:SimpleNamespace(table=sdk.from_)):
                            if error:
                                with self.assertRaises(error):
                                    f.EffectRanks().detect(module,[])
                            else:
                                result=f.EffectRanks().detect(module,[])
                                self.assertEqual([a.severity for a in result],expected)

    def test_sdk_truncated_206_content_range(self):
        import httpx
        self.run_sdk(lambda req:httpx.Response(206,json=[f.row(-1,80),f.row(1,20)],
                      headers={'Content-Range':'0-1/1001'}),error=IncompleteRankReadError)

    def test_sdk_normal_short_final(self):
        import httpx
        self.run_sdk(lambda req:httpx.Response(200,json=[f.row(-1,80),f.row(1,20)],
                      headers={'Content-Range':'0-1/2'}),expected=['high'])

    def test_sdk_final_page_after_206(self):
        import httpx
        calls=[]
        def handler(req):
            offset=int(req.url.params['offset']); calls.append(offset)
            self.assertEqual(req.url.params['limit'],'1000')
            if offset==0:
                rows=[dict(f.row(-1,80),id=f'{i:04}') for i in range(999)]
                rows += [dict(f.row(1,20),id='0999')]
                return httpx.Response(206,json=rows,headers={'Content-Range':'0-999/1001'})
            self.assertEqual(offset,1000)
            return httpx.Response(206,json=[dict(f.row(-1,80),id='1000')],
                                  headers={'Content-Range':'1000-1000/1001'})
        self.run_sdk(handler,expected=['high'])
        self.assertEqual(calls,[0,1000]*3)

    def test_sdk_complete_empty(self):
        import httpx
        self.run_sdk(lambda req:httpx.Response(200,json=[],headers={'Content-Range':'*/0'}),expected=[])

    def test_sdk_missing_total_and_null(self):
        import httpx
        for data,headers in (([f.row(-1,80),f.row(1,20)],{}),(None,{'Content-Range':'*/0'})):
            self.run_sdk(lambda req:httpx.Response(200,content=b"null",headers=headers) if data is None
                         else httpx.Response(200,json=data,headers=headers),
                         error=IncompleteRankReadError)

    def test_sdk_error_propagates(self):
        import httpx
        from postgrest.exceptions import APIError
        self.run_sdk(lambda req:httpx.Response(500,json={'message':'synthetic failure','code':'XX',
                            'details':None,'hint':None}),error=APIError)


if __name__=='__main__':
    unittest.main()
