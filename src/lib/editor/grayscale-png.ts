/**
 * Minimal 8-bit grayscale PNG encoder used by the export dialog.
 *
 * The browser canvas API only encodes RGBA PNGs, so a true grayscale PNG (PNG
 * color type 0, or type 4 with alpha) needs its own encoder. Scanlines are
 * filtered with "None" and compressed with `CompressionStream("deflate")`
 * when available; a stored-block zlib stream keeps the fallback dependency
 * free and always produces a valid file.
 */

import { perceptualLuminance } from "./grayscale.js";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index++) {
		let value = index;
		for (let bit = 0; bit < 8; bit++) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (let index = 0; index < bytes.length; index++) {
		crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
	let a = 1;
	let b = 0;
	for (let index = 0; index < bytes.length; index++) {
		a = (a + bytes[index]!) % 65521;
		b = (b + a) % 65521;
	}
	return ((b << 16) | a) >>> 0;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
	target[offset] = (value >>> 24) & 0xff;
	target[offset + 1] = (value >>> 16) & 0xff;
	target[offset + 2] = (value >>> 8) & 0xff;
	target[offset + 3] = value & 0xff;
}

/** Wraps one PNG chunk (length, type, data, CRC). */
function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
	const chunk = new Uint8Array(12 + data.length);
	writeUint32(chunk, 0, data.length);
	for (let index = 0; index < 4; index++) {
		chunk[4 + index] = type.charCodeAt(index) & 0xff;
	}
	chunk.set(data, 8);
	const crc = crc32(chunk.subarray(4, 8 + data.length));
	writeUint32(chunk, 8 + data.length, crc);
	return chunk;
}

/** zlib with uncompressed (stored) blocks; used when CompressionStream fails. */
function storedZlib(data: Uint8Array): Uint8Array<ArrayBuffer> {
	const blockCount = Math.max(1, Math.ceil(data.length / 65535));
	const output = new Uint8Array(2 + blockCount * 5 + data.length + 4);
	let offset = 0;
	output[offset++] = 0x78;
	output[offset++] = 0x01;

	for (let block = 0; block < blockCount; block++) {
		const start = block * 65535;
		const length = Math.min(65535, data.length - start);
		const final = block === blockCount - 1;
		output[offset++] = final ? 1 : 0;
		output[offset++] = length & 0xff;
		output[offset++] = (length >>> 8) & 0xff;
		const inverse = ~length & 0xffff;
		output[offset++] = inverse & 0xff;
		output[offset++] = (inverse >>> 8) & 0xff;
		output.set(data.subarray(start, start + length), offset);
		offset += length;
	}

	writeUint32(output, offset, adler32(data));
	return output;
}

async function deflate(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
	if (typeof CompressionStream !== "undefined") {
		try {
			const copy = new Uint8Array(data.length);
			copy.set(data);
			const stream = new Blob([copy])
				.stream()
				.pipeThrough(new CompressionStream("deflate"));
			const buffer = await new Response(stream).arrayBuffer();
			return new Uint8Array(buffer);
		} catch {
			// Fall through to the dependency-free encoder.
		}
	}
	return storedZlib(data);
}

export interface GrayscalePngOptions {
	/** Include an alpha channel (PNG color type 4). Defaults to false. */
	alpha?: boolean;
}

/**
 * Encodes packed RGBA pixels as an 8-bit grayscale PNG. RGB is reduced with
 * perceptual luminance; alpha is written only when requested.
 */
export async function encodeGrayscalePng(
	pixels: Uint32Array,
	width: number,
	height: number,
	options: GrayscalePngOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	const alpha = options.alpha === true;
	const channels = alpha ? 2 : 1;
	const rowLength = w * channels;
	const raw = new Uint8Array((rowLength + 1) * h);

	let offset = 0;
	for (let y = 0; y < h; y++) {
		raw[offset++] = 0; // Filter: None.
		const row = y * w;
		for (let x = 0; x < w; x++) {
			const value = pixels[row + x] ?? 0;
			const gray = Math.round(
				perceptualLuminance(
					value & 0xff,
					(value >>> 8) & 0xff,
					(value >>> 16) & 0xff,
				),
			);
			raw[offset++] = gray;
			if (alpha) raw[offset++] = value >>> 24;
		}
	}

	const ihdr = new Uint8Array(13);
	writeUint32(ihdr, 0, w);
	writeUint32(ihdr, 4, h);
	ihdr[8] = 8; // Bit depth.
	ihdr[9] = alpha ? 4 : 0; // Grayscale, optionally with alpha.
	ihdr[10] = 0; // Compression.
	ihdr[11] = 0; // Filter method.
	ihdr[12] = 0; // Interlace.

	const compressed = await deflate(raw);
	const chunks = [
		new Uint8Array(PNG_SIGNATURE),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", compressed),
		pngChunk("IEND", new Uint8Array(0)),
	];

	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const output = new Uint8Array(total);
	let cursor = 0;
	for (const chunk of chunks) {
		output.set(chunk, cursor);
		cursor += chunk.length;
	}
	return output;
}
