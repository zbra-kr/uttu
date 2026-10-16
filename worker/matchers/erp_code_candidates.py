"""Bounded read-only code-match candidates, never confirmed crosswalks or writes."""
from urllib.parse import urlparse

from .erp_existing_connection import existing_uttu_product_reader


def direct_code(value):
    return value if type(value) is str and value and value == value.strip() and len(value) <= 160 and all(ord(c) >= 32 for c in value) else None


def read_co_code_sample(factory=existing_uttu_product_reader):
    client = factory()
    url = urlparse(str(client.supabase_url))
    if url.scheme != 'https' or url.hostname != 'ogtrvberttzupxrffpoh.supabase.co' or url.username or url.password or url.port:
        raise RuntimeError('UTTU_DESTINATION_UNVERIFIED')
    fields = 'id,musinsa_no,brand_id,name,style_no,erp_style_code,brands!inner(slug)'
    response = client.table('products').select(fields, count='exact').eq('is_own', True).eq('brands.slug', 'covernat').not_.is_('style_no', 'null').neq('style_no', '').order('id').limit(10).execute()
    if type(response.data) is not list or len(response.data) > 10:
        raise RuntimeError('PRODUCT_SAMPLE_INVALID')
    samples = response.data
    codes = sorted({code for p in samples if (code := direct_code(p.get('style_no')))})
    peers, total = [], 0
    if codes:
        peers_response = client.table('products').select(fields, count='exact').eq('is_own', True).eq('brands.slug', 'covernat').in_('style_no', codes).order('id').limit(21).execute()
        peers, total = peers_response.data, peers_response.count
        if type(peers) is not list or len(peers) > 21:
            raise RuntimeError('PRODUCT_PEERS_INVALID')
    def project(p):
        if type(p) is not dict or not isinstance(p.get('brands'), dict) or p['brands'].get('slug') != 'covernat':
            raise RuntimeError('PRODUCT_BRAND_INVALID')
        if any(type(p.get(k)) is not str or not p[k].strip() for k in ('id','musinsa_no','brand_id')):
            raise RuntimeError('PRODUCT_KEYS_INVALID')
        return {k:p.get(k) for k in ('id','musinsa_no','brand_id','name','style_no','erp_style_code')}
    return {'catalog_brand':'covernat','erp_brand_scope':'CO','samples':[project(p) for p in samples],
            'peers':[project(p) for p in peers], 'sample_nonempty_style_no_total':response.count,
            'peer_scope_complete':type(total) is int and total == len(peers) and total <= 20,
            'codes':codes, 'queries':2 if codes else 1}


def build_code_candidates(products, master, color_master=None):
    """Names are context only. Composite equality is evidence, not permission to confirm."""
    candidates, conflicts, unmatched = [], [], []
    complete = products.get('peer_scope_complete') is True and master.get('complete') is True
    for p in products['samples']:
        code = direct_code(p.get('style_no'))
        base = {'product':p,'code_field':'style_no','code':code,'confirmed':False,'insight_eligible':False}
        if not code:
            unmatched.append({**base,'reason':'NO_EXACT_SOURCE_CODE'})
            continue
        if not complete:
            conflicts.append({**base,'reason':'READ_INCOMPLETE'})
            continue
        peers = [q for q in products['peers'] if q.get('style_no') == code]
        matches = [r for r in master.get('rows',[]) if r.get('BRANDCD') == 'CO' and r.get('STYLECD') == code]
        method = 'style_no == STYLECD'
        if color_master is not None:
            if color_master.get('complete') is not True:
                conflicts.append({**base,'reason':'READ_INCOMPLETE'})
                continue
            matches += [r for r in color_master.get('rows',[]) if r.get('BRANDCD') == 'CO' and type(r.get('STYLECD')) is str and type(r.get('COLORCD')) is str and r['STYLECD']+r['COLORCD'] == code]
            method = 'all supplied direct/composite resolutions'
        if len(peers) != 1 or peers[0].get('id') != p.get('id'):
            conflicts.append({**base,'reason':'MULTIPLE_PRODUCTS_PER_CODE','peer_count':len(peers)})
        elif not matches:
            unmatched.append({**base,'reason':'NO_ERP_EXACT_CODE'})
        elif len({(r.get('BRANDCD'),r.get('STYLECD'),r.get('COLORCD')) for r in matches}) > 1:
            conflicts.append({**base,'reason':'CODE_RESOLUTION_AMBIGUOUS','erp_rows':matches})
        elif len(matches) != 1 or matches[0].get('MASTER_KEY_ROWS') != 1:
            conflicts.append({**base,'reason':'ERP_MASTER_KEY_COLLISION','erp_rows':matches})
        elif p.get('erp_style_code') not in (None,'',matches[0]['STYLECD']):
            conflicts.append({**base,'reason':'EXISTING_ERP_HINT_CONFLICT'})
        else:
            candidates.append({**base,'reason':'EXACT_CODE_REVIEW_CANDIDATE','code_equality':method,'erp':matches[0],
                               'requires':['independent brand/style/product and composite-code review','global one-style/one-product cardinality verification','color-vs-style sales/market grain review; existing confirmed DTO has no color','existing CrosswalkEvidence ref/version approval','product-key write approval if accepted']})
    unique = []
    for c in candidates:
        if sum(x['erp']['STYLECD'] == c['erp']['STYLECD'] for x in candidates) > 1:
            conflicts.append({**c,'reason':'MULTIPLE_PRODUCTS_PER_ERP_STYLE'})
        else:
            unique.append(c)
    return {'candidates':unique,'conflicts':conflicts,'unmatched':unmatched,'confirmed_mappings':[],
            'insight_rows':[], 'writes':0,'method':'exact observed code fields, CO only; names unused; no suffix stripping'}


