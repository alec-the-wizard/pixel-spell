import { frameDurationMs } from "./doc.js";
import {
	animationFrameIndices,
	exportFrameImage,
	validateExportSize,
	type ExportBackground,
} from "./export.js";
import type { PixelDoc } from "./types.js";

export interface AnimatedWebpExportOptions {
	scale: number;
	loop: boolean;
	background: ExportBackground;
	/** Lossy quality 0–100. */
	quality: number;
	/** Frame indices to export, in playback order; missing means all frames. */
	frames?: readonly number[];
}

interface WebpSubChunk {
	fourCc: string;
	raw: Uint8Array;
}

/**
 * Walks the RIFF chunk list of a still WebP and returns the raw ALPH and
 * VP8/VP8L sub-chunks (in order) that make up a single frame. VP8X, ICCP,
 * EXIF, XMP, and unknown chunks are dropped because the animated container
 * supplies its own VP8X/ANIM/ANMF scaffolding.
 */
function extractFrameChunks(bytes: Uint8Array): WebpSubChunk[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length < 12) throw new Error("Invalid WebP frame");
	const alpha: WebpSubChunk[] = [];
	const bitstream: WebpSubChunk[] = [];
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const fourCc = String.fromCharCode(
			bytes[offset]!,
			bytes[offset + 1]!,
			bytes[offset + 2]!,
			bytes[offset + 3]!,
		);
		const size = view.getUint32(offset + 4, true);
		const pad = size % 2;
		const end = offset + 8 + size + pad;
		if (end > bytes.length) throw new Error("WebP chunk is truncated");
		if (fourCc === "ALPH") {
			alpha.push({ fourCc, raw: bytes.slice(offset, end) });
		} else if (fourCc === "VP8 " || fourCc === "VP8L") {
			bitstream.push({ fourCc, raw: bytes.slice(offset, end) });
		}
		offset = end;
	}
	return [...alpha, ...bitstream];
}

function uint24(value: number, view: DataView, at: number): void {
	view.setUint8(at, value & 0xff);
	view.setUint8(at + 1, (value >>> 8) & 0xff);
	view.setUint8(at + 2, (value >>> 16) & 0xff);
}

function riffChunk(fourCc: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(8 + payload.length + (payload.length % 2));
	const view = new DataView(output.buffer);
	output.set(
		[fourCc.charCodeAt(0), fourCc.charCodeAt(1), fourCc.charCodeAt(2), fourCc.charCodeAt(3)],
		0,
	);
	view.setUint32(4, payload.length, true);
	output.set(payload, 8);
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

/** Assembles an animated WebP from still-WebP frame bitstreams. */
export function buildAnimatedWebp(
	frames: { subChunks: WebpSubChunk[] }[],
	width: number,
	height: number,
	delaysMs: number[],
	loop: boolean,
	background: ExportBackground,
): Uint8Array<ArrayBuffer> {
	const hasAlpha = background === "transparent";

	const vp8x = new Uint8Array(10);
	const vp8xView = new DataView(vp8x.buffer);
	vp8xView.setUint8(0, 0x02 | (hasAlpha ? 0x10 : 0));
	uint24(width - 1, vp8xView, 4);
	uint24(height - 1, vp8xView, 7);

	const anim = new Uint8Array(6);
	const animView = new DataView(anim.buffer);
	const backgroundRgb =
		background === "white" ? 0xffffff : background === "black" ? 0x000000 : 0;
	const backgroundAlpha = background === "transparent" ? 0 : 255;
	// ANIM background is stored as Blue, Green, Red, Alpha.
	animView.setUint8(0, backgroundRgb & 0xff);
	animView.setUint8(1, (backgroundRgb >>> 8) & 0xff);
	animView.setUint8(2, (backgroundRgb >>> 16) & 0xff);
	animView.setUint8(3, backgroundAlpha);
	animView.setUint16(4, loop ? 0 : 1, true);

	const parts: Uint8Array[] = [];
	parts.push(new TextEncoder().encode("RIFF"));
	parts.push(new Uint8Array(4)); // RIFF size placeholder
	parts.push(new TextEncoder().encode("WEBP"));
	parts.push(riffChunk("VP8X", vp8x));
	parts.push(riffChunk("ANIM", anim));

	frames.forEach((frame, index) => {
		const frameData = concat(frame.subChunks.map((chunk) => chunk.raw));
		const header = new Uint8Array(16);
		const view = new DataView(header.buffer);
		uint24(0, view, 0); // Frame X * 2 → x = 0
		uint24(0, view, 3); // Frame Y * 2 → y = 0
		uint24(width - 1, view, 6);
		uint24(height - 1, view, 9);
		uint24(Math.max(1, Math.min(0xffffff, Math.round(delaysMs[index] ?? 100))), view, 12);
		// Reserved (6 bits) | Blending method (B, 1 bit = no blend) | Disposal (D, 0)
		view.setUint8(15, 0x02);
		parts.push(riffChunk("ANMF", concat([header, frameData])));
	});

	const body = concat(parts.slice(1)); // everything after "RIFF"
	new DataView(parts[1]!.buffer).setUint32(0, body.length - 4, true);

	return concat(parts);
}

/** Encodes the document as an animated (lossy) WebP. */
export async function exportAnimatedWebp(
	doc: PixelDoc,
	options: AnimatedWebpExportOptions,
): Promise<Blob> {
	const scale = Math.max(1, Math.min(10, Math.round(options.scale)));
	const frameIndices = animationFrameIndices(doc, options.frames);
	const width = doc.width * scale;
	const height = doc.height * scale;
	const sizeError = validateExportSize(width, height, frameIndices.length, true);
	if (sizeError) throw new Error(sizeError);

	const frames: { subChunks: WebpSubChunk[] }[] = [];
	const delaysMs: number[] = [];
	for (const frameIndex of frameIndices) {
		const blob = await exportFrameImage(doc, {
			frame: frameIndex,
			scale,
			format: "webp",
			background: options.background,
			quality: options.quality,
		});
		const bytes = new Uint8Array(await blob.arrayBuffer());
		frames.push({ subChunks: extractFrameChunks(bytes) });
		delaysMs.push(frameDurationMs(doc, frameIndex));
	}

	return new Blob(
		[
			buildAnimatedWebp(
				frames,
				width,
				height,
				delaysMs,
				options.loop,
				options.background,
			),
		],
		{ type: "image/webp" },
	);
}
