# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""Spanish repeaters from URE's public repeater map.

The Unión de Radioaficionados Españoles publishes its coordinated repeater list
through the map at https://www.ure.es/repetidores/ , which loads one band at a
time from a JSON endpoint. URE is the national coordinator for Spain, so its
list carries the UHF repeaters (and their tones) that HearHam's community data
misses: on 2026-11-24 HearHam held 9 analog UHF entries for the whole country,
URE 87 in its 70 cm band alone.

The fields arrive as human text ("145.725 MHz", "- 7.6 MHz", "77.0 Hz",
"145.712,5 MHz"), so they are parsed rather than trusted. A frequency outside
28-1300 MHz is a data error upstream (one row carries "7.6 MHz") and is dropped.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from .cache import Cached, JsonCache
from .geo import haversine_km, round_km, valid_lat, valid_lon
from .upstream import UpstreamError, fetch_json

BANDS = ("repe144", "repe432")
BAND_URL = "https://www.ure.es/appure/repetidores-nuevos_test/api.php?band={band}"

Fetcher = Callable[..., Any]

# Repeaters live between 10 m and 23 cm; anything else is a typo upstream.
MIN_MHZ, MAX_MHZ = 28.0, 1300.0

_NUMBER = re.compile(r"-?\d+(?:[.,]\d+)?")
_ANALOG = ("FM",)


def _number(text: str) -> float | None:
    match = _NUMBER.search(str(text or "").replace(" ", ""))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", "."))
    except ValueError:
        return None


def _decimal(text: str) -> float | None:
    """Read a Spanish-notation number.

    URE writes "145.712,5 MHz": the dot separates whole MHz from a kHz part
    that carries a decimal comma, so the two separators cannot both be decimal
    points. A string with only a comma uses it as the decimal separator; one
    with only a dot uses that.
    """
    raw = re.sub(r"[^0-9,.+-]", "", str(text or ""))
    if not raw or not re.search(r"\d", raw):
        return None
    sign = -1.0 if raw.lstrip().startswith("-") else 1.0
    raw = raw.lstrip("+-")
    if "," in raw and "." in raw:
        whole, _, fraction = raw.rpartition(".")
        whole = whole.replace(".", "").replace(",", "")
        try:
            return sign * (float(whole) + float(fraction.replace(",", ".")) / 1000)
        except ValueError:
            return None
    try:
        return sign * float(raw.replace(",", "."))
    except ValueError:
        return None


def parse_frequency(text: Any) -> float | None:
    """'145.725 MHz', '145.712,5 MHz' -> MHz, or None when implausible."""
    mhz = _decimal(str(text or ""))
    if mhz is None or not (MIN_MHZ <= mhz <= MAX_MHZ):
        return None
    return round(mhz, 6)


def parse_shift(text: Any) -> float:
    """'-600 kHz', '- 7.6 MHz', '-9.9MHz', '' -> a shift in MHz."""
    raw = str(text or "").strip()
    if not raw:
        return 0.0
    value = _decimal(raw)
    if value is None:
        return 0.0
    lowered = raw.lower()
    if "khz" in lowered:
        return round(value / 1000, 6)
    if "mhz" in lowered:
        return round(value, 6)
    # No unit: an amateur shift is at most a few MHz, so anything from 100 up
    # is written in kHz ("-600" is -0.6 MHz, "-7.6" is -7.6 MHz).
    return round(value / 1000 if abs(value) >= 100 else value, 6)


def parse_tone(text: Any) -> str:
    """'77.0 Hz', '77 Hz' -> '77.0'; empty or a non-CTCSS code -> ''."""
    raw = str(text or "").strip()
    if not raw:
        return ""
    value = _number(raw)
    if value is None or not (30.0 <= value <= 300.0):
        return ""
    return f"{value:.1f}"


def is_analog_mode(mode: Any) -> bool:
    text = " ".join(str(mode or "").split()).upper()
    if not text.startswith("FM"):
        return False
    # FM Echolink is still FM; APRS on 2 m is packet, not a voice repeater.
    return "APRS" not in text