def read_co_master_for_codes(codes, factory=None, match_color=False):
    from .central_sales_readonly import LocalReadBlocked, _execute_fixed_read
    from .erp_existing_connection import ExistingReadFailure, existing_mda_connection
    from .erp_session_bounded_read import SET_OWNED_TIMEOUT, _timeout

    if type(codes) not in (list, tuple) or not 1 <= len(codes) <= 10 or any(direct_code(c) is None for c in codes) or len(set(codes)) != len(codes):
        raise RuntimeError('MASTER_CODE_SCOPE_INVALID')
    captured = tuple(codes)
    sql = ("SELECT BRANDCD,STYLECD,STYLENM,COUNT(*) OVER(PARTITION BY BRANDCD,STYLECD) AS MASTER_KEY_ROWS\n"
           "FROM BCAVE.SEWON.SW_STYLEINFO\nWHERE BRANDCD = %s AND STYLECD IN ("+','.join(['%s']*len(captured))+")\nORDER BY STYLECD,STYLENM\nLIMIT 41")
    columns = ['BRANDCD','STYLECD','STYLENM','MASTER_KEY_ROWS']
    if match_color:
        sql = ("SELECT DISTINCT m.BRANDCD,m.STYLECD,m.STYLENM,d.COLORCD,m.MASTER_KEY_ROWS\n"
               "FROM (SELECT BRANDCD,STYLECD,STYLENM,COUNT(*) OVER(PARTITION BY BRANDCD,STYLECD) AS MASTER_KEY_ROWS FROM BCAVE.SEWON.SW_STYLEINFO WHERE BRANDCD = %s) m\n"
               "JOIN BCAVE.SEWON.SW_STYLEINFO_DETAIL d ON d.BRANDCD=m.BRANDCD AND d.STYLECD=m.STYLECD\n"
               "WHERE m.STYLECD || d.COLORCD IN ("+','.join(['%s']*len(captured))+")\nORDER BY m.STYLECD,d.COLORCD,m.STYLENM\nLIMIT 41")
        columns = ['BRANDCD','STYLECD','STYLENM','COLORCD','MASTER_KEY_ROWS']
    meta = {'codes_requested':len(captured), 'timeout_before':None, 'timeout_confirmed':None,
            'aggregate_selects':0, 'closed':False, 'read_failure_code':None}
    connection = None
    try:
        connection = (factory or existing_mda_connection)()
        cursor = connection.cursor()
        try:
            meta['timeout_before'] = _timeout(cursor)
            if not 1 <= meta['timeout_before'] <= 10:
                cursor.execute(SET_OWNED_TIMEOUT, timeout=10)
            meta['timeout_confirmed'] = _timeout(cursor)
            if not 1 <= meta['timeout_confirmed'] <= 10:
                raise RuntimeError('MASTER_TIMEOUT_UNCONFIRMED')
        finally:
            cursor.close()

        class Cursor:
            def __init__(self, raw):
                self.raw = raw

            def __getattr__(self, name):
                return getattr(self.raw, name)

            def execute(self, statement, binds=None):
                if statement == sql:
                    if meta['aggregate_selects']:
                        raise RuntimeError('MASTER_READ_LIMIT')
                    meta['aggregate_selects'] += 1
                return self.raw.execute(statement, binds, timeout=10)

        class Connection:
            def cursor(self):
                return Cursor(connection.cursor())

        receipt = _execute_fixed_read(Connection(), ('CO',)+captured, sql,
                                      columns, 41)
        if any(row['BRANDCD'] != 'CO' or (row['STYLECD']+row.get('COLORCD','') if match_color else row['STYLECD']) not in captured or type(row['MASTER_KEY_ROWS']) is not int or row['MASTER_KEY_ROWS'] < 1 for row in receipt['rows']):
            raise RuntimeError('MASTER_PROJECTION_INVALID')
        receipt['source'] = 'SW_STYLEINFO + SW_STYLEINFO_DETAIL exact CO/style+color predicates' if match_color else 'SW_STYLEINFO exact CO/code predicates'
        receipt['metadata'] = meta
        return receipt
    except Exception as error:
        meta['read_failure_code'] = str(error) if isinstance(error, LocalReadBlocked) else 'MASTER_READ_FAILED'
        meta['exception_class'] = type(error).__name__
        raise ExistingReadFailure(meta['read_failure_code'], meta) from None
    finally:
        if connection is not None:
            try:
                connection.close()
                check = getattr(connection, 'is_closed', None)
                if callable(check) and check() is not True:
                    raise RuntimeError('MASTER_CLOSE_UNCONFIRMED')
                meta['closed'] = True
            except Exception as error:
                meta['close_exception_class'] = type(error).__name__
                raise ExistingReadFailure('MASTER_CLOSE_FAILED', meta) from None
