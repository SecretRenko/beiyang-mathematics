"""Check the curated public tree, without reading production credentials."""
from pathlib import Path
import hashlib
import json
import sys

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'resource-manifest.json').read_text(encoding='utf-8'))
release = {x['path'] for x in manifest['release_assets']}
errors = []
for p in root.rglob('*'):
    if not p.is_file() or '.git' in p.relative_to(root).parts:
        continue
    rel = p.relative_to(root).as_posix()
    if (p.name.startswith('.env') and p.name != '.env.example') or p.suffix.lower() in {'.pem', '.key', '.pfx', '.p12', '.log'} or rel.startswith('backend/data/'):
        errors.append(f'Private runtime file: {rel}')
    if p.stat().st_size >= 100 * 1024**2:
        errors.append(f'File too large for Git: {rel}')
for entry in manifest['files']:
    if entry['path'] in release:
        continue
    p = root / 'frontend' / entry['path']
    if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != entry['sha256']:
        errors.append(f'Missing or modified resource: {entry["path"]}')
print(json.dumps({'errors': errors, 'missing_source_files': manifest['missing'],
                  'release_assets': list(release)}, ensure_ascii=False, indent=2))
sys.exit(bool(errors))
