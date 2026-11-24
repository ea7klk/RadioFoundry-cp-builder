# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""Configuration, read from the environment once at start-up."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Config:
    host: str = "127.0.0.1"
    port: int = 8080
    cache_dir: Path = Path("var/cache")
    user_agent: str = (
        "RadioFoundry-cp-builder/0.1 "
        "(+https://github.com/ea7klk/RadioFoundry-cp-builder)"
    )
    # Brandmeister asks clients not to poll its device list more than once every 15 minutes.
    bm_ttl: int = 900
    bm_timeout: float = 30.0
    talkgroup_ttl: int = 86400
    # The HearHam dump is ~10 MB; a long TTL keeps that off their server.
    hearham_ttl: int = 43200
    hearham_timeout: float = 45.0
    geocode_ttl: int = 2592000
    geocode_timeout: float = 15.0
    geocode_min_interval: float = 1.1
    max_radius_km: float = 300.0
    default_radius_km: float = 50.0
    max_results: int = 500
    include_private_repeaters: bool = False

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            host=os.environ.get("CPB_HOST", cls.host),
            port=_env_int("CPB_PORT", cls.port),
            cache_dir=Path(os.environ.get("CPB_CACHE_DIR", str(cls.cache_dir))),
            user_agent=os.environ.get("CPB_USER_AGENT", cls.user_agent),
            bm_ttl=_env_int("CPB_BM_TTL", cls.bm_ttl),
            bm_timeout=_env_float("CPB_BM_TIMEOUT", cls.bm_timeout),
            talkgroup_ttl=_env_int("CPB_TALKGROUP_TTL", cls.talkgroup_ttl),
            hearham_ttl=_env_int("CPB_HEARHAM_TTL", cls.hearham_ttl),
            hearham_timeout=_env_float("CPB_HEARHAM_TIMEOUT", cls.hearham_timeout),
            geocode_ttl=_env_int("CPB_GEOCODE_TTL", cls.geocode_ttl),
            geocode_timeout=_env_float("CPB_GEOCODE_TIMEOUT", cls.geocode_timeout),
            geocode_min_interval=_env_float("CPB_GEOCODE_MIN_INTERVAL", cls.geocode_min_interval),
            max_radius_km=_env_float("CPB_MAX_RADIUS_KM", cls.max_radius_km),
            default_radius_km=_env_float("CPB_DEFAULT_RADIUS_KM", cls.default_radius_km),
            max_results=_env_int("CPB_MAX_RESULTS", cls.max_results),
            include_private_repeaters=os.environ.get("CPB_INCLUDE_PRIVATE", "").lower()
            in ("1", "true", "yes"),
        )
