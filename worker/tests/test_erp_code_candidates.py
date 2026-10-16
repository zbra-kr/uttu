import json
import unittest

from worker.matchers.erp_code_candidates import build_code_candidates, read_co_master_for_codes


def product(code='CO1BK', pid='p1'):
    return {'id':pid,'musinsa_no':pid,'brand_id':'catalog-covernat','name':'same name is not evidence','style_no':code,'erp_style_code':None}


def inputs(p=None):
    p = p or product()
    return {'samples':[p],'peers':[p],'peer_scope_complete':True}


def master(style='CO1BK', color=None, count=1):
    row = {'BRANDCD':'CO','STYLECD':style,'STYLENM':'same name is not evidence','MASTER_KEY_ROWS':count}
    if color is not None:
        row['COLORCD'] = color
    return {'complete':True,'rows':[row]}


class CandidateTests(unittest.TestCase):
    def test_exact_direct_and_observed_composite_are_candidates_never_confirmed(self):
        for result in [build_code_candidates(inputs(),master()),build_code_candidates(inputs(),{'complete':True,'rows':[]},master('CO1','BK'))]:
            self.assertEqual(len(result['candidates']),1)
            self.assertFalse(result['candidates'][0]['confirmed'])
            self.assertFalse(result['candidates'][0]['insight_eligible'])
            self.assertEqual(result['confirmed_mappings'],[])
            self.assertEqual(result['insight_rows'],[])

    def test_duplicate_product_and_master_keys_are_conflicts(self):
        p = inputs()
        p['peers'].append(product(pid='p2'))
        self.assertEqual(build_code_candidates(p,master())['conflicts'][0]['reason'],'MULTIPLE_PRODUCTS_PER_CODE')
        self.assertEqual(build_code_candidates(inputs(),master(count=2))['conflicts'][0]['reason'],'ERP_MASTER_KEY_COLLISION')

    def test_no_name_similarity_suffix_strip_casefold_or_whitespace_repair(self):
        result = build_code_candidates(inputs(),master('CO1'))
        self.assertEqual(len(result['unmatched']),1)
        self.assertEqual(len(build_code_candidates(inputs(product(' CO1BK')),master())['unmatched']),1)
        self.assertEqual(len(build_code_candidates(inputs(product('co1bk')),master())['unmatched']),1)

    def test_ambiguous_composition_and_many_products_per_style_remain_conflicts(self):
        source = master('CO1','BK')
        source['rows'] += master('CO','1BK')['rows']
        self.assertEqual(len(build_code_candidates(inputs(),{'complete':True,'rows':[]},source)['conflicts']),1)
        a,b=product(),product('CO1WH','p2')
        p={'samples':[a,b],'peers':[a,b],'peer_scope_complete':True}
        source=master('CO1','BK');source['rows'] += master('CO1','WH')['rows']
        self.assertEqual(len(build_code_candidates(p,{'complete':True,'rows':[]},source)['conflicts']),2)

    def test_incomplete_source_or_existing_hint_conflict_never_candidate(self):
        p=inputs();p['peer_scope_complete']=False
        self.assertEqual(build_code_candidates(p,master())['candidates'],[])
        p=inputs();p['samples'][0]['erp_style_code']='OTHER'
        self.assertEqual(build_code_candidates(p,master())['conflicts'][0]['reason'],'EXISTING_ERP_HINT_CONFLICT')

    def test_invalid_read_scope_rejected_before_factory(self):
        for codes in [[],['X','X'],['X']*11]:
            with self.assertRaisesRegex(RuntimeError,'MASTER_CODE_SCOPE_INVALID'):
                read_co_master_for_codes(codes,lambda:self.fail('factory opened'))

    def test_fixed_composite_query_native_timeout_and_cleanup(self):
        class Cursor:
            def execute(self,sql,binds=None,timeout=None):
                self.sql=sql;self.assert_timeout=timeout;calls.append((sql,binds,timeout))
                self.description=[(k,) for k in (['key','value'] if sql.startswith('SHOW') else ['BRANDCD','STYLECD','STYLENM','COLORCD','MASTER_KEY_ROWS'])]
            def fetchall(self):return [('STATEMENT_TIMEOUT_IN_SECONDS','10')]
            def fetchone(self):return [json.dumps({'GlobalStats':{'bytesAssigned':1,'partitionsAssigned':1}})]
            def fetchmany(self,n):return [('CO','CO1','name','BK',1)]
            def close(self):pass
        class Connection:
            closed=False
            def cursor(self):return Cursor()
            def close(self):self.closed=True
            def is_closed(self):return self.closed
        calls=[];c=Connection();r=read_co_master_for_codes(['CO1BK'],lambda:c,True)
        self.assertTrue(r['complete']);self.assertTrue(c.closed)
        selects=[q for q in calls if q[0].startswith('SELECT')]
        self.assertEqual(len(selects),1);self.assertEqual(selects[0][1],('CO','CO1BK'))
        self.assertTrue(all(q[2]==10 for q in calls))
