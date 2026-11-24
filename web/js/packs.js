// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// Standard analog channel packs: IARU calling and simplex frequencies, APRS,
// PMR446, FRS/GMRS and marine VHF. Data only; build.js turns a pack into
// channels. Every pack names its source in docs/DATA-SOURCES.md.
//
// Frequencies are in MHz and are chosen to sit on the 10 Hz grid the codeplug
// stores. Where a service is licence-exempt but limited (PMR446, FRS), the note
// says so; this builder does not decide whether a user may transmit.

export const REGIONS = {
	R1: { label: "IARU Region 1", hint: "Europe, Africa, the Middle East and northern Asia" },
	R2: { label: "IARU Region 2", hint: "the Americas" },
	R3: { label: "IARU Region 3", hint: "Asia-Pacific" },
};

// [ISO 3166-1 alpha-2, English name, IARU region]
export const COUNTRIES = [
	["ES", "Spain", "R1"], ["PT", "Portugal", "R1"], ["FR", "France", "R1"], ["DE", "Germany", "R1"],
	["IT", "Italy", "R1"], ["NL", "Netherlands", "R1"], ["BE", "Belgium", "R1"], ["LU", "Luxembourg", "R1"],
	["CH", "Switzerland", "R1"], ["AT", "Austria", "R1"], ["LI", "Liechtenstein", "R1"], ["IE", "Ireland", "R1"],
	["GB", "United Kingdom", "R1"], ["SE", "Sweden", "R1"], ["NO", "Norway", "R1"], ["DK", "Denmark", "R1"],
	["FI", "Finland", "R1"], ["IS", "Iceland", "R1"], ["PL", "Poland", "R1"], ["CZ", "Czechia", "R1"],
	["SK", "Slovakia", "R1"], ["HU", "Hungary", "R1"], ["RO", "Romania", "R1"], ["BG", "Bulgaria", "R1"],
	["GR", "Greece", "R1"], ["CY", "Cyprus", "R1"], ["MT", "Malta", "R1"], ["HR", "Croatia", "R1"],
	["SI", "Slovenia", "R1"], ["RS", "Serbia", "R1"], ["BA", "Bosnia and Herzegovina", "R1"], ["ME", "Montenegro", "R1"],
	["MK", "North Macedonia", "R1"], ["AL", "Albania", "R1"], ["EE", "Estonia", "R1"], ["LV", "Latvia", "R1"],
	["LT", "Lithuania", "R1"], ["UA", "Ukraine", "R1"], ["BY", "Belarus", "R1"], ["MD", "Moldova", "R1"],
	["RU", "Russia", "R1"], ["TR", "Türkiye", "R1"], ["GE", "Georgia", "R1"], ["AM", "Armenia", "R1"],
	["AZ", "Azerbaijan", "R1"], ["KZ", "Kazakhstan", "R1"], ["UZ", "Uzbekistan", "R1"], ["KG", "Kyrgyzstan", "R1"],
	["TJ", "Tajikistan", "R1"], ["TM", "Turkmenistan", "R1"], ["IL", "Israel", "R1"], ["JO", "Jordan", "R1"],
	["LB", "Lebanon", "R1"], ["SY", "Syria", "R1"], ["IQ", "Iraq", "R1"], ["SA", "Saudi Arabia", "R1"],
	["AE", "United Arab Emirates", "R1"], ["QA", "Qatar", "R1"], ["KW", "Kuwait", "R1"], ["BH", "Bahrain", "R1"],
	["OM", "Oman", "R1"], ["YE", "Yemen", "R1"], ["IR", "Iran", "R1"], ["EG", "Egypt", "R1"],
	["LY", "Libya", "R1"], ["TN", "Tunisia", "R1"], ["DZ", "Algeria", "R1"], ["MA", "Morocco", "R1"],
	["MR", "Mauritania", "R1"], ["ML", "Mali", "R1"], ["NE", "Niger", "R1"], ["TD", "Chad", "R1"],
	["SD", "Sudan", "R1"], ["ET", "Ethiopia", "R1"], ["ER", "Eritrea", "R1"], ["DJ", "Djibouti", "R1"],
	["SO", "Somalia", "R1"], ["KE", "Kenya", "R1"], ["UG", "Uganda", "R1"], ["TZ", "Tanzania", "R1"],
	["RW", "Rwanda", "R1"], ["BI", "Burundi", "R1"], ["CD", "DR Congo", "R1"], ["CG", "Congo", "R1"],
	["GA", "Gabon", "R1"], ["GQ", "Equatorial Guinea", "R1"], ["CM", "Cameroon", "R1"], ["CF", "Central African Republic", "R1"],
	["NG", "Nigeria", "R1"], ["BJ", "Benin", "R1"], ["TG", "Togo", "R1"], ["GH", "Ghana", "R1"],
	["CI", "Côte d'Ivoire", "R1"], ["LR", "Liberia", "R1"], ["SL", "Sierra Leone", "R1"], ["GN", "Guinea", "R1"],
	["GW", "Guinea-Bissau", "R1"], ["SN", "Senegal", "R1"], ["GM", "Gambia", "R1"], ["CV", "Cabo Verde", "R1"],
	["ST", "São Tomé and Príncipe", "R1"], ["AO", "Angola", "R1"], ["ZM", "Zambia", "R1"], ["ZW", "Zimbabwe", "R1"],
	["MW", "Malawi", "R1"], ["MZ", "Mozambique", "R1"], ["BW", "Botswana", "R1"], ["NA", "Namibia", "R1"],
	["ZA", "South Africa", "R1"], ["LS", "Lesotho", "R1"], ["SZ", "Eswatini", "R1"], ["MG", "Madagascar", "R1"],
	["MU", "Mauritius", "R1"], ["SC", "Seychelles", "R1"], ["KM", "Comoros", "R1"], ["RE", "Réunion", "R1"],
	["YT", "Mayotte", "R1"], ["SH", "Saint Helena", "R1"],

	["US", "United States", "R2"], ["CA", "Canada", "R2"], ["MX", "Mexico", "R2"], ["GL", "Greenland", "R2"],
	["BM", "Bermuda", "R2"], ["PR", "Puerto Rico", "R2"], ["VI", "US Virgin Islands", "R2"], ["CU", "Cuba", "R2"],
	["JM", "Jamaica", "R2"], ["HT", "Haiti", "R2"], ["DO", "Dominican Republic", "R2"], ["TT", "Trinidad and Tobago", "R2"],
	["BB", "Barbados", "R2"], ["BS", "Bahamas", "R2"], ["BZ", "Belize", "R2"], ["GT", "Guatemala", "R2"],
	["HN", "Honduras", "R2"], ["SV", "El Salvador", "R2"], ["NI", "Nicaragua", "R2"], ["CR", "Costa Rica", "R2"],
	["PA", "Panama", "R2"], ["CO", "Colombia", "R2"], ["VE", "Venezuela", "R2"], ["EC", "Ecuador", "R2"],
	["PE", "Peru", "R2"], ["BR", "Brazil", "R2"], ["BO", "Bolivia", "R2"], ["PY", "Paraguay", "R2"],
	["UY", "Uruguay", "R2"], ["AR", "Argentina", "R2"], ["CL", "Chile", "R2"], ["FK", "Falkland Islands", "R2"],
	["GF", "French Guiana", "R2"], ["SR", "Suriname", "R2"], ["GY", "Guyana", "R2"],

	["AU", "Australia", "R3"], ["NZ", "New Zealand", "R3"], ["PG", "Papua New Guinea", "R3"], ["FJ", "Fiji", "R3"],
	["NC", "New Caledonia", "R3"], ["PF", "French Polynesia", "R3"], ["WS", "Samoa", "R3"], ["TO", "Tonga", "R3"],
	["VU", "Vanuatu", "R3"], ["SB", "Solomon Islands", "R3"], ["GU", "Guam", "R3"], ["MP", "Northern Mariana Islands", "R3"],
	["AS", "American Samoa", "R3"], ["JP", "Japan", "R3"], ["KR", "South Korea", "R3"], ["CN", "China", "R3"],
	["HK", "Hong Kong", "R3"], ["MO", "Macao", "R3"], ["TW", "Taiwan", "R3"], ["MN", "Mongolia", "R3"],
	["IN", "India", "R3"], ["PK", "Pakistan", "R3"], ["BD", "Bangladesh", "R3"], ["LK", "Sri Lanka", "R3"],
	["NP", "Nepal", "R3"], ["BT", "Bhutan", "R3"], ["MV", "Maldives", "R3"], ["AF", "Afghanistan", "R3"],
	["TH", "Thailand", "R3"], ["VN", "Vietnam", "R3"], ["LA", "Laos", "R3"], ["KH", "Cambodia", "R3"],
	["MM", "Myanmar", "R3"], ["MY", "Malaysia", "R3"], ["SG", "Singapore", "R3"], ["ID", "Indonesia", "R3"],
	["PH", "Philippines", "R3"], ["BN", "Brunei", "R3"], ["TL", "Timor-Leste", "R3"],
];

