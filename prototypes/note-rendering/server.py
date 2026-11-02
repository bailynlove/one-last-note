"""PROTOTYPE: python3 prototypes/note-rendering/server.py

Three variants of the Note reader, switchable via ?variant=A, B, or C.
No dependencies and no persistence.
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent


def sample_pdf():
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length 141 >>\nstream\nBT /F1 24 Tf 72 700 Td (One Last Note) Tj /F1 12 Tf 0 -36 Td (PDF prototype - selectable source text) Tj 0 -24 Td (Revision 3 - native browser navigation) Tj ET\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{number} 0 obj\n".encode())
        data.extend(obj)
        data.extend(b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    data.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        data.extend(f"{offset:010d} 00000 n \n".encode())
    data.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(data)


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/sample.pdf":
            payload = sample_pdf()
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        path = self.path.split("?", 1)[0]
        if path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        return str(ROOT / clean)


if __name__ == "__main__":
    address = ("127.0.0.1", 8000)
    print("PROTOTYPE — no persistence")
    print(f"Open http://{address[0]}:{address[1]}/?variant=A")
    ThreadingHTTPServer(address, Handler).serve_forever()
