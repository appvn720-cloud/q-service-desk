import json
import mimetypes
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
ENV_FILE = ROOT / ".env"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))


def load_dotenv():
    if not ENV_FILE.exists():
        return
    for raw_line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def env(name):
    return os.environ.get(name, "").strip()


def json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("cache-control", "no-store")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler):
    size = int(handler.headers.get("content-length", "0") or "0")
    if size <= 0:
        return {}
    try:
        return json.loads(handler.rfile.read(size).decode("utf-8"))
    except json.JSONDecodeError:
        return None


def supabase_request(method, path, api_key, token, payload=None, extra_headers=None):
    url = env("SUPABASE_URL").rstrip("/") + path
    data = None
    headers = {
        "apikey": api_key,
        "authorization": f"Bearer {token}",
        "content-type": "application/json",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    if extra_headers:
        headers.update(extra_headers)
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            text = response.read().decode("utf-8")
            return response.status, json.loads(text) if text else None
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8")
        try:
            body = json.loads(text)
        except json.JSONDecodeError:
            body = {"message": text or exc.reason}
        return exc.code, body


def local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


class ServiceDeskHandler(BaseHTTPRequestHandler):
    server_version = "QServiceDeskLocal/1.0"

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type, authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/.netlify/functions/config":
            return self.handle_config()
        return self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/.netlify/functions/create-user":
            return self.handle_create_user()
        json_response(self, 404, {"error": "Not found"})

    def handle_config(self):
        json_response(self, 200, {
            "SUPABASE_URL": env("SUPABASE_URL"),
            "SUPABASE_ANON_KEY": env("SUPABASE_ANON_KEY"),
        })

    def handle_create_user(self):
        url = env("SUPABASE_URL")
        anon_key = env("SUPABASE_ANON_KEY")
        service_key = env("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not anon_key or not service_key:
            return json_response(self, 500, {"error": "Missing Supabase settings in .env"})

        auth_header = self.headers.get("authorization", "")
        token = auth_header.replace("Bearer ", "", 1).strip()
        if not token:
            return json_response(self, 401, {"error": "Missing login token"})

        status, requester = supabase_request("GET", "/auth/v1/user", anon_key, token)
        if status >= 400 or not requester or not requester.get("id"):
            return json_response(self, 401, {"error": "Invalid login token"})

        profile_path = "/rest/v1/profiles?select=role&id=eq." + urllib.parse.quote(requester["id"])
        status, profiles = supabase_request("GET", profile_path, service_key, service_key)
        if status >= 400:
            return json_response(self, 500, {"error": profiles.get("message", "Profile check failed")})
        if not profiles or profiles[0].get("role") != "admin":
            return json_response(self, 403, {"error": "Admin only"})

        payload = read_json(self)
        if payload is None:
            return json_response(self, 400, {"error": "Invalid JSON"})

        email = str(payload.get("email", "")).strip()
        password = str(payload.get("password", ""))
        name = str(payload.get("name", "")).strip()
        role = "admin" if payload.get("role") == "admin" else "t1"
        if not email or not password or not name:
            return json_response(self, 400, {"error": "Email, password and name are required"})
        if len(password) < 6:
            return json_response(self, 400, {"error": "Password must be at least 6 characters"})

        status, created = supabase_request("POST", "/auth/v1/admin/users", service_key, service_key, {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"name": name, "role": role},
        })
        if status >= 400:
            return json_response(self, 400, {"error": created.get("message", "Create user failed")})

        user_id = created.get("id") or (created.get("user") or {}).get("id")
        if not user_id:
            return json_response(self, 500, {"error": "Create user returned no user id"})
        profile_payload = {"id": user_id, "name": name, "role": role}
        status, upserted = supabase_request(
            "POST",
            "/rest/v1/profiles?on_conflict=id",
            service_key,
            service_key,
            profile_payload,
            {"prefer": "resolution=merge-duplicates,return=representation"},
        )
        if status >= 400:
            return json_response(self, 500, {"error": upserted.get("message", "Profile save failed")})

        json_response(self, 200, {"userId": user_id, "name": name, "role": role})

    def serve_static(self, request_path):
        path = urllib.parse.unquote(request_path)
        if path == "/":
            path = "/index.html"
        file_path = (PUBLIC_DIR / path.lstrip("/")).resolve()
        if not str(file_path).startswith(str(PUBLIC_DIR.resolve())):
            return json_response(self, 403, {"error": "Forbidden"})
        if not file_path.exists() or not file_path.is_file():
            file_path = PUBLIC_DIR / "index.html"
        content = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main():
    load_dotenv()
    if not PUBLIC_DIR.exists():
        print("Missing public folder.")
        return 1
    server = ThreadingHTTPServer((HOST, PORT), ServiceDeskHandler)
    print("Q Service Desk local server is running")
    print(f"Local:   http://localhost:{PORT}")
    print(f"LAN:     http://{local_ip()}:{PORT}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