export const COUNTRY_BY_CC = new Map(COUNTRIES.map(([cc, name, region]) => [cc, { cc, name, region }]));

export function regionForCountry(cc) {
	return COUNTRY_BY_CC.get(String(cc || "").toUpperCase())?.region || "R1";
}

// The APRS frequency a country's amateurs usually use. IARU R3 has no single
// frequency: the band plan names 144.800 as a suggestion, with national
// exceptions. R1 = 144.800, R2 = 144.390 (aprs.org).
export function aprsFrequencyFor(cc) {
	const country = String(cc || "").toUpperCase();
	const special = {
		US: 144.39, CA: 144.39, MX: 144.39,
		AU: 145.175, NZ: 144.575, JP: 144.64,
		MY: 144.39, SG: 144.39, TH: 144.39, ID: 144.39,
		CN: 144.64, TW: 144.64, KR: 144.64,
	};
	return special[country] ?? (regionForCountry(country) === "R2" ? 144.39 : 144.8);
}

const fm = (name, rx, extra = {}) => ({ name, rx, tx: rx, bw: 12.5, mode: "fm", power: 0, ...extra });

const PMR = Array.from({ length: 16 }, (_, i) => {
	const channel = i + 1;
	const mhz = 446.00625 + i * 0.0125;
	return fm(`PMR${String(channel).padStart(2, "0")}`, mhz, {
		bw: 12.5,
		power: 1,
	});
});

