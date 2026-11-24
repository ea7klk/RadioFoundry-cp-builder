<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 The RadioFoundry-cp-builder Authors -->

# Design notes

## Why a server at all

The builder could be a single static page. It is not, for one reason:
Brandmeister, HearHam and Nominatim send no `Access-Control-Allow-Origin`, so a
page cannot read them. The alternatives were a public CORS proxy (third party,
rate-limited, sees every request) or a small local service. This is the service:

- it serves the page and its modules from the same origin as the API, so the
  Content-Security-Policy can stay `default-src 'self'` with no exceptions;
- it caches upstream answers on disk, which is what Brandmeister and Nominatim
  ask for, and turns three independent rate limits into one local one;
- it normalises each source once, so the browser never sees a 10 MB dump and
  never has to know which field is a transmit frequency.

The page works offline for everything that does not need a live search: packs,
the model, validation and both exports are computed in the browser.

## The pipeline

```
choices ──▶ build.js ──▶ RadioFoundry model ──▶ exportQdmr() ──▶ YAML
                                     └────────▶ exportAll()  ──▶ CSV set
```

`buildCodeplug(input)` is a pure function: no DOM, no fetch, no clock beyond the
timestamp in its result. That is what lets the Node tests check the same code the
browser runs, including a round trip through RadioFoundry's own importer.

The model is RadioFoundry's (`web/vendor/radiofoundry/codeplug/model.js`), not a
reimplementation: channel records, contact types, RX group lists, zones, APRS
configurations, the ID database header and validation all come from upstream.
If RadioFoundry changes a record layout, re-vendoring picks it up and the tests
that round-trip through `importQdmr` and `importAll` fail if the builder's
assumptions drift.

## Ordering rules

The order of operations is what makes the output predictable:

1. **DMR repeaters**, in the order the user selected them. Each one's talkgroups
   create contacts the first time they are seen; a talkgroup shared by two
   repeaters is one contact.
2. **DMR simplex channels**, from the selected plan: voice channels first, then
   access points if asked for, and per frequency one channel per chosen contact
   (TG 99, AllCall, or both). The plan's own channel names are kept and the
   contact is appended, so the name is the record of what the channel does.
3. **Analog repeaters**, in list order.
4. **Channel packs**, in `PACK_ORDER` (calling, licence-exempt, marine, APRS), so
   APRS channels are last and easy to find.
5. **APRS configuration**, pointing at the APRS frequency for the chosen region
   and country, or the first APRS channel if that frequency is not in the pack.
6. **Zones**, one per group, split at 80 channels, with the DMR zone first, then
   `DMR SIMPLEX`, `DMR ACCESS` and the rest.

Names are made unique as they are assigned, in that order: the first record to
claim a name keeps it and later ones get ` 2`, ` 3`, … The radio's 16-character
limit is applied to the name *including* the suffix.

## What is reported rather than silently fixed

The build result has three lists:

- `errors` — the file is not produced (no location, no selection, a table
  overflow, a failed export).
- `warnings` — the file is produced and something will differ from what was
  asked: a folded or shortened name, a talkgroup list cut at 32, a repeater
  without a tone, a pack from another region, a missing DMR ID.
- `notes` — what the builder did on its own behalf, such as adding the APRS
  position, or what qDMR could not carry.

The page shows all three. Nothing that changes a frequency, a tone or a contact
is applied without a line here.

## Extending it

- **A new channel pack**: add an entry to `PACKS` in `web/js/packs.js` with its
  regions, countries and `channels()`, add it to `PACK_ORDER`, and pin its
  values in `tests/packs.test.mjs`. If it is country-specific, add the country
  to `COUNTRIES` if it is missing.
- **A new DMR simplex plan**: add an entry to `PLANS` in `web/js/dmr.js` with its
  `simplex` and `access` tables, and pin its frequencies and names in
  `tests/dmr.test.mjs`. Keep the published names; the contact is appended by
  `planChannels`.
- **A new repeater source**: a module in `server/` that normalises to the shapes
  in `brandmeister.py` / `hearham.py`, a route in `server/app.py`, and a section
  in `web/index.html`. Keep `downlink_mhz` (the user's RX) and `uplink_mhz` (the
  user's TX) explicit.
- **A new export format**: RadioFoundry already has CHIRP and CSV importers; a
  new writer belongs upstream in the vendored tree, not here.

## Failure behaviour

- An upstream failure with a cached copy returns the copy with `stale: true`,
  and the page says the data is old. Without a copy, the route answers 502 with
  a JSON error and the page keeps whatever it had.
- A per-repeater talkgroup failure affects that repeater only; the rest of the
  selection still builds, and the row offers a retry.
- A malformed preference in `localStorage` is ignored rather than breaking the
  page.
- A missing location, a bad parameter or an out-of-range radius is a 400 with a
  machine-readable code; the page turns it into a sentence.
