"""Exercise the public API adapter with real multipart bytes and mocked Cloudflare."""
import base64
from contextlib import redirect_stdout
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import threading
import unittest
from unittest.mock import patch

import lambda_handler
import server

ORIGIN = "https://dkbznu9f5nh9n.cloudfront.net"
ACCOUNT = "a" * 32
TOKEN = "test-token-that-is-not-a-real-secret"
IMAGE = b"\xff\xd8\xfftest-image"
CONTENT_TYPE = "multipart/form-data; boundary=reshow-test"


def multipart(account=ACCOUNT, token=TOKEN, image=IMAGE, image_type="image/jpeg", extra=b""):
    body = b""
    for name, value in (("account_id", account.encode()), ("api_token", token.encode())):
        body += b'--reshow-test\r\nContent-Disposition: form-data; name="' + name.encode() + b'"\r\n\r\n' + value + b"\r\n"
    body += b'--reshow-test\r\nContent-Disposition: form-data; name="image"; filename="image.jpg"\r\nContent-Type: ' + image_type.encode() + b"\r\n\r\n" + image + b"\r\n"
    return body + extra + b"--reshow-test--\r\n"


def event(body=None, **headers):
    body = multipart() if body is None else body
    return {"rawPath": lambda_handler.GENERATE_PATH,
            "requestContext": {"http": {"method": "POST"}},
            "headers": {"origin": ORIGIN, "content-type": CONTENT_TYPE,
                        "x-amz-content-sha256": hashlib.sha256(body).hexdigest(), **headers},
            "isBase64Encoded": True, "body": base64.b64encode(body).decode()}


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"RESHOW_ALLOWED_ORIGIN": ORIGIN})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_real_post_parses_binary_image_and_generates_without_accepting_terms(self):
        with patch.object(server, "cloudflare_request", return_value=(200, {
            "success": True, "result": {"response": '{"name":"Helmet","description":"A metal helmet."}'},
        })) as outbound:
            result = lambda_handler.handler(event(), None)
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(json.loads(result["body"])["data"]["name"], "Helmet")
        self.assertEqual(result["headers"]["cache-control"], "no-store, private")
        outbound.assert_called_once()
        endpoint, token, payload = outbound.call_args.args
        self.assertEqual(endpoint, "https://api.cloudflare.com/client/v4/accounts/" + ACCOUNT + "/ai/run/@cf/meta/llama-3.2-11b-vision-instruct")
        self.assertEqual(token, TOKEN)
        self.assertEqual(bytes(payload["image"]), IMAGE)
        self.assertNotEqual(payload["prompt"], "agree")

    def test_invalid_uploads_fail_before_any_outbound_request(self):
        cases = [(multipart(account="../outside"), 400),
                 (multipart(token="x\r\nAuthorization: attacker"), 400),
                 (multipart(image=b"not-an-image"), 415),
                 (multipart(image=IMAGE + b"x" * server.MAX_IMAGE_SIZE), 413),
                 (multipart(extra=b'--reshow-test\r\nContent-Disposition: form-data; name="api_token"\r\n\r\nextra\r\n'), 400)]
        with patch.object(server, "cloudflare_request") as outbound:
            for body, expected in cases:
                with self.subTest(expected=expected, size=len(body)):
                    self.assertEqual(lambda_handler.handler(event(body), None)["statusCode"], expected)
            outbound.assert_not_called()

    def test_cross_origin_checksum_and_binary_encoding_are_validated(self):
        cases = [event(origin="https://attacker.example"), event(**{"x-amz-content-sha256": "0" * 64}), event()]
        cases[-1]["body"] = "not base64"
        with patch.object(server, "cloudflare_request") as outbound:
            self.assertEqual([lambda_handler.handler(value, None)["statusCode"] for value in cases], [403, 400, 400])
            outbound.assert_not_called()

    def test_upstream_failure_never_echoes_or_logs_credentials(self):
        capture = io.StringIO()
        with redirect_stdout(capture), patch.object(server, "cloudflare_request", return_value=(403, {
            "errors": [{"message": "Bearer " + TOKEN + " " + ACCOUNT}], "success": False,
        })):
            result = lambda_handler.handler(event(), None)
        self.assertEqual(result["statusCode"], 502)
        for secret in (TOKEN, ACCOUNT):
            self.assertNotIn(secret, result["body"] + capture.getvalue())

    def test_routes_and_health_do_not_contact_cloudflare(self):
        health = {"rawPath": "/api/health", "requestContext": {"http": {"method": "GET"}}}
        with patch.object(server, "cloudflare_request") as outbound, patch.object(Path, "read_text", return_value=json.dumps({"commit": "b" * 40})):
            result = lambda_handler.handler(health, None)
            self.assertEqual(json.loads(result["body"])["commit"], "b" * 40)
            unknown = event()
            unknown["rawPath"] = "/api/not-a-route"
            self.assertEqual(lambda_handler.handler(unknown, None)["statusCode"], 404)
            unknown["rawPath"] = lambda_handler.GENERATE_PATH
            unknown["requestContext"]["http"]["method"] = "GET"
            self.assertEqual(lambda_handler.handler(unknown, None)["statusCode"], 405)
            outbound.assert_not_called()

    def test_cloudflare_transport_does_not_follow_redirects_and_bounds_responses(self):
        opener = unittest.mock.MagicMock()
        reply = opener.open.return_value.__enter__.return_value
        reply.status = 200
        reply.read.return_value = b'{"success": true}'
        with patch.object(server, "build_opener", return_value=opener) as build:
            server.cloudflare_request("https://api.cloudflare.com/endpoint", TOKEN, {"image": []})
            self.assertIsInstance(build.call_args.args[0], server.NoRedirects)
            self.assertEqual(opener.open.call_args.kwargs["timeout"], 40)
            self.assertEqual(opener.open.call_args.args[0].get_header("Authorization"), "Bearer " + TOKEN)
            reply.read.assert_called_once_with(server.MAX_RESPONSE_SIZE + 1)
            reply.read.return_value = b"x" * (server.MAX_RESPONSE_SIZE + 1)
            with self.assertRaisesRegex(RuntimeError, "oversized"):
                server.cloudflare_request("https://api.cloudflare.com/endpoint", TOKEN, {})
        self.assertIsNone(server.NoRedirects().redirect_request(None, None, 302, "", {}, "https://attacker.example"))

    def test_local_static_server_keeps_backend_and_repository_files_private(self):
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.StudioHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            connection = http.client.HTTPConnection("127.0.0.1", httpd.server_port, timeout=5)
            for path, expected in (("/", 200), ("/js/app.js", 200), ("/server.py", 404), ("/lambda_handler.py", 404), ("/.git/config", 404), ("/js/", 404)):
                connection.request("GET", path)
                reply = connection.getresponse()
                self.assertEqual(reply.status, expected, path)
                reply.read()
            connection.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
