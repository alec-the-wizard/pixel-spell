/**
 * 8-bit indexed PNG encoder (PNG color type 3) used by the export dialog.
 *
 * Pixels are written as one palette index per pixel, the palette is emitted as
 * PLTE, and a tRNS entry marks the transparent slot. Because PNG palette entries
 * carry a single alpha value, semi-transparent pixels are thresholded: alpha at
 * or above the threshold is written opaque, anything below becomes transparent.
 * Every color is snapped to the active palette with the same OKLab matcher used
 * by indexed editing, so the file only contains palette colors.
 */

import { normalizeHex, packColor } from "./color.js";
import { createPaletteMatcher } from "./indexed.js";
import {
	PNG_SIGNATURE,
	assemblePng,
	deflate,
	pngChunk,
	writeUint32,
} from "./png.js";

/** PNG color type 3 allows at most 256 palette entries. */
export const INDEXED_PNG_MAX_COLORS = 256;
/** Shared default for the transparency cut-off. */
export const DEFAULT_INDEXED_ALPHA_THRESHOLD = 128;

export interface IndexedImage {
	/** RGB triples in index order (3 bytes per entry, including the transparent slot). */
	palette: Uint8Array;
	/** One palette index per pixel, row-major. */
	indices: Uint8Array;
	/** Index used for transparent pixels, or null when none were needed. */
	transparentIndex: number | null;
	/** Number of palette entries, including the transparent slot. */
	colors: number;
}

