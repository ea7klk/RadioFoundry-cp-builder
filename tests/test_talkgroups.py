# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""The talkgroup index: where an id says a talkgroup lives, and the filters."""

from __future__ import annotations

import pytest

from server.service import BadRequest, Service
from server.talkgroups import (
    AFRICA,
    ASIA,
    EUROPE,
    NORTH_AMERICA,
    OCEANIA,
    OTHER,
    SOUTH_AMERICA,
    WORLDWIDE,
    build_index,
    classify,
    country_of,
    facets,
)

from .conftest import FakeUpstream


@pytest.mark.parametrize(
    "tg,country,continent",
    [
        (214, "ES", EUROPE),
        (21429, "ES", EUROPE),
        (214012, "ES", EUROPE),
        (262, "DE", EUROPE),
        (2624, "DE", EUROPE),
        (235, "GB", EUROPE),
        (310, "US", NORTH_AMERICA),
        (3115, "US", NORTH_AMERICA),
        (302, "CA", NORTH_AMERICA),
        (334, "MX", NORTH_AMERICA),
        (505, "AU", OCEANIA),
        (530, "NZ", OCEANIA),
        (404, "IN", ASIA),
        (460, "CN", ASIA),
        (655, "ZA", AFRICA),
        (724, "BR", SOUTH_AMERICA),
        (748, "UY", SOUTH_AMERICA),
        (280, "CY", EUROPE),
        (286, "TR", EUROPE),
        (290, "GL", NORTH_AMERICA),
        (704, "GT", NORTH_AMERICA),
        (730, "CL", SOUTH_AMERICA),
    ],
)
def test_the_id_prefix_decides_the_country(tg, country, continent):
    assert country_of(tg) == (country, country_of(tg)[1], continent)
    assert classify(tg, "whatever")["country"] == country
    assert classify(tg, "whatever")["continent"] == continent


def test_the_system_talkgroups_have_no_place():
    for tg in (1, 2, 8, 9):
        result = classify(tg, "Local")
        assert result["continent"] == OTHER
        assert result["kind"] == "system"


def test_a_province_talkgroup_belongs_to_its_country():
    result = classify(21429, "Provincial Málaga")
    assert result == {"continent": EUROPE, "country": "ES", "country_name": "Spain", "kind": "country"}


@pytest.mark.parametrize(
    "tg,name,continent",
    [
        (91, "World-wide", WORLDWIDE),
        (901, "WW Tac 1", WORLDWIDE),
        (9101, "Worldwide Maritime", WORLDWIDE),
        (92, "Europe", EUROPE),
        (93, "North America", NORTH_AMERICA),
        (94, "Asia, Middle East", ASIA),
        (95, "Australia, New Zealand", OCEANIA),
        (969, "DMR-Caribbean", NORTH_AMERICA),
        (930, "PanHellenic Chat", EUROPE),
    ],
)
def test_international_ids_fall_back_to_the_name(tg, name, continent):
    assert classify(tg, name)["continent"] == continent


@pytest.mark.parametrize(
    "tg,name",
    [
        (98, "Radio Test"),
        (9990, "Parrot"),
        (913, "English"),
        (914, "Spanish"),
        (9480, "ICQ Podcast"),
        (973, "SOTA"),
        (910, "German"),
        (98003, "Reddit"),
    ],
)
def test_service_language_and_hobby_talkgroups_are_other(tg, name):
    result = classify(tg, name)
    assert result["continent"] == OTHER
    assert result["kind"] == "other"


def test_a_language_name_does_not_become_a_country():
    assert classify(913, "English")["country"] is None
    assert classify(91665, "RNLMC")["country"] is None


def test_the_index_is_sorted_and_drops_junk():
    index = build_index({"214": "Spain", "9": "Local", "x": "bad", "0": "zero", "2140": "  "})
    assert [item["tg"] for item in index] == [9, 214]
    assert build_index("not a map") == []


def test_facets_count_continents_and_countries():
    index = build_index({"214": "Spain", "21429": "Málaga", "262": "Deutschland", "91": "World-wide", "1": "Local"})
    result = facets(index)
    by_id = {entry["id"]: entry["count"] for entry in result["continents"]}
    assert by_id[EUROPE] == 3
    assert by_id[WORLDWIDE] == 1
    assert by_id[OTHER] == 1
    spain = [entry for entry in result["countries"] if entry["cc"] == "ES"][0]
    assert spain["count"] == 2
    assert spain["name"] == "Spain"


@pytest.fixture()
def talkgroup_service(config):
    raw = {
        "1": "Local",
        "9": "Local",
        "91": "World-wide",
        "92": "Europe",
        "98": "Radio Test",
        "214": "Spain",
        "21429": "Provincial Málaga",
        "21460": "BM-CAT",
        "262": "Deutschland",
        "2624": "Sachsen",
        "310": "USA Bridge",
        "9990": "Parrot",
    }
    return Service(config, fetcher=FakeUpstream(names=raw))


def test_the_list_comes_back_sorted_by_id(talkgroup_service):
    answer = talkgroup_service.talkgroups()
    assert [item["tg"] for item in answer["items"]] == [1, 9, 91, 92, 98, 214, 262, 310, 2624, 9990, 21429, 21460]


def test_a_name_search_narrows_the_list_and_its_facets(talkgroup_service):
    answer = talkgroup_service.talkgroups("malaga")
    assert [item["tg"] for item in answer["items"]] == [21429]
    countries = {entry["cc"]: entry["count"] for entry in answer["facets"]["countries"]}
    assert countries == {"ES": 1}, "the country list follows the search"
    assert answer["total"] == 12
    assert answer["matched"] == 1


def test_a_number_search_finds_a_province(talkgroup_service):
    answer = talkgroup_service.talkgroups("2142")
    assert 21429 in [item["tg"] for item in answer["items"]]


def test_a_country_word_finds_every_talkgroup_in_that_country(talkgroup_service):
    answer = talkgroup_service.talkgroups("Spain")
    assert [item["tg"] for item in answer["items"]] == [214, 21429, 21460]


def test_the_continent_filter(talkgroup_service):
    answer = talkgroup_service.talkgroups("", continent="europe")
    assert {item["tg"] for item in answer["items"]} == {92, 214, 21429, 21460, 262, 2624}


def test_the_other_filter_takes_what_has_no_place(talkgroup_service):
    answer = talkgroup_service.talkgroups("", continent="other")
    assert {item["tg"] for item in answer["items"]} == {1, 9, 98, 9990}


def test_the_country_filter(talkgroup_service):
    answer = talkgroup_service.talkgroups("", country="es")
    assert {item["tg"] for item in answer["items"]} == {214, 21429, 21460}


def test_a_continent_and_a_country_together(talkgroup_service):
    assert talkgroup_service.talkgroups("", continent="europe", country="DE")["matched"] == 2
    assert talkgroup_service.talkgroups("", continent="asia", country="DE")["matched"] == 0


def test_the_limit_is_reported_as_truncation(talkgroup_service):
    answer = talkgroup_service.talkgroups("", limit=3)
    assert len(answer["items"]) == 3
    assert answer["matched"] == 12
    assert answer["truncated"] is True


@pytest.mark.parametrize(
    "continent,country,code",
    [("mars", "", "bad_continent"), ("", "Spain", "bad_country"), ("", "E1", "bad_country")],
)
def test_bad_filters_are_named(talkgroup_service, continent, country, code):
    with pytest.raises(BadRequest) as caught:
        talkgroup_service.talkgroups("", continent=continent, country=country)
    assert caught.value.code == code
