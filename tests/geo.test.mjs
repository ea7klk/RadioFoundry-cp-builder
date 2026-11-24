// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// Location maths: locator conversion both ways, distances and formatting.

import { test } from "node:test";
import assert from "node:assert/strict";

import { distanceKm, formatLatLon, formatMHz, latLonToLocator, locatorToLatLon, validLat, validLon } from "../web/js/geo.js";

test("a six character locator is the centre of its square", () => {
	const point = locatorToLatLon("IM76SR");
	assert.equal(point.lat, 36.729167);
	assert.equal(point.lon, -4.458333);
});

test("locators round trip within a square", () => {
	for (const [lat, lon] of [[36.7213, -4.4214], [52.5, 13.4], [-33.87, 151.21], [64.13, -21.9], [0, 0]]) {
		const locator = latLonToLocator(lat, lon, 6);
		const back = locatorToLatLon(locator);
		assert.ok(distanceKm(lat, lon, back.lat, back.lon) < 6, `${locator} is too far from ${lat},${lon}`);
	}
});

test("locators are accepted in lower case and at every precision", () => {
	assert.ok(locatorToLatLon("im76sr"));
	assert.ok(locatorToLatLon("IM76"));
	assert.ok(locatorToLatLon("IM76SR93"));
	assert.equal(locatorToLatLon("IM76SR9"), null);
	assert.equal(locatorToLatLon("ZZ99"), null);
	assert.equal(locatorToLatLon("hello"), null);
	assert.equal(locatorToLatLon(""), null);
});

test("known distances are right to a few kilometres", () => {
	// Málaga to Madrid: about 415 km
	assert.ok(Math.abs(distanceKm(36.7213, -4.4214, 40.4168, -3.7038) - 415) < 8);
	// Málaga to itself
	assert.equal(distanceKm(36.7213, -4.4214, 36.7213, -4.4214), 0);
});

test("coordinates are checked before use", () => {
	assert.ok(validLat(90) && validLat(-90) && !validLat(90.1) && !validLat(Number.NaN));
	assert.ok(validLon(180) && validLon(-180) && !validLon(180.5));
});

test("coordinates and frequencies are shown in a fixed, readable form", () => {
	assert.equal(formatLatLon(-4.4214, -4.4214, 5), "4.42140° S, 4.42140° W");
	assert.equal(formatMHz(438_450_000), "438.45000");
	assert.equal(formatMHz(446_006_250), "446.00625");
});
