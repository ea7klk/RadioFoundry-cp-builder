# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""Licence hygiene: the vendored RadioFoundry code keeps its notices.

FORKING.md (upstream) asks that copied files keep their SPDX and copyright
lines and that LICENSE, AUTHORS and CONTRIBUTORS travel with them. These tests
are the mechanism, so a re-vendor cannot quietly drop them.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "web" / "vendor" / "radiofoundry"
SPDX = re.compile(r"SPDX-License-Identifier:\s*MIT")
COPYRIGHT = re.compile(r"Copyright \(c\) 2026 The RadioFoundry Authors")


def vendored_sources() -> list[Path]:
    return sorted(VENDOR.rglob("*.js"))


def test_the_vendored_tree_has_sources():
    assert len(vendored_sources()) >= 18


@pytest.mark.parametrize("path", vendored_sources(), ids=lambda path: str(path.relative_to(ROOT)))
def test_each_vendored_file_keeps_its_notices(path: Path):
    head = "\n".join(path.read_text(encoding="utf-8").splitlines()[:3])
    assert SPDX.search(head), f"{path} lost its SPDX line"
    assert COPYRIGHT.search(head), f"{path} lost the upstream copyright line"


def test_the_upstream_licence_and_authors_travel_with_the_code():
    for name in ("LICENSE", "AUTHORS", "CONTRIBUTORS"):
        assert (VENDOR / name).is_file(), f"web/vendor/radiofoundry/{name} is missing"
    assert "MIT License" in (VENDOR / "LICENSE").read_text(encoding="utf-8")


def test_the_vendor_note_names_the_upstream_commit():
    note = (VENDOR / "VENDOR.md").read_text(encoding="utf-8")
    assert "RadioFoundry/RadioFoundry" in note
    assert re.search(r"\b[0-9a-f]{40}\b", note), "record the upstream commit in VENDOR.md"


def test_the_project_licence_keeps_the_upstream_notice():
    licence = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert "MIT License" in licence
    assert "The RadioFoundry Authors" in licence


@pytest.mark.parametrize(
    "path",
    [
        *sorted((ROOT / "server").glob("*.py")),
        *sorted((ROOT / "tests").glob("*.py")),
        ROOT / "Makefile",
        ROOT / "Dockerfile",
    ],
    ids=lambda path: str(Path(path).relative_to(ROOT)),
)
def test_project_files_carry_an_spdx_line(path: Path):
    head = path.read_text(encoding="utf-8").splitlines()[:2]
    assert any("SPDX-License-Identifier: MIT" in line for line in head), f"{path} has no SPDX line"
