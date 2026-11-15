import { compositeFrame } from "./doc.js";
import type { ExportBackground, IconFormat } from "./export.js";
import { drawPixels } from "./render.js";
import type { PixelDoc } from "./types.js";

export interface IconExportOptions {
	format: IconFormat;
	frame: number;
	background: ExportBackground;
}

/** Square sizes embedded in an ICO file (256 is encoded as a zero width byte). */
const ICO_SIZES = [16, 32, 48, 64, 128, 256] as const;

/** macOS PNG icon entries: [OSType, size in pixels]. */
const ICNS_ENTRIES: { type: string; size: number }[] = [
	{ type: "icp4", size: 16 },
	{ type: "icp5", size: 32 },
	{ type: "icp6", size: 64 },
	{ type: "ic07", size: 128 },
	{ type: "ic08", size: 256 },
	{ type: "ic09", size: 512 },
	{ type: "ic10", size: 1024 },
];

function clampFrame(doc: PixelDoc, frame: number): number {
	return Math.max(0, Math.min(doc.frames.length - 1, Math.round(frame) || 0));
}

/**
 * Renders one composited frame into a square canvas, centered and letterboxed
 * with nearest-neighbor scaling. The optional solid background is painted
 * first so transparent pixels composite correctly over it.
 */
function renderIconCanvas(
	doc: PixelDoc,
	frameIndex: number,
	size: number,
	background: ExportBackground,
): HTMLCanvasElement {
	const source = document.createElement("canvas");
	drawPixels(source, compositeFrame(doc, frameIndex), doc.width, doc.height);

	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas 2D is not available");

	if (background !== "transparent") {
		context.fillStyle = background === "white" ? "#ffffff" : "#000000";
		context.fillRect(0, 0, size, size);
	}

	const scale = Math.min(size / doc.width, size / doc.height);
	const drawWidth = Math.max(1, Math.round(doc.width * scale));
	const drawHeight = Math.max(1, Math.round(doc.height * scale));
	const drawX = Math.round((size - drawWidth) / 2);
	const drawY = Math.round((size - drawHeight) / 2);
	context.imageSmoothingEnabled = false;
	context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
	return canvas;
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(encoded) =>
				encoded ? resolve(encoded) : reject(new Error("Could not encode PNG")),
			"image/png",
		);
	});
	return new Uint8Array(await blob.arrayBuffer());
}

function buildIco(pngs: Uint8Array[], sizes: readonly number[]): Uint8Array<ArrayBuffer> {
	const count = sizes.length;
	const headerSize = 6 + count * 16;
	const total = headerSize + pngs.reduce((sum, png) => sum + png.length, 0);
	const output = new Uint8Array(total);
	const view = new DataView(output.buffer);

	view.setUint16(0, 0, true); // reserved
	view.setUint16(2, 1, true); // type: icon
	view.setUint16(4, count, true);

	let offset = headerSize;
	for (let index = 0; index < count; index++) {
		const size = sizes[index]!;
		const png = pngs[index]!;
		const entry = 6 + index * 16;
		view.setUint8(entry, size >= 256 ? 0 : size); // width
		view.setUint8(entry + 1, size >= 256 ? 0 : size); // height
		view.setUint8(entry + 2, 0); // color count
		view.setUint8(entry + 3, 0); // reserved
		view.setUint16(entry + 4, 1, true); // planes
		view.setUint16(entry + 6, 32, true); // bit count
		view.setUint32(entry + 8, png.length, true); // bytes in resource
		view.setUint32(entry + 12, offset, true); // image offset
		output.set(png, offset);
		offset += png.length;
	}

	return output;
}

function buildIcns(pngs: Uint8Array[], entries: { type: string; size: number }[]): Uint8Array<ArrayBuffer> {
	const total =
		8 + entries.reduce((sum, _entry, index) => sum + 8 + pngs[index]!.length, 0);
	const output = new Uint8Array(total);
	const view = new DataView(output.buffer);

	output.set([0x69, 0x63, 0x6e, 0x73], 0); // "icns"
	view.setUint32(4, total); // big-endian length

	let offset = 8;
	entries.forEach((entry, index) => {
		const png = pngs[index]!;
		output.set(
			[entry.type.charCodeAt(0), entry.type.charCodeAt(1), entry.type.charCodeAt(2), entry.type.charCodeAt(3)],
			offset,
		);
		view.setUint32(offset + 4, 8 + png.length);
		output.set(png, offset + 8);
		offset += 8 + png.length;
	});

	return output;
}

/** Encodes the active frame as a multi-size ICO or ICNS container. */
export async function exportIcon(
	doc: PixelDoc,
	options: IconExportOptions,
): Promise<Blob> {
	const frame = clampFrame(doc, options.frame);

	if (options.format === "ico") {
		const pngs: Uint8Array[] = [];
		for (const size of ICO_SIZES) {
			pngs.push(await canvasToPngBytes(renderIconCanvas(doc, frame, size, options.background)));
		}
		return new Blob([buildIco(pngs, ICO_SIZES)], { type: "image/x-icon" });
	}

	const pngs: Uint8Array[] = [];
	for (const entry of ICNS_ENTRIES) {
		pngs.push(
			await canvasToPngBytes(renderIconCanvas(doc, frame, entry.size, options.background)),
		);
	}
	return new Blob([buildIcns(pngs, ICNS_ENTRIES)], { type: "image/x-icns" });
}
