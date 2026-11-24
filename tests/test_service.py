# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""The service layer: selection, ordering, validation and stale data."""

from __future__ import annotations

import pytest

from server.brandmeister import Brandmeister
from server.cache import JsonCache
from server.service import BadRequest, Service

from .conftest import FakeUpstream, bm_device, hearham_repeater


def test_nearby_returns_distances_nearest_first(service: Service):
    answer = service.bm_nearby(36.7213, -4.4214, 100, 10)
    assert answer["count"] == 1
    repeater = answer["repeaters"][0]
    assert repeater["callsign"] == "ED7ZAC"
    assert 15 < repeater["distance_km"] < 25


def test_nearby_respects_the_radius(service: Service):
    assert service.bm_nearby(40.0, -3.0, 50, 10)["count"] == 0


def test_nearby_clamps_the_limit_and_reports_truncation(config, monkeypatch):
    devices = [
        bm_device(id=214000 + n, callsign=f"ED7Z{n:02d}", lat=36.72 + n * 0.01, lng=-4.42)
        for n in range(1, 8)
    ]
    fake = FakeUpstream(devices=devices)
    service = Service(config, fetcher=fake)
    answer = service.bm_nearby(36.72, -4.42, 100, 3)
    assert answer["count"] == 3
    assert answer["truncated"] is True


@pytest.mark.parametrize(
    "lat,lon,radius,code",
    [
        (91, 0, 10, "bad_latitude"),
        (-91, 0, 10, "bad_latitude"),
        (0, 181, 10, "bad_longitude"),
        (0, 0, 0, "bad_radius"),
        (0, 0, -1, "bad_radius"),
        (0, 0, 10_000, "bad_radius"),
    ],
)
def test_bad_parameters_are_named(service: Service, lat, lon, radius, code):
    with pytest.raises(BadRequest) as caught:
        service.bm_nearby(lat, lon, radius, 10)
    assert caught.value.code == code


def test_talkgroups_keep_brandmeister_order_and_name_them(service: Service, fake: FakeUpstream):
    fake.talkgroups[214702] = [
        {"talkgroup": "21429", "slot": "2", "repeaterid": "214702"},
        {"talkgroup": "214", "slot": "1", "repeaterid": "214702"},
        {"talkgroup": "21429", "slot": "1", "repeaterid": "214702"},
        {"talkgroup": "0", "slot": "1", "repeaterid": "214702"},
    ]
    answer = service.bm_talkgroups(214702)
    assert [item["tg"] for item in answer["talkgroups"]] == [21429, 214]
    assert answer["talkgroups"][0]["name"] == "Provincial Málaga"
    assert answer["talkgroups"][0]["slot"] == 2
    assert answer["default_tg"] == 21429


def test_a_talkgroup_without_a_name_still_has_a_label(service: Service, fake: FakeUpstream):
    fake.talkgroups[214702] = [{"talkgroup": "999", "slot": "1", "repeaterid": "214702"}]
    assert service.bm_talkgroups(214702)["talkgroups"][0]["name"] == "TG 999"


def test_a_local_talkgroup_failure_returns_502_material(service: Service, fake: FakeUpstream):
    from server.upstream import UpstreamError

    fake.talkgroups.clear()
    with pytest.raises(UpstreamError):
        service.bm_talkgroups(214702)


def test_talkgroup_names_failing_does_not_fail_the_list(config):
    class NoNames(FakeUpstream):
        def __call__(self, url, *, timeout, user_agent):
            if url.rstrip("/").endswith("/v2/talkgroup"):
                from server.upstream import UpstreamError

                raise UpstreamError(url, "no names", 503)
            return super().__call__(url, timeout=timeout, user_agent=user_agent)

    service = Service(config, fetcher=NoNames())
    answer = service.bm_talkgroups(214702)
    assert answer["talkgroups"][0]["name"] == "TG 21429"


def test_a_bad_device_id_is_refused(service: Service):
    with pytest.raises(BadRequest) as caught:
        service.bm_talkgroups(42)
    assert caught.value.code == "bad_device"


