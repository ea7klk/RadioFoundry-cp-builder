// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// The page: state, fetching, rendering and the hand-off to build.js. All
// user-provided text goes in with textContent; the CSP forbids inline script.

import { api } from "./api.js";
import { buildCodeplug } from "./build.js";
import { COUNTRIES, COUNTRY_BY_CC, PACKS, PACK_BY_ID, REGIONS, defaultPacks, packApplies, regionForCountry } from "./packs.js";
import { distanceKm, formatKm, formatLatLon, formatMHz, latLonToLocator, locatorToLatLon, validLat, validLon } from "./geo.js";
import { makeZip } from "./zip.js";
import { parseRepeaterFile } from "./repeaters.js";
import { planChannels } from "./dmr.js";

const STORAGE_KEY = "cpb.state.v1";
const $ = (id) => document.getElementById(id);

const state = {
	meta: null,
	location: null,
	country: "ES",
	region: "R1",
	packs: new Set(),
	station: { callsign: "", dmrId: "", ssid: 7 },
	options: { aprsConfig: true, fallbackTg: true },
	dmrSimplex: { enabled: false, choice: "tg99", includeAccess: false },
	showAllPacks: false,
	dmr: {
		radius: 50,
		results: [],
		selected: new Set(),
		talkgroups: new Map(),
		promises: new Map(),
		loading: false,
		fetchedKey: null,
		fetchedRadius: null,
	},
	analog: {
		radius: 50,
		results: [],
		selected: new Set(),
		loading: false,
		fetchedKey: null,
		fetchedRadius: null,
		file: { name: "", repeaters: [], report: null },
	},
	built: null,
};

// --- small DOM helpers ---

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === undefined || value === null || value === false) continue;
		if (key === "class") node.className = value;
		else if (key === "text") node.textContent = value;
		else if (key === "dataset") Object.assign(node.dataset, value);
		else if (key === "checked") node.checked = Boolean(value);
		else if (key === "disabled") node.disabled = Boolean(value);
		else node.setAttribute(key, value);
	}
	for (const child of children.flat()) {
		if (child === null || child === undefined) continue;
		node.append(child instanceof Node ? child : document.createTextNode(String(child)));
	}
	return node;
}

function clear(node) {
	while (node.firstChild) node.removeChild(node.firstChild);
}

function setStatus(id, message, kind = "") {
	const node = $(id);
	node.textContent = message || "";
	node.className = `status${kind ? ` ${kind}` : ""}`;
}

let toastTimer = null;
function toast(message, kind = "") {
	const node = $("toast");
	node.textContent = message;
	node.className = `toast${kind ? ` ${kind}` : ""}`;
	node.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		node.hidden = true;
	}, 4200);
}

