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


def test_the_project_licence_is_the_unmodified_mit_text():
    """LICENSE stays byte-compatible with the MIT template so GitHub and SPDX
    tools detect it; attribution lives in NOTICE and the vendored tree."""
    licence = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert licence.startswith("MIT License\n")
    assert "Permission is hereby granted, free of charge" in licence
    assert 'THE SOFTWARE IS PROVIDED "AS IS"' in licence
    assert "The RadioFoundry Authors" not in licence, "attribution belongs in NOTICE"


def test_the_notice_carries_the_upstream_copyright():
    notice = (ROOT / "NOTICE").read_text(encoding="utf-8")
    assert "Copyright (c) 2026 The RadioFoundry Authors" in notice


# Every source file the project owns. The upstream files under web/vendor are
# checked by the notice tests above; LICENSE, NOTICE, package.json and the icon
# carry their licence in another way and are checked separately.
def project_files() -> list[Path]:
    files: list[Path] = [ROOT / "Makefile", ROOT / "Dockerfile", ROOT / "README.md", ROOT / "NOTICE", ROOT / "docker-compose.yml"]
    for pattern in ("server/*.py", "tests/*.py", "web/js/*.js", "web/*.html", "web/*.css", "docs/*.md", ".github/workflows/*.yml", ".gitignore", ".dockerignore", "pytest.ini"):
        files.extend(sorted(ROOT.glob(pattern)))
    return files


@pytest.mark.parametrize("path", project_files(), ids=lambda path: str(Path(path).relative_to(ROOT)))
def test_project_files_carry_an_spdx_line(path: Path):
    head = "\n".join(path.read_text(encoding="utf-8").splitlines()[:3])
    assert "SPDX-License-Identifier: MIT" in head, f"{path} has no SPDX line"


def test_package_manifest_declares_the_licence():
    import json

    manifest = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert manifest["license"] == "MIT"


def test_the_notice_credits_upstream_and_the_data_sources():
    notice = (ROOT / "NOTICE").read_text(encoding="utf-8")
    assert "MIT" in notice
    assert "RadioFoundry/RadioFoundry" in notice
    assert "docs/DATA-SOURCES.md" in notice
    assert "web/vendor/radiofoundry/VENDOR.md" in notice


def test_the_container_image_declares_its_licence():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert 'org.opencontainers.image.licenses="MIT"' in dockerfile
