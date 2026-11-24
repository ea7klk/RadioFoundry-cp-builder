// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// The builder: a codeplug model, its YAML and CSV export, and what the official
// RadioFoundry importer makes of them again.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCodeplug } from "../web/js/build.js";
import { empty, validate } from "../web/vendor/radiofoundry/codeplug/model.js";
import { importQdmr } from "../web/vendor/radiofoundry/codeplug/qdmr.js";
import { importAll } from "../web/vendor/radiofoundry/codeplug/csv.js";
import { makeZip, crc32 } from "../web/js/zip.js";
import { latLonToLocator } from "../web/js/geo.js";

const MALAGA = { lat: 36.7213, lon: -4.4214 };

function dmrRepeater(overrides = {}) {
	return {
		id: 214702,
		callsign: "ED7ZAC",
		city: "MALAGA",
		downlink_mhz: 438.45,
		uplink_mhz: 430.85,
		color_code: 1,
		status: 3,
		talkgroups: [
			{ tg: 21429, slot: 2, name: "Provincial Málaga" },
			{ tg: 214, slot: 1, name: "Spain" },
			{ tg: 91, slot: 1, name: "World-wide" },
		],
		...overrides,
	};
}

function analogRepeater(overrides = {}) {
	return {
		callsign: "ED7YAO",
		downlink_mhz: 145.725,
		uplink_mhz: 145.125,
		tx_tone: "82.5",
		rx_tone: "82.5",
		is_repeater: true,
		mode: "FM",
		...overrides,
	};
}

const base = (overrides = {}) => ({
	location: MALAGA,
	country: "ES",
	region: "R1",
	station: { callsign: "EA7KLK", dmrId: "1234567" },
	packs: ["r1_calling", "aprs_r1", "pmr446"],
	dmr: [],
	analog: [],
	options: { aprsConfig: true, aprsSsid: 7 },
	...overrides,
});

test("an empty request says what is missing", () => {
	const result = buildCodeplug({ location: null, packs: [], dmr: [], analog: [] });
	assert.equal(result.ok, false);
	assert.deepEqual(result.errors.map((error) => error.code).sort(), ["no_location", "nothing_selected"]);
	assert.equal(result.yaml, "");
});

test("a repeater channel uses the repeater's TX as its RX", () => {
	const result = buildCodeplug(base({ dmr: [dmrRepeater()] }));
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	const channel = result.model.channels.find((c) => c.mode === "dmr");
	assert.equal(channel.rxHz, 438_450_000);
	assert.equal(channel.txHz, 430_850_000);
	assert.equal(channel.colorCode, 1);
	assert.equal(channel.timeslot, 2, "the first talkgroup's slot sets the channel slot");
});

test("the first talkgroup the API lists becomes the default contact", () => {
	const result = buildCodeplug(base({ dmr: [dmrRepeater()] }));
	const channel = result.model.channels.find((c) => c.mode === "dmr");
	assert.equal(channel.contact.id, 21429);
	assert.equal(channel.contact.name, "Provincial Malag");
	assert.deepEqual(channel.rxList.contacts.map((c) => c.id), [21429, 214, 91]);
});

test("all selected repeaters' talkgroups go into contacts and lists", () => {
	const second = dmrRepeater({
		id: 214706,
		callsign: "EA7URV",
		downlink_mhz: 438.75,
		uplink_mhz: 431.15,
		talkgroups: [
			{ tg: 214, slot: 1, name: "Spain" },
			{ tg: 2142, slot: 1, name: "Andalucía" },
		],
	});
	const result = buildCodeplug(base({ dmr: [dmrRepeater(), second] }));
	assert.equal(result.model.contacts.length, 4, "21429, 214, 91, 2142, and 214 is shared");
	assert.deepEqual(result.model.rxLists.map((list) => list.contacts.length), [3, 2]);
	assert.equal(result.model.zones.find((zone) => zone.name === "DMR").channels.length, 2);
});

