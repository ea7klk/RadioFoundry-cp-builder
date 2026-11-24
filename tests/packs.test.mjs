// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// The channel packs: what each one holds and which region it belongs to.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PACKS, PACK_BY_ID, aprsFrequencyFor, defaultPacks, packApplies, packChannels, regionForCountry } from "../web/js/packs.js";

test("every pack has a unique id, a source and channels that build", () => {
	const ids = new Set();
	for (const pack of PACKS) {
		assert.ok(!ids.has(pack.id), `duplicate pack ${pack.id}`);
		ids.add(pack.id);
		assert.match(pack.source, /^https:\/\//, `${pack.id} needs a source link`);
		assert.ok(pack.title && pack.summary, `${pack.id} needs a title and summary`);
		assert.ok(pack.channels({}).length > 0, `${pack.id} has no channels`);
	}
});

test("PMR446 has the 16 analog channels at 12.5 kHz spacing", () => {
	const channels = PACK_BY_ID.get("pmr446").channels();
	assert.equal(channels.length, 16);
	assert.equal(channels[0].rx, 446.00625);
	assert.equal(channels[15].rx, 446.19375);
	for (let i = 1; i < channels.length; i++) {
		assert.ok(Math.abs(channels[i].rx - channels[i - 1].rx - 0.0125) < 1e-9);
	}
	assert.equal(channels[0].rx, channels[0].tx);
});

test("FRS has 22 channels, with the 462 and 467 halves", () => {
	const channels = PACK_BY_ID.get("frs").channels();
	assert.equal(channels.length, 22);
	assert.equal(channels[0].rx, 462.5625);
	assert.equal(channels[7].rx, 467.5625);
	assert.equal(channels[21].rx, 462.725);
});

test("marine channels are prefixed MAR- and keep their channel numbers", () => {
	const channels = PACK_BY_ID.get("marine_intl").channels();
	const names = channels.map((channel) => channel.name);
	assert.ok(names.every((name) => name.startsWith("MAR-")), "every marine channel says MAR-");
	assert.ok(names.includes("MAR-16"));
	assert.ok(!names.includes("MAR-70"), "channel 70 is DSC only");
	assert.ok(!names.includes("MAR-75") && !names.includes("MAR-76"), "75 and 76 are guard channels");
	// two digits and the 37A suffix survive the prefix
	assert.ok(names.includes("MAR-37A"));
	assert.ok(names.includes("MAR-88"));
	assert.ok(Math.max(...names.map((name) => name.length)) <= 16, "a name fits the radio");
});

test("marine channel 16 is the distress channel on 156.800", () => {
	const channels = PACK_BY_ID.get("marine_intl").channels();
	const sixteen = channels.find((channel) => channel.name === "MAR-16");
	assert.equal(sixteen.rx, 156.8);
	assert.equal(sixteen.tx, 156.8);
	// a duplex channel has the ship transmit on the higher frequency for channel 24
	const twentyFour = channels.find((channel) => channel.name === "MAR-24");
	assert.equal(twentyFour.rx, 161.8);
	assert.equal(twentyFour.tx, 157.2);
});

test("marine weather channels are receive only", () => {
	for (const channel of PACK_BY_ID.get("marine_wx").channels()) {
		assert.equal(channel.rxOnly, true);
		assert.equal(channel.rx, channel.tx);
	}
});

test("calling frequencies are where each region puts them", () => {
	const r1 = PACK_BY_ID.get("r1_calling").channels().map((channel) => channel.rx);
	assert.ok(r1.includes(145.5));
	assert.ok(r1.includes(433.5));
	const r2 = PACK_BY_ID.get("r2_calling").channels().map((channel) => channel.rx);
	assert.ok(r2.includes(146.52));
	assert.ok(r2.includes(446.0));
});

test("APRS defaults follow the country and region", () => {
	assert.equal(aprsFrequencyFor("ES"), 144.8);
	assert.equal(aprsFrequencyFor("US"), 144.39);
	assert.equal(aprsFrequencyFor("AU"), 145.175);
	assert.equal(aprsFrequencyFor("NZ"), 144.575);
	assert.equal(aprsFrequencyFor("CN"), 144.64);
	assert.equal(aprsFrequencyFor("JP"), 144.64);
	assert.equal(aprsFrequencyFor("VE"), 144.39); // Region 2
	assert.equal(aprsFrequencyFor("ZA"), 144.8); // Region 1
});

test("countries resolve to their IARU region", () => {
	assert.equal(regionForCountry("ES"), "R1");
	assert.equal(regionForCountry("us"), "R2");
	assert.equal(regionForCountry("JA"), "R1"); // not an ISO code: falls back to R1
	assert.equal(regionForCountry("JP"), "R3");
	assert.equal(regionForCountry(""), "R1");
});

test("packs are offered inside their region and by country exception", () => {
	assert.ok(packApplies(PACK_BY_ID.get("pmr446"), "R1", "ES"));
	assert.ok(packApplies(PACK_BY_ID.get("pmr446"), "R3", "MY"));
	assert.ok(!packApplies(PACK_BY_ID.get("pmr446"), "R2", "US"));
	assert.ok(packApplies(PACK_BY_ID.get("frs"), "R2", "US"));
});

test("regional defaults always include an APRS pack", () => {
	for (const [region, country] of [["R1", "ES"], ["R2", "US"], ["R3", "AU"]]) {
		const ids = defaultPacks(region, country);
		assert.ok(ids.some((id) => id.startsWith("aprs_")), `${region} needs an APRS pack`);
	}
});

test("pack channels carry the pack they came from, in a stable order", () => {
	const channels = packChannels(["aprs_r1", "r1_calling"]);
	assert.equal(channels[0].pack, "r1_calling");
	assert.equal(channels.at(-1).pack, "aprs_r1");
	assert.ok(channels.every((channel) => channel.name && channel.rx > 0));
});
