<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 The RadioFoundry-cp-builder Authors -->

# Data sources

Three live sources and a set of frequency tables. This page says exactly what
each one gives, what was checked, and where its data is thin, so a user can tell
a missing channel from a wrong one.

## Brandmeister — DMR repeaters and talkgroups

- **API**: Halligan API v2, <https://api.brandmeister.network/docs>, spec at
  `https://api.brandmeister.network/api-docs?api-docs.json` (OpenAPI 3.0.0,
  "Halligan API" 2.1.0).
- **Used endpoints**
  - `GET /v2/device?repeater=true` — every repeater seen in the last 30 days
    (3,348 devices on 2026-11-24; 137 in the Iberian box, 195 without
    coordinates). The API documentation asks clients not to poll the
    unfiltered device list more than once every 15 minutes, so the cache TTL is
    900 s.
  - `GET /v2/device/{id}/talkgroup` — the static talkgroups of one repeater.
  - `GET /v2/talkgroup` — id → name, for labels only. If it fails, the list
    still works with `TG <id>` labels.
- **Frequency direction**: in the device object `tx` is what the repeater
  transmits and `rx` what it receives. The user's receive frequency is therefore
  `tx` and the user's transmit frequency is `rx`. Checked against the same
  repeaters in HearHam, whose `frequency`/`offset` fields are independent
  (ED1ZAS: Brandmeister `tx 438.2250`, `rx 430.6250`; HearHam 438.225 MHz with
  a −7.6 MHz offset), and against the operator's own description of the
  repeater's shift.
- **Slots**: each static talkgroup row carries `slot` (1 or 2). It becomes that
  contact's **timeslot override** in the codeplug, because the slot is a property
  of the subscription at that repeater: the same talkgroup can be TS1 on one and
  TS2 on another. A talkgroup used on both slots by the selected repeaters gets
  two contact records (`… TS1`, `… TS2`), since a contact holds one override; the
  build output reports it.
- **"The first talkgroup"**: Brandmeister returns static talkgroups as an array
  with no documented order. The builder keeps the API's order and takes the
  first entry as the channel's default contact, which is what its own
  description promises. Where the order matters to you, check the build output,
  which names the talkgroup it chose.
- **Filtering**: a device needs a six-digit id, a callsign, coordinates inside
  valid ranges and both frequencies between 1 and 3000 MHz. Hotspots (shorter
  ids) are dropped, which is what `?repeater=true` is for.
- **Label**: `city` is free text and often holds a locator (`MALAGA, IM76QO`).

## HearHam — analog repeaters

- **API**: <https://hearham.com/api/repeaters/v1>, a JSON array of ~24,400
  entries (2026-11-24), about 10 MB.
- **Fields used**: `frequency` (the repeater's output), `offset` (the shift the
  user's radio applies, so user TX = `frequency + offset`), `encode` (the tone
  the user sends) and `decode` (the tone the repeater sends), `mode`, `city`,
  `latitude`, `longitude`, `operational`, `restriction`.
- **Filtering**: the entry must carry a mode that includes FM (so `FM`,
  `NFM`, `YSF/FM` and `P25/FM` qualify; DMR, D-STAR, P25, NXDN and AX.25 alone
  do not), coordinates, and a positive frequency. Entries with
  `operational: 0` are dropped. `restriction: private` entries are hidden by
  default (`CPB_INCLUDE_PRIVATE=1` shows them).
- **Tones**: passed through as text and validated by the RadioFoundry tone
  parser, so only CTCSS (67.0–300.0 Hz) and DCS (`D023N`, `D023I`) survive.
  Values such as `CC1`, `100,0` or `unknown` are dropped and counted; the build
  output says how many.
- **Coverage varies.** On 2026-11-24 the dump held 128 Spanish FM entries, 121
  with an offset and only 25 with an encode tone; the Canary and Balearic
  entries are sparse. This is why the "only repeaters with a tone" filter is
  off by default and why a repeater without a tone is flagged in the list and in
  the build output. Set a missing tone by hand in the RadioFoundry editor.
- **Licensing**: HearHam publishes the list as open repeater data and asks that
  it be used responsibly; several entries carry a provenance note in their
  description (for Spain, "Data sourced with permission from EA4T.es"). The
  builder caches the dump for 12 hours and identifies itself with a project
  User-Agent. Check HearHam's terms before redistributing the raw data.