test("a repeater with no talkgroups falls back to TG 9 and says so", () => {
	const result = buildCodeplug(base({ dmr: [dmrRepeater({ talkgroups: [] })] }));
	const channel = result.model.channels.find((c) => c.mode === "dmr");
	assert.equal(channel.contact.id, 9);
	assert.ok(result.warnings.some((warning) => warning.code === "no_talkgroups"));
});

test("the TG 9 fallback can be turned off", () => {
	const result = buildCodeplug(base({
		dmr: [dmrRepeater({ talkgroups: [] })],
		options: { aprsConfig: false, fallbackTg: false },
	}));
	const channel = result.model.channels.find((c) => c.mode === "dmr");
	assert.equal(channel.contact, null);
	assert.ok(result.warnings.some((warning) => warning.code === "no_default_contact"));
});

test("more talkgroups than a list holds are cut, with a warning", () => {
	const talkgroups = Array.from({ length: 40 }, (_, n) => ({ tg: 1000 + n, slot: 1, name: `TG ${1000 + n}` }));
	const result = buildCodeplug(base({ dmr: [dmrRepeater({ talkgroups })] }));
	const list = result.model.rxLists[0];
	assert.equal(list.contacts.length, 32);
	assert.equal(result.model.contacts.length, 32);
	assert.ok(result.warnings.some((warning) => warning.code === "rx_list_truncated"));
});

test("analog repeaters keep their shift and tones", () => {
	const result = buildCodeplug(base({
		packs: [],
		dmr: [],
		analog: [analogRepeater(), analogRepeater({ callsign: "ED7YAP", tx_tone: "D023N", rx_tone: "", downlink_mhz: 145.65, uplink_mhz: 145.05 })],
		options: { aprsConfig: false },
	}));
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	const [first, second] = result.model.channels;
	assert.equal(first.rxHz, 145_725_000);
	assert.equal(first.txHz, 145_125_000);
	assert.equal(first.txTone, "82.5");
	assert.equal(first.rxTone, "82.5");
	assert.equal(second.txTone, "D023N");
	assert.equal(second.rxTone, "");
});

test("an unreadable tone is dropped and reported, not written", () => {
	const result = buildCodeplug(base({
		packs: [],
		dmr: [],
		analog: [analogRepeater({ tx_tone: "CC1" })],
		options: { aprsConfig: false },
	}));
	assert.equal(result.model.channels[0].txTone, "");
	assert.ok(result.warnings.some((warning) => warning.code === "tones_dropped"));
});

test("a repeater without a tone is flagged", () => {
	const result = buildCodeplug(base({ packs: [], dmr: [], analog: [analogRepeater({ tx_tone: "" })], options: { aprsConfig: false } }));
	assert.ok(result.warnings.some((warning) => warning.code === "analog_no_tone"));
});

test("standard packs land in their own zone and keep their frequencies", () => {
	const result = buildCodeplug(base({ dmr: [], analog: [] }));
	const standards = result.model.zones.find((zone) => zone.name === "STANDARD");
	assert.ok(standards);
	assert.equal(standards.channels.length, 11 + 16, "r1_calling plus PMR446");
	const pmr = result.model.channels.find((channel) => channel.name === "PMR01");
	assert.equal(pmr.rxHz, 446_006_250);
	assert.equal(pmr.txHz, 446_006_250);
	assert.equal(pmr.mode, "fm");
});

test("receive-only weather channels never transmit on another frequency", () => {
	const result = buildCodeplug(base({ region: "R2", country: "US", packs: ["marine_wx"], dmr: [], analog: [], options: { aprsConfig: false } }));
	for (const channel of result.model.channels) {
		assert.equal(channel.rxOnly, true);
		assert.equal(channel.txHz, channel.rxHz);
	}
});