const FRS = [
	462.5625, 462.5875, 462.6125, 462.6375, 462.6625, 462.6875, 462.7125,
	467.5625, 467.5875, 467.6125, 467.6375, 467.6625, 467.6875, 467.7125,
	462.55, 462.575, 462.6, 462.625, 462.65, 462.675, 462.7, 462.725,
].map((mhz, i) => fm(`FRS${String(i + 1).padStart(2, "0")}`, mhz, { bw: 12.5 }));

// [channel name, ship transmit MHz, shore transmit MHz]. From ITU Appendix 18
// as tabulated by the US Coast Guard; channel 70 (DSC) and the 75/76 guard
// channels are deliberately absent.
const MARINE = [
	["M1", 156.05, 160.65], ["M2", 156.1, 160.7], ["M3", 156.15, 160.75], ["M4", 156.2, 160.8],
	["M5", 156.25, 160.85], ["M6", 156.3, 156.3], ["M7", 156.35, 160.95], ["M8", 156.4, 156.4],
	["M9", 156.45, 156.45], ["M10", 156.5, 156.5], ["M11", 156.55, 156.55], ["M12", 156.6, 156.6],
	["M13", 156.65, 156.65], ["M14", 156.7, 156.7], ["M15", 156.75, 156.75], ["M16", 156.8, 156.8],
	["M17", 156.85, 156.85], ["M18", 156.9, 161.5], ["M19", 156.95, 161.55], ["M20", 157.0, 161.6],
	["M21", 157.05, 161.65], ["M22", 157.1, 161.7], ["M23", 157.15, 161.75], ["M24", 157.2, 161.8],
	["M25", 157.25, 161.85], ["M26", 157.3, 161.9], ["M27", 157.35, 161.95], ["M28", 157.4, 162.0],
	["M31", 157.55, 162.15], ["M37A", 157.85, 157.85],
	["M60", 156.025, 160.625], ["M61", 156.075, 160.675], ["M62", 156.125, 160.725], ["M63", 156.175, 160.775],
	["M64", 156.225, 160.825], ["M65", 156.275, 160.875], ["M66", 156.325, 160.925], ["M67", 156.375, 156.375],
	["M68", 156.425, 156.425], ["M69", 156.475, 156.475], ["M71", 156.575, 156.575], ["M72", 156.625, 156.625],
	["M73", 156.675, 156.675], ["M74", 156.725, 156.725], ["M77", 156.875, 156.875], ["M78", 156.925, 161.525],
	["M79", 156.975, 161.575], ["M80", 157.025, 161.625], ["M81", 157.075, 161.675], ["M82", 157.125, 161.725],
	["M83", 157.175, 161.775], ["M84", 157.225, 161.825], ["M85", 157.275, 161.875], ["M86", 157.325, 161.925],
	["M87", 157.375, 157.375], ["M88", 157.425, 157.425],
].map(([name, ship, shore]) => ({ name, rx: shore, tx: ship, bw: 25, mode: "fm", power: 0 }));