def normalize_item(item: dict[str, Any], band: str) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    callsign = " ".join(str(item.get("name") or "").split()).upper()
    downlink = parse_frequency(item.get("freq"))
    lat, lon = item.get("lat"), item.get("lng")
    if not callsign or downlink is None:
        return None
    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        return None
    if not valid_lat(lat) or not valid_lon(lon):
        return None
    shift = parse_shift(item.get("shift"))
    uplink = round(downlink + shift, 6)
    if not (MIN_MHZ <= uplink <= MAX_MHZ):
        return None
    mode = " ".join(str(item.get("mode") or "FM").split())[:24].upper()
    tone = parse_tone(item.get("subtono"))
    province = " ".join(str(item.get("provincia") or "").split())[:60]
    place = " ".join(str(item.get("location") or "").split())[:60]
    return {
        "id": item.get("id"),
        "callsign": callsign[:16],
        "city": province or place,
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "downlink_mhz": downlink,
        "uplink_mhz": uplink,
        "offset_mhz": round(uplink - downlink, 6),
        "tx_tone": tone,
        "rx_tone": "",
        "mode": mode,
        "digital_capable": False,
        "group": province,
        "power": "",
        "operational": 1,
        "restriction": "",
        "description": place,
        "source": "ure",
        "band": band,
        "channel": " ".join(str(item.get("canal") or "").split())[:20],
        "locator": " ".join(str(item.get("locator") or "").split())[:8],
        "echolink": bool(item.get("has_echolink")) or "ECHOLINK" in mode,
    }


class Ure:
    def __init__(
        self,
        cache: JsonCache,
        *,
        ttl: int,
        timeout: float,
        user_agent: str,
        fetcher: Fetcher = fetch_json,
    ):
        self.cache = cache
        self.ttl = ttl
        self.timeout = timeout
        self.user_agent = user_agent
        self.fetcher = fetcher

    def _band(self, band: str) -> list[dict[str, Any]]:
        url = BAND_URL.format(band=band)

        def load() -> list[dict[str, Any]]:
            raw = self.fetcher(url, timeout=self.timeout, user_agent=self.user_agent)
            if not isinstance(raw, dict) or not raw.get("success"):
                raise UpstreamError(url, "URE answered without a repeater list")
            items = raw.get("items")
            if not isinstance(items, list):
                raise UpstreamError(url, "URE answered without a repeater list")
            out: list[dict[str, Any]] = []
            seen: set[tuple[str, float]] = set()
            for item in items:
                if not is_analog_mode(item.get("mode") if isinstance(item, dict) else None):
                    continue
                repeater = normalize_item(item, band)
                if repeater is None:
                    continue
                key = (repeater["callsign"], repeater["downlink_mhz"])
                if key in seen:
                    continue
                seen.add(key)
                out.append(repeater)
            return out

        return self.cache.get(f"ure:{band}", self.ttl, load).data

    def repeaters(self) -> list[dict[str, Any]]:
        """Every analog URE repeater, both bands. A band that fails is skipped
        if the other one answered, so a broken 2 m file cannot hide 70 cm."""
        out: list[dict[str, Any]] = []
        errors: list[Exception] = []
        for band in BANDS:
            try:
                out.extend(self._band(band))
            except Exception as exc:  # noqa: BLE001 - reported to the caller below
                errors.append(exc)
        if errors and not out:
            raise errors[0]
        return out

    def nearby(self, lat: float, lon: float, radius_km: float, limit: int) -> list[dict[str, Any]]:
        found: list[dict[str, Any]] = []
        for repeater in self.repeaters():
            distance = haversine_km(lat, lon, repeater["lat"], repeater["lon"])
            if distance > radius_km:
                continue
            found.append({**repeater, "is_repeater": abs(repeater["offset_mhz"]) > 1e-6, "distance_km": round_km(distance)})
        found.sort(key=lambda r: (r["distance_km"], r["callsign"]))
        return found[:limit]