test("APRS is a fixed position at the chosen point on the region's frequency", () => {
	const result = buildCodeplug(base({ dmr: [], analog: [] }));
	assert.equal(result.model.aprs.length, 1);
	const aprs = result.model.aprs[0];
	assert.equal(aprs.name, "EA7KLK-7");
	assert.equal(aprs.ssid, 7);
	assert.equal(aprs.lat, 36.7213);
	assert.equal(aprs.lon, -4.4214);
	assert.equal(aprs.useFixed, true);
	assert.equal(aprs.txHz, 144_800_000);
	const channel = result.model.channels.find((c) => c.aprs === aprs);
	assert.equal(channel.rxHz, 144_800_000);
	assert.equal(result.model.zones.find((zone) => zone.name === "APRS").channels.length, 2);
});

test("an American callsign gets 144.390 and a five character locator in the comment", () => {
	const result = buildCodeplug(base({
		country: "US",
		region: "R2",
		station: { callsign: "N0CALL", dmrId: "1234567" },
		packs: ["aprs_r2"],
		options: { aprsConfig: true, aprsSsid: 9 },
	}));
	const aprs = result.model.aprs[0];
	assert.equal(aprs.txHz, 144_390_000);
	assert.equal(aprs.name, "N0CALL-9");
	assert.match(aprs.comment, /^[A-R]{2}[0-9]{2}[A-X]{2}$/);
});

test("the APRS configuration can be left out", () => {
	const result = buildCodeplug(base({ options: { aprsConfig: false } }));
	assert.equal(result.model.aprs.length, 0);
});

test("a long callsign is cut to the radio's eight characters and reported", () => {
	const result = buildCodeplug(base({ station: { callsign: "EA7KLK/P", dmrId: "1234567" }, options: { aprsConfig: false } }));
	assert.equal(result.model.general.radioName.length <= 8, true);
});

test("a missing DMR ID is a warning, not an error", () => {
	const result = buildCodeplug(base({ station: { callsign: "EA7KLK", dmrId: "" }, dmr: [dmrRepeater()] }));
	assert.equal(result.ok, true);
	assert.ok(result.warnings.some((warning) => warning.code === "no_dmr_id"));
	assert.equal(result.model.general.dmrId, 0);
});

test("channel names stay unique when two repeaters share a callsign", () => {
	const twin = dmrRepeater({ id: 214799 });
	const result = buildCodeplug(base({ dmr: [dmrRepeater(), twin] }));
	const names = result.model.channels.map((channel) => channel.name);
	assert.equal(new Set(names).size, names.length);
});

test("a name longer than the field is shortened and reported", () => {
	const result = buildCodeplug(base({
		packs: [],
		dmr: [dmrRepeater({ talkgroups: [{ tg: 21429, slot: 2, name: "Provincial Malaga Province" }] })],
		analog: [],
		options: { aprsConfig: false },
	}));
	const contact = result.model.contacts[0];
	assert.equal(contact.name.length, 16);
	assert.ok(result.warnings.some((warning) => warning.code === "names_truncated"));
});

test("the model the builder hands over has no validation errors", () => {
	const result = buildCodeplug(base({ dmr: [dmrRepeater()], analog: [analogRepeater()] }));
	assert.deepEqual(validate(result.model).filter((problem) => problem.level === "error"), []);
});

test("the YAML the builder writes imports back through the vendored importer", () => {
	const result = buildCodeplug(base({ dmr: [dmrRepeater()], analog: [analogRepeater()] }));
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	const model = empty();
	importQdmr(model, result.yaml);
	assert.equal(model.channels.length, result.model.channels.length);
	assert.equal(model.contacts.length, result.model.contacts.length);
	assert.equal(model.rxLists.length, result.model.rxLists.length);
	assert.equal(model.aprs.length, 1);
	const dmr = model.channels.find((channel) => channel.mode === "dmr");
	assert.equal(dmr.rxHz, 438_450_000);
	assert.equal(dmr.txHz, 430_850_000);
	assert.equal(dmr.colorCode, 1);
	assert.equal(dmr.timeslot, 2);
	assert.equal(dmr.contact.id, 21429);
	assert.deepEqual(dmr.rxList.contacts.map((contact) => contact.id), [21429, 214, 91]);
	assert.equal(model.general.dmrId, 1234567);
	const aprs = model.aprs[0];
	assert.equal(aprs.useFixed, true);
	// qDMR stores a position as a locator, so the position comes back as that square's centre
	assert.equal(latLonToLocator(aprs.lat, aprs.lon, 6), "IM76SR");
});

