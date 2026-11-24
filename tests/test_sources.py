# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""The Brandmeister and HearHam normalisers: direction, filtering, order."""

from __future__ import annotations

import pytest

from server.brandmeister import normalize_device, parse_mhz
from server.hearham import clean_tone, normalize_repeater

from .conftest import bm_device, hearham_repeater


def test_brandmeister_tx_is_the_users_receive_frequency():
    device = normalize_device(bm_device(tx="438.4500", rx="430.8500"))
    assert device["downlink_mhz"] == 438.45
    assert device["uplink_mhz"] == 430.85


def test_brandmeister_rejects_hotspots_and_bad_coordinates():
    assert normalize_device(bm_device(id=123)) is None
    assert normalize_device(bm_device(lat=None)) is None
    assert normalize_device(bm_device(lng=200)) is None
    assert normalize_device(bm_device(tx="")) is None
    assert normalize_device(bm_device(callsign="  ")) is None


def test_brandmeister_clamps_color_code_and_trims_text():
    device = normalize_device(bm_device(colorcode=99, callsign=" ed7zac ", city="MALAGA\n"))
    assert device["color_code"] == 15
    assert device["callsign"] == "ED7ZAC"
    assert device["city"] == "MALAGA"


def test_brandmeister_is_strict_about_implausible_frequencies():
    assert parse_mhz("438.4500") == 438.45
    assert parse_mhz("0") is None
    assert parse_mhz("99999") is None
    assert parse_mhz(None) is None


def test_hearham_frequency_plus_offset_is_the_users_transmit_frequency():
    repeater = normalize_repeater(hearham_repeater(frequency=145_725_000, offset=-600_000))
    assert repeater["downlink_mhz"] == 145.725
    assert repeater["uplink_mhz"] == 145.125
    assert repeater["offset_mhz"] == -0.6
    assert repeater["tx_tone"] == "82.5"


def test_hearham_drops_non_analog_modes():
    assert normalize_repeater(hearham_repeater(mode="DMR")) is None
    assert normalize_repeater(hearham_repeater(mode="D-STAR")) is None
    assert normalize_repeater(hearham_repeater(mode="YSF/FM")) is not None
    assert normalize_repeater(hearham_repeater(mode="P25/FM")) is not None


def test_hearham_tones():
    assert clean_tone("82.5") == "82.5"
    assert clean_tone(" 82,5 ") == "82.5"  # a decimal comma is the same tone
    assert clean_tone("D023N") == "D023N"
    assert clean_tone("") == ""
    assert clean_tone("CC1") == ""
    assert clean_tone("100.0") == "100.0"


def test_hearham_keeps_entries_without_a_tone():
    repeater = normalize_repeater(hearham_repeater(encode="", decode=""))
    assert repeater["tx_tone"] == ""


def test_hearham_rejects_missing_coordinates():
    assert normalize_repeater(hearham_repeater(latitude=None)) is None
    assert normalize_repeater(hearham_repeater(longitude=181)) is None


@pytest.mark.parametrize("offset", [0, -600_000, 600_000, 7_600_000])
def test_hearham_offsets_are_kept(offset):
    repeater = normalize_repeater(hearham_repeater(offset=offset))
    assert repeater["uplink_mhz"] == round((145_725_000 + offset) / 1e6, 6)
