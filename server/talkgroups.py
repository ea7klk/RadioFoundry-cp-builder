# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
"""Brandmeister talkgroups with a place attached.

Brandmeister's talkgroup list is an id-to-name map with no geography in it, but
the numbering carries it: talkgroup ids are built on ITU country prefixes, so
``214`` is Spain, ``21429`` a Spanish province and ``2624`` a German region.
That gives a reliable country for most of the list without guessing from names.

Three groups sit outside the country blocks and are handled by rule:

- ``1``, ``2``, ``8`` and ``9`` are the system's own local/cluster/regional
  talkgroups, which mean different things on every repeater;
- ``90``-``99`` and ``901``-``999`` are the international ones (worldwide,
  Europe, Asia, language bridges, JOTA, SOTA, Parrot);
- anything left over is "other": no identifiable geography.

A name match is used only where the id says nothing (an international id, or a
prefix that is not in the table), so the classification cannot contradict a
country the numbering already states.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable

# --- geography ---------------------------------------------------------------

EUROPE, NORTH_AMERICA, SOUTH_AMERICA = "europe", "north-america", "south-america"
ASIA, AFRICA, OCEANIA = "asia", "africa", "oceania"
WORLDWIDE, OTHER = "worldwide", "other"

CONTINENTS = [
    (WORLDWIDE, "Worldwide"),
    (EUROPE, "Europe"),
    (NORTH_AMERICA, "North America and the Caribbean"),
    (SOUTH_AMERICA, "South America"),
    (ASIA, "Asia and the Middle East"),
    (AFRICA, "Africa"),
    (OCEANIA, "Oceania"),
    (OTHER, "Other / no geography"),
]

# ITU prefixes as Brandmeister uses them, with the country and continent each
# stands for. Continents follow the prefix block (2xx Europe, 3xx North America
# and the Caribbean, 4xx Asia, 5xx Oceania, 6xx Africa, 7xx Latin America), with
# two corrections: Cyprus and Türkiye are Europe, and the Central American and
# Caribbean prefixes are North America rather than South America.
COUNTRY_PREFIXES: dict[str, tuple[str, str, str]] = {
    # Europe
    "202": ("GR", "Greece", EUROPE),
    "204": ("NL", "Netherlands", EUROPE),
    "206": ("BE", "Belgium", EUROPE),
    "208": ("FR", "France", EUROPE),
    "212": ("MC", "Monaco", EUROPE),
    "213": ("AD", "Andorra", EUROPE),
    "214": ("ES", "Spain", EUROPE),
    "216": ("HU", "Hungary", EUROPE),
    "218": ("BA", "Bosnia and Herzegovina", EUROPE),
    "219": ("HR", "Croatia", EUROPE),
    "220": ("RS", "Serbia", EUROPE),
    "222": ("IT", "Italy", EUROPE),
    "223": ("VA", "Vatican City", EUROPE),
    "226": ("RO", "Romania", EUROPE),
    "228": ("CH", "Switzerland", EUROPE),
    "229": ("LI", "Liechtenstein", EUROPE),
    "230": ("CZ", "Czechia", EUROPE),
    "231": ("SK", "Slovakia", EUROPE),
    "232": ("AT", "Austria", EUROPE),
    "233": ("DE", "Germany", EUROPE),
    "234": ("GB", "United Kingdom", EUROPE),
    "235": ("GB", "United Kingdom", EUROPE),
    "236": ("GB", "United Kingdom", EUROPE),
    "237": ("DE", "Germany", EUROPE),
    "238": ("DK", "Denmark", EUROPE),
    "239": ("SE", "Sweden", EUROPE),
    "240": ("SE", "Sweden", EUROPE),
    "241": ("SE", "Sweden", EUROPE),
    "242": ("NO", "Norway", EUROPE),
    "243": ("NO", "Norway", EUROPE),
    "244": ("FI", "Finland", EUROPE),
    "245": ("FI", "Finland", EUROPE),
    "246": ("LT", "Lithuania", EUROPE),
    "247": ("LV", "Latvia", EUROPE),
    "248": ("EE", "Estonia", EUROPE),
    "250": ("RU", "Russia", EUROPE),
    "251": ("RU", "Russia", EUROPE),
    "255": ("UA", "Ukraine", EUROPE),
    "257": ("BY", "Belarus", EUROPE),
    "259": ("MD", "Moldova", EUROPE),
    "260": ("PL", "Poland", EUROPE),
    "261": ("PL", "Poland", EUROPE),
    "262": ("DE", "Germany", EUROPE),
    "263": ("DE", "Germany", EUROPE),
    "264": ("DE", "Germany", EUROPE),
    "265": ("DE", "Germany", EUROPE),
    "266": ("DE", "Germany", EUROPE),
    "267": ("DE", "Germany", EUROPE),
    "268": ("PT", "Portugal", EUROPE),
    "269": ("KM", "Comoros", AFRICA),
    "270": ("LU", "Luxembourg", EUROPE),
    "272": ("IE", "Ireland", EUROPE),
    "274": ("IS", "Iceland", EUROPE),
    "276": ("AL", "Albania", EUROPE),
    "278": ("MT", "Malta", EUROPE),
    "280": ("CY", "Cyprus", EUROPE),
    "282": ("GE", "Georgia", EUROPE),
    "283": ("AM", "Armenia", EUROPE),
    "284": ("BG", "Bulgaria", EUROPE),
    "286": ("TR", "Türkiye", EUROPE),
    "288": ("FO", "Faroe Islands", EUROPE),
    "290": ("GL", "Greenland", NORTH_AMERICA),
    "292": ("SM", "San Marino", EUROPE),
    "293": ("SI", "Slovenia", EUROPE),
    "294": ("MK", "North Macedonia", EUROPE),
    "295": ("LI", "Liechtenstein", EUROPE),
    "297": ("ME", "Montenegro", EUROPE),
    # North America, Central America and the Caribbean
    "302": ("CA", "Canada", NORTH_AMERICA),
    "308": ("CA", "Canada", NORTH_AMERICA),
    "310": ("US", "United States", NORTH_AMERICA),
    "311": ("US", "United States", NORTH_AMERICA),
    "312": ("US", "United States", NORTH_AMERICA),
    "313": ("US", "United States", NORTH_AMERICA),
    "314": ("US", "United States", NORTH_AMERICA),
    "315": ("US", "United States", NORTH_AMERICA),
    "316": ("US", "United States", NORTH_AMERICA),
    "317": ("US", "United States", NORTH_AMERICA),
    "318": ("US", "United States", NORTH_AMERICA),
    "319": ("US", "United States", NORTH_AMERICA),
    "330": ("PR", "Puerto Rico", NORTH_AMERICA),
    "334": ("MX", "Mexico", NORTH_AMERICA),
    "338": ("JM", "Jamaica", NORTH_AMERICA),
    "350": ("BM", "Bermuda", NORTH_AMERICA),
    "352": ("GD", "Grenada", NORTH_AMERICA),
    "354": ("MS", "Montserrat", NORTH_AMERICA),
    "356": ("KN", "Saint Kitts and Nevis", NORTH_AMERICA),
    "358": ("LC", "Saint Lucia", NORTH_AMERICA),
    "360": ("VC", "Saint Vincent and the Grenadines", NORTH_AMERICA),
    "362": ("CW", "Curaçao", NORTH_AMERICA),
    "363": ("AW", "Aruba", NORTH_AMERICA),
    "364": ("BS", "Bahamas", NORTH_AMERICA),
    "366": ("DM", "Dominica", NORTH_AMERICA),
    "368": ("CU", "Cuba", NORTH_AMERICA),
    "370": ("DO", "Dominican Republic", NORTH_AMERICA),
    "372": ("HT", "Haiti", NORTH_AMERICA),
    "374": ("TT", "Trinidad and Tobago", NORTH_AMERICA),
    "376": ("TC", "Turks and Caicos Islands", NORTH_AMERICA),
    "378": ("AI", "Anguilla", NORTH_AMERICA),
    "382": ("BB", "Barbados", NORTH_AMERICA),
    "386": ("AG", "Antigua and Barbuda", NORTH_AMERICA),
    # Asia and the Middle East
    "400": ("AZ", "Azerbaijan", ASIA),
    "401": ("KZ", "Kazakhstan", ASIA),
    "402": ("BT", "Bhutan", ASIA),
    "404": ("IN", "India", ASIA),
    "405": ("IN", "India", ASIA),
    "410": ("PK", "Pakistan", ASIA),
    "413": ("LK", "Sri Lanka", ASIA),
    "415": ("LB", "Lebanon", ASIA),
    "417": ("SY", "Syria", ASIA),
    "419": ("KW", "Kuwait", ASIA),
    "420": ("SA", "Saudi Arabia", ASIA),
    "422": ("OM", "Oman", ASIA),
    "425": ("IL", "Israel", ASIA),
    "426": ("BH", "Bahrain", ASIA),
    "427": ("QA", "Qatar", ASIA),
    "428": ("MN", "Mongolia", ASIA),
    "430": ("AE", "United Arab Emirates", ASIA),
    "432": ("IR", "Iran", ASIA),
    "434": ("UZ", "Uzbekistan", ASIA),
    "436": ("TJ", "Tajikistan", ASIA),
    "437": ("KG", "Kyrgyzstan", ASIA),
    "438": ("TM", "Turkmenistan", ASIA),
    "440": ("JP", "Japan", ASIA),
    "441": ("JP", "Japan", ASIA),
    "442": ("JP", "Japan", ASIA),
    "450": ("KR", "South Korea", ASIA),
    "452": ("VN", "Vietnam", ASIA),
    "454": ("HK", "Hong Kong", ASIA),
    "455": ("MO", "Macao", ASIA),
    "456": ("KH", "Cambodia", ASIA),
    "457": ("LA", "Laos", ASIA),
    "460": ("CN", "China", ASIA),
    "461": ("CN", "China", ASIA),
    "462": ("CN", "China", ASIA),
    "466": ("TW", "Taiwan", ASIA),
    "470": ("BD", "Bangladesh", ASIA),
    "472": ("MV", "Maldives", ASIA),
    "473": ("NP", "Nepal", ASIA),
    "474": ("MM", "Myanmar", ASIA),
    "475": ("PH", "Philippines", ASIA),
    # Oceania
    "500": ("PF", "French Polynesia", OCEANIA),
    "501": ("NC", "New Caledonia", OCEANIA),
    "502": ("MY", "Malaysia", ASIA),
    "505": ("AU", "Australia", OCEANIA),
    "506": ("AU", "Australia", OCEANIA),
    "508": ("SB", "Solomon Islands", OCEANIA),
    "510": ("ID", "Indonesia", ASIA),
    "512": ("NZ", "New Zealand", OCEANIA),
    "515": ("PH", "Philippines", ASIA),
    "520": ("TH", "Thailand", ASIA),
    "525": ("SG", "Singapore", ASIA),
    "530": ("NZ", "New Zealand", OCEANIA),
    "531": ("NZ", "New Zealand", OCEANIA),
    "533": ("WS", "Samoa", OCEANIA),
    "536": ("TO", "Tonga", OCEANIA),
    "538": ("FJ", "Fiji", OCEANIA),
    "541": ("VU", "Vanuatu", OCEANIA),
    "543": ("PG", "Papua New Guinea", OCEANIA),
    "544": ("GU", "Guam", OCEANIA),
    "545": ("MP", "Northern Mariana Islands", OCEANIA),
    # Africa
    "602": ("EG", "Egypt", AFRICA),
    "603": ("DZ", "Algeria", AFRICA),
    "604": ("MA", "Morocco", AFRICA),
    "605": ("TN", "Tunisia", AFRICA),
    "606": ("LY", "Libya", AFRICA),
    "607": ("SD", "Sudan", AFRICA),
    "608": ("SN", "Senegal", AFRICA),
    "609": ("MR", "Mauritania", AFRICA),
    "610": ("ML", "Mali", AFRICA),
    "611": ("NE", "Niger", AFRICA),
    "612": ("TD", "Chad", AFRICA),
    "613": ("BF", "Burkina Faso", AFRICA),
    "614": ("GN", "Guinea", AFRICA),
    "615": ("TG", "Togo", AFRICA),
    "616": ("BJ", "Benin", AFRICA),
    "617": ("CM", "Cameroon", AFRICA),
    "618": ("CF", "Central African Republic", AFRICA),
    "619": ("GA", "Gabon", AFRICA),
    "620": ("GH", "Ghana", AFRICA),
    "621": ("NG", "Nigeria", AFRICA),
    "622": ("CI", "Côte d'Ivoire", AFRICA),
    "623": ("LR", "Liberia", AFRICA),
    "624": ("SL", "Sierra Leone", AFRICA),
    "625": ("CV", "Cabo Verde", AFRICA),
    "626": ("GM", "Gambia", AFRICA),
    "627": ("GW", "Guinea-Bissau", AFRICA),
    "628": ("GQ", "Equatorial Guinea", AFRICA),
    "629": ("ST", "São Tomé and Príncipe", AFRICA),
    "630": ("CG", "Congo", AFRICA),
    "631": ("CD", "DR Congo", AFRICA),
    "632": ("AO", "Angola", AFRICA),
    "633": ("ZM", "Zambia", AFRICA),
    "634": ("ZW", "Zimbabwe", AFRICA),
    "635": ("MW", "Malawi", AFRICA),
    "636": ("MZ", "Mozambique", AFRICA),
    "637": ("BW", "Botswana", AFRICA),
    "638": ("NA", "Namibia", AFRICA),
    "639": ("KE", "Kenya", AFRICA),
    "640": ("TZ", "Tanzania", AFRICA),
    "641": ("UG", "Uganda", AFRICA),
    "642": ("RW", "Rwanda", AFRICA),
    "643": ("BI", "Burundi", AFRICA),
    "644": ("ET", "Ethiopia", AFRICA),
    "645": ("SO", "Somalia", AFRICA),
    "646": ("MG", "Madagascar", AFRICA),
    "647": ("RE", "Réunion", AFRICA),
    "648": ("MU", "Mauritius", AFRICA),
    "649": ("SC", "Seychelles", AFRICA),
    "650": ("SZ", "Eswatini", AFRICA),
    "651": ("LS", "Lesotho", AFRICA),
    "652": ("DJ", "Djibouti", AFRICA),
    "655": ("ZA", "South Africa", AFRICA),
    "657": ("ZA", "South Africa", AFRICA),
    # Latin America
    "702": ("BZ", "Belize", NORTH_AMERICA),
    "704": ("GT", "Guatemala", NORTH_AMERICA),
    "706": ("SV", "El Salvador", NORTH_AMERICA),
    "708": ("HN", "Honduras", NORTH_AMERICA),
    "710": ("NI", "Nicaragua", NORTH_AMERICA),
    "712": ("CR", "Costa Rica", NORTH_AMERICA),
    "714": ("PA", "Panama", NORTH_AMERICA),
    "716": ("PE", "Peru", SOUTH_AMERICA),
    "718": ("CL", "Chile", SOUTH_AMERICA),
    "720": ("BO", "Bolivia", SOUTH_AMERICA),
    "722": ("AR", "Argentina", SOUTH_AMERICA),
    "724": ("BR", "Brazil", SOUTH_AMERICA),
    "730": ("CL", "Chile", SOUTH_AMERICA),
    "732": ("CO", "Colombia", SOUTH_AMERICA),
    "734": ("VE", "Venezuela", SOUTH_AMERICA),
    "736": ("BO", "Bolivia", SOUTH_AMERICA),
    "738": ("GY", "Guyana", SOUTH_AMERICA),
    "740": ("EC", "Ecuador", SOUTH_AMERICA),
    "742": ("GF", "French Guiana", SOUTH_AMERICA),
    "744": ("PY", "Paraguay", SOUTH_AMERICA),
    "746": ("SR", "Suriname", SOUTH_AMERICA),
    "748": ("UY", "Uruguay", SOUTH_AMERICA),
}

# Continent and region words in names, checked before country words so that
# "North America" is a region and "Asia, Middle East" is a continent rather than
# whatever country its id prefix says. These carry no single country.
REGION_WORDS: list[tuple[str, str]] = [
    ("world-wide", WORLDWIDE),
    ("worldwide", WORLDWIDE),
    ("world wide", WORLDWIDE),
    ("europe", EUROPE),
    ("north america", NORTH_AMERICA),
    ("central america", NORTH_AMERICA),
    ("caribbean", NORTH_AMERICA),
    ("south america", SOUTH_AMERICA),
    ("latin america", SOUTH_AMERICA),
    ("asia", ASIA),
    ("middle east", ASIA),
    ("southeast asia", ASIA),
    ("africa", AFRICA),
    ("oceania", OCEANIA),
    ("scandinavia", EUROPE),
    ("nordic", EUROPE),
    ("balkans", EUROPE),
    ("iberia", EUROPE),
]

# Names that describe a technical service, an interest group or a language
# rather than a place: they belong in "other", not in a country or worldwide.
NO_PLACE = re.compile(
    r"^(?:parrot|echo\s*test|disconnect|radio\s*test|test|tg\s*\d+|tac\s*\d+|local|cluster|regional|"
    r"world-?wide|europe|north\s*america|asia|emu|emergency|emcomm|emcom|jota|sota|iota|yota|"
    r"amateur\s*television|atv|technical|tech|bridge|link|net|nets|chat|talk|podcast|multimode|multi-mode|"
    r"multi\s*mode|xlx|xrf|ysf|c4fm|dmr|d-?star|nxdn|p25|tetra|wires-?x|allstar|repeater|repeaters|"
    r"german|english|spanish|portuguese|italian|dutch|swedish|danish|finnish|french|francophonie|"
    r"arabic|basque|nordic|slavic|polish|russian|türk|turkish|euro|european|international|worldwide|"
    r"cafe|gratis|reddit|collegiate|amsat|veterans|lgbtq|manna|wwyl|icq|rnlmc)(?:\b|$)",
    re.IGNORECASE,
)

# Country words that appear in names, for ids that carry no usable prefix.
# Native spellings are included because the list is written by each community.
NAME_COUNTRIES: dict[str, tuple[str, str, str]] = {
    "spain": ("ES", "Spain", EUROPE),
    "españa": ("ES", "Spain", EUROPE),
    "espana": ("ES", "Spain", EUROPE),
    "portugal": ("PT", "Portugal", EUROPE),
    "france": ("FR", "France", EUROPE),
    "french": ("FR", "France", EUROPE),
    "germany": ("DE", "Germany", EUROPE),
    "deutschland": ("DE", "Germany", EUROPE),
    "italy": ("IT", "Italy", EUROPE),
    "italia": ("IT", "Italy", EUROPE),
    "netherlands": ("NL", "Netherlands", EUROPE),
    "nederland": ("NL", "Netherlands", EUROPE),
    "belgium": ("BE", "Belgium", EUROPE),
    "belgique": ("BE", "Belgium", EUROPE),
    "switzerland": ("CH", "Switzerland", EUROPE),
    "schweiz": ("CH", "Switzerland", EUROPE),
    "suisse": ("CH", "Switzerland", EUROPE),
    "austria": ("AT", "Austria", EUROPE),
    "österreich": ("AT", "Austria", EUROPE),
    "osterreich": ("AT", "Austria", EUROPE),
    "poland": ("PL", "Poland", EUROPE),
    "polska": ("PL", "Poland", EUROPE),
    "sweden": ("SE", "Sweden", EUROPE),
    "sverige": ("SE", "Sweden", EUROPE),
    "norway": ("NO", "Norway", EUROPE),
    "norge": ("NO", "Norway", EUROPE),
    "denmark": ("DK", "Denmark", EUROPE),
    "danmark": ("DK", "Denmark", EUROPE),
    "finland": ("FI", "Finland", EUROPE),
    "suomi": ("FI", "Finland", EUROPE),
    "ireland": ("IE", "Ireland", EUROPE),
    "iceland": ("IS", "Iceland", EUROPE),
    "greece": ("GR", "Greece", EUROPE),
    "panhellenic": ("GR", "Greece", EUROPE),
    "hellenic": ("GR", "Greece", EUROPE),
    "ελλάδα": ("GR", "Greece", EUROPE),
    "hungary": ("HU", "Hungary", EUROPE),
    "magyarország": ("HU", "Hungary", EUROPE),
    "romania": ("RO", "Romania", EUROPE),
    "românia": ("RO", "Romania", EUROPE),
    "bulgaria": ("BG", "Bulgaria", EUROPE),
    "croatia": ("HR", "Croatia", EUROPE),
    "hrvatska": ("HR", "Croatia", EUROPE),
    "serbia": ("RS", "Serbia", EUROPE),
    "slovenia": ("SI", "Slovenia", EUROPE),
    "slovakia": ("SK", "Slovakia", EUROPE),
    "czech": ("CZ", "Czechia", EUROPE),
    "ukraine": ("UA", "Ukraine", EUROPE),
    "russia": ("RU", "Russia", EUROPE),
    "россия": ("RU", "Russia", EUROPE),
    "turkey": ("TR", "Türkiye", EUROPE),
    "türkiye": ("TR", "Türkiye", EUROPE),
    "turkiye": ("TR", "Türkiye", EUROPE),
    "united kingdom": ("GB", "United Kingdom", EUROPE),
    "scotland": ("GB", "United Kingdom", EUROPE),
    "wales": ("GB", "United Kingdom", EUROPE),
    "england": ("GB", "United Kingdom", EUROPE),
    "lithuania": ("LT", "Lithuania", EUROPE),
    "latvia": ("LV", "Latvia", EUROPE),
    "estonia": ("EE", "Estonia", EUROPE),
    "moldova": ("MD", "Moldova", EUROPE),
    "belarus": ("BY", "Belarus", EUROPE),
    "malta": ("MT", "Malta", EUROPE),
    "cyprus": ("CY", "Cyprus", EUROPE),
    "luxembourg": ("LU", "Luxembourg", EUROPE),
    "macedonia": ("MK", "North Macedonia", EUROPE),
    "montenegro": ("ME", "Montenegro", EUROPE),
    "united states": ("US", "United States", NORTH_AMERICA),
    "usa": ("US", "United States", NORTH_AMERICA),
    "canada": ("CA", "Canada", NORTH_AMERICA),
    "mexico": ("MX", "Mexico", NORTH_AMERICA),
    "méxico": ("MX", "Mexico", NORTH_AMERICA),
    "cuba": ("CU", "Cuba", NORTH_AMERICA),
    "jamaica": ("JM", "Jamaica", NORTH_AMERICA),
    "haiti": ("HT", "Haiti", NORTH_AMERICA),
    "dominican republic": ("DO", "Dominican Republic", NORTH_AMERICA),
    "puerto rico": ("PR", "Puerto Rico", NORTH_AMERICA),
    "trinidad": ("TT", "Trinidad and Tobago", NORTH_AMERICA),
    "bahamas": ("BS", "Bahamas", NORTH_AMERICA),
    "guatemala": ("GT", "Guatemala", NORTH_AMERICA),
    "honduras": ("HN", "Honduras", NORTH_AMERICA),
    "el salvador": ("SV", "El Salvador", NORTH_AMERICA),
    "nicaragua": ("NI", "Nicaragua", NORTH_AMERICA),
    "costa rica": ("CR", "Costa Rica", NORTH_AMERICA),
    "panama": ("PA", "Panama", NORTH_AMERICA),
    "panamá": ("PA", "Panama", NORTH_AMERICA),
    "argentina": ("AR", "Argentina", SOUTH_AMERICA),
    "brazil": ("BR", "Brazil", SOUTH_AMERICA),
    "brasil": ("BR", "Brazil", SOUTH_AMERICA),
    "chile": ("CL", "Chile", SOUTH_AMERICA),
    "colombia": ("CO", "Colombia", SOUTH_AMERICA),
    "venezuela": ("VE", "Venezuela", SOUTH_AMERICA),
    "peru": ("PE", "Peru", SOUTH_AMERICA),
    "perú": ("PE", "Peru", SOUTH_AMERICA),
    "ecuador": ("EC", "Ecuador", SOUTH_AMERICA),
    "bolivia": ("BO", "Bolivia", SOUTH_AMERICA),
    "uruguay": ("UY", "Uruguay", SOUTH_AMERICA),
    "paraguay": ("PY", "Paraguay", SOUTH_AMERICA),
    "guyana": ("GY", "Guyana", SOUTH_AMERICA),
    "suriname": ("SR", "Suriname", SOUTH_AMERICA),
    "australia": ("AU", "Australia", OCEANIA),
    "new zealand": ("NZ", "New Zealand", OCEANIA),
    "fiji": ("FJ", "Fiji", OCEANIA),
    "papua new guinea": ("PG", "Papua New Guinea", OCEANIA),
    "india": ("IN", "India", ASIA),
    "pakistan": ("PK", "Pakistan", ASIA),
    "bangladesh": ("BD", "Bangladesh", ASIA),
    "sri lanka": ("LK", "Sri Lanka", ASIA),
    "nepal": ("NP", "Nepal", ASIA),
    "china": ("CN", "China", ASIA),
    "中国": ("CN", "China", ASIA),
    "taiwan": ("TW", "Taiwan", ASIA),
    "japan": ("JP", "Japan", ASIA),
    "日本": ("JP", "Japan", ASIA),
    "korea": ("KR", "South Korea", ASIA),
    "한국": ("KR", "South Korea", ASIA),
    "indonesia": ("ID", "Indonesia", ASIA),
    "philippines": ("PH", "Philippines", ASIA),
    "thailand": ("TH", "Thailand", ASIA),
    "malaysia": ("MY", "Malaysia", ASIA),
    "singapore": ("SG", "Singapore", ASIA),
    "vietnam": ("VN", "Vietnam", ASIA),
    "cambodia": ("KH", "Cambodia", ASIA),
    "hong kong": ("HK", "Hong Kong", ASIA),
    "israel": ("IL", "Israel", ASIA),
    "saudi": ("SA", "Saudi Arabia", ASIA),
    "emirates": ("AE", "United Arab Emirates", ASIA),
    "qatar": ("QA", "Qatar", ASIA),
    "kuwait": ("KW", "Kuwait", ASIA),
    "oman": ("OM", "Oman", ASIA),
    "bahrain": ("BH", "Bahrain", ASIA),
    "lebanon": ("LB", "Lebanon", ASIA),
    "jordan": ("JO", "Jordan", ASIA),
    "iran": ("IR", "Iran", ASIA),
    "kazakhstan": ("KZ", "Kazakhstan", ASIA),
    "south africa": ("ZA", "South Africa", AFRICA),
    "egypt": ("EG", "Egypt", AFRICA),
    "morocco": ("MA", "Morocco", AFRICA),
    "algeria": ("DZ", "Algeria", AFRICA),
    "tunisia": ("TN", "Tunisia", AFRICA),
    "libya": ("LY", "Libya", AFRICA),
    "kenya": ("KE", "Kenya", AFRICA),
    "nigeria": ("NG", "Nigeria", AFRICA),
    "ghana": ("GH", "Ghana", AFRICA),
    "senegal": ("SN", "Senegal", AFRICA),
    "ethiopia": ("ET", "Ethiopia", AFRICA),
    "madagascar": ("MG", "Madagascar", AFRICA),
    "reunion": ("RE", "Réunion", AFRICA),
    "réunion": ("RE", "Réunion", AFRICA),
    "mauritius": ("MU", "Mauritius", AFRICA),
}

# Three-digit ids at or above this are international (901-999).
INTERNATIONAL_MIN = 90
INTERNATIONAL_3_MIN = 901
SYSTEM_IDS = frozenset({1, 2, 8, 9})


def fold(text: Any) -> str:
    """Lower case, accents removed, single spaces: 'Málaga' -> 'malaga'."""
    decomposed = unicodedata.normalize("NFD", str(text or ""))
    stripped = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
    return " ".join(stripped.lower().split())


def country_of(tg: int) -> tuple[str, str, str] | None:
    """The country a talkgroup id belongs to, from its ITU prefix."""
    text = str(tg)
    if len(text) < 3:
        return None
    return COUNTRY_PREFIXES.get(text[:3])


def _has_word(folded: str, word: str) -> bool:
    """The word on its own, at the start or after a separator."""
    return bool(
        folded == word
        or folded.startswith(word + " ")
        or re.search(rf"(?:^|[\s/(,;-]){re.escape(word)}(?:$|[\s/),.;-])", folded)
    )


def classify(tg: int, name: Any) -> dict[str, Any]:
    """Where a talkgroup belongs: {continent, country, country_name, kind}.

    The id's ITU prefix decides first, because Brandmeister allocates ids by
    country. Only ids the numbering cannot place (the international 9xx range and
    anything with an unknown prefix) are read from the name.
    """
    label = " ".join(str(name or "").split())
    is_worldwide = tg >= INTERNATIONAL_3_MIN or (
        len(str(tg)) == 2 and tg >= INTERNATIONAL_MIN
    ) or tg in (91, 92, 93, 94, 95, 98)

    if tg in SYSTEM_IDS:
        return {"continent": OTHER, "country": None, "country_name": None, "kind": "system"}

    place = country_of(tg)
    if place:
        iso, country, continent = place
        return {"continent": continent, "country": iso, "country_name": country, "kind": "country"}

    folded = fold(label)
    if folded:
        for word, continent in REGION_WORDS:
            if _has_word(folded, word):
                return {"continent": continent, "country": None, "country_name": None, "kind": "region"}
        for word in sorted(NAME_COUNTRIES, key=len, reverse=True):
            if _has_word(folded, word):
                iso, country, continent = NAME_COUNTRIES[word]
                return {"continent": continent, "country": iso, "country_name": country, "kind": "country"}
        if NO_PLACE.match(folded):
            return {"continent": OTHER, "country": None, "country_name": None, "kind": "other"}

    if is_worldwide:
        return {"continent": WORLDWIDE, "country": None, "country_name": None, "kind": "worldwide"}
    return {"continent": OTHER, "country": None, "country_name": None, "kind": "other"}


def build_index(raw: Any) -> list[dict[str, Any]]:
    """The id-to-name map Brandmeister serves, as sorted records with a place."""
    if not isinstance(raw, dict):
        return []
    out: list[dict[str, Any]] = []
    for key, value in raw.items():
        try:
            tg = int(str(key).strip())
        except ValueError:
            continue
        name = " ".join(str(value or "").split())
        if tg <= 0 or not name:
            continue
        out.append({"tg": tg, "name": name[:48], **classify(tg, name)})
    out.sort(key=lambda item: item["tg"])
    return out


def facets(index: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Counts per continent and per country, for the filters."""
    continents: dict[str, int] = {}
    countries: dict[str, dict[str, Any]] = {}
    for item in index:
        continent = item["continent"]
        continents[continent] = continents.get(continent, 0) + 1
        iso = item.get("country")
        if not iso:
            continue
        entry = countries.setdefault(
            iso,
            {"cc": iso, "name": item.get("country_name") or iso, "continent": continent, "count": 0},
        )
        entry["count"] += 1
    return {
        "continents": [{"id": cid, "label": label, "count": continents.get(cid, 0)} for cid, label in CONTINENTS],
        "countries": sorted(countries.values(), key=lambda entry: entry["name"]),
    }
