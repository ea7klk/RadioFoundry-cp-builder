// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// DMR simplex channel plans. Data only; build.js turns an entry into a DMR
// channel with the chosen contact.
//
// The Spanish plan is a national agreement (URE / Radio Club Fene) that follows
// the IARU Region 1 band plan and fixes both the frequencies and the channel
// names, so that operators can agree a QSY by name ("pásate a SOTA-U"). The
// names are therefore kept exactly as published; the builder only appends the
// contact the channel uses.

export const TG99 = 99;
export const ALL_CALL_ID = 0xffffff;

// The contact a DMR simplex channel is built on.
export const SIMPLEX_CONTACTS = {
	tg99: { key: "tg99", label: "TG 99", contactName: "Simplex", number: TG99, type: "group" },
	all: { key: "all", label: "AllCall", contactName: "AllCall", number: ALL_CALL_ID, type: "all" },
};

export const PLANS = [
	{
		id: "es",
		title: "DMR simplex (Spain)",
		regions: [],
		countries: ["ES"],
		source: "https://www.radioclubfene.net/descargas/frecuencias_dmr.pdf",
		sourceNote:
			"Frecuencias DMR en simplex en España según plan de bandas IARU Región 1 (URE / Radio Club Fene).",
		notes:
			"CC1, slot 1 on every voice channel. The plan asks every station to keep these channel names, so a contact can agree a QSY by name.",
		// [name, MHz, use]
		simplex: [
			["CQDVHF", 145.375, "VHF calling channel"],
			["S1-VHF", 145.3875, "VHF QSO channel 1"],
			["S2-VHF", 145.4, "VHF QSO channel 2"],
			["SOTA-V", 144.9, "VHF SOTA and mountain activity"],
			["CQDUHF", 433.45, "UHF calling channel"],
			["S1-UHF", 433.775, "UHF QSO channel 1"],
			["S2-UHF", 438.025, "UHF QSO channel 2 (urban, 438 MHz)"],
			["S3-UHF", 438.0375, "UHF QSO channel 3 (urban, 438 MHz)"],
			["SOTA-U", 438.05, "UHF SOTA and mountain activity"],
		],
		// Access points (gateways reachable over the air), CC1 slot 2 by default.
		access: [
			["PA1-V", 144.8125],
			["PA2-V", 144.825],
			["PA3-V", 144.8375],
			["PA4-V", 144.85],
			["PA5-V", 144.8625],
			["PA6-V", 144.875],
			["PA1-U", 430.4],
			["PA2-U", 430.4125],
			["PA3-U", 430.425],
			["PA4-U", 439.8],
			["PA5-U", 439.8125],
			["PA6-U", 439.825],
		],
	},
];

export const PLAN_BY_ID = new Map(PLANS.map((plan) => [plan.id, plan]));

// The contacts a choice stands for: "tg99" -> [tg99], "both" -> [tg99, all].
export function contactsFor(choice) {
	if (choice === "all") return [SIMPLEX_CONTACTS.all];
	if (choice === "tg99") return [SIMPLEX_CONTACTS.tg99];
	return [SIMPLEX_CONTACTS.tg99, SIMPLEX_CONTACTS.all];
}

// The marker that makes the contact visible in a channel name.
export const CONTACT_MARKER = { tg99: "TG99", all: "ALL" };

// Channels of a plan for a contact choice: [{name, mhz, use, colorCode, timeslot, contact}].
// "both" gives one channel per frequency per contact, which is the only way a
// radio can hold both: a channel has a single default contact.
export function planChannels(planId, { choice = "tg99", includeAccess = false } = {}) {
	const plan = PLAN_BY_ID.get(planId);
	if (!plan) return [];
	const out = [];
	const add = (name, mhz, use, slot, kind) => {
		for (const contact of contactsFor(choice)) {
			out.push({
				plan: plan.id,
				kind,
				base: name,
				name: `${name} ${CONTACT_MARKER[contact.key]}`,
				mhz,
				use,
				colorCode: 1,
				timeslot: slot,
				contact,
			});
		}
	};
	for (const [name, mhz, use] of plan.simplex) add(name, mhz, use, 1, "simplex");
	if (includeAccess) for (const [name, mhz] of plan.access) add(name, mhz, "Access point (gateway)", 2, "access");
	return out;
}
