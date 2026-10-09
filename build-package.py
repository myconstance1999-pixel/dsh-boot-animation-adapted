#!/usr/bin/env python3
"""Build a local npm-format archive without installing dependencies or running scripts."""

import gzip
import hashlib
import io
import json
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PACKAGE = ROOT
DESTINATION = ROOT / 'delivery'
MEDIA_BLOBS = {
    '1.mp4': '3a215fb033067b67151c2caed1261493fa60a48a',
    '2.mp4': 'd899cf856eb6de8c774166333bb42abbf3e5ffc5',
    '3.mp4': 'ac74e18fba0f9ce1230b651f9d513cd5d2d728d8',
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    metadata = json.loads((PACKAGE / 'package.json').read_text())
    files = set()
    for item in metadata['files'] + ['README.md']:
        path = PACKAGE / item
        if path.is_symlink():
            raise ValueError(f'Symlink is not an archive input: {item}')
        if path.is_dir():
            files.update(p.relative_to(PACKAGE).as_posix() for p in path.rglob('*') if p.is_file())
        else:
            files.add(item)

    contents = {}
    inventory = []
    for relative in sorted(files):
        path = PACKAGE / relative
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'Expected a regular package file: {relative}')
        data = path.read_bytes()
        contents[relative] = data
        record = {'path': relative, 'bytes': len(data), 'sha256': sha256(data)}
        if relative.startswith('assets/videos/'):
            blob = hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()
            if blob != MEDIA_BLOBS[path.name]:
                raise ValueError(f'Original media mismatch: {relative}')
            record['originalGitBlob'] = blob
        inventory.append(record)

    original_boot_sha256 = '6c8c01f94ead14d22716d8cb636c7a45475438333d7a50f0cddaf6cce7701ec6'
    if sha256(contents['src/boot-screen.js']) != original_boot_sha256:
        raise ValueError('Original startup/transition script changed')
    if metadata.get('scripts'):
        raise ValueError('This prebuilt package must not contain installation scripts')

    DESTINATION.mkdir(exist_ok=True)
    archive = DESTINATION / f"{metadata['name']}-{metadata['version']}.tgz"
    with archive.open('wb') as output:
        with gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w', format=tarfile.USTAR_FORMAT) as tar:
                for relative, data in contents.items():
                    info = tarfile.TarInfo('package/' + relative)
                    info.size = len(data)
                    info.mode = 0o644
                    info.mtime = 0
                    tar.addfile(info, io.BytesIO(data))

    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if [member.name for member in members] != ['package/' + p for p in contents]:
            raise ValueError('Archive inventory mismatch')
        for member in members:
            if not member.isfile() or tar.extractfile(member).read() != contents[member.name[8:]]:
                raise ValueError(f'Archive content mismatch: {member.name}')

    result = {
        'package': {'name': metadata['name'], 'version': metadata['version']},
        'archive': {'path': archive.relative_to(ROOT).as_posix(), 'bytes': archive.stat().st_size,
                    'sha256': sha256(archive.read_bytes()), 'verifiedMembers': len(inventory)},
        'files': inventory,
        'originalMediaGitBlobsVerified': True,
        'originalStartupScriptVerified': True,
        'dependencyInstallation': False,
        'scriptsExecuted': False,
        'liveInstallation': False,
    }
    (DESTINATION / 'PACKAGE_MANIFEST.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result['archive'], indent=2))


if __name__ == '__main__':
    main()