test("the CSV set imports back through the vendored importer", () => {
	const result = buildCodeplug(base({ dmr: [dmrRepeater()], analog: [analogRepeater()] }));
	const model = empty();
	const { results, skipped } = importAll(model, result.csvFiles.map((file) => ({ name: file.name, text: file.text })));
	assert.deepEqual(skipped, []);
	assert.ok(results.length >= 6);
	const channels = results.find((entry) => entry.table === "channels");
	assert.equal(channels.problems.length, 0);
	assert.equal(model.channels.length, result.model.channels.length);
	assert.equal(model.zones.length, result.model.zones.length);
	const analog = model.channels.find((channel) => channel.name === "ED7YAO");
	assert.equal(analog.txTone, "82.5");
});

test("too many repeaters is an error, not a broken file", () => {
	const repeaters = Array.from({ length: 80 }, (_, n) =>
		dmrRepeater({
			id: 300000 + n,
			callsign: `ED7ZZ${n}`,
			talkgroups: Array.from({ length: 20 }, (_, k) => ({ tg: 5000 + n * 20 + k, slot: 1, name: `TG ${5000 + n * 20 + k}` })),
		}),
	);
	const result = buildCodeplug(base({ packs: [], dmr: repeaters, analog: [], options: { aprsConfig: false } }));
	assert.equal(result.ok, false);
	assert.ok(result.errors.some((error) => error.code === "too_many_contacts" || error.code === "too_many_rx_lists"));
	assert.equal(result.yaml, "");
});

test("selected packs from another region are added with a warning", () => {
	const result = buildCodeplug(base({ packs: ["frs"], dmr: [], analog: [], options: { aprsConfig: false } }));
	assert.equal(result.ok, true);
	assert.ok(result.warnings.some((warning) => warning.code === "pack_region"));
	assert.equal(result.model.channels.length, 22);
});

test("the same repeater selected twice is built once", () => {
	const result = buildCodeplug(base({ dmr: [dmrRepeater(), dmrRepeater()] }));
	assert.equal(result.model.channels.filter((channel) => channel.mode === "dmr").length, 1);
});

test("the zip writer makes an archive with the right checksums", () => {
	const files = [{ name: "channels.csv", text: "Name,RX\nA,145.5\n" }];
	const zip = makeZip(files, new Date("2026-11-24T12:00:00Z"));
	assert.equal(zip[0], 0x50);
	assert.equal(zip[1], 0x4b);
	const view = new DataView(zip.buffer);
	assert.equal(view.getUint32(0, true), 0x04034b50);
	const encoder = new TextEncoder();
	assert.equal(view.getUint32(14, true), crc32(encoder.encode(files[0].text)));
	assert.equal(view.getUint32(18, true), encoder.encode(files[0].text).length);
});

// --- DMR simplex ---

const simplex = (overrides = {}) => ({ enabled: true, plan: "es", choice: "tg99", includeAccess: false, ...overrides });

test("DMR simplex channels are built on the chosen talkgroup", () => {
	const result = buildCodeplug(base({ packs: [], dmr: [], analog: [], dmrSimplex: simplex(), options: { aprsConfig: false } }));
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.equal(result.summary.dmrSimplex, 9);
	const calling = result.model.channels.find((channel) => channel.name === "CQDVHF TG99");
	assert.ok(calling);
	assert.equal(calling.mode, "dmr");
	assert.equal(calling.rxHz, 145_375_000);
	assert.equal(calling.txHz, 145_375_000);
	assert.equal(calling.colorCode, 1);
	assert.equal(calling.timeslot, 1);
	assert.equal(calling.dmo, true);
	assert.equal(calling.contact.id, 99);
	assert.equal(calling.contact.type, "group");
	assert.equal(calling.contact.name, "Simplex");
	assert.deepEqual(result.model.zones.map((zone) => zone.name), ["DMR SIMPLEX"]);
});

