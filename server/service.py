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
from .upstream import UpstreamError
from .geocode import Geocoder
from .geo import band_of, valid_lat, valid_lon
from .talkgroups import CONTINENTS, facets, fold
from .hearham import HearHam
from .ure import Ure
from .upstream import UpstreamError


SOURCES = ("ure", "hearham")


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
        self.ure = Ure(
            cache,
            ttl=config.ure_ttl,
            timeout=config.ure_timeout,
            user_agent=config.user_agent,
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
                    "id": "ure",
                    "name": "URE Spanish repeater map",
                    "url": "https://www.ure.es/repetidores/",
                    "note": "The Spanish national coordinator's coordinated list, "
                    "both bands, cached for 12 hours. Where it and HearHam describe "
                    "the same repeater, URE's record is kept.",
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
        band: str = "all",
        sources: tuple[str, ...] = SOURCES,
    ) -> dict[str, Any]:
        """Analog repeaters near a point, from every requested source.

        URE goes first: where it and HearHam describe the same repeater (same
        callsign and output frequency) URE's record wins, because it is the
        coordinator's own list and carries more tones. A tone only the other
        source has is kept rather than lost.
        """
        self._check_point(lat, lon)
        radius_km = self._check_radius(radius_km)
        limit = min(max(limit, 1), self.config.max_results)
        if band not in ("all", "vhf", "uhf"):
            raise BadRequest("bad_band", "band must be all, vhf or uhf")
        if not sources:
            raise BadRequest("bad_sources", "ask for at least one source")

        merged: list[dict[str, Any]] = []
        by_key: dict[tuple[str, int], dict[str, Any]] = {}
        used_sources: list[str] = []
        fetched: list[tuple[str, Any]] = []
        problems: list[str] = []

        for name in sources:
            try:
                if name == "ure":
                    found = self.ure.nearby(lat, lon, radius_km, self.config.max_results)
                    used_sources.append("ure")
                elif name == "hearham":
                    found, cached = self.hearham.nearby(
                        lat,
                        lon,
                        radius_km,
                        self.config.max_results,
                        include_simplex=include_simplex,
                        toned_only=toned_only,
                    )
                    used_sources.append("hearham")
                    fetched.append(("hearham", cached))
                else:
                    raise BadRequest("bad_sources", f"unknown source {name}")
            except BadRequest:
                raise
            except Exception:
                # One source down must not empty the list; if every source
                # fails there is nothing to show and the caller hears it.
                problems.append(name)
                continue

            for repeater in found:
                key = (repeater["callsign"], int(round(repeater["downlink_mhz"] * 1000)))
                if key in by_key:
                    kept = by_key[key]
                    if not kept.get("tx_tone") and repeater.get("tx_tone"):
                        kept["tx_tone"] = repeater["tx_tone"]
                        kept["tone_source"] = repeater.get("source")
                    continue
                by_key[key] = repeater
                merged.append(repeater)

        if problems and len(problems) == len(sources):
            raise UpstreamError(sources[0], "every analog repeater source failed", 502)

        merged.sort(key=lambda r: (r["distance_km"], r["callsign"]))
        counts = {"all": len(merged), "vhf": 0, "uhf": 0}
        by_source: dict[str, int] = {}
        for repeater in merged:
            counts[band_of(repeater["downlink_mhz"])] += 1
            by_source[repeater.get("source", "?")] = by_source.get(repeater.get("source", "?"), 0) + 1

        if band != "all":
            merged = [repeater for repeater in merged if band_of(repeater["downlink_mhz"]) == band]
        if toned_only:
            merged = [repeater for repeater in merged if repeater.get("tx_tone")]
        kept = merged[:limit]

        meta = fetched[0][1].meta() if fetched else {
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "stale": False,
        }
        if any(entry.meta()["stale"] for _, entry in fetched):
            meta["stale"] = True
        return {
            "repeaters": kept,
            "count": len(kept),
            "counts": counts,
            "sources": used_sources,
            "by_source": by_source,
            "failed_sources": problems,
            "radius_km": radius_km,
            "limit": limit,
            "band": band,
            "truncated": len(merged) > limit,
            **meta,
        }

    def talkgroups(
        self,
        query: str = "",
        continent: str = "all",
        country: str = "",
        limit: int = 250,
    ) -> dict[str, Any]:
        """The Brandmeister talkgroup list, filtered by text, continent and country.

        The facets (continents, countries and their counts) are computed on the
        text-filtered set, so narrowing by name narrows the country list with it.
        """
        index, stale = self.bm.talkgroup_index()
        known = {cid for cid, _ in CONTINENTS}
        if continent and continent != "all" and continent not in known:
            raise BadRequest("bad_continent", "unknown continent")
        if country and not (len(country) == 2 and country.isalpha()):
            raise BadRequest("bad_country", "country must be a two-letter code")
        text = " ".join(query.split())
        if len(text) > 80:
            raise BadRequest("bad_query", "query is too long")

        found = index
        if text:
            # Rank: the name starts with what was typed, then contains it, then
            # matched only through its country, then the id.
            needle = fold(text)
            digits = "".join(char for char in text if char.isdigit())

            def rank(item: dict[str, Any]) -> int | None:
                name = fold(item["name"])
                if name.startswith(needle):
                    return 0
                if needle in name:
                    return 1
                if needle in fold(item.get("country_name") or ""):
                    return 2
                if digits and digits in str(item["tg"]):
                    return 3
                return None

            ranked = [(rank(item), item) for item in index]
            found = [pair for pair in ranked if pair[0] is not None]
            found.sort(key=lambda pair: (pair[0], pair[1]["tg"]))
            facets_for_search = facets(item for _, item in found)
            found = [item for _, item in found]
        else:
            facets_for_search = None
        if facets_for_search is None:
            facets_for_search = facets(found)
        if continent and continent != "all":
            found = [item for item in found if item["continent"] == continent]
        if country:
            found = [item for item in found if item.get("country") == country.upper()]

        # Without a query the id order is the one operators know; with one, the
        # order is the rank above.
        if not text:
            found = sorted(found, key=lambda item: item["tg"])
        limit = min(max(int(limit), 1), self.config.max_results)
        return {
            "items": found[:limit],
            "matched": len(found),
            "total": len(index),
            "limit": limit,
            "truncated": len(found) > limit,
            "facets": facets_for_search,
            "stale": stale,
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
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
        "band": one("band"),
        "sources": one("sources"),
        "continent": one("continent"),
        "country": one("country"),
    }
