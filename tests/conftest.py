# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""Shared fixtures: a fake upstream, a service and a live test server."""

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server.app import make_server  # noqa: E402
from server.config import Config  # noqa: E402
from server.service import Service  # noqa: E402


def bm_device(**overrides: Any) -> dict[str, Any]:
    device = {
        "id": 214702,
        "callsign": "ED7ZAC",
        "linkname": "MMDVM Host",
        "hardware": "MMDVM",
        "firmware": "1.0",
        "tx": "438.4500",
        "rx": "430.8500",
        "colorcode": 1,
        "status": 3,
        "lat": 36.60686,
        "lng": -4.59543,
        "city": "MALAGA",
        "pep": 10,
        "agl": 0,
        "last_seen": "2026-11-24 14:58:26",
    }
    device.update(overrides)
    return device


def hearham_repeater(**overrides: Any) -> dict[str, Any]:
    repeater = {
        "id": 24875,
        "callsign": "ED7YAO",
        "latitude": 36.933977,
        "longitude": -4.532547,
        "city": "Malaga",
        "group": "",
        "internet_node": "",
        "mode": "FM",
        "encode": "82.5",
        "decode": "82.5",
        "frequency": 145_725_000,
        "offset": -600_000,
        "description": "Subtono 82,5",
        "power": "unknown",
        "operational": 1,
        "restriction": "",
    }
    repeater.update(overrides)
    return repeater


class FakeUpstream:
    """A fetcher with canned answers, call counting and failure switches."""

    def __init__(self, devices=None, talkgroups=None, names=None, repeaters=None, places=None):
        self.devices = devices if devices is not None else [bm_device()]
        self.talkgroups = talkgroups or {214702: [{"talkgroup": "21429", "slot": "2", "repeaterid": "214702"}]}
        self.names = names or {"21429": "Provincial Málaga", "214": "Spain", "9": "Local"}
        self.repeaters = repeaters if repeaters is not None else [hearham_repeater()]
        self.places = places if places is not None else [
            {"lat": "36.7213", "lon": "-4.4214", "display_name": "Málaga, Andalucía, España",
             "name": "Málaga", "type": "administrative", "address": {"country_code": "es"}},
        ]
        self.calls: list[str] = []
        self.fail: set[str] = set()

    def __call__(self, url: str, *, timeout: float, user_agent: str):
        self.calls.append(url)
        if any(token in url for token in self.fail):
            from server.upstream import UpstreamError

            raise UpstreamError(url, "fake failure", 503)
        if "/v2/device?" in url:
            return self.devices
        if "/talkgroup" in url and "/v2/device/" in url:
            device_id = int(url.rsplit("/", 2)[-2])
            if device_id not in self.talkgroups:
                from server.upstream import UpstreamError

                raise UpstreamError(url, "fake failure", 503)
            return self.talkgroups[device_id]
        if url.rstrip("/").endswith("/v2/talkgroup"):
            return self.names
        if "hearham.com" in url:
            return self.repeaters
        if "nominatim" in url:
            return self.places
        from server.upstream import UpstreamError

        raise UpstreamError(url, "unexpected url", 404)


@pytest.fixture()
def fake() -> FakeUpstream:
    return FakeUpstream()


@pytest.fixture()
def config(tmp_path: Path) -> Config:
    return Config(cache_dir=tmp_path / "cache", geocode_min_interval=0.0, bm_timeout=1.0)


@pytest.fixture()
def service(config: Config, fake: FakeUpstream) -> Service:
    return Service(config, fetcher=fake)


@pytest.fixture()
def server(config: Config, service: Service):
    httpd = make_server(config, service, log_requests=False)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    host, port = httpd.server_address[:2]
    yield f"http://{host}:{port}"
    httpd.shutdown()
    httpd.server_close()


def get_json(url: str) -> tuple[int, dict[str, Any], dict[str, str]]:
    import urllib.error
    import urllib.request

    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read()
            return response.status, json.loads(body), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read()), dict(exc.headers)