const keyFor = (lat, lon) => `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;

// --- persistence ---

function saveState() {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				location: state.location,
				country: state.country,
				region: state.region,
				packs: [...state.packs],
				showAllPacks: state.showAllPacks,
				dmrSimplex: state.dmrSimplex,
				station: state.station,
				options: state.options,
				dmrRadius: state.dmr.radius,
				analogRadius: state.analog.radius,
			}),
		);
	} catch (error) {
		/* private browsing or a full quota: the page still works */
	}
}

function loadState() {
	let saved = null;
	try {
		saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
	} catch (error) {
		saved = null;
	}
	if (!saved || typeof saved !== "object") return;
	if (saved.location && validLat(Number(saved.location.lat)) && validLon(Number(saved.location.lon))) {
		state.location = {
			lat: Number(saved.location.lat),
			lon: Number(saved.location.lon),
			label: String(saved.location.label || "Saved location"),
			source: String(saved.location.source || "saved"),
		};
	}
	if (typeof saved.country === "string") state.country = COUNTRY_BY_CC.has(saved.country) ? saved.country : "";
	if (saved.region && REGIONS[saved.region]) state.region = saved.region;
	else state.region = state.country ? regionForCountry(state.country) : "R1";
	if (Array.isArray(saved.packs)) {
		state.packs = new Set(saved.packs.filter((id) => PACK_BY_ID.has(id)));
	}
	if (saved.station && typeof saved.station === "object") {
		state.station.callsign = String(saved.station.callsign || "").slice(0, 12);
		state.station.dmrId = String(saved.station.dmrId || "").slice(0, 8);
		state.station.ssid = Math.max(0, Math.min(15, Number(saved.station.ssid ?? 7) || 0));
	}
	state.showAllPacks = saved.showAllPacks === true;
	if (saved.dmrSimplex && typeof saved.dmrSimplex === "object") {
		state.dmrSimplex.enabled = saved.dmrSimplex.enabled === true;
		state.dmrSimplex.choice = ["tg99", "all", "both"].includes(saved.dmrSimplex.choice) ? saved.dmrSimplex.choice : "tg99";
		state.dmrSimplex.includeAccess = saved.dmrSimplex.includeAccess === true;
	}
	if (saved.options && typeof saved.options === "object") {
		state.options.aprsConfig = saved.options.aprsConfig !== false;
		state.options.fallbackTg = saved.options.fallbackTg !== false;
	}
	if (Number.isFinite(Number(saved.dmrRadius))) state.dmr.radius = clampRadius(Number(saved.dmrRadius));
	if (Number.isFinite(Number(saved.analogRadius))) state.analog.radius = clampRadius(Number(saved.analogRadius));
}

function clampRadius(value) {
	const max = state.meta?.limits?.max_radius_km || 300;
	return Math.max(5, Math.min(max, Math.round(value)));
}

// --- location ---

function setLocation(location, { quiet = false } = {}) {
	const lat = Number(location.lat);
	const lon = Number(location.lon);
	if (!validLat(lat) || !validLon(lon)) {
		showLocationError("Latitude must be −90…90 and longitude −180…180.");
		return false;
	}
	const changed = !state.location || state.location.lat !== lat || state.location.lon !== lon;
	state.location = {
		lat: Math.round(lat * 1e6) / 1e6,
		lon: Math.round(lon * 1e6) / 1e6,
		label: String(location.label || "Coordinates"),
		source: String(location.source || "manual"),
	};
	refreshFileDistances();
	$("lat").value = state.location.lat.toFixed(5);
	$("lon").value = state.location.lon.toFixed(5);
	$("locator").value = latLonToLocator(state.location.lat, state.location.lon, 6);
	$("location-error").hidden = true;
	renderLocation();
	if (changed) {
		clearResults();
		invalidateBuilt();
	}
	renderSummary();
	saveState();
	if (!quiet) toast(`Location set: ${latLonToLocator(state.location.lat, state.location.lon, 6)}`);
	return true;
}

function renderLocation() {
	const node = $("location-readout");
	if (!state.location) {
		node.textContent = "No location set yet.";
		return;
	}
	clear(node);
	const { lat, lon } = state.location;
	node.append(
		el("strong", { text: state.location.label }),
		document.createTextNode(" · "),
		el("span", { class: "mono", text: formatLatLon(lat, lon, 5) }),
		document.createTextNode(" · "),
		el("span", { class: "mono", text: latLonToLocator(lat, lon, 6) }),
	);
}

function showLocationError(message) {
	const node = $("location-error");
	node.textContent = message;
	node.hidden = false;
}

function applyCoordinates() {
	const lat = Number($("lat").value);
	const lon = Number($("lon").value);
	if (!validLat(lat) || !validLon(lon)) {
		showLocationError("Enter a latitude between −90 and 90 and a longitude between −180 and 180.");
		return;
	}
	setLocation({ lat, lon, label: "Coordinates", source: "coordinates" });
}

function applyLocator() {
	const input = $("locator").value.trim().toUpperCase();
	const point = locatorToLatLon(input);
	if (!point) {
		showLocationError("That is not a Maidenhead locator (four, six or eight characters, e.g. IM76SR).");
		return;
	}
	$("locator").value = input;
	setLocation({ ...point, label: `Locator ${input}`, source: "locator" });
}

function geolocate() {
	if (!navigator.geolocation) {
		toast("This browser has no geolocation support.", "bad");
		return;
	}
	const button = $("geolocate");
	button.disabled = true;
	button.textContent = "Locating…";
	navigator.geolocation.getCurrentPosition(
		(position) => {
			button.disabled = false;
			button.textContent = "Use my location";
			setLocation({
				lat: position.coords.latitude,
				lon: position.coords.longitude,
				label: "My location",
				source: "geolocation",
			});
		},
		(error) => {
			button.disabled = false;
			button.textContent = "Use my location";
			const messages = {
				1: "Location permission was denied.",
				2: "The browser could not determine your location.",
				3: "The location request timed out.",
			};
			showLocationError(messages[error.code] || "Could not get your location.");
		},
		{ timeout: 12000, maximumAge: 600000 },
	);
}

// Rows loaded from a file keep their place in the list when the location or the
// live search changes; only their distance is recomputed.
function refreshFileDistances() {
	if (!state.analog.file.repeaters.length) return;
	state.analog.file.repeaters = state.analog.file.repeaters.map((repeater) => {
		if (repeater.lat === null || repeater.lon === null || !state.location) return { ...repeater, distance_km: null };
		const km = distanceKm(state.location.lat, state.location.lon, repeater.lat, repeater.lon);
		return { ...repeater, distance_km: Math.round(km * 100) / 100 };
	});
}

function clearResults() {
	state.dmr.results = [];
	state.dmr.selected.clear();
	state.dmr.talkgroups.clear();
	state.dmr.promises.clear();
	state.dmr.fetchedKey = null;
	state.dmr.fetchedRadius = null;
	state.analog.selected.clear();
	state.analog.fetchedKey = null;
	state.analog.fetchedRadius = null;
	state.analog.results = [...state.analog.file.repeaters];
	setStatus("dmr-status", "");
	setStatus("analog-status", "");
	renderDmrResults();
	renderAnalogResults();
}

// --- city search ---

async function searchCity() {
	const query = $("city").value.trim();
	if (query.length < 2) {
		showLocationError("Type at least two characters of a place name.");
		return;
	}
	const button = $("city-search");
	button.disabled = true;
	button.textContent = "Finding…";
	try {
		const lang = (navigator.language || "en").slice(0, 2);
		const answer = await api.geocode(query, lang);
		renderCityResults(answer.results || []);
	} catch (error) {
		toast(error.message || "Place search failed.", "bad");
	} finally {
		button.disabled = false;
		button.textContent = "Find";
	}
}

function renderCityResults(results) {
	const box = $("city-results");
	clear(box);
	box.hidden = results.length === 0;
	for (const place of results) {
		const button = el(
			"button",
			{ type: "button", class: "city-result" },
			el("span", { text: place.display_name }),
			el("span", { text: place.country_code || "" }),
		);
		button.addEventListener("click", () => {
			if (place.country_code && COUNTRY_BY_CC.has(place.country_code)) {
				state.country = place.country_code;
				state.region = regionForCountry(place.country_code);
				$("country").value = state.country;
				$("region").value = state.region;
				renderPackList();
				updatePackSummary();
			}
			setLocation({
				lat: place.lat,
				lon: place.lon,
				label: place.name || place.display_name,
				source: "city",
			});
			box.hidden = true;
			$("city").value = "";
		});
		box.append(button);
	}
	if (results.length === 0) toast("No place found. Try a larger town or different spelling.", "bad");
}

// --- packs ---

function populateCountrySelect() {
	const select = $("country");
	clear(select);
	select.append(el("option", { value: "", text: "Other / not listed" }));
	for (const [regionId, region] of Object.entries(REGIONS)) {
		const group = el("optgroup", { label: region.label });
		for (const [cc, name, ccRegion] of COUNTRIES) {
			if (ccRegion !== regionId) continue;
			group.append(el("option", { value: cc, text: `${name} (${cc})` }));
		}
		select.append(group);
	}
	select.value = COUNTRY_BY_CC.has(state.country) ? state.country : "";
}

function renderPackList() {
	const box = $("pack-list");
	clear(box);
	const groups = new Map();
	for (const pack of PACKS) {
		if (!state.showAllPacks && !state.packs.has(pack.id) && !packApplies(pack, state.region, state.country)) continue;
		if (!groups.has(pack.group)) groups.set(pack.group, []);
		groups.get(pack.group).push(pack);
	}
	for (const [groupName, packs] of groups) {
		const group = el("div", { class: "pack-group" }, el("h3", { text: groupName }));
		for (const pack of packs) {
			const applies = packApplies(pack, state.region, state.country);
			const count = pack.channels({ region: state.region, country: state.country }).length;
			const checkbox = el("input", {
				type: "checkbox",
				"data-pack": pack.id,
				checked: state.packs.has(pack.id),
				"aria-label": `${pack.title} (${count} channels)`,
			});
			const meta = el("div", { class: "pack-meta" });
			meta.append(
				el("span", {
					class: "badge",
					text: pack.regions.length === 3 ? "Worldwide" : pack.regions.join(", "),
				}),
			);
			if (!applies) meta.append(el("span", { class: "badge badge-warn", text: `outside ${state.region}` }));
			if (pack.countries?.length) {
				meta.append(el("span", { class: "badge", text: `also ${pack.countries.join(", ")}` }));
			}
			const row = el(
				"label",
				{ class: "pack-row" },
				checkbox,
				el(
					"span",
					{},
					el("span", { class: "pack-title", text: pack.title }),
					el("span", { class: "pack-summary", text: pack.summary }),
					meta,
				),
				el("span", { class: "pack-count", text: `${count} ch` }),
			);
			group.append(row);
		}
		box.append(group);
	}
	updatePackSummary();
}

function updatePackSummary() {
	let channels = 0;
	let aprs = false;
	for (const id of state.packs) {
		const pack = PACK_BY_ID.get(id);
		if (!pack) continue;
		channels += pack.channels({ region: state.region, country: state.country }).length;
		if (id.startsWith("aprs_")) aprs = true;
	}
	$("pack-count").textContent = `${state.packs.size} pack${state.packs.size === 1 ? "" : "s"} · ${channels} channels`;
	$("aprs-config").disabled = !aprs;
	$("aprs-ssid").disabled = !aprs || !$("aprs-config").checked;
	$("pack-note").textContent = aprs
		? "An APRS position is added when a callsign is set. Leave it off if you do not want the radio to transmit a fixed position."
		: "Select an APRS pack to add a position configuration. PMR446, FRS and marine channels have their own licensing rules.";
}

function onPackChange(event) {
	const checkbox = event.target.closest("input[data-pack]");
	if (!checkbox) return;
	if (checkbox.checked) state.packs.add(checkbox.dataset.pack);
	else state.packs.delete(checkbox.dataset.pack);
	updatePackSummary();
	invalidateBuilt();
	saveState();
}

// --- DMR repeaters ---

async function searchDmr() {
	if (!ensureLocation()) return;
	if (state.dmr.loading) return;
	state.dmr.loading = true;
	const button = $("dmr-search");
	button.disabled = true;
	button.textContent = "Searching…";
	setStatus("dmr-status", "Asking Brandmeister for its repeater list…");
	try {
		const data = await api.bmNearby({
			lat: state.location.lat,
			lon: state.location.lon,
			radius: state.dmr.radius,
			limit: 300,
		});
		state.dmr.results = data.repeaters || [];
		state.dmr.selected.clear();
		state.dmr.talkgroups.clear();
		state.dmr.promises.clear();
		state.dmr.fetchedKey = keyFor(state.location.lat, state.location.lon);
		state.dmr.fetchedRadius = state.dmr.radius;
		const truncated = data.truncated ? ` Showing the first ${state.dmr.results.length}.` : "";
		setStatus(
			"dmr-status",
			`${data.count} repeater${data.count === 1 ? "" : "s"} within ${data.radius_km} km.${truncated}`,
			data.count ? "ok" : "warn",
		);
		renderDmrResults();
		renderSummary();
	} catch (error) {
		setStatus("dmr-status", error.message || "Brandmeister search failed.", "error");
	} finally {
		state.dmr.loading = false;
		button.disabled = false;
		button.textContent = "Find DMR repeaters";
	}
}

async function ensureTalkgroups(id) {
	if (state.dmr.talkgroups.has(id) && !state.dmr.talkgroups.get(id).error) return;
	if (state.dmr.promises.has(id)) return state.dmr.promises.get(id);
	state.dmr.talkgroups.set(id, { loading: true, talkgroups: [], error: null });
	renderDmrResults();
	const promise = (async () => {
		try {
			const data = await api.bmTalkgroups(id);
			state.dmr.talkgroups.set(id, {
				loading: false,
				talkgroups: data.talkgroups || [],
				error: null,
				defaultTg: data.default_tg,
			});
		} catch (error) {
			state.dmr.talkgroups.set(id, {
				loading: false,
				talkgroups: [],
				error: error.message || "Could not load talkgroups.",
			});
			toast(`Talkgroups for repeater ${id}: ${error.message}`, "bad");
		} finally {
			state.dmr.promises.delete(id);
			renderDmrResults();
			renderSummary();
		}
	})();
	state.dmr.promises.set(id, promise);
	return promise;
}

function toggleDmr(id, checked) {
	if (checked) {
		state.dmr.selected.add(id);
		ensureTalkgroups(id);
	} else {
		state.dmr.selected.delete(id);
	}
	invalidateBuilt();
	renderDmrResults();
	renderSummary();
}

function renderDmrResults() {
	const box = $("dmr-results");
	clear(box);
	if (!state.dmr.results.length) {
		if (state.dmr.fetchedKey) {
			box.append(el("p", { class: "hint", text: "No Brandmeister repeaters found in that radius. Try a larger radius." }));
		}
		return;
	}
	for (const repeater of state.dmr.results) {
		const selected = state.dmr.selected.has(repeater.id);
		const checkbox = el("input", {
			type: "checkbox",
			"data-dmr-id": String(repeater.id),
			checked: selected,
			"aria-label": `Add ${repeater.callsign} at ${formatKm(repeater.distance_km)}`,
		});
		const tags = el("div", { class: "result-tags" });
		tags.append(
			el("span", { class: "badge", text: `CC ${repeater.color_code}` }),
			el("span", { class: "badge", text: repeater.status === 3 ? "linked" : `status ${repeater.status ?? "?"}` }),
		);
		if (repeater.linkname) tags.append(el("span", { class: "badge", text: repeater.linkname }));
		const detail = el("div", { class: "result-detail" });
		const tg = state.dmr.talkgroups.get(repeater.id);
		if (selected) {
			if (!tg || tg.loading) detail.append(el("span", { text: "Loading static talkgroups…" }));
			else if (tg.error) {
				detail.append(el("div", { class: "result-error", text: tg.error }));
				const retry = el("button", { type: "button", class: "btn btn-small btn-ghost", text: "Retry talkgroups" });
				retry.addEventListener("click", () => {
					state.dmr.talkgroups.delete(repeater.id);
					ensureTalkgroups(repeater.id);
				});
				detail.append(retry);
			} else if (!tg.talkgroups.length) {
				detail.append(el("span", { text: "No static talkgroups listed." }));
			} else {
				const first = tg.talkgroups[0];
				detail.append(
					el("span", { text: "Static talkgroups: " }),
					el("b", { text: `${first.name} (${first.tg})` }),
					el("span", { class: "first", text: " default" }),
				);
				if (tg.talkgroups.length > 1) {
					const list = el("ol");
					for (const item of tg.talkgroups.slice(1, 6)) {
						list.append(el("li", { text: `${item.name} (${item.tg})${item.slot ? ` · TS${item.slot}` : ""}` }));
					}
					if (tg.talkgroups.length > 6) list.append(el("li", { text: `and ${tg.talkgroups.length - 6} more` }));
					detail.append(list);
				}
			}
		} else {
			detail.append(el("span", { text: "Select to load its static talkgroups and default contact." }));
		}

		const row = el(
			"div",
			{ class: `result${selected ? " selected" : ""}`, "data-row": String(repeater.id) },
			checkbox,
			el(
				"div",
				{ class: "result-main" },
				el(
					"div",
					{ class: "result-title" },
					el("span", { class: "result-call", text: repeater.callsign }),
					el("span", { class: "result-place", text: repeater.city || "—" }),
					el("span", { class: "badge badge-accent distance", text: formatKm(repeater.distance_km) }),
				),
				el("div", {
					class: "result-freq",
					text: `RX ${formatMHz(repeater.downlink_mhz * 1e6)} · TX ${formatMHz(repeater.uplink_mhz * 1e6)} MHz`,
				}),
				tags,
				detail,
			),
		);
		box.append(row);
	}
}

// --- analog repeaters ---

async function searchAnalog() {
	if (!ensureLocation()) return;
	if (state.analog.loading) return;
	state.analog.loading = true;
	const button = $("analog-search");
	button.disabled = true;
	button.textContent = "Searching…";
	setStatus("analog-status", "Asking HearHam for its repeater list…");
	try {
		const data = await api.analogNearby({
			lat: state.location.lat,
			lon: state.location.lon,
			radius: state.analog.radius,
			limit: 300,
			tonedOnly: $("analog-toned").checked,
			includeSimplex: $("analog-simplex").checked,
		});
		state.analog.results = [...(data.repeaters || []), ...state.analog.file.repeaters];
		state.analog.selected.clear();
		state.analog.fetchedKey = keyFor(state.location.lat, state.location.lon);
		state.analog.fetchedRadius = state.analog.radius;
		const truncated = data.truncated ? ` Showing the first ${state.analog.results.length}.` : "";
		setStatus(
			"analog-status",
			`${data.count} analog repeater${data.count === 1 ? "" : "s"} within ${data.radius_km} km.${truncated}`,
			data.count ? "ok" : "warn",
		);
		renderAnalogResults();
		renderSummary();
	} catch (error) {
		setStatus("analog-status", error.message || "HearHam search failed.", "error");
	} finally {
		state.analog.loading = false;
		button.disabled = false;
		button.textContent = "Find analog repeaters";
	}
}

function toggleAnalog(key, checked) {
	if (checked) state.analog.selected.add(key);
	else state.analog.selected.delete(key);
	invalidateBuilt();
	renderAnalogResults();
	renderSummary();
}

const analogKey = (repeater) => `${repeater.source || "hearham"}:${repeater.callsign}:${repeater.downlink_mhz}:${repeater.uplink_mhz}`;

const hasDistance = (repeater) => repeater.distance_km !== null && repeater.distance_km !== undefined;

const distanceText = (repeater) => (hasDistance(repeater) ? formatKm(repeater.distance_km) : "no coordinates");

function distanceBadge(repeater) {
	if (!hasDistance(repeater)) return el("span", { class: "badge", text: "no coordinates" });
	return el("span", { class: "badge badge-accent distance", text: formatKm(repeater.distance_km) });
}

function renderAnalogResults() {
	const box = $("analog-results");
	clear(box);
	if (!state.analog.results.length) {
		if (state.analog.fetchedKey) {
			box.append(el("p", { class: "hint", text: "No analog repeaters found. Try a larger radius, or allow entries without a tone." }));
		}
		return;
	}
	for (const repeater of state.analog.results) {
		const key = analogKey(repeater);
		const selected = state.analog.selected.has(key);
		const checkbox = el("input", {
			type: "checkbox",
			"data-analog-key": key,
			checked: selected,
			"aria-label": `Add ${repeater.callsign}, ${distanceText(repeater)}`,
		});
		const tags = el("div", { class: "result-tags" });
		if (repeater.tx_tone) tags.append(el("span", { class: "badge badge-accent", text: `TX tone ${repeater.tx_tone}` }));
		else tags.append(el("span", { class: "badge badge-warn", text: "no tone" }));
		if (repeater.rx_tone) tags.append(el("span", { class: "badge", text: `RX tone ${repeater.rx_tone}` }));
		if (!repeater.is_repeater) tags.append(el("span", { class: "badge badge-warn", text: "simplex" }));
		if (repeater.digital_capable) tags.append(el("span", { class: "badge", text: "digital capable" }));
		if (repeater.source === "file") tags.append(el("span", { class: "badge", text: "your file" }));
		if (repeater.mode) tags.append(el("span", { class: "badge", text: repeater.mode }));
		const description = repeater.description
			? el("div", { class: "result-detail", text: repeater.description.slice(0, 180) })
			: null;
		const row = el(
			"div",
			{ class: `result${selected ? " selected" : ""}` },
			checkbox,
			el(
				"div",
				{ class: "result-main" },
				el(
					"div",
					{ class: "result-title" },
					el("span", { class: "result-call", text: repeater.callsign }),
					el("span", { class: "result-place", text: repeater.city || "—" }),
					distanceBadge(repeater),
				),
				el("div", {
					class: "result-freq",
					text: `RX ${formatMHz(repeater.downlink_mhz * 1e6)} · TX ${formatMHz(repeater.uplink_mhz * 1e6)} MHz · shift ${repeater.offset_mhz > 0 ? "+" : ""}${repeater.offset_mhz.toFixed(4)} MHz`,
				}),
				tags,
				description,
			),
		);
		box.append(row);
	}
}

function syncSimplexControls() {
	const on = state.dmrSimplex.enabled;
	$("simplex-options").disabled = !on;
	$("simplex-access").disabled = !on;
	for (const input of document.querySelectorAll('input[name="simplex-contact"]')) {
		input.checked = input.value === state.dmrSimplex.choice;
	}
	$("simplex-access").checked = state.dmrSimplex.includeAccess;
}

function onSimplexChange() {
	state.dmrSimplex.enabled = $("simplex-on").checked;
	const picked = document.querySelector('input[name="simplex-contact"]:checked');
	if (picked) state.dmrSimplex.choice = picked.value;
	state.dmrSimplex.includeAccess = $("simplex-access").checked;
	syncSimplexControls();
	invalidateBuilt();
	saveState();
}

// --- a repeater list from a file ---

async function loadRepeaterFile(file) {
	if (!file) return;
	const report = $("analog-file-report");
	clear(report);
	let text = "";
	try {
		text = await file.text();
	} catch (error) {
		report.append(el("p", { class: "problem error", text: "The file could not be read." }));
		return;
	}
	const origin = state.location ? { lat: state.location.lat, lon: state.location.lon } : null;
	const parsed = parseRepeaterFile(text, file.name, origin);
	state.analog.file = { name: file.name, repeaters: parsed.repeaters, report: parsed };
	state.analog.results = [
		...state.analog.results.filter((repeater) => repeater.source !== "file"),
		...parsed.repeaters,
	];
	state.analog.results.sort((a, b) => {
		const da = a.distance_km ?? Infinity;
		const db = b.distance_km ?? Infinity;
		return da === db ? a.callsign.localeCompare(b.callsign) : da - db;
	});
	state.analog.selected.clear();
	invalidateBuilt();
	renderAnalogResults();
	renderSummary();

	const lines = [];
	lines.push(el("p", { class: "problem info", text: `${parsed.repeaters.length} repeater${parsed.repeaters.length === 1 ? "" : "s"} read from ${file.name}${parsed.skipped ? `, ${parsed.skipped} row${parsed.skipped === 1 ? "" : "s"} skipped` : ""}.` }));
	if (parsed.problems.length) {
		const list = el("ul", { class: "problem-list" });
		for (const problem of parsed.problems.slice(0, 8)) {
			list.append(el("li", { class: "problem warn", text: `Row ${problem.row}: ${problem.message}` }));
		}
		if (parsed.problems.length > 8) list.append(el("li", { class: "problem", text: `and ${parsed.problems.length - 8} more.` }));
		lines.push(list);
	}
	if (!state.location && parsed.repeaters.length) {
		lines.push(el("p", { class: "hint", text: "Set a location to see distances and plot these repeaters." }));
	}
	report.append(...lines);
	setStatus(
		"analog-status",
		`${state.analog.results.length} analog entr${state.analog.results.length === 1 ? "y" : "ies"} in the list.`,
		"ok",
	);
}

// --- build ---

function ensureLocation() {
	if (state.location) return true;
	toast("Set your location first.", "bad");
	$("location-card").scrollIntoView({ behavior: "smooth", block: "start" });
	return false;
}

function invalidateBuilt() {
	state.built = null;
	$("build-output").replaceChildren();
	renderSummary();
}

async function buildNow() {
	if (!ensureLocation()) return;
	const button = $("build");
	button.disabled = true;
	button.textContent = "Building…";
	try {
		const ids = [...state.dmr.selected];
		await Promise.all(ids.map((id) => ensureTalkgroups(id)));
		const dmr = state.dmr.results
			.filter((repeater) => state.dmr.selected.has(repeater.id))
			.map((repeater) => ({
				...repeater,
				talkgroups: state.dmr.talkgroups.get(repeater.id)?.talkgroups || [],
			}));
		const analog = state.analog.results.filter((repeater) => state.analog.selected.has(analogKey(repeater)));
		state.built = buildCodeplug({
			location: state.location,
			country: state.country,
			region: state.region,
			station: {
				callsign: $("callsign").value.trim(),
				dmrId: $("dmr-id").value.trim(),
			},
			packs: [...state.packs],
			dmr,
			analog,
			dmrSimplex: {
				enabled: state.dmrSimplex.enabled,
				plan: "es",
				choice: state.dmrSimplex.choice,
				includeAccess: state.dmrSimplex.includeAccess,
			},
			options: {
				aprsConfig: $("aprs-config").checked && !$("aprs-config").disabled,
				aprsSsid: Number($("aprs-ssid").value),
				fallbackTg: $("dmr-fallback").checked,
			},
		});
		renderBuild();
		renderSummary();
		$("build-output").scrollIntoView({ behavior: "smooth", block: "start" });
	} finally {
		button.disabled = false;
		button.textContent = "Build codeplug";
	}
}

function renderBuild() {
	const box = $("build-output");
	clear(box);
	const result = state.built;
	if (!result) return;

	if (result.errors.length) {
		box.append(el("p", { class: "subhead", text: "The codeplug cannot be exported yet" }));
		const list = el("ul", { class: "problem-list" });
		for (const problem of result.errors) list.append(el("li", { class: "problem error", text: problem.message }));
		box.append(list);
	}

	if (result.ok) {
		box.append(el("p", { class: "subhead", text: "Ready" }));
		const metrics = el("div", { class: "build-summary" });
		for (const [label, value] of [
			["Channels", result.summary.channels],
			["Contacts", result.summary.contacts],
			["RX lists", result.summary.rxLists],
			["Zones", result.summary.zones],
			["DMR", result.summary.dmr],
			["Simplex", result.summary.dmrSimplex],
			["Analog", result.summary.analog],
		]) {
			metrics.append(el("div", { class: "metric" }, el("b", { text: String(value) }), el("span", { text: label })));
		}
		box.append(metrics);
	}

	if (result.notes.length) {
		const list = el("ul", { class: "problem-list" });
		for (const note of result.notes) list.append(el("li", { class: "problem info", text: note.message }));
		box.append(el("p", { class: "subhead", text: "Notes" }), list);
	}
	if (result.warnings.length) {
		const list = el("ul", { class: "problem-list" });
		for (const warning of result.warnings) list.append(el("li", { class: "problem warn", text: warning.message }));
		box.append(el("p", { class: "subhead", text: `Warnings (${result.warnings.length})` }), list);
	}
	if (result.ok && result.model.channels.length) {
		box.append(el("p", { class: "subhead", text: "Channel preview" }));
		box.append(renderChannelPreview(result.model.channels));
		box.append(el("p", { class: "hint", text: "Download the YAML, then open it in the official RadioFoundry editor to review the tables and write the codeplug to the radio." }));
	}
}

function renderChannelPreview(channels) {
	const wrap = el("div", { class: "preview-wrap" });
	const table = el("table", { class: "preview-table" });
	const head = el("thead", {}, el(
		"tr",
		{},
		el("th", { text: "Name" }),
		el("th", { text: "Mode" }),
		el("th", { text: "RX MHz" }),
		el("th", { text: "TX MHz" }),
		el("th", { text: "Tone" }),
		el("th", { text: "CC/TS" }),
		el("th", { text: "Contact / list" }),
	));
	const body = el("tbody");
	for (const channel of channels.slice(0, 120)) {
		const tone = channel.txTone ? `TX ${channel.txTone}` : channel.rxTone ? `RX ${channel.rxTone}` : "";
		body.append(el(
			"tr",
			{},
			el("td", { text: channel.name }),
			el("td", { text: channel.mode.toUpperCase() }),
			el("td", { class: "num", text: formatMHz(channel.rxHz) }),
			el("td", { class: "num", text: formatMHz(channel.txHz) }),
			el("td", { text: tone }),
			el("td", { text: channel.mode === "dmr" ? `${channel.colorCode}/${channel.timeslot}` : "" }),
			el("td", { text: [channel.contact?.name, channel.rxList?.name].filter(Boolean).join(" · ") }),
		));
	}
	table.append(head, body);
	wrap.append(table);
	const extra = channels.length > 120 ? el("p", { class: "hint", text: `Showing 120 of ${channels.length} channels; the download has them all.` }) : null;
	return el("div", {}, wrap, extra);
}

// --- summary ---

function selectedPackChannels() {
	let channels = 0;
	for (const id of state.packs) {
		const pack = PACK_BY_ID.get(id);
		if (pack) channels += pack.channels({ region: state.region, country: state.country }).length;
	}
	return channels;
}

// The same plan data the build uses, so the draft count cannot drift from it.
function simplexDraftCount() {
	if (!state.dmrSimplex.enabled) return 0;
	return planChannels("es", {
		choice: state.dmrSimplex.choice,
		includeAccess: state.dmrSimplex.includeAccess,
	}).length;
}

function renderSummary() {
	const result = state.built;
	const locationNode = $("summary-location");
	if (!state.location) {
		locationNode.textContent = "No location set.";
	} else {
		locationNode.textContent = `${state.location.label} · ${formatLatLon(state.location.lat, state.location.lon, 4)} · ${latLonToLocator(state.location.lat, state.location.lon, 6)}`;
	}

	const counts = $("summary-counts");
	clear(counts);
	const entries = result?.ok
		? [
				["Channels", result.summary.channels],
				["Contacts", result.summary.contacts],
				["RX lists", result.summary.rxLists],
				["Zones", result.summary.zones],
				["DMR", result.summary.dmr],
				["Simplex", result.summary.dmrSimplex],
				["Analog", result.summary.analog],
			]
		: [
				["Channels", selectedPackChannels() + state.dmr.selected.size + state.analog.selected.size + simplexDraftCount()],
				["Packs", state.packs.size],
				["DMR", state.dmr.selected.size],
				["Analog", state.analog.selected.size],
			];
	for (const [term, value] of entries) {
		counts.append(el("div", {}, el("dt", { text: term }), el("dd", { text: String(value) })));
	}

	const stateBadge = $("summary-state");
	if (result?.ok) {
		stateBadge.textContent = "ready";
		stateBadge.className = "badge badge-ok";
	} else if (result?.errors.length) {
		stateBadge.textContent = "needs fixes";
		stateBadge.className = "badge badge-bad";
	} else {
		stateBadge.textContent = "draft";
		stateBadge.className = "badge";
	}

	const warnings = $("summary-warnings");
	clear(warnings);
	if (result?.errors.length) {
		for (const problem of result.errors.slice(0, 4)) warnings.append(el("div", { class: "problem error", text: problem.message }));
	} else if (result?.warnings.length) {
		warnings.append(el("div", { class: "problem warn", text: `${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"} — see the build output.` }));
	}

	$("download-yaml").disabled = !result?.ok;
	$("download-csv").disabled = !result?.ok;
	$("copy-yaml").disabled = !result?.ok;
	renderPlot();
}

