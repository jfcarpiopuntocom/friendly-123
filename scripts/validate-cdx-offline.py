#!/usr/bin/env python3
"""CycloneDX JSON-schema and graph check. Offline, read-only, no external calls.
Requires independently installed Python jsonschema and copies of exact upstream
CycloneDX schemas pinned by Git blob SHA. No automatic install or download.
"""
import argparse
import hashlib
import json
import pathlib
import sys

EXPECTED = {
    'bom': 'd9c4d08031d45ecf0c4b2f6fcac8eeb8c9e78a65',
    'spdx': '566c4a32518c60778e55a56ccf71bf781320b279',
}

def git_blob_digest(data):
    return hashlib.sha1(('blob ' + str(len(data)) + '\0').encode('ascii') + data).hexdigest()

def pinned_json(path, key):
    path = pathlib.Path(path)
    if not path.is_file() or path.is_symlink():
        raise ValueError('Missing or symlinked official ' + key + ' schema')
    payload = path.read_bytes()
    actual = git_blob_digest(payload)
    if actual != EXPECTED[key]:
        raise ValueError(f'Untrusted {key} schema blob: {actual}; expected {EXPECTED[key]}')
    return json.loads(payload)

def validate_schema(bom, schema, spdx):
    from jsonschema import Draft7Validator, FormatChecker
    from referencing import Registry, Resource
    reg = Registry().with_resources([
        (schema['$id'], Resource.from_contents(schema)),
        (spdx['$id'], Resource.from_contents(spdx)),
    ])
    Draft7Validator.check_schema(schema)
    validator = Draft7Validator(schema, registry=reg, format_checker=FormatChecker())
    return sorted([f'{list(e.absolute_path)}: {e.message}' for e in validator.iter_errors(bom)])

def validate_graph(bom):
    """Cross-BOM referential integrity is supplemental to JSON Schema."""
    errors = []
    components = bom.get('components', [])
    metadata_component = bom.get('metadata', {}).get('component')
    references = []
    if isinstance(metadata_component, dict):
        references.append(metadata_component.get('bom-ref'))
    for comp in components:
        if isinstance(comp, dict):
            references.append(comp.get('bom-ref'))
    ids = [v for v in references if isinstance(v, str)]
    known = set(ids)
    if len(known) != len(ids):
        errors.append('Duplicate bom-ref among described components')
    edges = bom.get('dependencies', [])
    for i, dep in enumerate(edges):
        if not isinstance(dep, dict):
            continue
        if dep.get('ref') not in known:
            errors.append(f'dependencies[{i}].ref unknown')
        for j, dep_id in enumerate(dep.get('dependsOn', [])):
            if dep_id not in known:
                errors.append(f'dependencies[{i}].dependsOn[{j}] unknown')
    return errors

def main(argv=None):
    parser = argparse.ArgumentParser(description='Validate CycloneDX 1.5 offline using EXACT pinned official schemas.')
    parser.add_argument('--schema', required=True, help='Official schema/bom-1.5.schema.json')
    parser.add_argument('--spdx', required=True, help='Official schema/spdx.schema.json')
    parser.add_argument('--bom', required=True, help='Generated CycloneDX JSON BOM')
    args = parser.parse_args(argv)
    try:
        schema = pinned_json(args.schema, 'bom')
        spdx = pinned_json(args.spdx, 'spdx')
        document = json.loads(pathlib.Path(args.bom).read_text(encoding='utf-8'))
        if document.get('bomFormat') != 'CycloneDX' or document.get('specVersion') != '1.5':
            raise ValueError('Unexpected BOM format/version')
        errs = validate_schema(document, schema, spdx) + validate_graph(document)
        result = {'status':'FAIL' if errs else 'PASS', 'schemaBlob':EXPECTED['bom'], 'spdxBlob':EXPECTED['spdx'],
                  'bom': pathlib.Path(args.bom).name, 'errors': errs[:20], 'errorCount':len(errs),
                  'claim':'Schema and local reference checks only; not OpenChain conformance or complete released-product coverage'}
        print(json.dumps(result,indent=2))
        return 1 if errs else 0
    except (ValueError, OSError, json.JSONDecodeError, ImportError) as err:
        print(json.dumps({'status':'NOT_VALIDATED','error':str(err), 'claim':'Do not present as valid or conformant'}))
        return 2

if __name__ == '__main__':
    sys.exit(main())
