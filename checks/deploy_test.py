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
            deploy.extract_runtime(archive([('repo/.env', b'secret', tarfile.REGTYPE)]), destination)
            self.assertEqual(sorted(str(p.relative_to(destination)) for p in destination.rglob('*') if p.is_file()), ['index.html', 'js/app.js'])

    def test_runtime_traversal_symlinks_and_duplicate_are_rejected(self):
        for name, kind in [('repo/js/../../escape.js', tarfile.REGTYPE), ('repo/js/link.js', tarfile.SYMTYPE), ('repo/index.html', tarfile.REGTYPE), ('/repo/js/absolute.js', tarfile.REGTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                with self.assertRaises(ValueError):
                    deploy.extract_runtime(archive([(name, b'', kind)]), Path(temporary))


if __name__ == '__main__':
    unittest.main()
