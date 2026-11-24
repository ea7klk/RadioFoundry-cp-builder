// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry-cp-builder Authors
// A minimal store-only ZIP writer for the CSV table set. No compression: the
// files are a few kilobytes and store entries are readable everywhere.

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
	let c = i;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	CRC_TABLE[i] = c >>> 0;
}

export function crc32(bytes) {
	let c = 0xffffffff;
	for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function dosStamp(date = new Date()) {
	const year = Math.max(1980, date.getFullYear());
	const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
	const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
	return { time: time & 0xffff, date: day & 0xffff };
}

// files: [{name, text}] -> Uint8Array of a .zip
export function makeZip(files, when = new Date()) {
	const encoder = new TextEncoder();
	const { time, date } = dosStamp(when);
	const localParts = [];
	const centralParts = [];
	let offset = 0;

	for (const file of files) {
		const name = encoder.encode(file.name);
		const data = encoder.encode(String(file.text ?? ""));
		const crc = crc32(data);

		const local = new Uint8Array(30 + name.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(6, 0x0800, true); // UTF-8 names
		lv.setUint16(8, 0, true); // store
		lv.setUint16(10, time, true);
		lv.setUint16(12, date, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, data.length, true);
		lv.setUint32(22, data.length, true);
		lv.setUint16(26, name.length, true);
		lv.setUint16(28, 0, true);
		local.set(name, 30);
		localParts.push(local, data);

		const central = new Uint8Array(46 + name.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, 20, true); // made by
		cv.setUint16(6, 20, true); // needed
		cv.setUint16(8, 0x0800, true);
		cv.setUint16(10, 0, true);
		cv.setUint16(12, time, true);
		cv.setUint16(14, date, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, data.length, true);
		cv.setUint32(24, data.length, true);
		cv.setUint16(28, name.length, true);
		cv.setUint16(30, 0, true);
		cv.setUint16(32, 0, true);
		cv.setUint16(34, 0, true);
		cv.setUint16(36, 0, true);
		cv.setUint32(38, 0, true);
		cv.setUint32(42, offset, true);
		central.set(name, 46);
		centralParts.push(central);

		offset += local.length + data.length;
	}

	const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(4, 0, true);
	ev.setUint16(6, 0, true);
	ev.setUint16(8, files.length, true);
	ev.setUint16(10, files.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);
	ev.setUint16(20, 0, true);

	const total = offset + centralSize + end.length;
	const out = new Uint8Array(total);
	let at = 0;
	for (const part of [...localParts, ...centralParts, end]) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
