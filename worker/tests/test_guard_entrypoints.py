"""Execute real enrolled CLI source with synthetic dependencies and private state."""
import ast
import builtins
import contextlib
import importlib.util
import io
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

REVIEW=Path(__file__).parents[2]
spec=importlib.util.spec_from_file_location('entry_guard',REVIEW/'worker/utils/maintenance_guard.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)


class EntrypointTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.calls=[];self.imports=[];self.funding_failure=False
        self.modules={'worker.utils.maintenance_guard':guard,
            'dotenv':types.SimpleNamespace(load_dotenv=lambda: self.assert_locked()),
            'loguru':types.SimpleNamespace(logger=types.SimpleNamespace(remove=lambda:None,add=lambda *a,**k:None,info=lambda *a,**k:None)),
            'pytz':types.SimpleNamespace(timezone=lambda *a:None),
            'supabase':types.SimpleNamespace(Client=object,create_client=lambda *a,**k: self.fail('Client invocation forbidden'))}
        self.addCleanup(self.release)

    def release(self):
        lease=guard._leases.pop(str(self.root.resolve()),None)
        if lease:
            lease.close()

    def assert_locked(self):
        self.assertIn(str(self.root.resolve()),guard._leases)

    def execute(self, filename, relative, args):
        real_import=builtins.__import__
        async def run_job(company_id,dry_run):
            self.calls.append(('funding',company_id,dry_run));return {'error':'offline failure'} if self.funding_failure else {'ok':True}
        async def poll_pending(limit):
            self.calls.append(('poll',limit));return {'ok':True,'processed':0,'failed':0}
        def imports(name,*a,**k):
            if name=='worker.funding.orchestrator':
                self.assert_locked();self.imports.append(name)
                return types.SimpleNamespace(run_job=run_job,poll_pending=poll_pending)
            if name in self.modules:
                if name!='worker.utils.maintenance_guard':
                    self.assert_locked()
                self.imports.append(name);return self.modules[name]
            if name in {'worker.dart.fetcher','worker.dart.fss_client'}:
                self.assert_locked();self.imports.append(name)
                return types.SimpleNamespace(fetch_company=lambda:None,fetch_corp_code_zip=lambda:None,
                    fetch_disclosures=lambda:None,fetch_audit_financials=lambda:None)
            if name=='worker.dart.parser':
                self.assert_locked();return types.SimpleNamespace(parse_corp_codes=lambda:None)
            return real_import(name,*a,**k)
        source=(REVIEW/filename).read_text()
        env={'__name__':'__main__','__file__':str(self.root/relative)}
        with patch('builtins.__import__',imports),patch.object(sys,'argv',[str(relative),*args]):
            if filename == 'worker/scrapers/dart_scraper.py' and '--help' not in args:
                tree=ast.parse(source); final=tree.body.pop()
                exec(compile(ast.fix_missing_locations(tree),str(REVIEW/filename),'exec'),env)
                async def fake_main(**kwargs):
                    self.assert_locked();self.calls.append(('dart',kwargs))
                env['main']=fake_main
                exec(compile(ast.fix_missing_locations(ast.Module(body=[final],type_ignores=[])),str(REVIEW/filename),'exec'),env)
            else:
                exec(compile(source,str(REVIEW/filename),'exec'),env)

    def test_poll_limit_and_success_exit_unchanged(self):
        with self.assertRaises(SystemExit) as result:
            self.execute('worker/tests/fixtures/accepted_funding_main_with_guard.py','worker/main.py',['--mode','funding-poll','--limit','3'])
        self.assertEqual(result.exception.code,0);self.assertEqual(self.calls,[('poll',3)])

    def test_manual_funding_company_and_dry_run_unchanged(self):
        with self.assertRaises(SystemExit) as result:
            self.execute('worker/tests/fixtures/accepted_funding_main_with_guard.py','worker/main.py',['--mode','funding','--company-id','offline-id','--dry-run'])
        self.assertEqual(result.exception.code,0);self.assertEqual(self.calls,[('funding','offline-id',True)])

    def test_invalid_funding_args_still_exit_two(self):
        with self.assertRaises(SystemExit) as result:
            self.execute('worker/tests/fixtures/accepted_funding_main_with_guard.py','worker/main.py',['--mode','funding'])
        self.assertEqual(result.exception.code,2);self.assertEqual(self.calls,[])

    def test_funding_maintenance_before_any_app_import_or_job_claim(self):
        owner=guard.Maintenance(self.root,lambda:True,lambda:[]).begin()
        try:
            with self.assertRaises(SystemExit) as result:
                self.execute('worker/main.py','worker/main.py',['--mode','funding-poll','--limit','3'])
            self.assertEqual(result.exception.code,0);self.assertEqual(self.imports,['worker.utils.maintenance_guard']);self.assertEqual(self.calls,[])
        finally:
            owner.verified_finish(lambda:True)

    def test_dart_maintenance_before_shared_sdk_import(self):
        owner=guard.Maintenance(self.root,lambda:True,lambda:[]).begin()
        try:
            with self.assertRaises(SystemExit) as result:
                self.execute('worker/scrapers/dart_scraper.py','worker/scrapers/dart_scraper.py',['--target','all'])
            self.assertEqual(result.exception.code,75);self.assertEqual(self.imports,['worker.utils.maintenance_guard'])
        finally:
            owner.verified_finish(lambda:True)

    def test_dart_help_still_parses_without_clients_and_sdk_import_is_guarded(self):
        with self.assertRaises(SystemExit) as result:
            self.execute('worker/scrapers/dart_scraper.py','worker/scrapers/dart_scraper.py',['--help'])
        self.assertEqual(result.exception.code,0);self.assertIn('worker.dart.fss_client',self.imports)

    def test_normal_dart_arguments_are_forwarded_unchanged(self):
        self.execute('worker/scrapers/dart_scraper.py','worker/scrapers/dart_scraper.py',['--target','all','--disc-years','10','--fin-years','3','--ids','one,two'])
        self.assertEqual(self.calls,[('dart',{'target':'all','disc_years':10,'fin_years':3,'ids':['one','two']})])

    def test_actual_funding_poll_keeps_outcome_dict_return_contract(self):
        with self.assertRaises(SystemExit) as result:
            self.execute('worker/main.py','worker/main.py',['--mode','funding-poll','--limit','3'])
        self.assertEqual(result.exception.code,0);self.assertEqual(self.calls,[('poll',3)])

    def test_funding_failure_exit_remains_one(self):
        self.funding_failure=True
        with self.assertRaises(SystemExit) as result:
            self.execute('worker/tests/fixtures/accepted_funding_main_with_guard.py','worker/main.py',['--mode','funding','--company-id','offline-id'])
        self.assertEqual(result.exception.code,1)

    def test_guard_is_before_all_funding_or_sdk_application_imports(self):
        for filename in ['worker/main.py','worker/tests/fixtures/accepted_funding_main_with_guard.py','worker/scrapers/dart_scraper.py']:
            tree=ast.parse((REVIEW/filename).read_text());guard_line=next(n.lineno for n in tree.body if isinstance(n,ast.If))
            app_imports=[n.lineno for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom)) and not (isinstance(n,ast.ImportFrom) and n.module=='__future__')]
            self.assertTrue(all(guard_line < line for line in app_imports))



    def test_missing_backend_prevents_app_imports_claims_and_state_not_deferral(self):
        for filename, relative, args in [
            ("worker/main.py", "worker/main.py", ["--mode", "funding-poll", "--limit", "3"]),
            (
                "worker/main.py",
                "worker/main.py",
                ["--mode", "funding", "--company-id", "offline-id"],
            ),
            (
                "worker/scrapers/dart_scraper.py",
                "worker/scrapers/dart_scraper.py",
                ["--target", "all"],
            ),
        ]:
            with self.subTest(filename=filename, args=args):
                self.imports.clear()
                output, errors = io.StringIO(), io.StringIO()
                with (
                    patch.object(guard, "fcntl", None),
                    contextlib.redirect_stdout(output),
                    contextlib.redirect_stderr(errors),
                ):
                    with self.assertRaises(SystemExit) as result:
                        self.execute(filename, relative, args)
                self.assertEqual(result.exception.code, 78)
                self.assertEqual(self.imports, ["worker.utils.maintenance_guard"])
                self.assertEqual(self.calls, [])
                self.assertEqual(output.getvalue(), "")
                self.assertIn("cannot start", errors.getvalue())
                self.assertNotIn("deferred", errors.getvalue())
                self.assertFalse((self.root / ".maintenance").exists())


if __name__=='__main__':
    unittest.main(verbosity=2)