test("AllCall uses the 24-bit all-call id and the all call type", () => {
	const result = buildCodeplug(base({ packs: [], dmr: [], analog: [], dmrSimplex: simplex({ choice: "all" }), options: { aprsConfig: false } }));
	const channel = result.model.channels[0];
	assert.equal(channel.name, "CQDVHF ALL");
	assert.equal(channel.contact.id, 0xffffff);
	assert.equal(channel.contact.type, "all");
	assert.equal(channel.contact.name, "AllCall");
	assert.equal(result.model.contacts.length, 1);
});

test("both gives two channels per frequency, each naming its contact", () => {
	const result = buildCodeplug(base({ packs: [], dmr: [], analog: [], dmrSimplex: simplex({ choice: "both" }), options: { aprsConfig: false } }));
	assert.equal(result.summary.dmrSimplex, 18);
	const names = result.model.channels.map((channel) => channel.name);
	assert.ok(names.includes("SOTA-U TG99"));
	assert.ok(names.includes("SOTA-U ALL"));
	assert.equal(result.model.contacts.length, 2);
	const tg = result.model.channels.find((channel) => channel.name === "SOTA-U TG99");
	const all = result.model.channels.find((channel) => channel.name === "SOTA-U ALL");
	assert.equal(tg.rxHz, all.rxHz);
	assert.equal(tg.contact.id, 99);
	assert.equal(all.contact.id, 0xffffff);
	assert.ok(result.notes.some((note) => note.code === "simplex_both"));
});

test("access-point frequencies are optional and sit on slot 2", () => {
	const result = buildCodeplug(base({ packs: [], dmr: [], analog: [], dmrSimplex: simplex({ includeAccess: true }), options: { aprsConfig: false } }));
	assert.equal(result.summary.dmrAccess, 12);
	const access = result.model.channels.find((channel) => channel.name === "PA1-V TG99");
	assert.equal(access.rxHz, 144_812_500);
	assert.equal(access.timeslot, 2);
	assert.deepEqual(result.model.zones.map((zone) => zone.name), ["DMR SIMPLEX", "DMR ACCESS"]);
});

test("simplex channels survive the YAML round trip with their contact type", () => {
	const result = buildCodeplug(base({ packs: [], dmr: [], analog: [], dmrSimplex: simplex({ choice: "both", includeAccess: true }), options: { aprsConfig: false } }));
	const model = empty();
	importQdmr(model, result.yaml);
	assert.equal(model.channels.length, 42);
	const all = model.channels.find((channel) => channel.name === "CQDUHF ALL");
	assert.equal(all.contact.type, "all");
	assert.equal(all.contact.id, 0xffffff);
	assert.equal(all.dmo, true);
	assert.equal(all.rxHz, 433_450_000);
	const access = model.channels.find((channel) => channel.name === "PA6-U TG99");
	assert.equal(access.timeslot, 2);
});

test("simplex channels survive the CSV round trip", () => {
	const result = buildCodeplug(base({ packs: [], dmr: [], analog: [], dmrSimplex: simplex({ choice: "both" }), options: { aprsConfig: false } }));
	const model = empty();
	const { results } = importAll(model, result.csvFiles.map((file) => ({ name: file.name, text: file.text })));
	assert.deepEqual(results.find((entry) => entry.table === "channels").problems, []);
	assert.equal(model.channels.length, 18);
	assert.equal(model.contacts.find((contact) => contact.type === "all").id, 0xffffff);
});

test("the Spanish plan used outside Spain is flagged", () => {
	const result = buildCodeplug(base({ country: "DE", packs: [], dmr: [], analog: [], dmrSimplex: simplex(), options: { aprsConfig: false } }));
	assert.ok(result.warnings.some((warning) => warning.code === "simplex_country"));
});

