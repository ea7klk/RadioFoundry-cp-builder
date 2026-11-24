# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""URE's Spanish repeater map: the human text it publishes, and the merge with
HearHam that decides which record a repeater gets."""

from __future__ import annotations

import pytest

from server.service import BadRequest, Service
from server.ure import is_analog_mode, normalize_item, parse_frequency, parse_shift, parse_tone

from .conftest import FakeUpstream, hearham_repeater, ure_item


@pytest.mark.parametrize(
    "text,mhz",
    [
        ("145.725 MHz", 145.725),
        ("145.712,5 MHz", 145.7125),
        ("438.900 MHz", 438.9),
        ("145.7MHz", 145.7),
        ("  145.725   MHz ", 145.725),
    ],
)
def test_frequencies_are_read_from_the_text_ure_publishes(text, mhz):
    assert parse_frequency(text) == mhz


@pytest.mark.parametrize("text", ["", None, "7.6", "7.6 MHz", "9999 MHz", "abc"])
def test_implausible_frequencies_are_refused(text):
    assert parse_frequency(text) is None


@pytest.mark.parametrize(
    "text,mhz",
    [
        ("-600 kHz", -0.6),
        ("- 600 kHz", -0.6),
        ("-7.6 MHz", -7.6),
        ("- 7.6 MHz", -7.6),
        ("-7.6MHz", -7.6),
        ("-7.6 Mhz", -7.6),
        ("+600 kHz", 0.6),
        ("+1.6 MHz", 1.6),
        ("", 0.0),
        (None, 0.0),
        ("-600", -0.6),
    ],
)
def test_shifts_are_read_in_either_unit_and_spelling(text, mhz):
    assert parse_shift(text) == mhz


@pytest.mark.parametrize(
    "text,tone",
    [("77.0 Hz", "77.0"), ("77 Hz", "77.0"), ("88,5 Hz", "88.5"), ("123.0", "123.0"), ("", ""), ("CC1", ""), ("999 Hz", "")],
)
def test_tones_are_ctcss_or_nothing(text, tone):
    assert parse_tone(text) == tone


@pytest.mark.parametrize("mode", ["FM", "FM ", "FM Echolink", "fm"])
def test_analog_voice_modes_are_kept(mode):
    assert is_analog_mode(mode) is True


@pytest.mark.parametrize("mode", ["D-Star", "DMR", "C4FM", "APRS", "", None])
def test_digital_and_packet_modes_are_dropped(mode):
    assert is_analog_mode(mode) is False


def test_an_item_becomes_a_channel_sized_repeater():
    repeater = normalize_item(ure_item(freq="438.750 MHz", shift="-7.6 MHz", subtono="77.0 Hz"), "repe432")
    assert repeater["callsign"] == "ED7YAZ"
    assert repeater["downlink_mhz"] == 438.75
    assert repeater["uplink_mhz"] == 431.15
    assert repeater["offset_mhz"] == -7.6
    assert repeater["tx_tone"] == "77.0"
    assert repeater["rx_tone"] == ""
    assert repeater["source"] == "ure"
    assert repeater["band"] == "repe432"
    assert repeater["city"] == "Malaga"


def test_an_item_without_coordinates_is_dropped():
    assert normalize_item(ure_item(lat=None), "repe144") is None
    assert normalize_item(ure_item(lng="x"), "repe144") is None


def test_a_shift_that_leaves_the_bands_is_dropped():
    assert normalize_item(ure_item(freq="28.500 MHz", shift="-7.6 MHz"), "repe144") is None


def test_both_bands_are_read_and_only_analog_voice_survives(config):
    service = Service(config, fetcher=FakeUpstream())
    calls = {repeater["callsign"] for repeater in service.ure.repeaters()}
    assert calls == {"ED7YAO", "ED7YAZ", "ED1ZBG", "ED7UHF", "ED7UHF2"}
    assert "ED7DS" not in calls, "D-Star is not an analog channel"
    assert "ED7BAD" not in calls, "a 7.6 MHz frequency is a typo, not a repeater"


def test_a_failing_band_does_not_hide_the_other(config):
    class TwoMetreOnly(FakeUpstream):
        def __call__(self, url, *, timeout, user_agent):
            if "band=repe432" in url:
                from server.upstream import UpstreamError

                raise UpstreamError(url, "gone", 500)
            return super().__call__(url, timeout=timeout, user_agent=user_agent)

    service = Service(config, fetcher=TwoMetreOnly())
    calls = {repeater["callsign"] for repeater in service.ure.repeaters()}
    assert "ED7YAZ" in calls
    assert "ED7UHF" not in calls


def test_ure_is_asked_first_and_its_record_wins(config):
    """URE is the coordinator: same callsign and output, URE's tone is kept."""
    service = Service(config, fetcher=FakeUpstream())
    answer = service.analog_nearby(36.72, -4.42, 100, 50)
    yaou = [repeater for repeater in answer["repeaters"] if repeater["callsign"] == "ED7YAO"]
    assert len(yaou) == 1, "the same repeater from two sources is one channel"
    assert yaou[0]["source"] == "ure"
    assert yaou[0]["tx_tone"] == "77.0", "URE says 77.0, HearHam 82.5"
    assert answer["sources"] == ["ure", "hearham"]


