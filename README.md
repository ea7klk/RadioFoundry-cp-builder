# RadioFoundry CP Builder

A location-aware codeplug builder for [RadioFoundry](https://radiofoundry.org/) radios.
It answers one question: *what should my radio hold where I actually operate?*

Set a location — coordinates, a Maidenhead locator or a nearby city — then add:

- **Standard analog channels** for your IARU region and country: FM calling and
  simplex frequencies, APRS, PMR446, FRS/GMRS and marine VHF, each with the
  IARU or regulator that defines it.
- **Nearby Brandmeister DMR repeaters**, within a radius you choose, each with
  its static talkgroups. The first talkgroup the API returns becomes the
  channel's default contact; every talkgroup goes into the channel's RX group
  list and into the contact table.
- **Nearby analog repeaters**, from the HearHam open database, with the
  repeater's shift and its CTCSS/DCS tones — or from a repeater list you
  already have, as CSV or JSON, read in the browser.

The result is a **qDMR YAML** file and a **CSV table set** that the official
[RadioFoundry codeplug editor](https://radiofoundry.org/codeplug/index.html)
opens, validates and writes to the radio. This project does not talk to a radio
and has no WebUSB code: the editor is the only thing that programs a radio.

Everything is built in the browser. The small local server exists only because
Brandmeister, HearHam and Nominatim do not send CORS headers, so a page cannot
call them directly; it proxies and caches those three sources and serves the
static files. Your location and selections are kept in your browser's
`localStorage`, never posted anywhere.

```
Browser  ──/api/bm/*, /api/repeaters/analog, /api/geocode──▶  local server  ──▶  Brandmeister
   │                                                            │  (cache on disk)   HearHam
   └── builds the codeplug, validates it, downloads YAML/CSV ◀───┘                    Nominatim
```

## Quick start

Local run needs Python 3.11 or newer. There are no third-party runtime
dependencies.

```sh
python3 -m server            # http://localhost:8080/
```

Or with Docker:

```sh
docker build -t radiofoundry-cp-builder .
docker run --rm -p 127.0.0.1:8080:8080 -v cpb-cache:/var/cache/cp-builder radiofoundry-cp-builder
```

Then open <http://localhost:8080/>, set a location, pick packs and repeaters,
press **Build codeplug**, and download the YAML. In the RadioFoundry editor,
*Open file* the YAML, review the tables, and write it to the radio.

Tests:

```sh
python3 -m pytest -q          # server: sources, cache, service, HTTP
node --test "tests/*.test.mjs" # builder: packs, model, YAML and CSV round trips
```

## What ends up in the codeplug

| From | Channels | Contacts | RX group list | Zone |
|---|---|---|---|---|
| DMR repeater | one per repeater, RX = repeater TX | every static talkgroup, shared across repeaters | one per repeater, named after its callsign | `DMR` |
| Analog repeater | one per repeater, with TX/RX tone | — | — | `ANALOG` |
| Your own list (CSV/JSON) | one per row, with TX/RX tone | — | — | `ANALOG` |
| Channel packs | one per frequency or channel | — | — | `STANDARD` |
| APRS pack plus a callsign | the APRS frequency as an FM channel | — | — | `APRS` |

- A DMR channel's **default contact is the first static talkgroup Brandmeister
  returns** for that repeater, and its timeslot is that talkgroup's slot. When a
  repeater lists no talkgroups, TG 9 (Local) is used unless you turn that off;
  either way the build output says so.
- A DMR channel's **RX group list holds every static talkgroup** of that
  repeater (up to the radio's 32 entries per list), so the talkgroups are
  reachable without editing the contact on the radio.
- **APRS** is a fixed position at your location, as a six-character locator on
  the region's usual frequency (144.800 in Region 1, 144.390 in Region 2,
  country exceptions in Region 3), linked to that APRS channel as its revert
  channel. Leave it off if you do not want the radio to transmit a position.
- Names are folded to the characters the radio's font holds and cut to its
  16-character field. Every fold or cut is reported, never silent.

Zones are split when a group would exceed the radio's 80 channels per zone.
The builder refuses to write a file when a table would overflow (1024 channels,
1024 contacts, 76 RX lists, 68 zones) and says which one.

## Frequency packs

| Pack | Region | Channels | Source |
|---|---|---|---|
| Calling and FM simplex | R1 | 145.500, 433.500 and the R1 simplex channels | IARU Region 1 band plan |
| Calling and FM simplex | R2 | 146.520, 446.000 and the 2 m simplex channels | IARU Region 2 band plan |
| APRS | R1 / R2 / R3 | terrestrial APRS, ISS, and the R3 national exceptions | aprs.org, IARU R3 band plan |
| PMR446 | R1 (+ MY, SG, AE, IN, VN) | 16 analog channels | CEPT ECC Decision (15)05 |
| FRS / GMRS | R2 | 22 channels | US FCC |
| Marine VHF | worldwide | ITU Appendix 18, ship and shore frequencies | US Coast Guard |
| NOAA weather | R2 | WX1–WX10, receive only | NOAA NWS |

The country selector sets the IARU region and the APRS frequency; the region can
be overridden. Packs that do not belong to the chosen region are hidden unless
you ask to see them, and selecting one adds a warning to the build.

Details, including what each source says and where its data is thin, are in
[docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

### Your own repeater list

HearHam's coverage varies a lot by country (it is strongest in North America).
If your national coordinator, club or a licensed export gives you better data,
load it in the analog card as CSV or JSON; it is parsed in the browser and never
uploaded. Column names are matched loosely (`output`/`frequency`, `offset`/
`shift`, `tone`/`ctcss`, …):

```csv
Callsign,Output,Offset,CTCSS,Latitude,Longitude,City,Mode
ED7YAA,145.775,-0.6,82.5,36.79,-4.48,Malaga,FM
ED7YAB,438.225,-7.6,88.5,36.72,-4.42,Malaga,FM
```

Shifts may be in MHz, kHz or Hz, and a decimal comma is understood. Rows
without coordinates are kept (they are listed as `no coordinates` and left off
the plot), and rows that cannot be a channel are skipped with a reason.

## Configuration

Every setting has an environment variable; see `server/config.py`.

| Variable | Default | Meaning |
|---|---|---|
| `CPB_HOST` | `127.0.0.1` | Listen address |
| `CPB_PORT` | `8080` | Listen port |
| `CPB_CACHE_DIR` | `var/cache` | Where upstream answers are cached |
| `CPB_MAX_RADIUS_KM` | `300` | Largest search radius the API accepts |
| `CPB_DEFAULT_RADIUS_KM` | `50` | Radius shown first in the page |
| `CPB_MAX_RESULTS` | `500` | Most repeaters one search returns |
| `CPB_BM_TTL` | `900` | Seconds a Brandmeister device list stays fresh |
| `CPB_HEARHAM_TTL` | `43200` | Seconds a HearHam dump stays fresh |
| `CPB_GEOCODE_TTL` | `2592000` | Seconds a place search stays fresh |
| `CPB_GEOCODE_MIN_INTERVAL` | `1.1` | Minimum seconds between Nominatim calls |
| `CPB_INCLUDE_PRIVATE` | off | Show HearHam entries marked private |
| `CPB_USER_AGENT` | project URL | User-Agent sent upstream |

Brandmeister asks clients not to poll its device list more than once every 15
minutes, which is why the default TTL is 15 minutes; Nominatim asks for one
request per second, which the geocoder enforces with a lock.

## Deploying it

The page has no accounts and its API spends the quotas of three upstream
services, so treat it as a local tool. If you host it for others, put it behind
a reverse proxy with TLS and rate limiting, and keep the default
`127.0.0.1` binding unless you mean to expose it. The server sends a strict
Content-Security-Policy (no inline script, same-origin only), `no-referrer`, and
`nosniff`, and refuses path traversal outside `web/`.

There is no CSRF token: the API is read-only and stateless, so a cross-site
request can only spend the same public quotas a visitor could spend directly.

## Layout

```
server/          Python 3.11+ service, standard library only
  app.py         HTTP routes, static files, security headers
  service.py     input checks and the shapes the page consumes
  brandmeister.py  Halligan API v2: devices, talkgroups
  hearham.py     HearHam repeater database
  geocode.py     Nominatim place search
  cache.py       JSON file cache with stale-if-error
  upstream.py    HTTP fetch with a size limit
web/             the page, no build step and no dependencies
  js/build.js    choices -> RadioFoundry model -> YAML and CSV
  js/packs.js    frequency data and IARU/country rules
  js/repeaters.js  a user's own repeater list (CSV or JSON)
  js/geo.js      locators, distances, formatting
  js/app.js      state, rendering, downloads
  vendor/radiofoundry/  upstream codeplug model, copied verbatim (MIT)
tests/           pytest for the server, node --test for the builder
docs/            data sources and design notes
```

The codeplug model, qDMR mapping, CSV tables and channel-record layouts come
from RadioFoundry itself, vendored under `web/vendor/radiofoundry/` with its
licence and notices; see `VENDOR.md` there.

## Licence

MIT. This is an independent project, not an official RadioFoundry release; it is
based on [RadioFoundry](https://github.com/RadioFoundry/RadioFoundry), which is
MIT licensed and whose copyright notices are kept in the vendored files. Radio
regulations are yours to follow: a channel in a codeplug does not grant the
right to transmit on it.
