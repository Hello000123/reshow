import argparse
import json
import re
import threading
from email import policy
from email.parser import BytesParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
MAX_IMAGE_SIZE = 4 * 1024 * 1024
LICENSE_ACCEPTED_MESSAGE = (
    "Thank you for agreeing to this model's terms. You may now use the model."
)
PROMPT = """Analyze the attached image and identify the visible artifact. Return exactly one valid JSON object and no Markdown or extra text, using precisely these two keys:
{
  "name": "A short, specific title for the visible image",
  "description": "A concise description of details visible in the image."
}
Do not return a general image summary instead of this JSON. Do not infer facts that cannot be seen."""


class UploadError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def decode_json_response(response):
    try:
        value = json.loads(response.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def cloudflare_request(endpoint, token, payload):
    request = Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=60) as response:
            return response.status, decode_json_response(response.read())
    except HTTPError as error:
        return error.code, decode_json_response(error.read())
    except URLError as error:
        raise RuntimeError("Could not connect to Cloudflare Workers AI.") from error
    except TimeoutError as error:
        raise RuntimeError("Cloudflare Workers AI did not respond in time.") from error
    except OSError as error:
        raise RuntimeError("Cloudflare Workers AI transport failed.") from error


def extract_json_object(text):
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and {
            "name",
            "description",
        }.issubset(value):
            name = value["name"]
            description = value["description"]
            if (
                not isinstance(name, str)
                or not isinstance(description, str)
                or not name.strip()
                or not description.strip()
            ):
                raise RuntimeError(
                    "The AI response contains invalid exhibit details. Please try again."
                )
            return name.strip(), description.strip()
    return None