def test_analog_search_filters_simplex_and_tones(config):
    repeaters = [
        hearham_repeater(id=1, callsign="ED7YAO", encode="82.5"),
        hearham_repeater(id=2, callsign="ED7YAP", encode="", offset=-600_000),
        hearham_repeater(id=3, callsign="ED7YAQ", encode="", offset=0),
        hearham_repeater(id=4, callsign="ED7YAR", encode="", offset=0),
        hearham_repeater(id=5, callsign="ED7YAS", encode="", mode="DMR"),
    ]
    service = Service(config, fetcher=FakeUpstream(repeaters=repeaters))
    only_repeaters = service.analog_nearby(36.72, -4.42, 100, 50, sources=("hearham",))
    assert {r["callsign"] for r in only_repeaters["repeaters"]} == {"ED7YAO", "ED7YAP"}
    everything = service.analog_nearby(36.72, -4.42, 100, 50, include_simplex=True, sources=("hearham",))
    assert {r["callsign"] for r in everything["repeaters"]} == {"ED7YAO", "ED7YAP", "ED7YAQ", "ED7YAR"}
    toned = service.analog_nearby(36.72, -4.42, 100, 50, include_simplex=True, toned_only=True, sources=("hearham",))
    assert [r["callsign"] for r in toned["repeaters"]] == ["ED7YAO"]


def test_private_repeaters_are_hidden_unless_asked_for(config):
    repeaters = [
        hearham_repeater(id=1, callsign="ED7YAO"),
        hearham_repeater(id=2, callsign="ED7YAP", restriction="private"),
    ]
    from dataclasses import replace

    service = Service(config, fetcher=FakeUpstream(repeaters=repeaters))
    assert service.analog_nearby(36.72, -4.42, 100, 50, sources=("hearham",))["count"] == 1
    open_service = Service(replace(config, include_private_repeaters=True), fetcher=FakeUpstream(repeaters=repeaters))
    assert open_service.analog_nearby(36.72, -4.42, 100, 50, sources=("hearham",))["count"] == 2


def test_stale_upstream_data_is_flagged(config):
    fake = FakeUpstream()
    service = Service(config, fetcher=fake)
    assert service.bm_nearby(36.72, -4.42, 100, 10)["stale"] is False
    fake.fail.add("/v2/device")
    stale = Service(config, fetcher=fake)
    # a fresh service reads the cache the first one wrote, so with a 0 TTL it must reload and fall back
    stale.bm.ttl = 0
    answer = stale.bm_nearby(36.72, -4.42, 100, 10)
    assert answer["count"] == 1
    assert answer["stale"] is True


def test_upstream_failure_without_a_cache_copy_is_reported(config):
    from dataclasses import replace

    from server.upstream import UpstreamError

    empty = Service(replace(config, cache_dir=config.cache_dir / "empty"), fetcher=FakeUpstream())
    empty.bm.fetcher = lambda *a, **k: (_ for _ in ()).throw(UpstreamError("https://api.brandmeister.network/v2/device", "down", 503))
    with pytest.raises(UpstreamError):
        empty.bm_nearby(36.72, -4.42, 100, 10)


def test_geocode_returns_places_and_trims_the_query(service: Service):
    answer = service.geocode("  Málaga  ", "es")
    assert answer["query"] == "Málaga"
    assert answer["results"][0]["country_code"] == "ES"
    assert answer["results"][0]["lat"] == 36.7213


def test_geocode_refuses_a_one_character_query(service: Service):
    with pytest.raises(BadRequest):
        service.geocode("M")


def test_geocode_ignores_a_bad_language_tag(service: Service, fake: FakeUpstream):
    service.geocode("Malaga", "not a language!")
    assert any("accept-language=en" in call for call in fake.calls)


def test_the_device_list_is_fetched_once_for_many_requests(service: Service, fake: FakeUpstream):
    service.bm_nearby(36.72, -4.42, 100, 10)
    service.bm_nearby(36.80, -4.30, 100, 10)
    assert sum(1 for call in fake.calls if "/v2/device?" in call) == 1