const WX = [
	["WX1", 162.55], ["WX2", 162.4], ["WX3", 162.475], ["WX4", 162.425], ["WX5", 162.45],
	["WX6", 162.5], ["WX7", 162.525], ["WX8", 161.65], ["WX9", 161.775], ["WX10", 163.275],
].map(([name, mhz]) => fm(name, mhz, { bw: 25, rxOnly: true }));

const ap = (name, mhz) => fm(name, mhz, { bw: 12.5 });

export const PACKS = [
	{
		id: "r1_calling",
		group: "IARU Region 1",
		title: "Calling and FM simplex",
		summary: "145.500 and 433.500 FM calling, plus the Region 1 2 m and 70 cm simplex channels.",
		regions: ["R1"],
		source: "https://www.iaru-r1.org/reference/band-plans/",
		channels: () => [
			fm("CALL 2M", 145.5),
			fm("SIMP 2M 1", 145.525),
			fm("SIMP 2M 2", 145.55),
			fm("SIMP 2M 3", 145.575),
			fm("CALL 70CM", 433.5),
			fm("SIMP 70C 1", 433.4),
			fm("SIMP 70C 2", 433.425),
			fm("SIMP 70C 3", 433.475),
			fm("SIMP 70C 4", 433.525),
			fm("SIMP 70C 5", 433.55),
			fm("SIMP 70C 6", 433.575),
		],
		notes: "433.450 is the Region 1 digital-voice calling channel and is left out of an analog pack. 23 cm is outside the radios' VHF/UHF range.",
	},
	{
		id: "r2_calling",
		group: "IARU Region 2",
		title: "Calling and FM simplex",
		summary: "146.520 and 446.000 calling, plus the 2 m simplex channels around 146.52.",
		regions: ["R2"],
		source: "https://www.iaru-r2.org/en/band-plans/",
		channels: () => [
			fm("CALL 2M", 146.52),
			fm("SIMP 2M 1", 146.54),
			fm("SIMP 2M 2", 146.56),
			fm("SIMP 2M 3", 146.58),
			fm("CALL 70CM", 446.0),
		],
		notes: "Region 2 has no region-wide 70 cm simplex channel beyond the 446.000 calling frequency.",
	},
	{
		id: "aprs_r1",
		group: "APRS",
		title: "APRS (Region 1)",
		summary: "144.800 terrestrial APRS and 145.825 for the ISS packet system.",
		regions: ["R1"],
		source: "https://www.aprs.org/freq.html",
		channels: () => [ap("APRS 144.800", 144.8), ap("APRS ISS", 145.825)],
		notes: "The builder can also add an APRS position configuration for your location.",
	},
	{
		id: "aprs_r2",
		group: "APRS",
		title: "APRS (Region 2)",
		summary: "144.390 terrestrial APRS and 145.825 for the ISS packet system.",
		regions: ["R2"],
		source: "https://www.aprs.org/freq.html",
		channels: () => [ap("APRS 144.390", 144.39), ap("APRS ISS", 145.825)],
		notes: "144.390 is the North American APRS frequency; some South American countries use 144.800.",
	},
	{
		id: "aprs_r3",
		group: "APRS",
		title: "APRS (Region 3)",
		summary: "The frequencies the Region 3 band plan names, including national exceptions.",
		regions: ["R3"],
		source: "https://www.iaru.org/wp-content/uploads/2020/01/R3-004-IARU-Region-3-Bandplan-rev.2.pdf",
		channels: () => [
			ap("APRS 144.800", 144.8),
			ap("APRS 144.390", 144.39),
			ap("APRS 144.640", 144.64),
			ap("APRS 145.175", 145.175),
			ap("APRS 144.575", 144.575),
			ap("APRS ISS", 145.825),
		],
		notes: "Use 144.800 unless your country is listed for 144.390 (MY, SG, TH, ID) or 144.640 (CN, TW, KR, JP); AU uses 145.175 and NZ 144.575.",
	},
	{
		id: "pmr446",
		group: "Licence-exempt",
		title: "PMR446",
		summary: "All 16 analog PMR446 channels, 446.00625 to 446.19375 MHz.",
		regions: ["R1"],
		countries: ["MY", "SG", "AE", "IN", "VN"],
		source: "https://docdb.cept.org/download/1491",
		channels: () => PMR,
		notes: "Licence-exempt in CEPT countries with a fixed antenna and 0.5 W ERP. Not permitted in the US or Canada.",
	},
	{
		id: "frs",
		group: "Licence-exempt",
		title: "FRS / GMRS",
		summary: "The 22 FRS channels; channels 15–22 are shared with GMRS.",
		regions: ["R2"],
		countries: ["US", "CA", "MX"],
		source: "https://www.fcc.gov/wireless/bureau-divisions/mobility-division/family-radio-service-frs",
		channels: () => FRS,
		notes: "FRS needs no licence in the US and Canada. Transmitting on the 467 MHz GMRS repeater inputs needs a GMRS licence.",
	},
	{
		id: "marine_intl",
		group: "Marine",
		title: "Marine VHF, international",
		summary: "The ITU Appendix 18 channels, with ship and shore frequencies.",
		regions: ["R1", "R2", "R3"],
		source: "https://www.navcen.uscg.gov/marine-vhf-channels",
		channels: () => MARINE,
		notes: "Channel 16 is the distress and calling channel. A marine radio operator certificate may be required.",
	},
	{
		id: "marine_wx",
		group: "Marine",
		title: "NOAA weather channels",
		summary: "WX1–WX10, receive only.",
		regions: ["R2"],
		countries: ["US", "CA", "MX"],
		source: "https://www.weather.gov/nwr/",
		channels: () => WX,
		notes: "Receive-only weather broadcasts; the radio cannot transmit on these channels.",
	},
];

