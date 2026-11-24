<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 The RadioFoundry-cp-builder Authors -->

# Vendored RadioFoundry codeplug code

The files in this directory are copied **verbatim** from RadioFoundry, MIT
licensed, and keep their original SPDX and copyright lines.

- Upstream: <https://github.com/RadioFoundry/RadioFoundry>
- Path upstream: `site/static/js/`
- Commit: `e62d0fcf272a9c08d501988c2976480d045e6304` (2026-11-24)
- Licence: MIT. `LICENSE`, `AUTHORS` and `CONTRIBUTORS` in this directory are
  the upstream copies.

## What is here and why

Only the dependency closure needed to build, validate and export a codeplug
without a browser-specific or WebUSB module:

| File | Used for |
|---|---|
| `codeplug/model.js` | Editing model, `newChannel`, `newContact`, `validate`, `encode` |
| `codeplug/records.js`, `image.js`, `fields.js` | Binary layouts, names, tones, frequencies |
| `codeplug/iddb.js`, `kv.js`, `channelmodes.js`, `modes.js` | The rest of the model's dependencies |
| `codeplug/mode_*.js`, `modebytes.js` | Channel-mode modules loaded by `modes.js` |
| `codeplug/qdmr.js`, `qdmrmodes.js`, `yaml.js` | qDMR YAML export and import |
| `codeplug/csv.js` | RadioFoundry CSV table export |
| `flasher/bytes.js` | Small byte helpers used by `kv.js` |

The editor UI (`site/static/js/editor/`), WebUSB transport, flasher and i18n
catalogues are **not** vendored. This project has its own UI and does not talk
to a radio; it hands a codeplug file to the official RadioFoundry editor.

## Updating

Re-run the closure copy from a fresh RadioFoundry checkout and update the
commit above. Do not edit vendored files: put changes in `web/js/` instead, and
send fixes that belong upstream to RadioFoundry.
