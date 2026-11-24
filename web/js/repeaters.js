// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// A local repeater list: CSV or JSON the user already has a right to use (a
// national coordinator's export, a RepeaterBook export, a club list). Parsed in
// the browser; the file never leaves it. Column names are matched loosely so a
// file written for another tool can be dropped in without editing its header.

import { distanceKm, validLat, validLon } from "./geo.js";

const ALIASES = {
	callsign: ["callsign", "call", "cs", "station", "name"],
	output: ["output_mhz", "output", "frequency", "freq", "frequency_mhz", "rx_mhz", "downlink", "downlink_mhz", "repeater_output", "tx_frequency"],
	offset: ["offset_mhz", "offset", "shift", "shift_mhz", "duplex"],
	tx: ["uplink_mhz", "uplink", "input_mhz", "input", "repeater_input", "tx_mhz"],
	txTone: ["tx_tone", "tone", "ctcss", "encode", "uplink_tone", "rpt_tone", "tsq", "pl"],
	rxTone: ["rx_tone", "decode", "downlink_tone"],
	city: ["city", "location", "qth", "town", "place", "nearest_town"],
	lat: ["lat", "latitude"],
	lon: ["lon", "lng", "long", "longitude"],
	mode: ["mode", "type", "modes"],
	band: ["band"],
};

const norm = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function columnMap(headers) {
	const map = new Map();
	for (const key of Object.keys(ALIASES)) {
		for (const alias of ALIASES[key]) {
			const index = headers.findIndex((header) => norm(header) === norm(alias));
			if (index >= 0) {
				map.set(key, index);
				break;
			}
		}
	}
	return map;
}

