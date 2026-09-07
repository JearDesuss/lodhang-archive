"""Static dev server for the archive.  python tools/serve.py [port]

No caching, so a reload always shows the current file, and correct MIME types
for .mjs/.webp/.avif which the stdlib gets wrong or omits.
"""
import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8788


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".webp": "image/webp",
        ".avif": "image/avif",
        ".woff2": "font/woff2",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *a):
        msg = fmt % a
        if " 200 " not in msg:  # only surface the failures
            sys.stderr.write(f"{self.address_string()} {msg}\n")


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    try:
        with Server(("127.0.0.1", PORT), handler) as httpd:
            print(f"serving {ROOT}\n  http://127.0.0.1:{PORT}/")
            httpd.serve_forever()
    except OSError as e:
        sys.exit(f"port {PORT} is not available ({e}). Pass another: python tools/serve.py 8799")
