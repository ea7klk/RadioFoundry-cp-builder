# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""Geo helpers: distance and input checks. No external data."""

from __future__ import annotations

import math

EARTH_RADIUS_KM = 6371.0088


def valid_lat(value: float) -> bool:
    return math.isfinite(value) and -90.0 <= value <= 90.0


def valid_lon(value: float) -> bool:
    return math.isfinite(value) and -180.0 <= value <= 180.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def round_km(value: float) -> float:
    return round(value, 2)


# Repeaters are VHF below 300 MHz (6 m, 4 m, 2 m) and UHF above it (70 cm, 23 cm).
VHF_MAX_MHZ = 300.0


def band_of(mhz: float) -> str:
    return "vhf" if mhz < VHF_MAX_MHZ else "uhf"
