# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""Cache behaviour: TTL reuse, stale-if-error, atomic writes."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from server.cache import JsonCache
from server.upstream import UpstreamError


def test_a_second_call_within_the_ttl_does_not_load_again(tmp_path: Path):
    cache = JsonCache(tmp_path)
    loads = []

    def loader():
        loads.append(1)
        return {"n": len(loads)}

    first = cache.get("k", 60, loader)
    second = cache.get("k", 60, loader)
    assert first.data == {"n": 1}
    assert second.data == {"n": 1}
    assert len(loads) == 1


def test_an_expired_entry_is_loaded_again(tmp_path: Path):
    cache = JsonCache(tmp_path)
    loads = []

    def loader():
        loads.append(1)
        return {"n": len(loads)}

    cache.get("k", 0, loader)
    assert cache.get("k", 0, loader).data == {"n": 2}


def test_a_failed_load_serves_the_older_copy_marked_stale(tmp_path: Path):
    cache = JsonCache(tmp_path)
    cache.get("k", 0, lambda: {"n": 1})

    def broken():
        raise UpstreamError("https://example.invalid", "boom", 503)

    entry = cache.get("k", 0, broken)
    assert entry.data == {"n": 1}
    assert entry.stale is True


def test_a_failed_load_without_an_older_copy_raises(tmp_path: Path):
    cache = JsonCache(tmp_path)

    def broken():
        raise UpstreamError("https://example.invalid", "boom", 503)

    with pytest.raises(UpstreamError):
        cache.get("k", 0, broken)


def test_a_corrupt_file_is_ignored(tmp_path: Path):
    cache = JsonCache(tmp_path)
    cache.get("k", 60, lambda: {"n": 1})
    for path in tmp_path.glob("*.json"):
        path.write_text("{not json", encoding="utf-8")
    assert cache.get("k", 60, lambda: {"n": 2}).data == {"n": 2}


def test_entries_are_written_atomically(tmp_path: Path):
    cache = JsonCache(tmp_path)
    cache.get("k", 60, lambda: {"n": 1})
    files = list(tmp_path.glob("*.json"))
    assert len(files) == 1
    document = json.loads(files[0].read_text(encoding="utf-8"))
    assert document["key"] == "k"
    assert document["data"] == {"n": 1}
    assert not list(tmp_path.glob(".tmp-*"))