export const PACK_BY_ID = new Map(PACKS.map((pack) => [pack.id, pack]));

export const PACK_ORDER = [
	"r1_calling", "r2_calling", "pmr446", "frs", "marine_intl", "marine_wx",
	"aprs_r1", "aprs_r2", "aprs_r3",
];

export function packsForRegion(region, country) {
	return PACKS.filter((pack) => {
		if (pack.regions.includes(region)) return true;
		return country && pack.countries?.includes(country);
	});
}

export function packApplies(pack, region, country) {
	return pack.regions.includes(region) || (country && pack.countries?.includes(country));
}

export function defaultPacks(region, country) {
	const out = [region === "R2" ? "r2_calling" : region === "R1" ? "r1_calling" : "aprs_r3"];
	out.push(region === "R2" ? "aprs_r2" : region === "R1" ? "aprs_r1" : "aprs_r3");
	if (region === "R1") out.push("pmr446");
	if (region === "R2") out.push("frs");
	return [...new Set(out)];
}

// Channels of the selected packs, in a stable order (calling, licence-exempt,
// marine, then APRS last so the APRS revert channel is easy to find).
export function packChannels(ids, ctx = {}) {
	const chosen = PACK_ORDER.map((id) => PACK_BY_ID.get(id)).filter((pack) => pack && ids.includes(pack.id));
	return chosen.flatMap((pack) => pack.channels(ctx).map((channel) => ({ ...channel, pack: pack.id })));
}
