# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""The HTTP surface: routing, validation, headers, static files, gzip."""

from __future__ import annotations

import gzip
import json
import urllib.error
import urllib.request

import pytest

from .conftest import FakeUpstream, get_json


def test_health(server: str):
    status, body, _ = get_json(f"{server}/api/health")
    assert status == 200
    assert body["ok"] is True
    assert body["version"]


def test_meta_lists_the_sources(server: str):
    status, body, _ = get_json(f"{server}/api/meta")
    assert status == 200
    assert {source["id"] for source in body["sources"]} == {"brandmeister", "hearham", "ure", "nominatim"}
    assert body["limits"]["max_radius_km"] == 300


def test_bm_repeaters(server: str):
    status, body, _ = get_json(f"{server}/api/bm/repeaters?lat=36.72&lon=-4.42&radius=100&limit=10")
    assert status == 200
    assert body["repeaters"][0]["callsign"] == "ED7ZAC"
    assert body["repeaters"][0]["downlink_mhz"] == 438.45
    assert body["fetched_at"]


def test_talkgroups_route(server: str):
    status, body, _ = get_json(f"{server}/api/bm/devices/214702/talkgroups")
    assert status == 200
    assert body["default_tg"] == 21429


def test_analog_route(server: str):
    status, body, _ = get_json(f"{server}/api/repeaters/analog?lat=36.72&lon=-4.42&radius=100")
    assert status == 200
    assert body["count"] == 5
    assert body["counts"]["vhf"] == 3
    assert body["counts"]["uhf"] == 2


def test_analog_route_can_be_narrowed_to_one_band(server: str):
    status, body, _ = get_json(f"{server}/api/repeaters/analog?lat=36.72&lon=-4.42&radius=100&band=uhf")
    assert status == 200
    assert {repeater["callsign"] for repeater in body["repeaters"]} == {"ED7UHF", "ED7UHF2"}
    assert body["counts"]["vhf"] == 3, "the counts describe the search, not the filter"


def test_analog_route_rejects_an_unknown_band(server: str):
    status, body, _ = get_json(f"{server}/api/repeaters/analog?lat=36.72&lon=-4.42&radius=100&band=shf")
    assert status == 400
    assert body["error"]["code"] == "bad_band"


def test_analog_route_rejects_an_unknown_source(server: str):
    status, body, _ = get_json(f"{server}/api/repeaters/analog?lat=36.72&lon=-4.42&radius=100&sources=ure,repeaterbook")
    assert status == 400
    assert body["error"]["code"] == "bad_sources"


def test_geocode_route(server: str):
    status, body, _ = get_json(f"{server}/api/geocode?q=Malaga&lang=es")
    assert status == 200
    assert body["results"]


@pytest.mark.parametrize(
    "path,code",
    [
        ("/api/bm/repeaters?lat=abc&lon=0&radius=10", "bad_parameter"),
        ("/api/bm/repeaters?lon=0&radius=10", "missing_parameter"),
        ("/api/bm/repeaters?lat=0&lon=0&radius=9999", "bad_radius"),
        ("/api/geocode?q=x", "bad_query"),
        ("/api/bm/devices/12/talkgroups", "bad_device"),
    ],
)
def test_bad_requests_are_400_with_a_code(server: str, path, code):
    status, body, _ = get_json(f"{server}{path}")
    assert status == 400
    assert body["error"]["code"] == code


def test_unknown_api_route_is_404(server: str):
    status, body, _ = get_json(f"{server}/api/nope")
    assert status == 404
    assert body["error"]["code"] == "not_found"


def test_upstream_failure_is_502(server: str, fake: FakeUpstream):
    fake.fail.add("/v2/device")
    status, body, _ = get_json(f"{server}/api/bm/repeaters?lat=36.72&lon=-4.42&radius=100&limit=10")
    assert status == 502
    assert body["error"]["code"] == "upstream_error"


def test_index_is_served_with_a_csp(server: str):
    with urllib.request.urlopen(f"{server}/", timeout=10) as response:
        body = response.read().decode("utf-8")
        headers = dict(response.headers)
    assert response.status == 200
    assert "RadioFoundry CP Builder" in body
    assert "default-src 'self'" in headers["Content-Security-Policy"]
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Referrer-Policy"] == "no-referrer"


def test_javascript_is_served_with_the_right_type(server: str):
    with urllib.request.urlopen(f"{server}/js/app.js", timeout=10) as response:
        assert response.headers["Content-Type"].startswith("text/javascript")


@pytest.mark.parametrize(
    "path",
    ["/../server/config.py", "/%2e%2e/server/config.py", "/js/../../server/app.py"],
)
def test_path_traversal_is_refused(server: str, path: str):
    status, body, _ = get_json(f"{server}{path}")
    assert status == 404


def test_missing_static_file_is_404(server: str):
    status, _, _ = get_json(f"{server}/nope.js")
    assert status == 404


def test_large_json_is_gzipped_when_asked(server: str, fake: FakeUpstream):
    request = urllib.request.Request(
        f"{server}/api/meta",
        headers={"Accept-Encoding": "gzip", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        encoding = response.headers.get("Content-Encoding")
        body = response.read()
    assert encoding == "gzip"
    assert json.loads(gzip.decompress(body))["version"]


def test_head_has_no_body(server: str):
    request = urllib.request.Request(f"{server}/api/health", method="HEAD")
    with urllib.request.urlopen(request, timeout=10) as response:
        assert response.status == 200
        assert response.read() == b""
        assert int(response.headers["Content-Length"]) > 0


def test_a_json_error_is_still_json(server: str):
    try:
        urllib.request.urlopen(f"{server}/api/nope", timeout=10)
    except urllib.error.HTTPError as exc:
        assert exc.headers["Content-Type"].startswith("application/json")