test("simplex alone is a complete request", () => {
	const result = buildCodeplug({ location: MALAGA, country: "ES", region: "R1", station: {}, packs: [], dmr: [], analog: [], dmrSimplex: simplex(), options: { aprsConfig: false } });
	assert.equal(result.ok, true);
	assert.equal(result.model.channels.length, 9);
});

test("an unknown simplex contact falls back to TG 99 and says so", () => {
	const result = buildCodeplug(base({ packs: [], dmr: [], analog: [], dmrSimplex: simplex({ choice: "nonsense" }), options: { aprsConfig: false } }));
	assert.equal(result.model.channels[0].contact.id, 99);
	assert.ok(result.warnings.some((warning) => warning.code === "simplex_contact_unknown"));
});

// --- bands and prefixes ---

test("marine channels keep the MAR- prefix in the codeplug", () => {
	const result = buildCodeplug(base({ packs: ["marine_intl"], dmr: [], analog: [], options: { aprsConfig: false } }));
	const names = result.model.channels.map((channel) => channel.name);
	assert.ok(names.includes("MAR-16"));
	assert.ok(names.includes("MAR-37A"));
	assert.equal(names.filter((name) => name.startsWith("MAR-")).length, 56);
});

test("a UHF analog repeater becomes a UHF channel with its tone", () => {
	const result = buildCodeplug(base({
		packs: [],
		dmr: [],
		analog: [analogRepeater({ callsign: "ED7YAE", downlink_mhz: 438.65, uplink_mhz: 431.05, tx_tone: "82.5", rx_tone: "" })],
		options: { aprsConfig: false },
	}));
	const channel = result.model.channels[0];
	assert.equal(channel.rxHz, 438_650_000);
	assert.equal(channel.txHz, 431_050_000);
	assert.equal(channel.txTone, "82.5");
	assert.equal(channel.rxTone, "");
	assert.equal(channel.mode, "fm");
});

test("VHF and UHF repeaters from both sources land in one zone", () => {
	const result = buildCodeplug(base({
		packs: [],
		dmr: [],
		analog: [
			analogRepeater({ callsign: "ED7YAD", downlink_mhz: 145.7, uplink_mhz: 145.1 }),
			analogRepeater({ callsign: "ED7YAE", downlink_mhz: 438.65, uplink_mhz: 431.05 }),
		],
		options: { aprsConfig: false },
	}));
	const zone = result.model.zones.find((entry) => entry.name === "ANALOG");
	assert.equal(zone.channels.length, 2);
	assert.deepEqual(result.model.channels.map((channel) => channel.rxHz).sort((a, b) => a - b), [145_700_000, 438_650_000]);
});

// --- timeslot overrides on talkgroup contacts ---

test("a talkgroup contact carries the slot its repeater publishes", () => {
	const result = buildCodeplug(base({ dmr: [dmrRepeater()] }));
	const byId = new Map(result.model.contacts.map((contact) => [contact.id, contact]));
	assert.equal(byId.get(21429).timeslot, 2, "Provincial Malaga is on TS2 at this repeater");
	assert.equal(byId.get(214).timeslot, 1);
	assert.equal(byId.get(91).timeslot, 1);
});

test("a talkgroup without a published slot gets no override", () => {
	const result = buildCodeplug(base({ dmr: [dmrRepeater({ talkgroups: [{ tg: 9, slot: 0, name: "Local" }] })] }));
	assert.equal(result.model.contacts[0].timeslot, 0);
});

test("the TG 9 fallback has no override", () => {
	const result = buildCodeplug(base({ dmr: [dmrRepeater({ talkgroups: [] })] }));
	const contact = result.model.channels.find((channel) => channel.mode === "dmr").contact;
	assert.equal(contact.id, 9);
	assert.equal(contact.timeslot, 0);
});