// RFC 4180 enough for a repeater list: quotes, doubled quotes, commas, semicolons or tabs
export function parseRows(text) {
	const clean = String(text ?? "").replace(/^\uFEFF/, "");
	const firstLine = clean.split(/\r?\n/, 1)[0] || "";
	const delimiter = [",", ";", "\t"].find((candidate) => firstLine.includes(candidate)) || ",";
	const rows = [];
	let row = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < clean.length; i++) {
		const char = clean[i];
		if (quoted) {
			if (char === '"') {
				if (clean[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += char;
		} else if (char === '"' && field === "") quoted = true;
		else if (char === delimiter) {
			row.push(field);
			field = "";
		} else if (char === "\r" || char === "\n") {
			if (char === "\r" && clean[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else field += char;
	}
	if (field !== "" || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

const number = (value) => {
	if (value === null || value === undefined || value === "") return null;
	const parsed = Number(String(value).replace(",", ".").replace(/[^\d.+-]/g, ""));
	return Number.isFinite(parsed) ? parsed : null;
};

function cleanTone(value) {
	const text = String(value ?? "").trim().toUpperCase().replace(/^(\d{2,3}),(\d)$/, "$1.$2");
	if (!text || text === "NONE" || text === "CSQ" || text === "-" || text === "0" || text === "0.0") return "";
	return text.slice(0, 8);
}

// A shift in MHz, kHz or Hz, by magnitude: no amateur shift is over 100 MHz, so
// a value below 100 is MHz, below 100 000 is kHz, and above that is Hz.
function shiftMHz(value) {
	if (value === null) return null;
	const magnitude = Math.abs(value);
	if (magnitude >= 100_000) return value / 1e6;
	if (magnitude >= 100) return value / 1e3;
	return value;
}

function offsetMHz(raw, offsetValue) {
	if (raw !== null) return shiftMHz(raw);
	const text = String(offsetValue ?? "").trim();
	if (!text) return 0;
	const value = number(text);
	if (value === null) return 0;
	const scaled = shiftMHz(value);
	return text.startsWith("+") ? Math.abs(scaled) : text.startsWith("-") ? -Math.abs(scaled) : scaled;
}

// A parsed file: {repeaters: [...], problems: [...], skipped, source}
export function parseRepeaterFile(text, name = "file", origin = null) {
	const trimmed = String(text ?? "").trim();
	const problems = [];
	let rows = [];
	if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
		let document;
		try {
			document = JSON.parse(trimmed);
		} catch (error) {
			return { repeaters: [], problems: [{ row: 0, message: "The file is not valid JSON." }], source: name };
		}
		const list = Array.isArray(document) ? document : Array.isArray(document.repeaters) ? document.repeaters : null;
		if (!list) return { repeaters: [], problems: [{ row: 0, message: "The JSON holds no list of repeaters." }], source: name };
		rows = list.map((item) => (item && typeof item === "object" ? item : null));
	} else {
		const table = parseRows(trimmed);
		if (table.length < 2) return { repeaters: [], problems: [{ row: 0, message: "The file has a header and no rows." }], source: name };
		const map = columnMap(table[0]);
		if (!map.has("callsign") || (!map.has("output") && !map.has("tx"))) {
			return {
				repeaters: [],
				problems: [{ row: 1, message: "The header needs a callsign column and an output (or frequency) column." }],
				source: name,
			};
		}
		rows = table.slice(1).map((cells) => {
			const item = {};
			for (const [key, index] of map) item[key] = cells[index] ?? "";
			return item;
		});
	}

	const repeaters = [];
	let skipped = 0;
	rows.forEach((row, index) => {
		const rowNumber = index + 2;
		if (!row) {
			skipped++;
			return;
		}
		const callsign = String(row.callsign ?? row.call ?? "").trim().toUpperCase().slice(0, 16);
		const output = number(row.output ?? row.output_mhz ?? row.frequency ?? row.freq ?? row.downlink_mhz ?? row.rx_mhz);
		const uplinkDirect = number(row.tx ?? row.uplink_mhz ?? row.input ?? row.input_mhz);
		const offset = offsetMHz(number(row.offset ?? row.offset_mhz ?? row.shift), row.offset ?? row.shift ?? row.duplex);
		const lat = number(row.lat ?? row.latitude);
		const lon = number(row.lon ?? row.lng ?? row.long ?? row.longitude);
		if (!callsign) {
			skipped++;
			problems.push({ row: rowNumber, message: "No callsign." });
			return;
		}
		if (output === null || output <= 0 || output > 3000) {
			skipped++;
			problems.push({ row: rowNumber, message: `${callsign}: no usable output frequency.` });
			return;
		}
		const hasPoint = lat !== null && lon !== null && validLat(lat) && validLon(lon);
		const uplink = uplinkDirect !== null && uplinkDirect > 0 ? uplinkDirect : output + offset;
		if (!(uplink > 0 && uplink <= 3000)) {
			skipped++;
			problems.push({ row: rowNumber, message: `${callsign}: the transmit frequency is not usable.` });
			return;
		}
		const mode = String(row.mode ?? "FM").trim().toUpperCase().slice(0, 24) || "FM";
		if (!mode.includes("FM") && !mode.includes("ANALOG")) {
			skipped++;
			return;
		}
		const point = origin && hasPoint ? distanceKm(origin.lat, origin.lon, lat, lon) : null;
		repeaters.push({
			callsign,
			city: String(row.city ?? row.location ?? row.qth ?? "").trim().slice(0, 80),
			lat: hasPoint ? Math.round(lat * 1e6) / 1e6 : null,
			lon: hasPoint ? Math.round(lon * 1e6) / 1e6 : null,
			downlink_mhz: Math.round(output * 1e6) / 1e6,
			uplink_mhz: Math.round(uplink * 1e6) / 1e6,
			offset_mhz: Math.round((uplink - output) * 1e6) / 1e6,
			tx_tone: cleanTone(row.txTone ?? row.tx_tone ?? row.tone ?? row.ctcss ?? row.encode),
			rx_tone: cleanTone(row.rxTone ?? row.rx_tone ?? row.decode),
			mode,
			digital_capable: false,
			is_repeater: Math.abs(uplink - output) > 1e-6,
			source: "file",
			distance_km: point === null ? null : Math.round(point * 100) / 100,
		});
	});
	return { repeaters, problems, skipped, source: name };
}
