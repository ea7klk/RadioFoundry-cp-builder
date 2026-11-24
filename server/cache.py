# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""A small JSON file cache with per-key locks and stale-if-error."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass(frozen=True)
class Cached:
    data: Any
    fetched_at: float
    stale: bool = False

    def meta(self) -> dict[str, Any]:
        return {
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.fetched_at)),
            "stale": self.stale,
        }


class JsonCache:
    """One JSON document per key, kept under ``root``.

    A loader that fails does not throw away a usable older copy: the caller gets
    that copy with ``stale=True`` so the page can say the data is old instead of
    showing an empty map.
    """

    def __init__(self, root: Path | str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def _lock(self, key: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def _path(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]
        return self.root / f"{digest}.json"

    def _read(self, path: Path) -> Cached | None:
        try:
            with path.open("r", encoding="utf-8") as handle:
                doc = json.load(handle)
            fetched_at = float(doc["fetched_at"])
            return Cached(doc["data"], fetched_at, False)
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def _write(self, path: Path, key: str, data: Any, fetched_at: float) -> None:
        payload = {"key": key, "fetched_at": fetched_at, "data": data}
        fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=self.root)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def get(self, key: str, ttl: float, loader: Callable[[], Any]) -> Cached:
        with self._lock(key):
            path = self._path(key)
            entry = self._read(path)
            now = time.time()
            if entry and now - entry.fetched_at < ttl:
                return entry
            try:
                data = loader()
            except Exception:
                if entry:
                    return Cached(entry.data, entry.fetched_at, True)
                raise
            self._write(path, key, data, now)
            return Cached(data, now, False)