test("the same talkgroup on two slots becomes two contacts, each named for its slot", () => {
	const second = dmrRepeater({
		id: 214706,
		callsign: "EA7URV",
		talkgroups: [{ tg: 214, slot: 2, name: "Spain" }, { tg: 91, slot: 1, name: "World-wide" }],
	});
	const result = buildCodeplug(base({ dmr: [dmrRepeater(), second] }));
	const spains = result.model.contacts.filter((contact) => contact.id === 214);
	assert.equal(spains.length, 2, "one record per override");
	assert.deepEqual(spains.map((contact) => contact.timeslot).sort(), [1, 2]);
	assert.deepEqual(spains.map((contact) => contact.name).sort(), ["Spain TS1", "Spain TS2"]);
	// a talkgroup on one slot keeps its plain name
	assert.deepEqual(result.model.contacts.filter((contact) => contact.id === 91).map((contact) => contact.name), ["World-wide"]);
	const lists = new Map(result.model.rxLists.map((list) => [list.name, list.contacts]));
	assert.deepEqual(lists.get("ED7ZAC").map((contact) => `${contact.id}:${contact.timeslot}`), ["21429:2", "214:1", "91:1"]);
	assert.deepEqual(lists.get("EA7URV").map((contact) => `${contact.id}:${contact.timeslot}`), ["214:2", "91:1"]);
	assert.ok(result.notes.some((note) => note.code === "timeslot_split"));
});

test("each channel's default contact is the one for its own slot", () => {
	const second = dmrRepeater({ id: 214706, callsign: "EA7URV", talkgroups: [{ tg: 214, slot: 2, name: "Spain" }] });
	const result = buildCodeplug(base({ dmr: [dmrRepeater(), second] }));
	const [first, other] = result.model.channels.filter((channel) => channel.mode === "dmr");
	assert.equal(first.contact.id, 21429);
	assert.equal(other.contact.id, 214);
	assert.equal(other.contact.timeslot, 2);
	assert.equal(other.timeslot, 2);
});

test("a slot given as a string is read, anything else is no override", () => {
	const result = buildCodeplug(base({
		packs: [],
		analog: [],
		dmr: [dmrRepeater({ talkgroups: [{ tg: 214, slot: "2", name: "Spain" }, { tg: 91, slot: "x", name: "World-wide" }] })],
		options: { aprsConfig: false },
	}));
	assert.equal(result.model.contacts.find((contact) => contact.id === 214).timeslot, 2);
	assert.equal(result.model.contacts.find((contact) => contact.id === 91).timeslot, 0);
});

test("timeslot overrides survive the YAML round trip", () => {
	const second = dmrRepeater({ id: 214706, callsign: "EA7URV", talkgroups: [{ tg: 214, slot: 2, name: "Spain" }] });
	const result = buildCodeplug(base({ packs: [], analog: [], dmr: [dmrRepeater(), second], options: { aprsConfig: false } }));
	assert.match(result.yaml, /timeSlotOverride: TS2/);
	const model = empty();
	importQdmr(model, result.yaml);
	const spains = model.contacts.filter((contact) => contact.id === 214);
	assert.deepEqual(spains.map((contact) => contact.timeslot).sort(), [1, 2]);
	assert.equal(model.channels.find((channel) => channel.name === "EA7URV").contact.timeslot, 2);
});

test("timeslot overrides survive the CSV round trip", () => {
	const result = buildCodeplug(base({ packs: [], analog: [], dmr: [dmrRepeater()], options: { aprsConfig: false } }));
	const contactsCsv = result.csvFiles.find((file) => file.name === "contacts.csv").text;
	assert.match(contactsCsv, /Provincial Malag,21429,Group,2/);
	const model = empty();
	const { results } = importAll(model, result.csvFiles.map((file) => ({ name: file.name, text: file.text })));
	assert.deepEqual(results.find((entry) => entry.table === "contacts").problems, []);
	assert.equal(model.contacts.find((contact) => contact.id === 21429).timeslot, 2);
	assert.equal(model.channels[0].contact.timeslot, 2);
});
