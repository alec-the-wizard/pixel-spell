import { hexToRgb, normalizeHex, packColor, rgbToOklab } from "./color.js";
import type { PixelDoc } from "./types.js";

/**
 * Indexed color mode keeps cels in packed RGBA form but enforces the active
 * palette. These helpers own the perceptual matching and the in-place remapping
 * so drawing paths, imports, filters, and palette edits share one definition of
 * "the closest palette color".
 *
 * Alpha is always preserved: a semi-transparent pixel keeps its alpha and only
 * its RGB channels are snapped. Fully transparent pixels are left untouched.
 */

interface PaletteEntry {
	hex: string;
	key: number;
	l: number;
	a: number;
	b: number;
}

export interface PaletteMatcher {
	/** True when the palette has no usable colors, so nothing can be snapped. */
	readonly empty: boolean;
	/** True when the packed RGB (`0x00rrggbb`) is exactly a palette entry. */
	has(key: number): boolean;
	/** Nearest palette entry as packed RGB, or -1 when the palette is empty. */
	nearestKey(key: number): number;
	/** Nearest palette entry as hex, or null when the palette is empty. */
	nearestHex(key: number): string | null;
}

/**
 * Builds an OKLab matcher for one palette. Lookups are memoized per distinct
 * RGB value, which keeps whole-canvas remaps linear in distinct colors rather
 * than pixels × palette size.
 */
export function createPaletteMatcher(
	colors: readonly string[],
): PaletteMatcher {
	const entries: PaletteEntry[] = [];
	const keys = new Set<number>();

	for (const color of colors) {
		const hex = normalizeHex(color);
		if (!hex) continue;
		const key = packColor(hex) & 0x00ffffff;
		if (keys.has(key)) continue;
		keys.add(key);
		const lab = rgbToOklab(hexToRgb(hex));
		entries.push({ hex, key, l: lab.l, a: lab.a, b: lab.b });
	}

	const hexByKey = new Map<number, string>(
		entries.map((entry) => [entry.key, entry.hex]),
	);
	const nearestCache = new Map<number, number>();

	const nearestKey = (key: number): number => {
		if (entries.length === 0) return -1;
		const known = nearestCache.get(key);
		if (known !== undefined) return known;

		const target = rgbToOklab({
			r: key & 0xff,
			g: (key >>> 8) & 0xff,
			b: (key >>> 16) & 0xff,
		});
		let best = entries[0]!;
		let bestDistance = Infinity;
		for (const entry of entries) {
			const dl = entry.l - target.l;
			const da = entry.a - target.a;
			const db = entry.b - target.b;
			const distance = dl * dl + da * da + db * db;
			if (distance < bestDistance) {
				bestDistance = distance;
				best = entry;
			}
		}
		nearestCache.set(key, best.key);
		return best.key;
	};

	return {
		empty: entries.length === 0,
		has: (key) => keys.has(key),
		nearestKey,
		nearestHex(key) {
			if (entries.length === 0) return null;
			return hexByKey.get(nearestKey(key)) ?? null;
		},
	};
}

/**
 * Returns the palette hex a color resolves to. Colors already in the palette
 * are returned normalized; otherwise the perceptually nearest entry wins.
 * An empty palette leaves the input unchanged.
 */
export function snapHexToPalette(colors: readonly string[], hex: string): string {
	const normalized = normalizeHex(hex);
	if (!normalized) return hex;
	const matcher = createPaletteMatcher(colors);
	if (matcher.empty) return normalized;
	const key = packColor(normalized) & 0x00ffffff;
	if (matcher.has(key)) return normalized;
	return matcher.nearestHex(key) ?? normalized;
}

/**
 * Snaps every painted pixel's RGB to the palette, keeping alpha. Returns a new
 * buffer only when something changed; otherwise the input buffer is returned so
 * callers can cheaply detect no-ops.
 */
export function snapPixelsToPalette(
	pixels: Uint32Array,
	colors: readonly string[],
): Uint32Array {
	const matcher = createPaletteMatcher(colors);
	if (matcher.empty) return pixels;

	let output: Uint32Array | null = null;
	for (let index = 0; index < pixels.length; index++) {
		const value = pixels[index]!;
		const alpha = value >>> 24;
		if (alpha === 0) continue;
		const key = value & 0x00ffffff;
		const nearest = matcher.nearestKey(key);
		if (nearest < 0 || nearest === key) continue;
		if (!output) output = new Uint32Array(pixels);
		output[index] = ((alpha << 24) | nearest) >>> 0;
	}

	return output ?? pixels;
}

/**
 * Snaps a disk of a cel in place, used by tools that synthesize colors
 * (for example the blur tool). Returns true when any pixel changed.
 */
export function snapRegionToPalette(
	cel: Uint32Array,
	width: number,
	height: number,
	centerX: number,
	centerY: number,
	radius: number,
	colors: readonly string[],
): boolean {
	const matcher = createPaletteMatcher(colors);
	if (matcher.empty) return false;

	const span = Math.max(1, Math.round(radius));
	const minX = Math.max(0, centerX - span);
	const maxX = Math.min(width - 1, centerX + span);
	const minY = Math.max(0, centerY - span);
	const maxY = Math.min(height - 1, centerY + span);
	const radiusSquared = span * span;
	let changed = false;

	for (let y = minY; y <= maxY; y++) {
		for (let x = minX; x <= maxX; x++) {
			const dx = x - centerX;
			const dy = y - centerY;
			if (dx * dx + dy * dy > radiusSquared) continue;
			const index = y * width + x;
			const value = cel[index]!;
			const alpha = value >>> 24;
			if (alpha === 0) continue;
			const key = value & 0x00ffffff;
			const nearest = matcher.nearestKey(key);
			if (nearest < 0 || nearest === key) continue;
			cel[index] = ((alpha << 24) | nearest) >>> 0;
			changed = true;
		}
	}

	return changed;
}

/**
 * Snaps every distinct cel buffer of a document to the palette in place. Linked
 * cels share one buffer, so mutating in place keeps links intact. Returns the
 * number of changed pixels.
 */
export function snapDocToPalette(
	doc: PixelDoc,
	colors: readonly string[],
): number {
	const matcher = createPaletteMatcher(colors);
	if (matcher.empty) return 0;

	const seen = new Set<Uint32Array>();
	let changed = 0;

	for (const layer of doc.layers) {
		for (const cel of layer.cels) {
			if (!cel || seen.has(cel)) continue;
			seen.add(cel);
			for (let index = 0; index < cel.length; index++) {
				const value = cel[index]!;
				const alpha = value >>> 24;
				if (alpha === 0) continue;
				const key = value & 0x00ffffff;
				const nearest = matcher.nearestKey(key);
				if (nearest < 0 || nearest === key) continue;
				cel[index] = ((alpha << 24) | nearest) >>> 0;
				changed++;
			}
		}
	}

	return changed;
}
