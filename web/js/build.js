// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// Turns the builder's choices into a RadioFoundry codeplug model and the two
// interchange files the official editor reads: qDMR YAML and RadioFoundry's
// CSV tables. Pure JavaScript (no DOM) so the Node tests exercise the same code
// the browser runs.

import { empty, newChannel, newContact, validate } from "../vendor/radiofoundry/codeplug/model.js";
import { parseTone, nameBytes } from "../vendor/radiofoundry/codeplug/fields.js";
import { exportQdmr } from "../vendor/radiofoundry/codeplug/qdmr.js";
import { exportAll } from "../vendor/radiofoundry/codeplug/csv.js";
import { PACK_BY_ID, PACK_ORDER, packApplies, packChannels, aprsFrequencyFor } from "./packs.js";
import { latLonToLocator, validLat, validLon } from "./geo.js";

export const CHANNEL_LIMIT = 1024;
export const CONTACT_LIMIT = 1024;
export const RX_LIST_LIMIT = 76;
export const ZONE_LIMIT = 68;
export const RX_LIST_CONTACTS = 32;
export const ZONE_CHANNELS = 80;

const hz = (mhz) => Math.round(Number(mhz) * 1e5) * 10;

// ASCII, no combining marks: the radio's name field is Latin-1 and a DMR
// contact name that crosses the radio's font would arrive as question marks.
export function asciiName(value, fallback = "") {
	const text = String(value ?? "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^\x20-\x7E]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text || fallback;
}

function fit(text, max) {
	let out = text;
	while (out && nameBytes(out) > max) out = [...out].slice(0, -1).join("");
	return out;
}

function uniqueName(value, used, max, fallback) {
	const base = fit(asciiName(value, fallback), max).trim() || fallback;
	if (!used.has(base)) {
		used.add(base);
		return base;
	}
	for (let n = 2; n < 1000; n++) {
		const suffix = ` ${n}`;
		const stem = fit(base, max - nameBytes(suffix)).trim();
		const candidate = `${stem}${suffix}`;
		if (!used.has(candidate)) {
			used.add(candidate);
			return candidate;
		}
	}
	const candidate = fit(`${fallback}${used.size}`, max);
	used.add(candidate);
	return candidate;
}

const PROBLEMS = {
	no_dmr_id: "No DMR ID: the radio needs one before it can transmit on DMR.",
	no_name: "A record has no name.",
	too_long: "A name is longer than the radio stores and was cut.",
	bad_freq: "A frequency is outside the range the radio accepts.",
	bad_tone: "A tone is not a CTCSS or DCS tone the radio accepts.",
	range: "A value is outside the radio's range.",
	no_contact: "A DMR channel has no default contact.",
	duplicate: "Two records share a name; one was renamed.",
	too_many: "There are more records than the radio holds.",
	dangling: "A reference points at a record that is not in the codeplug.",
	out_of_band: "A frequency is outside the radio's band.",
	no_name_zone: "A zone has no name.",
};

function problemText(problem) {
	const base = PROBLEMS[problem.code] || problem.code;
	const where = problem.item?.name || problem.item?.number;
	const table = problem.table ? `${problem.table}${where ? ` / ${where}` : ""}: ` : "";
	const params = problem.params && Object.keys(problem.params).length
		? ` (${Object.entries(problem.params).map(([k, v]) => `${k} ${v}`).join(", ")})`
		: "";
	return `${table}${base}${params}`;
}

const QDMR_NOTES = {
	location_rounded: "A channel location was rounded to the locator the radio stores.",
	sfr: "A single-frequency repeat setting was left out of the YAML.",
	tone_burst: "A tone burst setting has no qDMR field and was left out.",
	power_level: "A power level has no qDMR name and was left out.",
	aprs_no_channel: "An APRS configuration has no matching FM channel.",
	icon_export: "An APRS icon has no qDMR name and was exported as None.",
	aprs_flags: "APRS silent/ambiguity flags have no qDMR field.",
};

export function buildCodeplug(input) {
	const warnings = [];
	const notes = [];
	const errors = [];
	const addWarning = (code, message) => {
		if (!warnings.some((w) => w.code === code && w.message === message)) warnings.push({ code, message });
	};
	const addNote = (code, message) => {
		if (!notes.some((n) => n.code === code && n.message === message)) notes.push({ code, message });
	};
	const addError = (code, message) => {
		if (!errors.some((e) => e.code === code && e.message === message)) errors.push({ code, message });
	};

	const location = input.location || {};
	const station = input.station || {};
	const options = input.options || {};
	const region = input.region || "R1";
	const country = String(input.country || "").toUpperCase();
	const selectedPacks = Array.isArray(input.packs) ? input.packs : [];
	const selectedDmr = Array.isArray(input.dmr) ? input.dmr : [];
	const selectedAnalog = Array.isArray(input.analog) ? input.analog : [];

	if (!validLat(Number(location.lat)) || !validLon(Number(location.lon))) {
		addError("no_location", "Set your latitude and longitude first.");
	}
	if (!selectedPacks.length && !selectedDmr.length && !selectedAnalog.length) {
		addError("nothing_selected", "Select at least one pack, DMR repeater or analog repeater.");
	}

	const model = empty();
	const callsign = asciiName(station.callsign, "").toUpperCase().replace(/[^A-Z0-9/]/g, "");
	if (!callsign) {
		addWarning("no_callsign", "No callsign: the radio name and APRS configuration are left empty.");
	} else {
		if (nameBytes(callsign) > 8) addWarning("callsign_long", `Callsign ${callsign} is longer than the 8 characters the radio shows; it was cut.`);
		model.general.radioName = fit(callsign, 8);
	}
	const dmrId = Number.parseInt(String(station.dmrId ?? ""), 10);
	if (Number.isInteger(dmrId) && dmrId > 0 && dmrId <= 0xFFFFFF) {
		model.general.dmrId = dmrId;
	} else if (selectedDmr.length) {
		addWarning("no_dmr_id", "No valid DMR ID: DMR channels will be built, but the radio needs an ID to transmit.");
	}

	for (const id of selectedPacks) {
		const pack = PACK_BY_ID.get(id);
		if (!pack) continue;
		if (!packApplies(pack, region, country)) {
			addWarning("pack_region", `${pack.title} is not part of ${region}${country ? `/${country}` : ""}; it was added anyway.`);
		}
	}

	const usedChannelNames = new Set();
	const usedContactNames = new Set();
	const usedListNames = new Set();
	const usedZoneNames = new Set();
	const contactsByTg = new Map();
	let foldedNames = 0;
	let truncatedNames = 0;
	let badTones = 0;

	const cleanChannelName = (value, fallback) => {
		const name = uniqueName(value, usedChannelNames, 16, fallback);
		if (name.length < asciiName(value, fallback).length) truncatedNames++;
		return name;
	};

	const contactFor = (tg) => {
		const id = Number(tg.tg);
		if (contactsByTg.has(id)) return contactsByTg.get(id);
		const raw = String(tg.name || `TG ${id}`);
		const name = uniqueName(raw, usedContactNames, 16, `TG ${id}`);
		if (asciiName(raw, "") !== raw) foldedNames++;
		if (name.length < asciiName(raw, "").length) truncatedNames++;
		const contact = newContact({ number: null, name, id, type: "group", timeslot: 0 });
		model.contacts.push(contact);
		contactsByTg.set(id, contact);
		return contact;
	};

	const tone = (value) => {
		const parsed = parseTone(value ?? "");
		if (parsed === null) {
			badTones++;
			return "";
		}
		return parsed;
	};

	const dmrChannels = [];
	const analogChannels = [];
	const standardChannels = [];
	const aprsChannels = [];
	const seenDevices = new Set();

	for (const repeater of selectedDmr) {
		if (!repeater || seenDevices.has(repeater.id)) continue;
		seenDevices.add(repeater.id);
		let talkgroups = Array.isArray(repeater.talkgroups) ? repeater.talkgroups.filter((tg) => tg && Number(tg.tg) > 0) : [];
		if (!talkgroups.length && options.fallbackTg !== false) {
			talkgroups = [{ tg: 9, slot: 0, name: "Local", fallback: true }];
			addWarning(
				"no_talkgroups",
				`${repeater.callsign || repeater.id}: no static talkgroups came back from Brandmeister; TG 9 (Local) is the default contact.`,
			);
		}
		const contacts = talkgroups.slice(0, RX_LIST_CONTACTS).map(contactFor);
		if (talkgroups.length > RX_LIST_CONTACTS) {
			addWarning(
				"rx_list_truncated",
				`${repeater.callsign || repeater.id}: ${talkgroups.length} talkgroups, but an RX group list holds ${RX_LIST_CONTACTS}; the rest are not in the list.`,
			);
		}
		let list = null;
		if (contacts.length) {
			list = {
				number: null,
				name: uniqueName(repeater.callsign || `DMR ${repeater.id}`, usedListNames, 16, "DMR"),
				contacts,
			};
			model.rxLists.push(list);
		}
		const first = contacts[0] || null;
		if (!first) {
			addWarning("no_default_contact", `${repeater.callsign || repeater.id}: no talkgroup to use as the default contact.`);
		}
		const channel = newChannel({
			number: null,
			name: cleanChannelName(repeater.callsign || `DMR ${repeater.id}`, "DMR"),
			rxHz: hz(repeater.downlink_mhz),
			txHz: hz(repeater.uplink_mhz),
			mode: "dmr",
			power: 0,
			colorCode: Math.max(0, Math.min(15, Number(repeater.color_code) || 0)),
			timeslot: talkgroups[0]?.slot === 2 ? 2 : 1,
			contact: first,
			rxList: list,
		});
		model.channels.push(channel);
		dmrChannels.push(channel);
	}

	const seenAnalog = new Set();
	for (const repeater of selectedAnalog) {
		const key = `${repeater.callsign}:${repeater.downlink_mhz}:${repeater.uplink_mhz}`;
		if (!repeater || seenAnalog.has(key)) continue;
		seenAnalog.add(key);
		if (!repeater.tx_tone) {
			addWarning(
				"analog_no_tone",
				`${repeater.callsign || "analog repeater"} at ${Number(repeater.downlink_mhz).toFixed(4)} MHz has no tone listed; if it needs one, set it in the editor.`,
			);
		}
		const channel = newChannel({
			number: null,
			name: cleanChannelName(repeater.callsign || "ANALOG", "ANALOG"),
			rxHz: hz(repeater.downlink_mhz),
			txHz: hz(repeater.uplink_mhz),
			mode: "fm",
			power: 0,
			bw: 12.5,
			txTone: tone(repeater.tx_tone),
			rxTone: tone(repeater.rx_tone),
		});
		model.channels.push(channel);
		analogChannels.push(channel);
	}

	for (const spec of packChannels(selectedPacks, { region, country })) {
		const channel = newChannel({
			number: null,
			name: cleanChannelName(spec.name, "CH"),
			rxHz: hz(spec.rx),
			txHz: hz(spec.tx ?? spec.rx),
			mode: spec.mode || "fm",
			power: Number.isInteger(spec.power) ? spec.power : 0,
			bw: spec.bw ?? 12.5,
			rxOnly: !!spec.rxOnly,
			txTone: tone(spec.txTone),
			rxTone: tone(spec.rxTone),
			allSkip: false,
		});
		if (spec.rxOnly) channel.txHz = channel.rxHz;
		model.channels.push(channel);
		standardChannels.push(channel);
		if (String(spec.pack || "").startsWith("aprs_")) aprsChannels.push({ channel, spec });
	}

	if (foldedNames) addWarning("names_folded", `${foldedNames} talkgroup name(s) lost non-ASCII characters the radio cannot show.`);
	if (truncatedNames) addWarning("names_truncated", `${truncatedNames} name(s) were shortened to the radio's 16-character field.`);
	if (badTones) addWarning("tones_dropped", `${badTones} CTCSS/DCS tone(s) could not be read and were left empty.`);

	// APRS: a fixed position at the chosen location, on the region's usual
	// frequency, linked to that channel's revert setting.
	if (options.aprsConfig !== false && model.general.radioName && aprsChannels.length) {
		const wanted = hz(aprsFrequencyFor(country));
		const target = aprsChannels.find((entry) => entry.channel.rxHz === wanted) || aprsChannels[0];
		const ssid = Math.max(0, Math.min(15, Number(options.aprsSsid ?? 7) || 0));
		const aprsName = fit(`${callsign}-${ssid}`, 8);
		if (aprsName !== `${callsign}-${ssid}`) {
			addWarning("aprs_name_long", `APRS name ${callsign}-${ssid} is longer than 8 characters and was cut; the SSID may be missing.`);
		}
		const locator = latLonToLocator(Number(location.lat), Number(location.lon), 6);
		const entry = {
			number: null,
			name: aprsName,
			ssid,
			lat: Number(location.lat),
			lon: Number(location.lon),
			useFixed: true,
			txHz: target.channel.rxHz,
			path1: "WIDE1",
			path2: "WIDE2",
			symTable: "/",
			symCode: ">",
			comment: locator.slice(0, 23),
			baud300: false,
			qsy: true,
			silent: false,
			ambiguity: 0,
		};
		model.aprs.push(entry);
		target.channel.aprs = entry;
		addNote("aprs_config", `APRS position ${locator} added on ${(target.channel.rxHz / 1e6).toFixed(3)} MHz as ${aprsName}.`);
	}

	// Zones: one per kind, split when a zone would hold more than 80 channels.
	const addZones = (base, channels) => {
		if (!channels.length) return;
		for (let index = 0; index < channels.length; index += ZONE_CHANNELS) {
			const part = Math.floor(index / ZONE_CHANNELS) + 1;
			const suffix = channels.length > ZONE_CHANNELS ? ` ${part}` : "";
			const name = uniqueName(`${base}${suffix}`, usedZoneNames, 16, "ZONE");
			model.zones.push({ name, channels: channels.slice(index, index + ZONE_CHANNELS) });
		}
	};
	addZones("DMR", dmrChannels);
	addZones("ANALOG", analogChannels);
	addZones("STANDARD", standardChannels.filter((channel) => !aprsChannels.some((entry) => entry.channel === channel)));
	addZones("APRS", aprsChannels.map((entry) => entry.channel));

	if (model.channels.length > CHANNEL_LIMIT) addError("too_many_channels", `This codeplug has ${model.channels.length} channels; the radio holds ${CHANNEL_LIMIT}.`);
	if (model.contacts.length > CONTACT_LIMIT) addError("too_many_contacts", `This codeplug has ${model.contacts.length} contacts; the radio holds ${CONTACT_LIMIT}.`);
	if (model.rxLists.length > RX_LIST_LIMIT) addError("too_many_rx_lists", `This codeplug has ${model.rxLists.length} RX group lists; the radio holds ${RX_LIST_LIMIT}.`);
	if (model.zones.length > ZONE_LIMIT) addError("too_many_zones", `This codeplug has ${model.zones.length} zones; the radio holds ${ZONE_LIMIT}.`);

	for (const problem of validate(model)) {
		const entry = { code: problem.code, message: problemText(problem) };
		if (problem.level === "error") errors.push(entry);
		else addWarning(problem.code, entry.message);
	}

	let yaml = "";
	let csvFiles = [];
	if (!errors.length) {
		try {
			const exported = exportQdmr(model);
			yaml = exported.text;
			for (const note of exported.notes) {
				addWarning(`qdmr_${note.code}`, QDMR_NOTES[note.code] || `qDMR export note: ${note.code}`);
			}
		} catch (error) {
			addError("yaml_failed", `The qDMR YAML export failed: ${error.message}`);
		}
		try {
			csvFiles = exportAll(model).map((file) => ({ name: file.name, text: file.data }));
		} catch (error) {
			addError("csv_failed", `The CSV export failed: ${error.message}`);
		}
	}

	const summary = {
		channels: model.channels.length,
		dmr: dmrChannels.length,
		analog: analogChannels.length,
		standard: standardChannels.length,
		contacts: model.contacts.length,
		rxLists: model.rxLists.length,
		zones: model.zones.length,
		aprs: model.aprs.length,
	};
	return {
		ok: errors.length === 0,
		model,
		yaml,
		csvFiles,
		summary,
		warnings,
		notes,
		errors,
		generatedAt: new Date().toISOString(),
	};
}

export { packChannels, PACK_ORDER };