HearHam's coverage is uneven: about 24,400 entries worldwide, 645 with a German
city and 274 with a Spanish one, of which only a fraction are FM repeaters with
tones. It is strongest in North America. That is why the builder also accepts a
repeater list from a file:

## Your own repeater list

A CSV or JSON file the user has the right to use — a national coordinator's
export, a club list, a licensed RepeaterBook export. It is read in the browser
with `web/js/repeaters.js` and never sent to the server. Columns are matched by
alias (`output`/`frequency`/`freq`/`rx_mhz`/`downlink_mhz`, `offset`/`shift`,
`tx`/`uplink_mhz`/`input`, `tone`/`ctcss`/`encode`, `lat`, `lon`, `city`,
`mode`); shifts may be in MHz, kHz or Hz. Rows without coordinates are kept but
not plotted; rows that cannot be an analog channel are skipped and counted.

This keeps the project out of any dataset whose licence forbids redistribution:
the operator brings the data, the builder only reads it.

RepeaterBook was considered as a built-in source and rejected: its API requires
an authenticating key and its terms do not allow a public proxy. ukrepeater.net
(the UK's RSGB ETCC data) was probed and is behind a bot challenge.

## URE — Spanish repeaters, both bands

- **Where**: the map at <https://www.ure.es/repetidores/> loads a band at a time
  from `https://www.ure.es/appure/repetidores-nuevos_test/api.php?band=repe144`
  (`repe432`, `repe1200`, `repe50`, `repe28`, `repeATV` also exist; this project
  reads `repe144` and `repe432`).
- **What it holds** (2026-11-24): 135 rows on 2 m and 126 on 70 cm, of which 122
  and 87 are FM; the rest are D-Star, DMR, C4FM and APRS, which are skipped
  because they are not analog FM channels.
- **Fields**: `name` (callsign), `freq` and `shift` as text, `subtono` as text,
  `mode`, `lat`/`lng`, `provincia`, `locator`, `canal` (the URE channel code,
  e.g. `RV58 - R5`), `has_echolink`.
- **Parsing**, because the text is not uniform:
  - `145.725 MHz`, `145.712,5 MHz` (Spanish notation: dot between MHz and a kHz
    part that carries a decimal comma), `438.900 MHz`.
  - `-600 kHz`, `- 600 kHz`, `-7.6 MHz`, `- 7.6 MHz`, `-7.6MHz`, `-7.6 Mhz`, and
    a bare `-600` meaning kHz.
  - `77.0 Hz`, `77 Hz`, `88,5 Hz`; anything outside 30–300 Hz is not CTCSS.
  - A frequency outside 28–1300 MHz is an upstream typo (one row carries
    `7.6 MHz`) and is dropped, as is a shift that would leave the band.
- **Why it is here**: it is the coordinator's own list, and it is the only
  source found with meaningful Spanish UHF analog coverage. RepeaterBook needs a
  key; ukrepeater.net is behind a bot challenge; the EA4T.es data HearHam
  republishes carries the same gaps.
- **Tone direction**: URE publishes one `subtono` per repeater, the tone the
  user sends, so it becomes the channel's **TX tone** and the receive tone stays
  empty.

## Merging the two repeater sources

`ure` is queried first. A repeater is identified by callsign and output
frequency rounded to the kHz, so the same repeater from both sources is one
channel: URE's record is kept, and if it has no tone but HearHam does, that tone
is filled in and marked (`tone_source`). The API reports `counts` per band,
`by_source`, and any `failed_sources`, so the page can say "VHF 11 · UHF 9, from
URE + HearHam".

## OpenStreetMap Nominatim — place search

- **API**: <https://nominatim.openstreetmap.org/search>, `format=jsonv2`,
  `addressdetails=1`, `limit=8`.
- Only called when the user searches for a city; results are cached for 30 days
  and requests are serialised to at most one per 1.1 s. The browser never talks
  to Nominatim, so no referrer or user address reaches it.
- Usage policy: <https://operations.osmfoundation.org/policies/nominatim/>.

## Frequency tables

These are compiled data, checked by hand against the primary documents on
2026-11-24. The `tests/packs.test.mjs` file pins the values that matter
(spacing, channel 16, calling frequencies, receive-only).

| Pack | Source | Notes |
|---|---|---|
| IARU R1 calling and simplex | [IARU R1 band plans](https://www.iaru-r1.org/reference/band-plans/) | 145.500 FM calling, 433.500 FM calling, 433.450 digital-voice calling (not in an analog pack). Simplex channels around both. |
| IARU R2 calling and simplex | [IARU R2 band plans](https://www.iaru-r2.org/en/band-plans/) | 146.520 and 446.000 calling; 2 m simplex 146.54–146.58. |
| APRS | [aprs.org frequencies](https://www.aprs.org/freq.html), [IARU R3 band plan](https://www.iaru.org/wp-content/uploads/2020/01/R3-004-IARU-Region-3-Bandplan-rev.2.pdf) | 144.800 in R1 and most of R3, 144.390 in North America, 145.175 in Australia, 144.575 in New Zealand, 144.640 in CN/TW/KR/JP, 145.825 for the ISS. |
| PMR446 | CEPT ECC Decision (15)05 | 16 channels, 446.00625 + 12.5 kHz steps, 0.5 W ERP, fixed antenna. Not legal in the US or Canada. |
| FRS / GMRS | US FCC, 47 CFR 95 | 22 channels. Channels 8–14 are 0.5 W; 15–22 are shared with GMRS. |
| Marine VHF | ITU Radio Regulations Appendix 18, as tabulated by the [US Coast Guard](https://www.navcen.uscg.gov/marine-vhf-channels) | Ship (`tx`) and shore (`rx`) frequencies. Channel 70 (DSC) and the 75/76 guard channels are deliberately absent. |
| NOAA weather | [NOAA NWS](https://www.weather.gov/nwr/) | WX1–WX10, receive only. |
| DMR simplex (Spain) | [URE / Radio Club Fene, *Frecuencias DMR en simplex en España*](https://www.radioclubfene.net/descargas/frecuencias_dmr.pdf) | 9 voice frequencies and 12 access-point frequencies, CC1, with the channel names the document asks every station to use. See below. |

Frequencies are chosen to sit on the 10 Hz grid the codeplug stores
(`Math.round(mhz * 1e5) * 10`), so a pack value never rounds silently.

## DMR simplex (Spain)

The document is a national agreement that follows the IARU Region 1 band plan.
It asks operators to keep its channel names in their codeplugs so a contact can
say "pásate a SOTA-U" and be understood. The builder therefore never invents a
name: it uses the published one and appends the contact in use.

| Channel | MHz | Use | CC / slot |
|---|---|---|---|
| CQDVHF | 145.375 | VHF calling | 1 / 1 |
| S1-VHF | 145.3875 | VHF QSO 1 | 1 / 1 |
| S2-VHF | 145.400 | VHF QSO 2 | 1 / 1 |
| SOTA-V | 144.900 | VHF SOTA | 1 / 1 |
| CQDUHF | 433.450 | UHF calling | 1 / 1 |
| S1-UHF | 433.775 | UHF QSO 1 | 1 / 1 |
| S2-UHF | 438.025 | UHF QSO 2 (urban) | 1 / 1 |
| S3-UHF | 438.0375 | UHF QSO 3 (urban) | 1 / 1 |
| SOTA-U | 438.050 | UHF SOTA | 1 / 1 |
| PA1-V … PA6-V | 144.8125, 144.825, 144.8375, 144.850, 144.8625, 144.875 | access points | 1 / 2 |
| PA1-U … PA6-U | 430.400, 430.4125, 430.425, 439.800, 439.8125, 439.825 | access points | 1 / 2 |

The document's own notes, which the builder does not repeat in the codeplug:

- Put a group call to **TG 99 "Simplex"** (ID 99) in the contacts and an RX list
  holding the simplex channels, associating each channel with TG 99.
- CC2 is the secondary colour code where signals overlap; the builder always
  uses CC1, the document's default.
- PA1-V (144.8125) may be a poor choice where 144.800 APRS is active.
- An access point is not a repeater: keep DMO power to 5–10 W.

AllCall is offered as an alternative contact because a station calling on a
simplex frequency has no way to know which TG, if any, a listener is parked on;
an all call reaches every DMR radio in range. Both is two channels per
frequency, since a channel carries a single default contact.

### Deliberate omissions

- **23 cm** (1297.500 FM calling) is not in a pack: the radios are VHF/UHF and
  the codeplug validator rejects a 1.3 GHz channel.
- **Channel 70** is DSC-only and cannot carry voice; **75 and 76** are guard
  channels either side of 16.
- **DMR talkgroups as channels**: Brandmeister repeaters are added as one
  channel each with a talkgroup list, not one channel per talkgroup, because
  the radio selects a talkgroup with the channel's contact and RX group list.
  That keeps 3 talkgroups from becoming 3 near-identical channels.
