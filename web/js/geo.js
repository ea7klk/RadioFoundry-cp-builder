// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// Coordinates, Maidenhead locators and distances. No DOM, so Node tests use it too.

const EARTH_KM = 6371.0088;

export function validLat(lat) {
	return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function validLon(lon) {
	return Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

// A 4, 6 or 8 character locator to the centre of its square; null if it is not one.
export function locatorToLatLon(value) {
	const text = String(value ?? "").trim().toUpperCase();
	if (!/^[A-R]{2}[0-9]{2}([A-X]{2}([0-9]{2})?)?$/.test(text)) return null;
	let lon = (text.charCodeAt(0) - 65) * 20 - 180 + Number(text[2]) * 2;
	let lat = (text.charCodeAt(1) - 65) * 10 - 90 + Number(text[3]);
	let lonSize = 2;
	let latSize = 1;
	if (text.length >= 6) {
		lon += (text.charCodeAt(4) - 65) * (2 / 24);
		lat += (text.charCodeAt(5) - 65) * (1 / 24);
		lonSize = 2 / 24;
		latSize = 1 / 24;
	}
	if (text.length >= 8) {
		lon += Number(text[6]) * (2 / 240);
		lat += Number(text[7]) * (1 / 240);
		lonSize = 2 / 240;
		latSize = 1 / 240;
	}
	return { lat: round(lat + latSize / 2, 6), lon: round(lon + lonSize / 2, 6) };
}

export function latLonToLocator(lat, lon, precision = 6) {
	if (!validLat(lat) || !validLon(lon)) return "";
	const lon2 = Math.min(179.999999, Math.max(-180, lon)) + 180;
	const lat2 = Math.min(89.999999, Math.max(-90, lat)) + 90;
	const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	let fieldLon = Math.floor(lon2 / 20);
	let fieldLat = Math.floor(lat2 / 10);
	let text = A[fieldLon] + A[fieldLat];
	if (precision < 4) return text;
	let restLon = lon2 - fieldLon * 20;
	let restLat = lat2 - fieldLat * 10;
	const squareLon = Math.floor(restLon / 2);
	const squareLat = Math.floor(restLat);
	text += String(squareLon) + String(squareLat);
	if (precision < 6) return text;
	restLon -= squareLon * 2;
	restLat -= squareLat;
	const subLon = Math.floor(restLon / (2 / 24));
	const subLat = Math.floor(restLat / (1 / 24));
	text += A[subLon] + A[subLat];
	if (precision < 8) return text;
	restLon -= subLon * (2 / 24);
	restLat -= subLat * (1 / 24);
	text += String(Math.floor(restLon / (2 / 240))) + String(Math.floor(restLat / (1 / 240)));
	return text;
}

export function distanceKm(lat1, lon1, lat2, lon2) {
	const p1 = (lat1 * Math.PI) / 180;
	const p2 = (lat2 * Math.PI) / 180;
	const dp = p2 - p1;
	const dl = ((lon2 - lon1) * Math.PI) / 180;
	const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
	return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function round(value, places = 4) {
	const scale = 10 ** places;
	return Math.round(value * scale) / scale;
}

export function formatLatLon(lat, lon, places = 5) {
	const ns = lat >= 0 ? "N" : "S";
	const ew = lon >= 0 ? "E" : "W";
	return `${Math.abs(lat).toFixed(places)}° ${ns}, ${Math.abs(lon).toFixed(places)}° ${ew}`;
}

export function formatMHz(hz) {
	return (hz / 1e6).toFixed(5);
}

export function formatKm(km) {
	return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