function paletteRgb(hex: string): [number, number, number] {
	const value = packColor(hex);
	return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

/**
 * Maps an RGBA buffer onto a palette index buffer. Returns null when the palette
 * is empty or cannot represent the image within 256 entries (a full 256-color
 * palette plus a transparent slot), so callers can fall back to RGBA output.
 *
 * The full palette is kept in its visible order by default, which keeps index
 * positions stable across exports. It is compacted to the used entries only in
 * the one case that would otherwise overflow.
 */
export function buildIndexedImage(
	pixels: Uint32Array,
	width: number,
	height: number,
	colors: readonly string[],
	alphaThreshold = DEFAULT_INDEXED_ALPHA_THRESHOLD,
): IndexedImage | null {
	const count = Math.max(0, Math.round(width)) * Math.max(0, Math.round(height));
	if (count === 0 || pixels.length === 0) return null;

	const palette: string[] = [];
	for (const color of colors) {
		const hex = normalizeHex(color);
		if (!hex) continue;
		palette.push(hex);
		if (palette.length >= INDEXED_PNG_MAX_COLORS) break;
	}
	if (palette.length === 0) return null;

	const threshold = Math.max(1, Math.min(255, Math.round(alphaThreshold)));
	const matcher = createPaletteMatcher(palette);
	const indexByKey = new Map<number, number>();
	for (let index = 0; index < palette.length; index++) {
		const key = packColor(palette[index]!) & 0x00ffffff;
		if (!indexByKey.has(key)) indexByKey.set(key, index);
	}

	const resolveIndex = (key: number): number => {
		const exact = indexByKey.get(key);
		if (exact !== undefined) return exact;
		const nearest = matcher.nearestKey(key);
		return nearest < 0 ? 0 : (indexByKey.get(nearest) ?? 0);
	};

	let needsTransparent = false;
	// A 256-color palette has no spare slot, so track used entries in case
	// transparency forces a compacted palette. Opaque images keep all 256.
	let usedColors: Set<number> | null =
		palette.length + 1 > INDEXED_PNG_MAX_COLORS ? new Set<number>() : null;
	let usedCount = 0;

	for (let index = 0; index < count; index++) {
		const value = pixels[index]!;
		const alpha = value >>> 24;
		if (alpha < threshold) {
			needsTransparent = true;
			continue;
		}
		if (usedColors) {
			const paletteIndex = resolveIndex(value & 0x00ffffff);
			if (!usedColors.has(paletteIndex)) {
				usedColors.add(paletteIndex);
				usedCount++;
			}
		}
	}

	let finalPalette = palette;
	if (usedColors && needsTransparent) {
		// Only the entries the image actually uses need to be written; the
		// transparent slot requires one spare index.
		if (usedCount + 1 > INDEXED_PNG_MAX_COLORS) return null;
		finalPalette = [...usedColors]
			.sort((a, b) => a - b)
			.map((index) => palette[index]!);
		indexByKey.clear();
		for (let index = 0; index < finalPalette.length; index++) {
			const key = packColor(finalPalette[index]!) & 0x00ffffff;
			if (!indexByKey.has(key)) indexByKey.set(key, index);
		}
	}

	const transparentIndex = needsTransparent
		? finalPalette.length
		: null;
	const entries = finalPalette.length + (needsTransparent ? 1 : 0);
	if (entries > INDEXED_PNG_MAX_COLORS) return null;

	const paletteBytes = new Uint8Array(entries * 3);
	for (let index = 0; index < finalPalette.length; index++) {
		const [r, g, b] = paletteRgb(finalPalette[index]!);
		paletteBytes[index * 3] = r;
		paletteBytes[index * 3 + 1] = g;
		paletteBytes[index * 3 + 2] = b;
	}
	// The transparent slot keeps black RGB; tRNS makes it invisible.

	const indices = new Uint8Array(count);
	for (let index = 0; index < count; index++) {
		const value = pixels[index]!;
		const alpha = value >>> 24;
		if (alpha < threshold) {
			indices[index] = transparentIndex ?? 0;
			continue;
		}
		indices[index] = resolveIndex(value & 0x00ffffff);
	}

	return {
		palette: paletteBytes,
		indices,
		transparentIndex,
		colors: entries,
	};
}

export interface IndexedPngOptions {
	/** Palette colors in index order. */
	palette: readonly string[];
	/** Alpha cut-off; pixels below it become the transparent index. Defaults to 128. */
	alphaThreshold?: number;
}

/**
 * Applies the indexed-export rules (nearest palette color plus alpha
 * thresholding) so the export dialog can preview exactly what a palette PNG
 * will contain. Returns the input buffer when the palette is empty.
 */
export function indexedPreviewPixels(
	pixels: Uint32Array,
	palette: readonly string[],
	alphaThreshold = DEFAULT_INDEXED_ALPHA_THRESHOLD,
): Uint32Array {
	const colors = palette
		.map((color) => normalizeHex(color))
		.filter((color): color is string => color !== null);
	if (colors.length === 0) return pixels;

	const matcher = createPaletteMatcher(colors);
	const threshold = Math.max(1, Math.min(255, Math.round(alphaThreshold)));
	const output = new Uint32Array(pixels.length);

	for (let index = 0; index < pixels.length; index++) {
		const value = pixels[index]!;
		if (value >>> 24 < threshold) continue;
		const key = value & 0x00ffffff;
		const nearest = matcher.nearestKey(key);
		output[index] = (0xff000000 | (nearest < 0 ? key : nearest)) >>> 0;
	}

	return output;
}

/**
 * Encodes packed RGBA pixels as an 8-bit indexed PNG. Returns null when the
 * palette cannot index the image so the caller can fall back to RGBA output.
 */
export async function encodeIndexedPng(
	pixels: Uint32Array,
	width: number,
	height: number,
	options: IndexedPngOptions,
): Promise<Uint8Array<ArrayBuffer> | null> {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	const image = buildIndexedImage(
		pixels,
		w,
		h,
		options.palette,
		options.alphaThreshold,
	);
	if (!image) return null;

	// Filter type None per scanline keeps the encoder small; the palette index
	// is the only sample byte.
	const raw = new Uint8Array((w + 1) * h);
	let offset = 0;
	for (let y = 0; y < h; y++) {
		raw[offset++] = 0;
		const row = y * w;
		raw.set(image.indices.subarray(row, row + w), offset);
		offset += w;
	}

	const ihdr = new Uint8Array(13);
	writeUint32(ihdr, 0, w);
	writeUint32(ihdr, 4, h);
	ihdr[8] = 8; // Bit depth.
	ihdr[9] = 3; // Indexed color.
	ihdr[10] = 0; // Compression.
	ihdr[11] = 0; // Filter method.
	ihdr[12] = 0; // Interlace.

	const chunks: Uint8Array[] = [
		new Uint8Array(PNG_SIGNATURE),
		pngChunk("IHDR", ihdr),
		pngChunk("PLTE", image.palette),
	];

	if (image.transparentIndex !== null) {
		// tRNS lists alpha bytes for the leading entries; entries after the list
		// are opaque. The transparent slot is always last.
		const transparency = new Uint8Array(image.transparentIndex + 1);
		transparency.fill(255);
		transparency[image.transparentIndex] = 0;
		chunks.push(pngChunk("tRNS", transparency));
	}

	chunks.push(pngChunk("IDAT", await deflate(raw)));
	chunks.push(pngChunk("IEND", new Uint8Array(0)));
	return assemblePng(chunks);
}