function renderPlot() {
	const box = $("plot");
	clear(box);
	if (!state.location) {
		box.append(el("span", { text: "Set a location to see repeaters around you." }));
		return;
	}
	const points = [
		...state.dmr.results.map((repeater) => ({ ...repeater, kind: "dmr", selected: state.dmr.selected.has(repeater.id) })),
		...state.analog.results
			.filter((repeater) => repeater.lat !== null && repeater.lon !== null)
			.map((repeater) => ({ ...repeater, kind: "analog", selected: state.analog.selected.has(analogKey(repeater)) })),
	];
	if (!points.length) {
		box.append(el("span", { text: "Search for repeaters to plot them here." }));
		return;
	}
	const maxDistance = Math.max(5, ...points.map((point) => point.distance_km));
	const maxKm = Math.max(10, Math.ceil(maxDistance / 10) * 10);
	const NS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", "0 0 320 200");
	svg.setAttribute("role", "img");
	svg.setAttribute("aria-label", `Repeaters within ${maxKm} km of your location`);
	const centerX = 160;
	const centerY = 100;
	const radius = 84;
	const scale = radius / maxKm;

	for (const fraction of [0.25, 0.5, 0.75, 1]) {
		const circle = document.createElementNS(NS, "circle");
		circle.setAttribute("cx", String(centerX));
		circle.setAttribute("cy", String(centerY));
		circle.setAttribute("r", String(radius * fraction));
		circle.setAttribute("fill", "none");
		circle.setAttribute("stroke", "currentColor");
		circle.setAttribute("stroke-opacity", fraction === 1 ? "0.35" : "0.15");
		circle.setAttribute("stroke-dasharray", "3 4");
		svg.append(circle);
	}
	const center = document.createElementNS(NS, "circle");
	center.setAttribute("cx", String(centerX));
	center.setAttribute("cy", String(centerY));
	center.setAttribute("r", "4");
	center.setAttribute("fill", "currentColor");
	svg.append(center);

	for (const point of points) {
		const xKm = (point.lon - state.location.lon) * 111.32 * Math.cos((state.location.lat * Math.PI) / 180);
		const yKm = (point.lat - state.location.lat) * 110.57;
		const x = centerX + xKm * scale;
		const y = centerY - yKm * scale;
		const dot = document.createElementNS(NS, "circle");
		dot.setAttribute("cx", x.toFixed(1));
		dot.setAttribute("cy", y.toFixed(1));
		dot.setAttribute("r", point.selected ? "4" : "2.6");
		dot.setAttribute("fill", point.kind === "dmr" ? (point.selected ? "#ef7a50" : "none") : point.selected ? "#4a9d62" : "none");
		dot.setAttribute("stroke", point.kind === "dmr" ? "#b8431f" : "#2f7d47");
		dot.setAttribute("stroke-width", point.selected ? "2" : "1.4");
		dot.setAttribute("stroke-opacity", point.selected ? "1" : "0.75");
		const title = document.createElementNS(NS, "title");
		title.textContent = `${point.callsign} · ${point.kind === "dmr" ? "DMR" : "analog"} · ${point.distance_km.toFixed(1)} km`;
		dot.append(title);
		svg.append(dot);
	}
	box.append(svg);
}

