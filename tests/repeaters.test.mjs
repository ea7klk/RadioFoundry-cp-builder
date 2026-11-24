// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// A repeater list from a file: tolerant column matching, honest skipping.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseRepeaterFile, parseRows } from "../web/js/repeaters.js";

const MALAGA = { lat: 36.7213, lon: -4.4214 };

test("a CSV with familiar column names is read", () => {
	const text = [
		"Callsign,Output,Offset,CTCSS,Latitude,Longitude,City,Mode",
		"ED7YAO,145.725,-0.6,82.5,36.933977,-4.532547,Malaga,FM",
		"ED7YAP,145.65,-0.6,,36.94,-4.53,Malaga,FM",
	].join("\n");
	const result = parseRepeaterFile(text, "spain.csv", MALAGA);
	assert.equal(result.repeaters.length, 2);
	const [first, second] = result.repeaters;
	assert.equal(first.callsign, "ED7YAO");
	assert.equal(first.downlink_mhz, 145.725);
	assert.equal(first.uplink_mhz, 145.125);
	assert.equal(first.tx_tone, "82.5");
	assert.equal(first.source, "file");
	assert.equal(second.tx_tone, "");
	assert.ok(first.distance_km > 20 && first.distance_km < 30);
});

test("a semicolon file with decimal commas is read", () => {
	const text = "Callsign;Frequency;Shift;Tone;Lat;Lon\nDL0TEST;438,650;+7,6;88,5;48,13;11,55\n";
	const result = parseRepeaterFile(text, "de.csv", MALAGA);
	assert.equal(result.repeaters.length, 1);
	assert.equal(result.repeaters[0].downlink_mhz, 438.65);
	assert.equal(result.repeaters[0].uplink_mhz, 446.25);
	assert.equal(result.repeaters[0].tx_tone, "88.5");
});

test("an explicit input frequency wins over an offset", () => {
	const text = "callsign,frequency,tx_mhz\nED7YAA,145.775,145.175\n";
	const [repeater] = parseRepeaterFile(text, "x.csv").repeaters;
	assert.equal(repeater.uplink_mhz, 145.175);
	assert.equal(repeater.offset_mhz, -0.6);
});

test("JSON lists are accepted in both shapes", () => {
	const list = JSON.stringify([{ callsign: "ED7YAO", downlink_mhz: 145.725, uplink_mhz: 145.125, tx_tone: "82.5", lat: 36.93, lon: -4.53 }]);
	const wrapped = JSON.stringify({ repeaters: [{ callsign: "ED7YAP", downlink_mhz: 145.65, uplink_mhz: 145.05 }] });
	assert.equal(parseRepeaterFile(list, "a.json").repeaters.length, 1);
	assert.equal(parseRepeaterFile(wrapped, "b.json").repeaters.length, 1);
});

test("rows without coordinates are kept and marked", () => {
	const text = "callsign,output_mhz,offset_mhz\nED7YAZ,145.7,-0.6\n";
	const result = parseRepeaterFile(text, "x.csv", MALAGA);
	assert.equal(result.repeaters.length, 1);
	assert.equal(result.repeaters[0].lat, null);
	assert.equal(result.repeaters[0].distance_km, null);
});

test("unusable rows are skipped with a reason", () => {
	const text = [
		"callsign,output_mhz,offset_mhz,lat,lon,mode",
		",145.7,-0.6,36.7,-4.4,FM",
		"ED7YAA,abc,-0.6,36.7,-4.4,FM",
		"ED7YAB,145.7,-0.6,36.7,-4.4,DMR",
		"ED7YAC,145.7,-0.6,36.7,-4.4,FM",
	].join("\n");
	const result = parseRepeaterFile(text, "x.csv");
	assert.equal(result.repeaters.length, 1);
	assert.equal(result.repeaters[0].callsign, "ED7YAC");
	assert.equal(result.skipped, 3);
	assert.equal(result.problems.length, 2);
});

test("a file without a header is refused with a readable reason", () => {
	const result = parseRepeaterFile("just some text\nand more", "x.txt");
	assert.equal(result.repeaters.length, 0);
	assert.match(result.problems[0].message, /callsign/i);
});

test("broken JSON is refused, not thrown", () => {
	const result = parseRepeaterFile("[{", "x.json");
	assert.equal(result.repeaters.length, 0);
	assert.match(result.problems[0].message, /JSON/i);
});

test("quoted fields with commas and semicolons survive", () => {
	const rows = parseRows('callsign,city\nED7YAO,"Malaga, Andalucia"\n');
	assert.deepEqual(rows[1], ["ED7YAO", "Malaga, Andalucia"]);
});

test("tones that are not tones are dropped", () => {
	const text = "callsign,output_mhz,offset_mhz,tone\nA,145.7,-0.6,CC1\nB,145.7,-0.6,0.0\nC,145.7,-0.6,D023N\n";
	const tones = parseRepeaterFile(text, "x.csv").repeaters.map((repeater) => repeater.tx_tone);
	assert.deepEqual(tones, ["CC1", "", "D023N"]);
});

test("the reported offsets survive a kHz shift column", () => {
	const text = "callsign,output_mhz,shift\nED7YAA,145.775,-600\n";
	const [repeater] = parseRepeaterFile(text, "x.csv").repeaters;
	assert.equal(repeater.uplink_mhz, 145.175);
});
