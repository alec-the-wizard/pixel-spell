/**
 * Generates build/icon.png without any image dependencies.
 *
 * The mark mirrors the in-app logo: a sky-blue rounded square with a white
 * wand and sparkles. Shapes are supersampled for clean edges at every icon size.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const SIZE = 512;
const SCALE = 3;
const W = SIZE * SCALE;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
	let value = index;
	for (let bit = 0; bit < 8; bit++) {
		value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	}
	crcTable[index] = value >>> 0;
}

function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const typeBytes = Buffer.from(type, "ascii");
	const body = Buffer.concat([typeBytes, data]);
	const result = Buffer.alloc(body.length + 8);
	result.writeUInt32BE(data.length, 0);
	body.copy(result, 4);
	result.writeUInt32BE(crc32(body), body.length + 4);
	return result;
}

function png(rgba, width, height) {
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	header[10] = 0;
	header[11] = 0;
	header[12] = 0;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function rounded(x, y, left, top, right, bottom, radius) {
	const cx = Math.max(left + radius, Math.min(x, right - radius));
	const cy = Math.max(top + radius, Math.min(y, bottom - radius));
	const dx = x - cx;
	const dy = y - cy;
	return x >= left && x <= right && y >= top && y <= bottom && dx * dx + dy * dy <= radius * radius;
}

function capsule(x, y, ax, ay, bx, by, radius) {
	const abx = bx - ax;
	const aby = by - ay;
	const t = Math.max(
		0,
		Math.min(1, ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby)),
	);
	const dx = x - (ax + abx * t);
	const dy = y - (ay + aby * t);
	return dx * dx + dy * dy <= radius * radius;
}

function star(x, y, cx, cy, radius, power = 0.5) {
	const nx = Math.abs(x - cx) / radius;
	const ny = Math.abs(y - cy) / radius;
	return Math.pow(nx, power) + Math.pow(ny, power) <= 1;
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
const subpixels = SCALE * SCALE;

for (let py = 0; py < SIZE; py++) {
	for (let px = 0; px < SIZE; px++) {
		let r = 0;
		let g = 0;
		let b = 0;
		let a = 0;

		for (let sy = 0; sy < SCALE; sy++) {
			for (let sx = 0; sx < SCALE; sx++) {
				const x = px * SCALE + sx + 0.5;
				const y = py * SCALE + sy + 0.5;
				if (!rounded(x, y, 38, 38, 474, 474, 112)) continue;

				// Sky-blue vertical gradient.
				const t = Math.max(0, Math.min(1, (x + y - 76) / 836));
				let cr = Math.round(56 + (2 - 56) * t);
				let cg = Math.round(189 + (132 - 189) * t);
				let cb = Math.round(248 + (199 - 248) * t);

				const wand = capsule(x, y, 176, 348, 350, 174, 24);
				const bigStar = star(x, y, 372, 146, 72);
				const smallStarA = star(x, y, 160, 158, 32);
				const smallStarB = star(x, y, 384, 382, 26);
				const tail = capsule(x, y, 128, 392, 180, 340, 10);

				if (wand || bigStar || smallStarA || smallStarB || tail) {
					cr = 255;
					cg = 255;
					cb = 255;
				}

				r += cr;
				g += cg;
				b += cb;
				a += 255;
			}
		}

		const offset = (py * SIZE + px) * 4;
		if (a > 0) {
			rgba[offset] = Math.round(r / subpixels);
			rgba[offset + 1] = Math.round(g / subpixels);
			rgba[offset + 2] = Math.round(b / subpixels);
			rgba[offset + 3] = Math.round(a / subpixels);
		}
	}
}

const output = path.join(root, "build", "icon.png");
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, png(rgba, SIZE, SIZE));
console.log(`Wrote ${path.relative(root, output)} (${SIZE}×${SIZE})`);
