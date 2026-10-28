"""Local query-embedding service for the Convex search action (EMBEDDINGS_URL).

    python tools/rag/embed_server.py --model intfloat/multilingual-e5-base --port 8765

POST /embed {"texts": [...], "kind": "query" | "passage"} -> {"model", "dim", "vectors"}
GET  /health -> {"model", "dim"}
Binds to 127.0.0.1 only.
"""
from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from embedding import DEFAULT_MODEL, Embedder

MAX_TEXTS = 64


def make_handler(embedder: Embedder, dim: int):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: dict) -> None:
            data = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                self._send(200, {"model": embedder.name, "dim": dim})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/embed":
                self._send(404, {"error": "not found"})
                return
            try:
                length = int(self.headers.get("content-length", "0"))
                body = json.loads(self.rfile.read(length) or b"{}")
                texts = body.get("texts")
                kind = body.get("kind", "query")
                if not isinstance(texts, list) or not texts or len(texts) > MAX_TEXTS \
                        or not all(isinstance(t, str) and t.strip() for t in texts) or kind not in ("query", "passage"):
                    self._send(400, {"error": f"texts must be 1-{MAX_TEXTS} non-empty strings; kind query|passage"})
                    return
                self._send(200, {"model": embedder.name, "dim": dim, "vectors": embedder.encode(texts, kind)})
            except json.JSONDecodeError:
                self._send(400, {"error": "invalid JSON"})

        def log_message(self, fmt: str, *args) -> None:
            pass

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    embedder = Embedder(args.model)
    dim = len(embedder.encode(["test"], "query")[0])
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(embedder, dim))
    print(f"embedding service ready on http://127.0.0.1:{args.port} ({args.model}, dim {dim})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
