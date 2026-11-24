# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""Analog repeaters from the HearHam open repeater database.

HearHam publishes its repeater list as JSON at /api/repeaters/v1. Its
``frequency`` is the repeater's output, and ``offset`` is the shift the user's
radio applies (transmit = frequency + offset); ``encode`` is the tone the user
sends and ``decode`` the tone the repeater sends. We keep only entries that can
be programmed as an analog FM channel and pass the tone through for the client
to validate with the same parser the codeplug editor uses.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from .cache import Cached, JsonCache
from .geo import haversine_km, round_km, valid_lat, valid_lon
from .upstream import UpstreamError, fetch_json

SOURCE_URL = "https://hearham.com/api/repeaters/v1"

Fetcher = Callable[..., Any]

_TONE = re.compile(r"^(?:D?[0-7]{1,3}[NI]?|[0-9]{2,3}(?:\.[0-9])?)$")
_DIGITAL = ("DMR", "D-STAR", "DSTAR", "P25", "NXDN", "AX25", "M17")


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None  # NaN


def _integer(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def clean_tone(value: Any) -> str:
    """A tone as the radio stores it, or "" when the value is not one.

    A decimal comma ("82,5") is the same tone written differently, so it is
    normalised rather than dropped; "CC1" and "100,0" are not tones at all.
    """
    text = " ".join(str(value or "").split()).upper()
    text = re.sub(r"^(\d{2,3}),(\d)$", r"\1.\2", text)
    if not text or text in ("NONE", "OFF", "CSQ", "-"):
        return ""
    if len(text) > 8 or not _TONE.match(text):
        return ""
    return text


def clean_text(value: Any, limit: int = 400) -> str:
    text = " ".join(str(value or "").replace("\x00", " ").split())
    return text[:limit]


def normalize_mode(value: Any) -> tuple[str, bool]:
    """(mode as shown, whether it can carry analog FM)."""
    mode = " ".join(str(value or "").split()).upper()
    analog = "FM" in mode
    return mode[:24], analog


def normalize_repeater(raw: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    callsign = " ".join(str(raw.get("callsign") or "").split()).upper()
    frequency_hz = _number(raw.get("frequency"))
    offset_hz = _number(raw.get("offset")) or 0.0
    lat = _number(raw.get("latitude"))
    lon = _number(raw.get("longitude"))
    mode, analog = normalize_mode(raw.get("mode"))
    if (
        not callsign
        or not analog
        or frequency_hz is None
        or frequency_hz <= 0
        or lat is None
        or lon is None
        or not valid_lat(lat)
        or not valid_lon(lon)
    ):
        return None
    uplink_hz = frequency_hz + offset_hz
    if uplink_hz <= 0:
        return None
    digital = any(word in mode for word in _DIGITAL)
    return {
        "id": _integer(raw.get("id")),
        "callsign": callsign[:16],
        "city": clean_text(raw.get("city"), 80),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "downlink_mhz": round(frequency_hz / 1e6, 6),
        "uplink_mhz": round(uplink_hz / 1e6, 6),
        "offset_mhz": round(offset_hz / 1e6, 6),
        "tx_tone": clean_tone(raw.get("encode")),
        "rx_tone": clean_tone(raw.get("decode")),
        "mode": mode,
        "digital_capable": digital,
        "group": clean_text(raw.get("group"), 40),
        "power": clean_text(raw.get("power"), 20),
        "operational": _integer(raw.get("operational")),
        "restriction": clean_text(raw.get("restriction"), 20),
        "description": clean_text(raw.get("description")),
        "source": "hearham",
    }


class HearHam:
    def __init__(
        self,
        cache: JsonCache,
        *,
        ttl: int,
        timeout: float,
        user_agent: str,
        include_private: bool = False,
        fetcher: Fetcher = fetch_json,
    ):
        self.cache = cache
        self.ttl = ttl
        self.timeout = timeout
        self.user_agent = user_agent
        self.include_private = include_private
        self.fetcher = fetcher

    def repeaters(self) -> Cached:
        def load() -> list[dict[str, Any]]:
            raw = self.fetcher(SOURCE_URL, timeout=self.timeout, user_agent=self.user_agent)
            if not isinstance(raw, list):
                raise UpstreamError(SOURCE_URL, "HearHam repeater list is not a list")
            seen: set[tuple[str, float, float]] = set()
            out: list[dict[str, Any]] = []
            for item in raw:
                repeater = normalize_repeater(item)
                if repeater is None:
                    continue
                if repeater["operational"] == 0:
                    continue
                key = (repeater["callsign"], repeater["downlink_mhz"], repeater["uplink_mhz"])
                if key in seen:
                    continue
                seen.add(key)
                out.append(repeater)
            return out

        return self.cache.get("hearham:repeaters", self.ttl, load)

    def nearby(
        self,
        lat: float,
        lon: float,
        radius_km: float,
        limit: int,
        *,
        include_simplex: bool = False,
        toned_only: bool = False,
    ) -> tuple[list[dict[str, Any]], Cached]:
        repeaters = self.repeaters()
        found: list[dict[str, Any]] = []
        for repeater in repeaters.data:
            # the one dump serves both settings, so the privacy filter is applied per query
            if not self.include_private and repeater["restriction"].lower() == "private":
                continue
            is_repeater = abs(repeater["offset_mhz"]) > 0.000001
            if not include_simplex and not is_repeater:
                continue
            if toned_only and not repeater["tx_tone"]:
                continue
            distance = haversine_km(lat, lon, repeater["lat"], repeater["lon"])
            if distance > radius_km:
                continue
            found.append(
                {
                    **repeater,
                    "is_repeater": bool(is_repeater),
                    "distance_km": round_km(distance),
                }
            )
        found.sort(key=lambda r: (r["distance_km"], r["callsign"]))
        return found[:limit], repeaters
