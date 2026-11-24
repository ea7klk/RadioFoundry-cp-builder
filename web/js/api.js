// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// The small client for this server's own API. Same origin, no keys, no third
// party calls from the browser.

export class ApiError extends Error {
	constructor(code, message, status = 0) {
		super(message);
		this.name = "ApiError";
		this.code = code;
		this.status = status;
	}
}

async function getJSON(path, params = {}) {
	const url = new URL(path, window.location.origin);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
	}
	let response;
	try {
		response = await fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin" });
	} catch (error) {
		throw new ApiError("network", "The builder server is not reachable.", 0);
	}
	let body = null;
	try {
		body = await response.json();
	} catch (error) {
		body = null;
	}
	if (!response.ok) {
		throw new ApiError(
			body?.error?.code || `http_${response.status}`,
			body?.error?.message || `The server answered HTTP ${response.status}.`,
			response.status,
		);
	}
	return body;
}

export const api = {
	meta: () => getJSON("/api/meta"),
	bmNearby: ({ lat, lon, radius, limit = 300 }) =>
		getJSON("/api/bm/repeaters", { lat, lon, radius, limit }),
	bmTalkgroups: (id) => getJSON(`/api/bm/devices/${encodeURIComponent(id)}/talkgroups`),
	analogNearby: ({ lat, lon, radius, limit = 300, tonedOnly = false, includeSimplex = false, band = "all" }) =>
		getJSON("/api/repeaters/analog", {
			lat,
			lon,
			radius,
			limit,
			band,
			toned_only: tonedOnly ? 1 : 0,
			include_simplex: includeSimplex ? 1 : 0,
		}),
	talkgroups: ({ query = "", continent = "all", country = "", limit = 250 }) =>
		getJSON("/api/talkgroups", { q: query, continent, country, limit }),
	geocode: (query, lang) => getJSON("/api/geocode", { q: query, lang }),
};
