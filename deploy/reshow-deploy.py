#!/usr/bin/env python3
"""Install only ReShow static runtime files from one immutable public commit."""
import io
import gzip
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import subprocess
import time
import tarfile
import tempfile
import urllib.request

ROOT = Path('/opt/ee3070-frontend')
MAX_ARCHIVE = 25 * 1024 * 1024
MAX_CONTENT = 50 * 1024 * 1024
EXTENSIONS = {'.html', '.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.glb'}


def extract_runtime(archive, destination):
    total = 0
    written = set()
    with gzip.GzipFile(fileobj=io.BytesIO(archive)) as compressed:
        unpacked = compressed.read(MAX_CONTENT + 1024 * 1024 + 1)
    if len(unpacked) > MAX_CONTENT + 1024 * 1024:
        raise ValueError('Decompressed archive exceeds size limit')
    with tarfile.open(fileobj=io.BytesIO(unpacked), mode='r:') as bundle:
        for member in bundle:
            if PurePosixPath(member.name).is_absolute():
                raise ValueError('Absolute archive path')
            parts = PurePosixPath(member.name).parts
            relative = PurePosixPath(*parts[1:])
            selected = str(relative) == 'index.html' or (relative.parts and relative.parts[0] in ('css', 'js', 'assets'))
            if not selected or member.isdir():
                continue
            if not member.isfile():
                raise ValueError(f'Unsafe runtime archive member {member.name!r}: only regular files are allowed')
            if relative.is_absolute() or '..' in parts or '\\' in member.name:
                raise ValueError(f'Unsafe runtime archive member {member.name!r}: invalid relative path')
            if relative.suffix.lower() not in EXTENSIONS and str(relative) != 'js/vendor/three-r128/LICENSE.txt':
                raise ValueError(f'Unsafe runtime archive member {member.name!r}: file type is not allowed')
            if str(relative) in written:
                raise ValueError('Duplicate runtime archive member')
            total += member.size
            if total > MAX_CONTENT or member.size < 0:
                raise ValueError('Runtime content exceeds size limit')
            target = destination.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            source = bundle.extractfile(member)
            with target.open('xb') as output:
                shutil.copyfileobj(source, output)
            target.chmod(0o644)
            written.add(str(relative))
    if 'index.html' not in written or not any(p.startswith('js/') for p in written):
        raise ValueError('Archive lacks required website files')


def point_current(target):
    temporary = ROOT / 'current.next'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    temporary.replace(ROOT / 'current')


def download_archive(commit):
    if not re.fullmatch('[0-9a-f]{40}', commit):
        raise ValueError('Expected exactly one lowercase 40-character commit SHA')
    with urllib.request.urlopen('https://codeload.github.com/Hello000123/reshow/tar.gz/' + commit, timeout=60) as response:
        archive = response.read(MAX_ARCHIVE + 1)
    if len(archive) > MAX_ARCHIVE:
        raise ValueError('Archive exceeds size limit')
    return archive


def validate(commit):
    archive = download_archive(commit)
    with tempfile.TemporaryDirectory(prefix='reshow-validate-') as temporary:
        extract_runtime(archive, Path(temporary))
    print('Validated ReShow runtime archive ' + commit)


def deploy(commit):
    # Serialize a rollback with a still-running SSM command after cancellation.
    with (ROOT / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        install_release(commit)


def install_release(commit):
    archive = download_archive(commit)
    releases = ROOT / 'releases'
    releases.mkdir(parents=True, exist_ok=True)
    target = releases / commit
    with tempfile.TemporaryDirectory(prefix='.staging-', dir=releases) as staging:
        stage = Path(staging)
        stage.chmod(0o755)
        public = stage / 'public'
        public.mkdir(mode=0o755)
        extract_runtime(archive, public)
        (public / 'release.json').write_text(json.dumps({'commit': commit}) + '\n')
        # Keep the preinstalled trusted server; repository code is never executed.
        shutil.copyfile(ROOT / 'current/server.py', stage / 'server.py')
        (stage / 'server.py').chmod(0o644)
        if not target.exists():
            stage.rename(target)
    current = ROOT / 'current'
    previous = os.readlink(current) if current.is_symlink() else None
    point_current(target)
    try:
        subprocess.run(['systemctl', 'restart', 'ee3070-frontend.service'], check=True, timeout=30)
        for attempt in range(10):
            try:
                with urllib.request.urlopen('http://127.0.0.1:8080/release.json', timeout=5) as response:
                    if json.load(response)['commit'] != commit:
                        raise RuntimeError('Local release check returned a different commit')
                with urllib.request.urlopen('http://127.0.0.1:8080/', timeout=5) as response:
                    if response.status != 200:
                        raise RuntimeError('Local homepage check failed')
                break
            except (OSError, ValueError, RuntimeError):
                if attempt == 9:
                    raise
                time.sleep(1)
    except Exception:
        if previous is not None:
            point_current(previous)
            subprocess.run(['systemctl', 'restart', 'ee3070-frontend.service'], check=True, timeout=30)
        else:
            current.unlink()
        raise
    print('Deployed ReShow commit ' + commit)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--validate':
        validate(sys.argv[2])
    elif len(sys.argv) == 2:
        deploy(sys.argv[1])
    else:
        raise SystemExit('Usage: reshow-deploy [--validate] <40-character commit SHA>')
