import { frameDurationMs } from "./doc.js";
import {
	animationFrameIndices,
	exportFrameImage,
	validateExportSize,
	type ExportBackground,
} from "./export.js";
import type { PixelDoc } from "./types.js";

export interface ApngExportOptions {
	scale: number;
	loop: boolean;
	background: ExportBackground;
	/** Frame indices to export, in playback order; missing means all frames. */
	frames?: readonly number[];
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
	let crc = 0xffffffff;
	for (let index = start; index < end; index++) {
		crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

interface PngChunk {
	type: string;
	data: Uint8Array;
}

/** Parses a PNG into its 8-byte signature and a list of chunks (CRC verified). */
function parsePng(bytes: Uint8Array): { signature: Uint8Array; chunks: PngChunk[] } {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const signature = bytes.slice(0, 8);
	const chunks: PngChunk[] = [];
	let offset = 8;
	while (offset + 8 <= bytes.length) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(
			bytes[offset + 4]!,
			bytes[offset + 5]!,
			bytes[offset + 6]!,
			bytes[offset + 7]!,
		);
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		if (dataEnd + 4 > bytes.length) {
			throw new Error("PNG chunk is truncated");
		}
		const expected = view.getUint32(dataEnd);
		const actual = crc32(bytes, offset + 4, dataEnd);
		if (expected !== actual) {
			throw new Error("PNG chunk CRC mismatch");
		}
		chunks.push({ type, data: bytes.slice(dataStart, dataEnd) });
		offset = dataEnd + 4;
	}
	return { signature, chunks };
}

function concatIdat(chunks: PngChunk[]): Uint8Array<ArrayBuffer> {
	let total = 0;
	for (const chunk of chunks) {
		if (chunk.type === "IDAT") total += chunk.data.length;
	}
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		if (chunk.type !== "IDAT") continue;
		output.set(chunk.data, offset);
		offset += chunk.data.length;
	}
	return output;
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(12 + data.length);
	const view = new DataView(output.buffer);
	view.setUint32(0, data.length);
	output.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)], 4);
	output.set(data, 8);
	const crc = crc32(output, 4, 8 + data.length);
	view.setUint32(8 + data.length, crc);
	return output;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	let total = 0;
	for (const part of parts) total += part.length;
	const output = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

/**
 * Builds an animated PNG from a list of frame PNGs that share identical
 * dimensions and color types. The first frame's IHDR becomes the default
 * image; every frame's compressed scanlines are reused directly as fdAT data
 * because each APNG frame covers the full canvas.
 */
export function buildApng(
	framePngs: Uint8Array[],
	delaysMs: number[],
	loop: boolean,
): Uint8Array<ArrayBuffer> {
	if (framePngs.length === 0) throw new Error("APNG needs at least one frame");

	const first = parsePng(framePngs[0]!);
	const ihdr = first.chunks.find((entry) => entry.type === "IHDR");
	if (!ihdr) throw new Error("PNG frame has no IHDR");

	const ihdrView = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
	const frameWidth = ihdrView.getUint32(0);
	const frameHeight = ihdrView.getUint32(4);

	const firstIdat = concatIdat(first.chunks);

	const writeFctl = (sequence: number, delayMs: number): Uint8Array => {
		const data = new Uint8Array(26);
		const view = new DataView(data.buffer);
		view.setUint32(0, sequence);
		view.setUint32(4, frameWidth);
		view.setUint32(8, frameHeight);
		view.setUint32(12, 0); // x offset
		view.setUint32(16, 0); // y offset
		view.setUint16(20, Math.max(1, Math.min(65535, Math.round(delayMs))));
		view.setUint16(22, 1000); // delay denominator → milliseconds
		data[24] = 0; // dispose: none
		data[25] = 0; // blend: source (full replacement)
		return data;
	};

	const parts: Uint8Array[] = [PNG_SIGNATURE.slice()];
	parts.push(chunk("IHDR", ihdr.data));

	const acTl = new Uint8Array(8);
	new DataView(acTl.buffer).setUint32(0, framePngs.length);
	new DataView(acTl.buffer).setUint32(4, loop ? 0 : 1);
	parts.push(chunk("acTL", acTl));

	parts.push(chunk("fcTL", writeFctl(0, delaysMs[0] ?? 100)));
	parts.push(chunk("IDAT", firstIdat));

	for (let index = 1; index < framePngs.length; index++) {
		const frame = parsePng(framePngs[index]!);
		const frameIdat = concatIdat(frame.chunks);
		const fdAt = new Uint8Array(4 + frameIdat.length);
		new DataView(fdAt.buffer).setUint32(0, index);
		fdAt.set(frameIdat, 4);
		parts.push(chunk("fcTL", writeFctl(index, delaysMs[index] ?? 100)));
		parts.push(chunk("fdAT", fdAt));
	}

	parts.push(chunk("IEND", new Uint8Array(0)));
	return concat(parts);
}

/** Encodes the document as an APNG, preserving per-frame durations. */
export async function exportApng(
	doc: PixelDoc,
	options: ApngExportOptions,
): Promise<Blob> {
	const scale = Math.max(1, Math.min(10, Math.round(options.scale)));
	const frameIndices = animationFrameIndices(doc, options.frames);
	const width = doc.width * scale;
	const height = doc.height * scale;
	const sizeError = validateExportSize(width, height, frameIndices.length, true);
	if (sizeError) throw new Error(sizeError);

	const framePngs: Uint8Array[] = [];
	const delaysMs: number[] = [];
	for (const frameIndex of frameIndices) {
		const blob = await exportFrameImage(doc, {
			frame: frameIndex,
			scale,
			format: "png",
			background: options.background,
			quality: 90,
		});
		framePngs.push(new Uint8Array(await blob.arrayBuffer()));
		delaysMs.push(frameDurationMs(doc, frameIndex));
	}

	return new Blob([buildApng(framePngs, delaysMs, options.loop)], {
		type: "image/apng",
	});
}
