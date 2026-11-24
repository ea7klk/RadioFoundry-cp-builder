# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""Fetching JSON from upstream APIs, with a size limit and honest errors."""

from __future__ import annotations

import gzip
import json
import socket
import urllib.error
import urllib.request
from typing import Any

# Large enough for the Brandmeister device list (~10 MB) and the HearHam dump (~10 MB),
# small enough that a wrong URL cannot fill memory.
MAX_BYTES = 40_000_000


class UpstreamError(RuntimeError):
    """An upstream API did not answer with usable JSON."""

    def __init__(self, url: str, message: str, status: int | None = None):
        super().__init__(message)
        self.url = url
        self.status = status

    def __str__(self) -> str:  # a single line for the log
        where = f" (HTTP {self.status})" if self.status else ""
        return f"{self.args[0]}{where}: {self.url}"


class UpstreamTooLarge(UpstreamError):
    pass


def fetch_json(
    url: str,
    *,
    timeout: float,
    user_agent: str,
    max_bytes: int = MAX_BYTES,
) -> Any:
    """GET a JSON document. Redirects are followed; TLS is verified by urllib."""
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(max_bytes + 1)
            encoding = (response.headers.get("Content-Encoding") or "").lower()
            status = response.status
    except urllib.error.HTTPError as exc:
        raise UpstreamError(url, f"upstream returned HTTP {exc.code}", exc.code) from exc
    except (urllib.error.URLError, socket.timeout, TimeoutError) as exc:
        reason = getattr(exc, "reason", exc)
        raise UpstreamError(url, f"upstream request failed: {reason}") from exc

    if status != 200:
        raise UpstreamError(url, f"upstream returned HTTP {status}", status)
    if len(raw) > max_bytes:
        raise UpstreamTooLarge(url, f"upstream response exceeds {max_bytes} bytes")
    if encoding == "gzip":
        try:
            raw = gzip.decompress(raw)
        except OSError as exc:
            raise UpstreamError(url, "upstream sent a broken gzip body") from exc
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise UpstreamError(url, "upstream did not send JSON") from exc
