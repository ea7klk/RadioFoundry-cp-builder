# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""HTTP server: a JSON API plus the static builder, from one origin."""

from __future__ import annotations

import argparse
import gzip
import json
import mimetypes
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

from . import __version__
from .config import Config
from .service import BadRequest, NotFound, Service, _bool, _float, _int, parse_params
from .upstream import UpstreamError

WEB_ROOT = (Path(__file__).resolve().parent.parent / "web").resolve()

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
}

# Below this, gzip costs more than it saves (the response already fits in one packet).
GZIP_MIN_BYTES = 512

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; base-uri 'none'; form-action 'self'; "
        "img-src 'self' data:; script-src 'self'; style-src 'self'; "
        "connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
    ),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "geolocation=(self)",
}

API_TALKGROUP = re.compile(r"^/api/bm/devices/(\d{1,7})/talkgroups$")


class Handler(BaseHTTPRequestHandler):
    service: Service
    web_root: Path = WEB_ROOT
    server_version = f"RadioFoundry-cp-builder/{__version__}"
    sys_version = ""

    # --- verbs ---

    def do_GET(self) -> None:  # noqa: N802 (http.server's name)
        self._dispatch(head=False)

    def do_HEAD(self) -> None:  # noqa: N802
        self._dispatch(head=True)

    def _dispatch(self, *, head: bool) -> None:
        started = time.monotonic()
        split = urlsplit(self.path)
        path = unquote(split.path)
        status = 200
        try:
            if path.startswith("/api/"):
                payload, status = self._api(path, parse_qs(split.query))
                self._send_json(payload, status=status, head=head)
            else:
                status = self._static(path, head=head)
        except BadRequest as exc:
            status = 400
            self._send_json({"error": {"code": exc.code, "message": exc.message}}, status=400, head=head)
        except NotFound as exc:
            status = 404
            self._send_json({"error": {"code": "not_found", "message": exc.message}}, status=404, head=head)
        except UpstreamError as exc:
            status = 502
            print(f"upstream: {exc}", file=sys.stderr, flush=True)
            self._send_json(
                {
                    "error": {
                        "code": "upstream_error",
                        "message": "the upstream data source did not answer; try again later",
                    }
                },
                status=502,
                head=head,
            )
        except Exception as exc:  # keep the server alive, log one line
            status = 500
            print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
            self._send_json(
                {"error": {"code": "internal_error", "message": "internal error"}},
                status=500,
                head=head,
            )
        finally:
            if getattr(self.server, "log_requests", True):
                elapsed = (time.monotonic() - started) * 1000
                print(f"{self.command} {split.path} -> {status} {elapsed:.0f} ms", file=sys.stderr, flush=True)

    # --- API ---

    def _api(self, path: str, query: dict[str, list[str]]) -> tuple[dict[str, Any], int]:
        params = parse_params(query)
        if path == "/api/health":
            return self.service.health(), 200
        if path == "/api/meta":
            return self.service.meta(), 200
        if path == "/api/bm/repeaters":
            return (
                self.service.bm_nearby(
                    _float(params["lat"], "lat"),
                    _float(params["lon"], "lon"),
                    _float(params["radius"], "radius"),
                    _int(params["limit"], "limit", 200, 1, 500),
                ),
                200,
            )
        match = API_TALKGROUP.match(path)
        if match:
            return self.service.bm_talkgroups(int(match.group(1))), 200
        if path == "/api/repeaters/analog":
            return (
                self.service.analog_nearby(
                    _float(params["lat"], "lat"),
                    _float(params["lon"], "lon"),
                    _float(params["radius"], "radius"),
                    _int(params["limit"], "limit", 200, 1, 500),
                    include_simplex=_bool(params["include_simplex"]),
                    toned_only=_bool(params["toned_only"]),
                ),
                200,
            )
        if path == "/api/geocode":
            query_text = params["q"] or ""
            return self.service.geocode(query_text, params["lang"] or "en"), 200
        raise NotFound("no such API endpoint")

    # --- static files ---

    def _static(self, path: str, *, head: bool) -> int:
        if path in ("", "/"):
            path = "/index.html"
        if path.endswith("/"):
            path += "index.html"
        candidate = (self.web_root / path.lstrip("/")).resolve()
        if candidate != self.web_root and self.web_root not in candidate.parents:
            raise NotFound("no such file")
        if not candidate.is_file():
            raise NotFound("no such file")
        try:
            body = candidate.read_bytes()
        except OSError:
            raise NotFound("no such file")
        suffix = candidate.suffix.lower()
        ctype = CONTENT_TYPES.get(suffix) or mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        cache = "no-cache" if suffix == ".html" else "public, max-age=3600"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self._common_headers()
        self.end_headers()
        if not head:
            self.wfile.write(body)
        return 200

    # --- output ---

    def _send_json(self, payload: dict[str, Any], *, status: int = 200, head: bool = False) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}
        if len(body) >= GZIP_MIN_BYTES and "gzip" in (self.headers.get("Accept-Encoding") or "").lower():
            body = gzip.compress(body, compresslevel=6)
            headers["Content-Encoding"] = "gzip"
            headers["Vary"] = "Accept-Encoding"
        headers["Content-Length"] = str(len(body))
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self._common_headers()
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _common_headers(self) -> None:
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)

    def log_message(self, fmt: str, *args: Any) -> None:
        # One line per request is printed by _dispatch; keep the default quiet.
        pass


def make_server(
    config: Config,
    service: Service | None = None,
    *,
    log_requests: bool = True,
) -> ThreadingHTTPServer:
    service = service or Service(config)
    handler = type("BoundHandler", (Handler,), {"service": service, "web_root": WEB_ROOT})
    server = ThreadingHTTPServer((config.host, config.port), handler)
    server.daemon_threads = True
    server.log_requests = log_requests
    return server


def main(argv: list[str] | None = None) -> int:
    config = Config.from_env()
    parser = argparse.ArgumentParser(description="RadioFoundry codeplug builder and its data proxy")
    parser.add_argument("--host", default=config.host)
    parser.add_argument("--port", type=int, default=config.port)
    parser.add_argument("--cache-dir", default=str(config.cache_dir))
    args = parser.parse_args(argv)
    config = Config(
        host=args.host,
        port=args.port,
        cache_dir=Path(args.cache_dir),
        user_agent=config.user_agent,
        bm_ttl=config.bm_ttl,
        bm_timeout=config.bm_timeout,
        talkgroup_ttl=config.talkgroup_ttl,
        hearham_ttl=config.hearham_ttl,
        hearham_timeout=config.hearham_timeout,
        geocode_ttl=config.geocode_ttl,
        geocode_timeout=config.geocode_timeout,
        geocode_min_interval=config.geocode_min_interval,
        max_radius_km=config.max_radius_km,
        default_radius_km=config.default_radius_km,
        max_results=config.max_results,
        include_private_repeaters=config.include_private_repeaters,
    )
    server = make_server(config)
    shown = "localhost" if config.host in ("127.0.0.1", "0.0.0.0", "::") else config.host
    print(f"RadioFoundry-cp-builder {__version__}: http://{shown}:{config.port}/")
    print("  data: Brandmeister, HearHam and Nominatim (cached under %s)" % config.cache_dir)
    print("  Ctrl-C stops")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
