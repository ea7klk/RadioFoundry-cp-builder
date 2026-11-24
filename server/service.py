# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""The application service: validate input, ask the providers, shape answers."""

from __future__ import annotations

import math
import time
from typing import Any

from . import __version__
from .brandmeister import Brandmeister
from .cache import JsonCache
from .config import Config
from .geocode import Geocoder
from .geo import valid_lat, valid_lon
from .hearham import HearHam
from .upstream import UpstreamError


class BadRequest(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class NotFound(Exception):
    def __init__(self, message: str = "not found"):
        super().__init__(message)
        self.message = message


def _float(value: str | None, name: str) -> float:
    if value is None or value == "":
        raise BadRequest("missing_parameter", f"{name} is required")
    try:
        number = float(value)
    except ValueError as exc:
        raise BadRequest("bad_parameter", f"{name} must be a number") from exc
    if not math.isfinite(number):
        raise BadRequest("bad_parameter", f"{name} must be a finite number")
    return number


def _int(value: str | None, name: str, default: int, low: int, high: int) -> int:
    if value is None or value == "":
        return default
    try:
        number = int(value)
    except ValueError as exc:
        raise BadRequest("bad_parameter", f"{name} must be an integer") from exc
    if not low <= number <= high:
        raise BadRequest("bad_parameter", f"{name} must be between {low} and {high}")
    return number


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


class Service:
    def __init__(self, config: Config, *, fetcher: Any | None = None):
        self.config = config
        self.started = time.time()
        cache = JsonCache(config.cache_dir)
        kwargs = {} if fetcher is None else {"fetcher": fetcher}
        self.bm = Brandmeister(
            cache,
            ttl=config.bm_ttl,
            talkgroup_ttl=config.talkgroup_ttl,
            timeout=config.bm_timeout,
            user_agent=config.user_agent,
            **kwargs,
        )
        self.hearham = HearHam(
            cache,
            ttl=config.hearham_ttl,
            timeout=config.hearham_timeout,
            user_agent=config.user_agent,
            include_private=config.include_private_repeaters,
            **kwargs,
        )
        self.geocoder = Geocoder(
            cache,
            ttl=config.geocode_ttl,
            timeout=config.geocode_timeout,
            user_agent=config.user_agent,
            min_interval=config.geocode_min_interval,
            **kwargs,
        )

    # --- answers ---

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "version": __version__,
            "uptime_s": round(time.time() - self.started, 1),
            "cache_dir": str(self.config.cache_dir),
        }

    def meta(self) -> dict[str, Any]:
        return {
            "version": __version__,
            "limits": {
                "max_radius_km": self.config.max_radius_km,
                "default_radius_km": self.config.default_radius_km,
                "max_results": self.config.max_results,
            },
            "sources": [
                {
                    "id": "brandmeister",
                    "name": "Brandmeister Halligan API v2",
                    "url": "https://api.brandmeister.network/docs",
                    "note": "Repeater list cached for 15 minutes, as Brandmeister asks. "
                    "'downlink' is the repeater's TX (your RX); 'uplink' is your TX.",
                },
                {
                    "id": "hearham",
                    "name": "HearHam open repeater database",
                    "url": "https://hearham.com/api/repeaters/v1",
                    "note": "Open repeater data, cached for 12 hours. Verify a repeater "
                    "and its tone before transmitting.",
                },
                {
                    "id": "nominatim",
                    "name": "OpenStreetMap Nominatim",
                    "url": "https://nominatim.openstreetmap.org/",
                    "note": "Place search only; one request per second, cached for 30 days.",
                },
            ],
        }

    def bm_nearby(self, lat: float, lon: float, radius_km: float, limit: int) -> dict[str, Any]:
        self._check_point(lat, lon)
        radius_km = self._check_radius(radius_km)
        limit = min(max(limit, 1), self.config.max_results)
        repeaters, cached = self.bm.nearby(lat, lon, radius_km, limit)
        return {
            "repeaters": repeaters,
            "count": len(repeaters),
            "radius_km": radius_km,
            "limit": limit,
            "truncated": len(repeaters) == limit,
            **cached.meta(),
        }

    def bm_talkgroups(self, device_id: int) -> dict[str, Any]:
        if not (100000 <= device_id <= 999999):
            raise BadRequest("bad_device", "device id must be a six-digit Brandmeister repeater id")
        talkgroups, stale = self.bm.talkgroups(device_id)
        return {
            "device_id": device_id,
            "talkgroups": talkgroups,
            "default_tg": talkgroups[0]["tg"] if talkgroups else None,
            "stale": stale,
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

    def analog_nearby(
        self,
        lat: float,
        lon: float,
        radius_km: float,
        limit: int,
        *,
        include_simplex: bool = False,
        toned_only: bool = False,
    ) -> dict[str, Any]:
        self._check_point(lat, lon)
        radius_km = self._check_radius(radius_km)
        limit = min(max(limit, 1), self.config.max_results)
        repeaters, cached = self.hearham.nearby(
            lat,
            lon,
            radius_km,
            limit,
            include_simplex=include_simplex,
            toned_only=toned_only,
        )
        return {
            "repeaters": repeaters,
            "count": len(repeaters),
            "radius_km": radius_km,
            "limit": limit,
            "truncated": len(repeaters) == limit,
            **cached.meta(),
        }

    def geocode(self, query: str, lang: str = "en") -> dict[str, Any]:
        query = " ".join(query.split())
        if len(query) < 2:
            raise BadRequest("bad_query", "type at least two characters")
        if len(query) > 120:
            raise BadRequest("bad_query", "query is too long")
        if not lang or len(lang) > 12 or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-" for c in lang):
            lang = "en"
        return {"query": query, "results": self.geocoder.search(query, lang)}

    # --- checks ---

    def _check_point(self, lat: float, lon: float) -> None:
        if not valid_lat(lat):
            raise BadRequest("bad_latitude", "latitude must be between -90 and 90")
        if not valid_lon(lon):
            raise BadRequest("bad_longitude", "longitude must be between -180 and 180")

    def _check_radius(self, radius_km: float) -> float:
        if not math.isfinite(radius_km) or radius_km <= 0:
            raise BadRequest("bad_radius", "radius must be greater than zero")
        if radius_km > self.config.max_radius_km:
            raise BadRequest("bad_radius", f"radius must not exceed {self.config.max_radius_km:g} km")
        return round(radius_km, 1)


def parse_params(query: dict[str, list[str]]) -> dict[str, str | None]:
    def one(name: str) -> str | None:
        values = query.get(name)
        return values[0] if values else None

    return {
        "lat": one("lat"),
        "lon": one("lon"),
        "radius": one("radius"),
        "limit": one("limit"),
        "q": one("q"),
        "lang": one("lang"),
        "include_simplex": one("include_simplex"),
        "toned_only": one("toned_only"),
    }
