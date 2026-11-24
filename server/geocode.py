# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""Place search through Nominatim, used only when the user asks for a city.

Nominatim's usage policy asks for an identifying User-Agent, a low request rate
and caching; this module does all three. The browser never talks to Nominatim
directly, so its referrer and the user's address stay out of the request.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable

from .cache import JsonCache
from .upstream import UpstreamError, fetch_json

SEARCH_URL = "https://nominatim.openstreetmap.org/search"

Fetcher = Callable[..., Any]


class Geocoder:
    def __init__(
        self,
        cache: JsonCache,
        *,
        ttl: int,
        timeout: float,
        user_agent: str,
        min_interval: float = 1.1,
        fetcher: Fetcher = fetch_json,
    ):
        self.cache = cache
        self.ttl = ttl
        self.timeout = timeout
        self.user_agent = user_agent
        self.min_interval = min_interval
        self.fetcher = fetcher
        self._lock = threading.Lock()
        self._last_call = 0.0

    def _wait(self) -> None:
        with self._lock:
            wait = self.min_interval - (time.monotonic() - self._last_call)
            if wait > 0:
                time.sleep(wait)
            self._last_call = time.monotonic()

    def search(self, query: str, lang: str = "en") -> list[dict[str, Any]]:
        key = f"nominatim:{lang}:{query.casefold()}"
        cached = self.cache.get(key, self.ttl, lambda: self._fetch(query, lang))
        raw = cached.data
        if not isinstance(raw, list):
            raise UpstreamError(SEARCH_URL, "Nominatim answer is not a list")
        out: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in raw:
            if not isinstance(item, dict):
                continue
            try:
                lat = float(item["lat"])
                lon = float(item["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            display = " ".join(str(item.get("display_name") or "").split())
            if not display or display in seen:
                continue
            seen.add(display)
            address = item.get("address") if isinstance(item.get("address"), dict) else {}
            out.append(
                {
                    "name": " ".join(str(item.get("name") or "").split())[:80],
                    "display_name": display[:180],
                    "lat": round(lat, 6),
                    "lon": round(lon, 6),
                    "type": str(item.get("type") or "")[:32],
                    "country_code": str(address.get("country_code") or "").upper()[:2],
                }
            )
            if len(out) >= 8:
                break
        return out

    def _fetch(self, query: str, lang: str) -> Any:
        self._wait()
        url = (
            f"{SEARCH_URL}?format=jsonv2&limit=8&addressdetails=1"
            f"&accept-language={lang}&q={_quote(query)}"
        )
        return self.fetcher(url, timeout=self.timeout, user_agent=self.user_agent)


def _quote(value: str) -> str:
    from urllib.parse import quote

    return quote(value, safe="")