// --- download ---

function baseName() {
	const call = (state.station.callsign || "codeplug").toUpperCase().replace(/[^A-Z0-9]/g, "");
	const date = new Date();
	const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	return `${call || "codeplug"}-${stamp}`;
}

function downloadBlob(name, blob) {
	const url = URL.createObjectURL(blob);
	const anchor = el("a", { href: url, download: name });
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadYaml() {
	if (!state.built?.ok) return;
	downloadBlob(`${baseName()}.yaml`, new Blob([state.built.yaml], { type: "application/x-yaml" }));
}

function downloadCsv() {
	if (!state.built?.ok) return;
	const zip = makeZip(state.built.csvFiles);
	downloadBlob(`${baseName()}-csv.zip`, new Blob([zip], { type: "application/zip" }));
}

async function copyYaml() {
	if (!state.built?.ok) return;
	try {
		await navigator.clipboard.writeText(state.built.yaml);
		toast("YAML copied to the clipboard.", "ok");
	} catch (error) {
		toast("The browser refused clipboard access; download the file instead.", "bad");
	}
}

// --- reset and wiring ---

function resetPage() {
	if (!window.confirm("Clear the location, selections and station details on this page?")) return;
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch (error) {
		/* ignore */
	}
	state.location = null;
	state.country = "ES";
	state.region = "R1";
	state.packs = new Set(defaultPacks("R1", "ES"));
	state.station = { callsign: "", dmrId: "", ssid: 7 };
	state.options = { aprsConfig: true, fallbackTg: true };
	state.showAllPacks = false;
	state.dmrSimplex = { enabled: false, choice: "tg99", includeAccess: false };
	state.built = null;
	clearResults();
	$("lat").value = "";
	$("lon").value = "";
	$("locator").value = "";
	$("city").value = "";
	$("callsign").value = "";
	$("dmr-id").value = "";
	$("aprs-ssid").value = "7";
	$("aprs-config").checked = true;
	$("dmr-fallback").checked = true;
	$("pack-all").checked = false;
	$("simplex-on").checked = false;
	syncSimplexControls();
	$("country").value = "ES";
	$("region").value = "R1";
	$("build-output").replaceChildren();
	$("analog-file-report").replaceChildren();
	$("analog-file").value = "";
	state.analog.file = { name: "", repeaters: [], report: null };
	renderLocation();
	renderPackList();
	renderSummary();
}

function wire() {
	$("apply-latlon").addEventListener("click", applyCoordinates);
	$("apply-locator").addEventListener("click", applyLocator);
	$("geolocate").addEventListener("click", geolocate);
	$("city-search").addEventListener("click", searchCity);
	$("city").addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			searchCity();
		}
	});
	$("lat").addEventListener("keydown", (event) => {
		if (event.key === "Enter") applyCoordinates();
	});
	$("lon").addEventListener("keydown", (event) => {
		if (event.key === "Enter") applyCoordinates();
	});
	$("locator").addEventListener("keydown", (event) => {
		if (event.key === "Enter") applyLocator();
	});
	$("country").addEventListener("change", () => {
		state.country = $("country").value;
		if (state.country) {
			state.region = regionForCountry(state.country);
			$("region").value = state.region;
		}
		renderPackList();
		invalidateBuilt();
		saveState();
	});
	$("pack-all").addEventListener("change", () => {
		state.showAllPacks = $("pack-all").checked;
		renderPackList();
		saveState();
	});
	$("region").addEventListener("change", () => {
		state.region = $("region").value;
		renderPackList();
		invalidateBuilt();
		saveState();
	});
	$("pack-list").addEventListener("change", onPackChange);
	$("pack-defaults").addEventListener("click", () => {
		state.packs = new Set(defaultPacks(state.region, state.country));
		renderPackList();
		invalidateBuilt();
		saveState();
	});
	$("aprs-config").addEventListener("change", () => {
		state.options.aprsConfig = $("aprs-config").checked;
		updatePackSummary();
		invalidateBuilt();
		saveState();
	});
	$("aprs-ssid").addEventListener("input", () => {
		state.station.ssid = Number($("aprs-ssid").value) || 0;
		invalidateBuilt();
		saveState();
	});
	$("dmr-radius").addEventListener("input", () => {
		state.dmr.radius = Number($("dmr-radius").value);
		$("dmr-radius-out").textContent = `${state.dmr.radius} km`;
		saveState();
	});
	$("analog-radius").addEventListener("input", () => {
		state.analog.radius = Number($("analog-radius").value);
		$("analog-radius-out").textContent = `${state.analog.radius} km`;
		saveState();
	});
	$("analog-file").addEventListener("change", (event) => loadRepeaterFile(event.target.files?.[0]));
	$("simplex-on").addEventListener("change", onSimplexChange);
	for (const input of document.querySelectorAll('input[name="simplex-contact"]')) {
		input.addEventListener("change", onSimplexChange);
	}
	$("simplex-access").addEventListener("change", onSimplexChange);
	$("dmr-search").addEventListener("click", searchDmr);
	$("analog-search").addEventListener("click", searchAnalog);
	$("dmr-fallback").addEventListener("change", () => {
		state.options.fallbackTg = $("dmr-fallback").checked;
		invalidateBuilt();
		saveState();
	});
	$("analog-toned").addEventListener("change", () => {
		invalidateBuilt();
	});
	$("analog-simplex").addEventListener("change", () => {
		invalidateBuilt();
	});
	$("dmr-results").addEventListener("change", (event) => {
		const checkbox = event.target.closest("input[data-dmr-id]");
		if (checkbox) toggleDmr(Number(checkbox.dataset.dmrId), checkbox.checked);
	});
	$("analog-results").addEventListener("change", (event) => {
		const checkbox = event.target.closest("input[data-analog-key]");
		if (checkbox) toggleAnalog(checkbox.dataset.analogKey, checkbox.checked);
	});
	$("callsign").addEventListener("input", () => {
		state.station.callsign = $("callsign").value.trim();
		invalidateBuilt();
		saveState();
	});
	$("dmr-id").addEventListener("input", () => {
		state.station.dmrId = $("dmr-id").value.trim();
		invalidateBuilt();
		saveState();
	});
	$("build").addEventListener("click", buildNow);
	$("reset").addEventListener("click", resetPage);
	$("download-yaml").addEventListener("click", downloadYaml);
	$("download-csv").addEventListener("click", downloadCsv);
	$("copy-yaml").addEventListener("click", copyYaml);
}

