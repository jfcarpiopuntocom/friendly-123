import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from contextlib import redirect_stdout

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'validate-cdx-offline.py'
spec = importlib.util.spec_from_file_location('checker', MODULE)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
SCHEMA = {
    '$schema':'http://json-schema.org/draft-07/schema#',
    '$id':'http://cyclonedx.org/schema/bom-1.5.schema.json',
    'type':'object', 'required':['bomFormat','specVersion'],
    'additionalProperties':False,
    'properties':{'bomFormat':{'const':'CycloneDX'},'specVersion':{'const':'1.5'},
                  'metadata':{'type':'object'},'components':{'type':'array'},'dependencies':{'type':'array'}}
}
SPDX = {'$schema':'http://json-schema.org/draft-07/schema#','$id':'http://cyclonedx.org/schema/spdx.schema.json','type':'string'}
BOM = {'bomFormat':'CycloneDX','specVersion':'1.5','metadata':{'component':{'bom-ref':'root'}},
       'components':[{'bom-ref':'pkg'}],
       'dependencies':[{'ref':'root','dependsOn':['pkg']},{'ref':'pkg','dependsOn':[]}]}

class Checks(unittest.TestCase):
    def test_git_blob_digest_matches_documented_git_algorithm(self):
        import hashlib
        data=b'hello world\n'
        self.assertEqual(checker.git_blob_digest(data),hashlib.sha1(b'blob 12\0hello world\n').hexdigest())
    def test_valid_example_schema(self):
        self.assertEqual(checker.validate_schema(BOM,SCHEMA,SPDX),[])
    def test_detect_additional_property(self):
        obj={**BOM,'bogus':True}
        self.assertTrue(checker.validate_schema(obj,SCHEMA,SPDX))
    def test_detect_wrong_spec(self):
        obj={**BOM,'specVersion':'1.4'}
        self.assertTrue(checker.validate_schema(obj,SCHEMA,SPDX))
    def test_good_dependency_references(self):
        self.assertEqual(checker.validate_graph(BOM),[])
    def test_missing_dependency_reference(self):
        obj={**BOM,'dependencies':[{'ref':'root','dependsOn':['ghost']}]}
        self.assertTrue(checker.validate_graph(obj))
    def test_duplicate_component_reference(self):
        obj={**BOM,'components':[{'bom-ref':'pkg'},{'bom-ref':'pkg'}]}
        self.assertTrue(checker.validate_graph(obj))
    def test_mismatching_official_schema_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'schema.json';p.write_text('{}')
            with self.assertRaisesRegex(ValueError,'Untrusted bom schema'):
                checker.pinned_json(p,'bom')
    def test_symlinked_official_schema_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'real';p.write_text('{}')
            link=pathlib.Path(d)/'alias';link.symlink_to(p)
            with self.assertRaisesRegex(ValueError,'symlinked'):
                checker.pinned_json(link,'bom')
    def test_missing_official_schema_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'bom.json';p.write_text(json.dumps(BOM))
            with redirect_stdout(io.StringIO()) as std:
                status=checker.main(['--schema',str(pathlib.Path(d)/'absent1'), '--spdx',str(pathlib.Path(d)/'absent2'),'--bom',str(p)])
            self.assertEqual(status,2)
            self.assertIn('NOT_VALIDATED',std.getvalue())

if __name__=='__main__': unittest.main()
