# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""Brandmeister (Halligan API v2) repeaters, distances and static talkgroups.

Every device object is normalised once per cache period. Brandmeister's ``tx``
is what the repeater transmits (the user's receive frequency) and ``rx`` is what
it receives (the user's transmit frequency); the API's own examples and
cross-checks against HearHam repeater entries agree. The names in this module
say ``downlink`` and ``uplink`` so the direction cannot be misread later.
"""

from __future__ import annotations

from typing import Any, Callable

from .cache import Cached, JsonCache
from .geo import haversine_km, round_km, valid_lat, valid_lon
from .upstream import UpstreamError, fetch_json

DEVICES_URL = "https://api.brandmeister.network/v2/device?repeater=true"
DEVICE_TALKGROUPS_URL = "https://api.brandmeister.network/v2/device/{id}/talkgroup"
TALKGROUPS_URL = "https://api.brandmeister.network/v2/talkgroup"

Fetcher = Callable[..., Any]


def _number(value: Any) -> float | None:
    try:
        text = str(value).strip().replace(",", ".")
        if not text:
            return None
        return float(text)
    except (TypeError, ValueError):
        return None


def _integer(value: Any) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def parse_mhz(value: Any) -> float | None:
    mhz = _number(value)
    if mhz is None or not (1.0 <= mhz <= 3000.0):
        return None
    return round(mhz, 6)


def normalize_device(raw: dict[str, Any]) -> dict[str, Any] | None:
    """A compact, JSON-safe repeater, or None when it cannot be a repeater."""
    device_id = _integer(raw.get("id"))
    if device_id is None or not (100000 <= device_id <= 999999):
        return None
    downlink = parse_mhz(raw.get("tx"))
    uplink = parse_mhz(raw.get("rx"))
    lat = _number(raw.get("lat"))
    lon = _number(raw.get("lng"))
    callsign = " ".join(str(raw.get("callsign") or "").split()).upper()
    if (
        not callsign
        or downlink is None
        or uplink is None
        or lat is None
        or lon is None
        or not valid_lat(lat)
        or not valid_lon(lon)
    ):
        return None
    return {
        "id": device_id,
        "callsign": callsign[:16],
        "city": " ".join(str(raw.get("city") or "").split())[:80],
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "downlink_mhz": downlink,
        "uplink_mhz": uplink,
        "color_code": max(0, min(15, _integer(raw.get("colorcode")) or 0)),
        "status": _integer(raw.get("status")),
        "last_seen": str(raw.get("last_seen") or "")[:32],
        "pep_w": _integer(raw.get("pep")),
        "agl_m": _integer(raw.get("agl")),
        "linkname": " ".join(str(raw.get("linkname") or "").split())[:60],
    }


class Brandmeister:
    def __init__(
        self,
        cache: JsonCache,
        *,
        ttl: int,
        talkgroup_ttl: int,
        timeout: float,
        user_agent: str,
        fetcher: Fetcher = fetch_json,
    ):
        self.cache = cache
        self.ttl = ttl
        self.talkgroup_ttl = talkgroup_ttl
        self.timeout = timeout
        self.user_agent = user_agent
        self.fetcher = fetcher

    def devices(self) -> Cached:
        def load() -> list[dict[str, Any]]:
            raw = self.fetcher(DEVICES_URL, timeout=self.timeout, user_agent=self.user_agent)
            if not isinstance(raw, list):
                raise UpstreamError(DEVICES_URL, "Brandmeister device list is not a list")
            seen: set[int] = set()
            out: list[dict[str, Any]] = []
            for item in raw:
                if not isinstance(item, dict):
                    continue
                device = normalize_device(item)
                if device is None or device["id"] in seen:
                    continue
                seen.add(device["id"])
                out.append(device)
            return out

        return self.cache.get("bm:devices:repeaters", self.ttl, load)

    def nearby(self, lat: float, lon: float, radius_km: float, limit: int) -> tuple[list[dict[str, Any]], Cached]:
        devices = self.devices()
        found: list[dict[str, Any]] = []
        for device in devices.data:
            distance = haversine_km(lat, lon, device["lat"], device["lon"])
            if distance > radius_km:
                continue
            found.append({**device, "distance_km": round_km(distance)})
        # Linked repeaters first, then nearest.
        found.sort(key=lambda d: (d["status"] != 3, d["distance_km"], d["callsign"]))
        return found[:limit], devices

    def talkgroup_names(self) -> tuple[dict[str, str], bool]:
        """Talkgroup id -> name. A failure here only costs nicer labels."""
        try:
            cached = self.cache.get(
                "bm:talkgroups",
                self.talkgroup_ttl,
                lambda: self.fetcher(TALKGROUPS_URL, timeout=self.timeout, user_agent=self.user_agent),
            )
        except Exception:
            return {}, True
        raw = cached.data
        if not isinstance(raw, dict):
            return {}, True
        names = {
            str(key): " ".join(str(value).split())[:40]
            for key, value in raw.items()
            if str(key).isdigit() and isinstance(value, str) and value.strip()
        }
        return names, cached.stale

    def talkgroups(self, device_id: int) -> tuple[list[dict[str, Any]], bool]:
        """Static talkgroups in the order Brandmeister returns them.

        That order is what "the first talkgroup of the repeater" means here: the
        first one the API lists, which the builder makes the channel's default
        contact.
        """
        url = DEVICE_TALKGROUPS_URL.format(id=device_id)
        cached = self.cache.get(
            f"bm:device:{device_id}:talkgroups",
            self.talkgroup_ttl,
            lambda: self.fetcher(url, timeout=self.timeout, user_agent=self.user_agent),
        )
        raw = cached.data
        if not isinstance(raw, list):
            raise UpstreamError(url, "Brandmeister talkgroup list is not a list")
        names, names_stale = self.talkgroup_names()
        out: list[dict[str, Any]] = []
        seen: set[int] = set()
        for item in raw:
            if not isinstance(item, dict):
                continue
            tg = _integer(item.get("talkgroup"))
            if tg is None or tg <= 0 or tg in seen:
                continue
            seen.add(tg)
            slot = _integer(item.get("slot"))
            out.append(
                {
                    "tg": tg,
                    "slot": slot if slot in (1, 2) else 0,
                    "name": names.get(str(tg), f"TG {tg}"),
                }
            )
        return out, (cached.stale or names_stale)