function renderSources() {
	const list = $("sources");
	clear(list);
	for (const source of state.meta?.sources || []) {
		list.append(el(
			"li",
			{},
			el("b", { text: source.name }),
			el("span", { text: source.note }),
			el("a", { href: source.url, target: "_blank", rel: "noopener", text: source.url }),
		));
	}
}

async function init() {
	populateCountrySelect();
	loadState();
	if (!state.packs.size) state.packs = new Set(defaultPacks(state.region, state.country));

	if (state.location) {
		$("lat").value = state.location.lat.toFixed(5);
		$("lon").value = state.location.lon.toFixed(5);
		$("locator").value = latLonToLocator(state.location.lat, state.location.lon, 6);
	}
	$("country").value = COUNTRY_BY_CC.has(state.country) ? state.country : "";
	$("region").value = state.region;
	$("callsign").value = state.station.callsign;
	$("dmr-id").value = state.station.dmrId;
	$("aprs-ssid").value = String(state.station.ssid);
	$("aprs-config").checked = state.options.aprsConfig;
	$("dmr-fallback").checked = state.options.fallbackTg;
	$("pack-all").checked = state.showAllPacks;
	$("simplex-on").checked = state.dmrSimplex.enabled;
	syncSimplexControls();
	$("dmr-radius").value = String(state.dmr.radius);
	$("dmr-radius-out").textContent = `${state.dmr.radius} km`;
	$("analog-radius").value = String(state.analog.radius);
	$("analog-radius-out").textContent = `${state.analog.radius} km`;

	wire();
	renderLocation();
	renderPackList();
	renderSummary();

	try {
		state.meta = await api.meta();
		const max = state.meta.limits?.max_radius_km || 300;
		for (const id of ["dmr-radius", "analog-radius"]) {
			$(id).max = String(max);
			if (Number($(id).value) > max) $(id).value = String(max);
		}
		state.dmr.radius = Number($("dmr-radius").value);
		state.analog.radius = Number($("analog-radius").value);
		$("dmr-radius-out").textContent = `${state.dmr.radius} km`;
		$("analog-radius-out").textContent = `${state.analog.radius} km`;
		renderSources();
	} catch (error) {
		$("sources").replaceChildren(el("li", { text: "The builder server is not available, so repeater and city search will not work." }));
	}
}

init();
