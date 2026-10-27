"""Verify the outbound AI request boundary without calling the gateway."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('review', 'scripts/ai-review.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class ReviewTests(unittest.TestCase):
    def test_request_has_bounded_allowlist_and_no_private_context(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in review.REVIEW_FILES:
                source = root / name
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_text('public source ' + 'x' * review.MAX_FILE_CHARS)
            (root / '.env').write_text('unlisted-file-secret')
            (root / 'sonar-report').mkdir()
            (root / 'sonar-report/issues.json').write_text(json.dumps({'issues': [{'rule': 'javascript:S123', 'message': 'private-issue-prose', 'component': 'private/path'}] * 101}))
            response = io.BytesIO(json.dumps({'choices': [{'message': {'content': 'Advisory result'}}]}).encode())
            environment = {'AI_API_KEY': 'api-key-sentinel', 'PRIVATE_CONTEXT': 'environment-secret'}
            with patch.dict(os.environ, environment, clear=True), patch.object(review.urllib.request, 'urlopen', return_value=response) as send:
                review.main(root)
            request = send.call_args.args[0]
            self.assertEqual(request.full_url, 'https://18.163.201.242/ica/harry/v1/chat/completions')
            self.assertEqual(request.get_header('Authorization'), 'Bearer api-key-sentinel')
            payload = json.loads(request.data)
            self.assertEqual(payload['model'], 'claude-sonnet-5-5')
            context = json.loads(payload['messages'][1]['content'])
            self.assertEqual([item['path'] for item in context['deploymentSources']], list(review.REVIEW_FILES))
            for item in context['deploymentSources']:
                self.assertEqual(len(item['content']), review.MAX_FILE_CHARS)
                self.assertTrue(item['truncated'])
            self.assertEqual(len(context['first100']), 100)
            for secret in ['api-key-sentinel', 'environment-secret', 'unlisted-file-secret', 'private-issue-prose', 'private/path']:
                self.assertNotIn(secret, request.data.decode())
            self.assertIn('Advisory result', (root / 'sonar-report/ai-review.md').read_text())

    def test_missing_key_fails_without_network(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True), patch.object(review.urllib.request, 'urlopen') as send:
            with self.assertRaisesRegex(RuntimeError, 'AI review failed: ValueError'):
                review.main(Path(temporary))
            send.assert_not_called()
            self.assertIn('AI review failed', (Path(temporary) / 'sonar-report/ai-review.md').read_text())


if __name__ == '__main__':
    unittest.main()
