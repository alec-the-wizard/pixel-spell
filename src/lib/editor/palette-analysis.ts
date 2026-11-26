import { hexToRgb, packColor, rgbToHex, rgbToHsv } from "./color.js";
import type { PixelDoc } from "./types.js";

/**
 * Low 24 bits of the editor's packed RGBA value. Palette entries have no alpha,
 * so usage matching only compares the RGB channels.
 */
export function paletteColorKey(hex: string): number {
	return packColor(hex) & 0x00ffffff;
}

export interface PaletteUsageEntry {
	color: string;
	/** Number of painted pixels using this color across every layer. */
	count: number;
	/** `count` divided by the document's total painted pixel count. */
	share: number;
}

export interface OffPaletteEntry {
	color: string;
	count: number;
}

export interface CoverageBin {
	/** Inclusive start of the range. */
	start: number;
	/** Exclusive end of the range. */
	end: number;
	/** Number of palette colors inside the range. */
	count: number;
}

export interface PaletteCoverage {
	paletteSize: number;
	/** Distinct palette entries with at least one painted pixel. */
	usedColors: number;
	unusedColors: number;
	/** Non-transparent pixels across every layer and frame. */
	paintedPixels: number;
	/** Painted pixels whose RGB matches a palette entry. */
	matchedPixels: number;
	/** `matchedPixels / paintedPixels`, 0..1. */
	coverage: number;
	/** One entry per palette color, in palette order. */
	entries: PaletteUsageEntry[];
	/** Palette colors with no painted pixels, in palette order. */
	unused: string[];
	/** Painted RGB values that are missing from the palette, most used first. */
	offPalette: OffPaletteEntry[];
	/** Total distinct off-palette colors. */
	offPaletteCount: number;
	/** Painted pixels whose RGB is missing from the palette. */
	offPalettePixels: number;
	/** Palette color distribution over twelve 30° hue bins (chromatic colors). */
	hueBins: CoverageBin[];
	/** Palette color count with no measurable hue (black, white, grays). */
	neutralColors: number;
	/** Palette color distribution over eight brightness bins. */
	valueBins: CoverageBin[];
}

const HUE_BIN_COUNT = 12;
const VALUE_BIN_COUNT = 8;

function isPainted(value: number): boolean {
	return value >>> 24 !== 0;
}

/**
 * Returns the palette entries that no layer uses in any frame. Preserves
 * palette order and skips duplicates.
 */
export function unusedPaletteColors(
	doc: PixelDoc,
	colors: readonly string[],
): string[] {
	const remaining = new Map<number, string>();
	for (const color of colors) {
		const key = paletteColorKey(color);
		if (!remaining.has(key)) remaining.set(key, color);
	}
	if (remaining.size === 0) return [];

	for (const layer of doc.layers) {
		for (const cel of layer.cels) {
			if (!cel) continue;
			for (let index = 0; index < cel.length; index++) {
				const value = cel[index]!;
				if (!isPainted(value)) continue;
				const key = value & 0x00ffffff;
				if (remaining.delete(key) && remaining.size === 0) return [];
			}
		}
	}

	const unused: string[] = [];
	for (const color of colors) {
		if (remaining.has(paletteColorKey(color)) && !unused.includes(color)) {
			unused.push(color);
		}
	}
	return unused;
}

/**
 * Measures how much of the document's painted pixels use the palette and how
 * evenly the palette spans hue and brightness. The scan touches every layer
 * cel once.
 */
export function analyzePaletteCoverage(
	doc: PixelDoc,
	colors: readonly string[],
	options: { offPaletteLimit?: number } = {},
): PaletteCoverage {
	const limit = Math.max(0, options.offPaletteLimit ?? 24);
	const counts = new Map<number, number>();
	for (const color of colors) {
		const key = paletteColorKey(color);
		if (!counts.has(key)) counts.set(key, 0);
	}

	let paintedPixels = 0;
	let matchedPixels = 0;
	const offPaletteCounts = new Map<number, number>();

	for (const layer of doc.layers) {
		for (const cel of layer.cels) {
			if (!cel) continue;
			for (let index = 0; index < cel.length; index++) {
				const value = cel[index]!;
				if (!isPainted(value)) continue;
				paintedPixels++;
				const key = value & 0x00ffffff;
				const known = counts.get(key);
				if (known !== undefined) {
					counts.set(key, known + 1);
					matchedPixels++;
				} else {
					offPaletteCounts.set(key, (offPaletteCounts.get(key) ?? 0) + 1);
				}
			}
		}
	}

	const seen = new Set<string>();
	const entries: PaletteUsageEntry[] = [];
	const unused: string[] = [];
	let usedColors = 0;
	for (const color of colors) {
		if (seen.has(color)) continue;
		seen.add(color);
		const count = counts.get(paletteColorKey(color)) ?? 0;
		entries.push({
			color,
			count,
			share: paintedPixels > 0 ? count / paintedPixels : 0,
		});
		if (count > 0) usedColors++;
		else unused.push(color);
	}

	const offPalette: OffPaletteEntry[] = [];
	let offPalettePixels = 0;
	for (const [key, count] of offPaletteCounts) {
		offPalettePixels += count;
		if (limit === 0) continue;
		const entry = {
			color: rgbToHex(key & 0xff, (key >>> 8) & 0xff, (key >>> 16) & 0xff),
			count,
		};
		if (offPalette.length < limit) {
			offPalette.push(entry);
			continue;
		}
		// Keep the most-used entries without sorting every distinct color.
		let smallest = 0;
		for (let index = 1; index < offPalette.length; index++) {
			if (offPalette[index]!.count < offPalette[smallest]!.count) {
				smallest = index;
			}
		}
		if (entry.count > offPalette[smallest]!.count) offPalette[smallest] = entry;
	}
	offPalette.sort((a, b) => b.count - a.count);

	const hueBins: CoverageBin[] = Array.from({ length: HUE_BIN_COUNT }, (_, i) => ({
		start: (i * 360) / HUE_BIN_COUNT,
		end: ((i + 1) * 360) / HUE_BIN_COUNT,
		count: 0,
	}));
	const valueBins: CoverageBin[] = Array.from(
		{ length: VALUE_BIN_COUNT },
		(_, i) => ({
			start: i / VALUE_BIN_COUNT,
			end: (i + 1) / VALUE_BIN_COUNT,
			count: 0,
		}),
	);
	let neutralColors = 0;
	for (const color of seen) {
		const hsv = rgbToHsv(hexToRgb(color));
		if (hsv.s === 0) {
			neutralColors++;
		} else {
			const index = Math.min(
				HUE_BIN_COUNT - 1,
				Math.floor((hsv.h / 360) * HUE_BIN_COUNT),
			);
			hueBins[index]!.count++;
		}
		const valueIndex = Math.min(
			VALUE_BIN_COUNT - 1,
			Math.floor(hsv.v * VALUE_BIN_COUNT),
		);
		valueBins[valueIndex]!.count++;
	}

	return {
		paletteSize: seen.size,
		usedColors,
		unusedColors: unused.length,
		paintedPixels,
		matchedPixels,
		coverage: paintedPixels > 0 ? matchedPixels / paintedPixels : 0,
		entries,
		unused,
		offPalette: offPalette.slice(0, limit),
		offPaletteCount: offPaletteCounts.size,
		offPalettePixels,
		hueBins,
		neutralColors,
		valueBins,
	};
}
