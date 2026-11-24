// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// The DMR simplex plan: published frequencies and names, and the contact choice
// that decides how many channels a frequency becomes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ALL_CALL_ID, CONTACT_MARKER, PLAN_BY_ID, PLANS, contactsFor, planChannels } from "../web/js/dmr.js";

test("the Spanish plan carries the published simplex frequencies", () => {
	const plan = PLAN_BY_ID.get("es");
	const mhz = plan.simplex.map(([, frequency]) => frequency);
	assert.deepEqual(mhz, [145.375, 145.3875, 145.4, 144.9, 433.45, 433.775, 438.025, 438.0375, 438.05]);
});

test("the published channel names are kept exactly", () => {
	const names = PLAN_BY_ID.get("es").simplex.map(([name]) => name);
	assert.deepEqual(names, ["CQDVHF", "S1-VHF", "S2-VHF", "SOTA-V", "CQDUHF", "S1-UHF", "S2-UHF", "S3-UHF", "SOTA-U"]);
});

test("access points are a separate list with the published names", () => {
	const access = PLAN_BY_ID.get("es").access;
	assert.equal(access.length, 12);
	assert.deepEqual(access.map(([name]) => name), [
		"PA1-V", "PA2-V", "PA3-V", "PA4-V", "PA5-V", "PA6-V",
		"PA1-U", "PA2-U", "PA3-U", "PA4-U", "PA5-U", "PA6-U",
	]);
});

test("TG 99 and AllCall are the two contacts on offer", () => {
	assert.equal(contactsFor("tg99").length, 1);
	assert.equal(contactsFor("tg99")[0].number, 99);
	assert.equal(contactsFor("tg99")[0].type, "group");
	assert.equal(contactsFor("all").length, 1);
	assert.equal(contactsFor("all")[0].number, 16777215);
	assert.equal(contactsFor("all")[0].number, ALL_CALL_ID);
	assert.equal(contactsFor("all")[0].type, "all");
	assert.equal(contactsFor("both").length, 2);
});

test("every channel name says which contact it uses, and fits the radio", () => {
	for (const choice of ["tg99", "all", "both"]) {
		for (const channel of planChannels("es", { choice, includeAccess: true })) {
			const suffix = choice === "both" ? CONTACT_MARKER[channel.contact.key] : CONTACT_MARKER[choice];
			assert.ok(channel.name.endsWith(suffix), `${channel.name} should end in ${suffix}`);
			assert.ok(channel.name.length <= 16, `${channel.name} is ${channel.name.length} characters`);
		}
	}
});

test("one choice gives one channel per frequency, both gives two", () => {
	assert.equal(planChannels("es", { choice: "tg99" }).length, 9);
	assert.equal(planChannels("es", { choice: "all" }).length, 9);
	assert.equal(planChannels("es", { choice: "both" }).length, 18);
	assert.equal(planChannels("es", { choice: "both", includeAccess: true }).length, 42);
});

test("the plan uses CC1 slot 1 for voice and CC1 slot 2 for access points", () => {
	for (const channel of planChannels("es", { choice: "both", includeAccess: true })) {
		assert.equal(channel.colorCode, 1);
		assert.equal(channel.timeslot, channel.kind === "access" ? 2 : 1);
	}
});

test("an unknown plan is empty rather than throwing", () => {
	assert.deepEqual(planChannels("nowhere", { choice: "both" }), []);
	assert.equal(PLANS.length, 1);
});
