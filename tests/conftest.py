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


def ure_item(**overrides: Any) -> dict[str, Any]:
    """A row of URE's band API: human text, as the map's own script reads it."""
    item = {
        "id": 1,
        "name": "ED7YAZ",
        "lat": 36.8,
        "lng": -4.5,
        "freq": "145.650 MHz",
        "shift": "-600 kHz",
        "mode": "FM",
        "has_echolink": False,
        "subtono": "",
        "canal": "RV58 - R5",
        "locator": "IM76SR",
        "provincia": "Malaga",
        "comunidad": "Andalucia",
        "location": "Sierra de Mijas",
        "icon_key": "R5",
    }
    item.update(overrides)
    return item


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

    def __init__(self, devices=None, talkgroups=None, names=None, repeaters=None, places=None, ure=None):
        self.devices = devices if devices is not None else [bm_device()]
        self.talkgroups = talkgroups or {214702: [{"talkgroup": "21429", "slot": "2", "repeaterid": "214702"}]}
        self.names = names or {"21429": "Provincial Málaga", "214": "Spain", "9": "Local"}
        self.repeaters = repeaters if repeaters is not None else [hearham_repeater()]
        if ure is None:
            ure = {
                "repe144": [
                    # same repeater as the HearHam fake, with the coordinator's tone
                    ure_item(name="ED7YAO", freq="145.725 MHz", shift="-600 kHz", subtono="77.0 Hz"),
                    ure_item(name="ED7YAZ", freq="145.650 MHz", shift="-600 kHz", subtono=""),
                    # a decimal comma and a spaced shift
                    ure_item(id=3, name="ED1ZBG", freq="145.712,5 MHz", shift="- 600 kHz", subtono="88.5 Hz", provincia="Ourense"),
                    # not analog voice
                    ure_item(id=4, name="ED7DS", freq="145.637,5 MHz", shift="", mode="D-Star"),
                    # a typo upstream: a frequency of 7.6
                    ure_item(id=5, name="ED7BAD", freq="7.6 MHz", shift="-7.6 MHz"),
                ],
                "repe432": [
                    ure_item(id=6, name="ED7UHF", freq="438.750 MHz", shift="-7.6 MHz", subtono="77.0 Hz", provincia="Malaga"),
                    ure_item(id=7, name="ED7UHF2", freq="439.350 MHz", shift="-9.9MHz", subtono="71.9 Hz", provincia="Malaga"),
                ],
            }
        self.ure = ure
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
        if "ure.es" in url:
            band = url.rsplit("band=", 1)[-1]
            if band not in self.ure:
                from server.upstream import UpstreamError

                raise UpstreamError(url, "no such band", 404)
            return {"success": True, "band": band, "items": self.ure[band]}
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