def test_a_tone_only_hearham_has_is_not_lost(config):
    repeaters = [hearham_repeater(callsign="ED7YAZ", frequency=145_650_000, offset=-600_000, encode="91.5")]
    service = Service(config, fetcher=FakeUpstream(repeaters=repeaters))
    answer = service.analog_nearby(36.72, -4.42, 100, 50)
    yaz = [repeater for repeater in answer["repeaters"] if repeater["callsign"] == "ED7YAZ"]
    assert len(yaz) == 1
    assert yaz[0]["source"] == "ure", "URE's record is kept"
    assert yaz[0]["tx_tone"] == "91.5", "but the tone only HearHam has is filled in"
    assert yaz[0]["tone_source"] == "hearham"


def test_both_bands_come_back_together(config):
    service = Service(config, fetcher=FakeUpstream())
    answer = service.analog_nearby(36.72, -4.42, 100, 50)
    assert answer["counts"] == {"all": 5, "vhf": 3, "uhf": 2}
    bands = {"uhf" if repeater["downlink_mhz"] >= 300 else "vhf" for repeater in answer["repeaters"]}
    assert bands == {"vhf", "uhf"}


@pytest.mark.parametrize("band,expected", [("vhf", 3), ("uhf", 2), ("all", 5)])
def test_the_band_filter_selects_one_band(config, band, expected):
    service = Service(config, fetcher=FakeUpstream())
    answer = service.analog_nearby(36.72, -4.42, 100, 50, band=band)
    assert answer["count"] == expected
    for repeater in answer["repeaters"]:
        if band == "uhf":
            assert repeater["downlink_mhz"] >= 300
        if band == "vhf":
            assert repeater["downlink_mhz"] < 300


def test_an_unknown_band_is_refused(config):
    service = Service(config, fetcher=FakeUpstream())
    with pytest.raises(BadRequest) as caught:
        service.analog_nearby(36.72, -4.42, 100, 50, band="shf")
    assert caught.value.code == "bad_band"


def test_one_source_can_be_asked_for_alone(config):
    service = Service(config, fetcher=FakeUpstream())
    answer = service.analog_nearby(36.72, -4.42, 100, 50, sources=("hearham",))
    assert answer["sources"] == ["hearham"]
    assert {repeater["source"] for repeater in answer["repeaters"]} == {"hearham"}


def test_ure_down_leaves_hearham_working(config):
    class NoUre(FakeUpstream):
        def __call__(self, url, *, timeout, user_agent):
            if "ure.es" in url:
                from server.upstream import UpstreamError

                raise UpstreamError(url, "down", 503)
            return super().__call__(url, timeout=timeout, user_agent=user_agent)

    service = Service(config, fetcher=NoUre())
    answer = service.analog_nearby(36.72, -4.42, 100, 50)
    assert answer["failed_sources"] == ["ure"]
    assert answer["count"] == 1
    assert answer["repeaters"][0]["source"] == "hearham"


def test_every_source_down_is_an_error(config):
    from server.upstream import UpstreamError

    class Dead(FakeUpstream):
        def __call__(self, url, *, timeout, user_agent):
            raise UpstreamError(url, "down", 503)

    service = Service(config, fetcher=Dead())
    with pytest.raises(UpstreamError):
        service.analog_nearby(36.72, -4.42, 100, 50)


def test_the_tone_filter_follows_the_merged_tone(config):
    service = Service(config, fetcher=FakeUpstream())
    answer = service.analog_nearby(36.72, -4.42, 100, 50, toned_only=True)
    assert answer["count"] == 4
    assert all(repeater["tx_tone"] for repeater in answer["repeaters"])
