"""Archive boundaries are tested without network or server writes."""
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('deploy', 'deploy/reshow-deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def archive(extra=()):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode='w:gz') as bundle:
        for name, content, kind in [('repo/index.html', b'home', tarfile.REGTYPE), ('repo/js/app.js', b'code', tarfile.REGTYPE), *extra]:
            member = tarfile.TarInfo(name)
            member.type = kind
            member.size = len(content)
            bundle.addfile(member, io.BytesIO(content))
    return data.getvalue()


class ArchiveTests(unittest.TestCase):
    def test_only_runtime_is_published(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary)
            deploy.extract_runtime(archive([('repo/.env', b'secret', tarfile.REGTYPE), ('repo/assets/model.glb', b'glTF', tarfile.REGTYPE)]), destination)
            self.assertEqual(sorted(str(p.relative_to(destination)) for p in destination.rglob('*') if p.is_file()), ['assets/model.glb', 'index.html', 'js/app.js'])

    def test_unsupported_runtime_file_reports_path_and_reason(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, r"repo/assets/secret\.json.*file type is not allowed"):
                deploy.extract_runtime(archive([('repo/assets/secret.json', b'{}', tarfile.REGTYPE)]), Path(temporary))

    def test_current_glb_asset_archive_is_accepted(self):
        asset = Path('assets/another_pot.glb')
        if not asset.exists():
            self.skipTest('Current GLB asset is not present in this checkout')
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w:gz') as bundle:
            for name in ('index.html', 'js/app.js', str(asset)):
                content = Path(name).read_bytes()
                member = tarfile.TarInfo(f'reshow/{name}')
                member.size = len(content)
                bundle.addfile(member, io.BytesIO(content))
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary)
            deploy.extract_runtime(data.getvalue(), destination)
            self.assertEqual((destination / asset).stat().st_size, asset.stat().st_size)

    def test_runtime_traversal_symlinks_and_duplicate_are_rejected(self):
        for name, kind in [('repo/js/../../escape.js', tarfile.REGTYPE), ('repo/js/link.js', tarfile.SYMTYPE), ('repo/index.html', tarfile.REGTYPE), ('/repo/js/absolute.js', tarfile.REGTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                with self.assertRaises(ValueError):
                    deploy.extract_runtime(archive([(name, b'', kind)]), Path(temporary))


if __name__ == '__main__':
    unittest.main()