def create_exhibit_name(description):
    first_sentence = re.split(r"(?<=[.!?])\s+", description, maxsplit=1)[0]
    first_sentence = re.sub(
        r"^the image\s+(presents|shows|depicts|features|contains)\s+",
        "",
        first_sentence,
        flags=re.IGNORECASE,
    )
    name = re.split(
        r"\s+(that|which|with|characterized by)\s+",
        first_sentence,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip(" \t\n\r.,:;\"'")
    name = re.sub(r"^(a|an|the)\s+", "", name, flags=re.IGNORECASE)
    return name[:1].upper() + name[1:] if name else "Image-based exhibit"


def generate_exhibit(image_bytes, account_id, api_token):
    endpoint = (
        "https://api.cloudflare.com/client/v4/accounts/"
        + account_id
        + "/ai/run/@cf/meta/llama-3.2-11b-vision-instruct"
    )
    with StudioHandler.license_lock:
        if account_id not in StudioHandler.accepted_accounts:
            status, response = cloudflare_request(
                endpoint, api_token, {"prompt": "agree"}
            )
            errors = response.get("errors", [])
            api_message = (
                errors[0].get("message", "")
                if isinstance(errors, list)
                and errors
                and isinstance(errors[0], dict)
                else ""
            )
            if not (
                200 <= status < 300 and response.get("success")
            ) and not (
                status == 403 and LICENSE_ACCEPTED_MESSAGE in api_message
            ):
                raise RuntimeError(
                    "Cloudflare model terms could not be accepted: "
                    + (api_message or "unknown API error")
                )
            StudioHandler.accepted_accounts.add(account_id)

    status, response = cloudflare_request(
        endpoint,
        api_token,
        {
            "prompt": PROMPT,
            "image": list(image_bytes),
            "max_tokens": 512,
            "temperature": 0.2,
        },
    )
    errors = response.get("errors", [])
    api_message = (
        errors[0].get("message", "")
        if isinstance(errors, list)
        and errors
        and isinstance(errors[0], dict)
        else ""
    )
    if not (200 <= status < 300 and response.get("success")):
        raise RuntimeError(
            "Cloudflare Workers AI request failed (HTTP "
            + str(status)
            + "): "
            + (api_message or "unknown API error")
        )

    result = response.get("result")
    generated = result.get("response") if isinstance(result, dict) else None
    if not isinstance(generated, str) or not generated.strip():
        raise RuntimeError("Cloudflare returned no generated text. Try another image.")
    details = extract_json_object(generated)
    if details is None:
        description = generated.strip()
        name = create_exhibit_name(description)
    else:
        name, description = details

    return {
        "exhibit_id": "demo-artifact-01",
        "name": name,
        "description": description,
        "tag_id": "DEMO-TAG-001",
        "temperature_min_c": 18,
        "temperature_max_c": 28,
        "brightness_min_raw": 600,
        "brightness_max_raw": 3000,
    }


def parse_multipart_request(content_type, body):
    if len(body) > MAX_IMAGE_SIZE + 32 * 1024:
        raise UploadError(413, "The image must be smaller than 4 MB.")
    try:
        if not content_type.lower().startswith("multipart/form-data;"):
            raise UploadError(400, "Choose a JPEG, PNG, or WebP image and try again.")
        message = BytesParser(policy=policy.default).parsebytes(
            ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode(
                "ascii"
            )
            + body
        )
    except (LookupError, UnicodeEncodeError) as error:
        raise UploadError(400, "The image upload could not be read.") from error
    if not message.is_multipart():
        raise UploadError(400, "Choose a JPEG, PNG, or WebP image and try again.")

    fields = {}
    image = None
    for part in message.iter_parts():
        disposition = part.get_content_disposition()
        if disposition != "form-data":
            continue
        name = part.get_param("name", header="content-disposition")
        if name == "image":
            image = part.get_payload(decode=True) or b""
            image_type = part.get_content_type()
            if not image or len(image) > MAX_IMAGE_SIZE:
                raise UploadError(413, "The image must be smaller than 4 MB.")
            is_jpeg = image.startswith(b"\xff\xd8\xff")
            is_png = image.startswith(b"\x89PNG\r\n\x1a\n")
            is_webp = (
                len(image) >= 12
                and image.startswith(b"RIFF")
                and image[8:12] == b"WEBP"
            )
            if not (
                (image_type == "image/jpeg" and is_jpeg)
                or (image_type == "image/png" and is_png)
                or (image_type == "image/webp" and is_webp)
            ):
                raise UploadError(415, "Only JPEG, PNG, and WebP images are supported.")
        elif name in ("account_id", "api_token"):
            value = part.get_content()
            if isinstance(value, bytes):
                try:
                    value = value.decode("utf-8")
                except UnicodeDecodeError as error:
                    raise UploadError(400, "Cloudflare credentials must be text.") from error
            if isinstance(value, str):
                fields[name] = value.strip()

    account_id = fields.get("account_id", "")
    api_token = fields.get("api_token", "")
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account_id):
        raise UploadError(400, "Enter a valid 32-character Cloudflare Account ID.")
    if not api_token or len(api_token) > 4096:
        raise UploadError(400, "Enter a valid Cloudflare API token.")
    if image is None:
        raise UploadError(400, "Choose a JPEG, PNG, or WebP image and try again.")
    return image, account_id, api_token


class StudioHandler(SimpleHTTPRequestHandler):
    accepted_accounts = set()
    license_lock = threading.Lock()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/technology/generate-exhibit":
            self.send_json(404, {"error": "Not found."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Invalid request length."})
            return
        if content_length <= 0:
            self.send_json(400, {"error": "Choose an image and try again."})
            return
        if content_length > MAX_IMAGE_SIZE + 32 * 1024:
            self.send_json(413, {"error": "The image must be smaller than 4 MB."})
            return

        account_id = ""
        api_token = ""
        try:
            image, account_id, api_token = parse_multipart_request(
                self.headers.get("Content-Type", ""),
                self.rfile.read(content_length),
            )
            self.send_json(
                200, {"data": generate_exhibit(image, account_id, api_token)}
            )
        except UploadError as error:
            self.send_json(error.status, {"error": str(error)})
        except RuntimeError as error:
            message = str(error)
            for secret in (account_id, api_token):
                if secret:
                    message = message.replace(secret, "[redacted]")
            message = re.sub(r"Bearer\s+\S+", "Bearer [redacted]", message)
            print("Image-to-JSON generation failed: " + message, flush=True)
            self.send_json(502, {"error": message})


def main():
    parser = argparse.ArgumentParser(
        description="Serve the ReShow dashboard and its 3D/AI studio API."
    )
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), StudioHandler)
    print(
        "ReShow is available at http://"
        + args.bind
        + ":"
        + str(args.port),
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping ReShow server.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
