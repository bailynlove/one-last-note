"""PROTOTYPE: python3 prototypes/web-app/server.py

Three product-wide UI variants on one route, switchable via ?variant=A, B, or C.
No dependencies and no persistence.
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?", 1)[0] == "/":
            self.path = "/index.html"
        return super().do_GET()

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        return str(ROOT / clean)


if __name__ == "__main__":
    address = ("127.0.0.1", 8004)
    print("PROTOTYPE — no persistence")
    print(f"Open http://{address[0]}:{address[1]}/?variant=A")
    ThreadingHTTPServer(address, Handler).serve_forever()
