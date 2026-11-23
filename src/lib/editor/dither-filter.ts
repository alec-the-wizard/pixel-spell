import { BAYER_SIZES, BAYER_THRESHOLDS, type BayerMatrixId } from "./dither.js";

export type DitherMethod = "ordered" | "diffusion";
export type DitherTarget = "two-color" | "palette";
export type DiffusionKernel = "floyd-steinberg";

export const DITHER_METHODS: { id: DitherMethod; label: string }[] = [
	{ id: "ordered", label: "Ordered" },
	{ id: "diffusion", label: "Error diffusion" },
];

export const DITHER_TARGETS: { id: DitherTarget; label: string }[] = [
	{ id: "two-color", label: "Two colors" },
	{ id: "palette", label: "Active palette" },
];

export interface DitherFilterOptions {
	method: DitherMethod;
	matrix: BayerMatrixId;
	diffusion: DiffusionKernel;
	serpentine: boolean;
	target: DitherTarget;
	/** Packed RGBA colors for the two-color mode. */
	lightColor: number;
	darkColor: number;
	/** Packed RGBA palette entries for palette mode. */
	palette?: readonly number[];
	mask?: Uint8Array | null;
}

interface RgbTriplet {
	r: number;
	g: number;
	b: number;
}

function unpackRgb(value: number): RgbTriplet {
	return {
		r: value & 0xff,
		g: (value >>> 8) & 0xff,
		b: (value >>> 16) & 0xff,
	};
}

function luminance(r: number, g: number, b: number): number {
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clamp255(value: number): number {
	return value < 0 ? 0 : value > 255 ? 255 : value;
}

function packWithAlpha(r: number, g: number, b: number, alpha: number): number {
	return (
		((alpha << 24) |
			(clamp255(b) << 16) |
			(clamp255(g) << 8) |
			clamp255(r)) >>>
		0
	);
}

interface PaletteLookup {
	packed: number[];
	r: number[];
	g: number[];
	b: number[];
	exact: Map<number, number>;
	/** 5-bit-per-channel nearest-color cache; null for tiny palettes. */
	lut: Uint16Array | null;
}

function rgbKey(r: number, g: number, b: number): number {
	return (r << 16) | (g << 8) | b;
}

function buildPaletteLookup(palette: readonly number[]): PaletteLookup | null {
	if (palette.length === 0) return null;
	const lookup: PaletteLookup = {
		packed: [],
		r: [],
		g: [],
		b: [],
		exact: new Map(),
		lut: null,
	};
	for (const value of palette) {
		const index = lookup.packed.length;
		const red = value & 0xff;
		const green = (value >>> 8) & 0xff;
		const blue = (value >>> 16) & 0xff;
		lookup.packed.push(value);
		lookup.r.push(red);
		lookup.g.push(green);
		lookup.b.push(blue);
		lookup.exact.set(rgbKey(red, green, blue), index);
	}
	if (lookup.packed.length > 4) {
		// Bulk palette dithering is the hot path. A 32×32×32 nearest-color LUT
		// turns the per-pixel search into one array lookup; the 5-bit bucket is
		// already finer than the quantization dithering introduces.
		const lut = new Uint16Array(32768);
		for (let r5 = 0; r5 < 32; r5++) {
			for (let g5 = 0; g5 < 32; g5++) {
				for (let b5 = 0; b5 < 32; b5++) {
					lut[(r5 << 10) | (g5 << 5) | b5] = nearestPaletteIndexExact(
						lookup,
						r5 * 8 + 4,
						g5 * 8 + 4,
						b5 * 8 + 4,
					);
				}
			}
		}
		lookup.lut = lut;
	}
	return lookup;
}

function nearestPaletteIndexExact(
	lookup: PaletteLookup,
	r: number,
	g: number,
	b: number,
): number {
	let best = 0;
	let bestDistance = Infinity;
	for (let index = 0; index < lookup.packed.length; index++) {
		const dr = r - lookup.r[index]!;
		const dg = g - lookup.g[index]!;
		const db = b - lookup.b[index]!;
		// Weighted RGB distance is a good cheap approximation of perception.
		const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
		if (distance < bestDistance) {
			bestDistance = distance;
			best = index;
		}
	}
	return best;
}

function nearestPaletteIndex(
	lookup: PaletteLookup,
	r: number,
	g: number,
	b: number,
): number {
	const exact = lookup.exact.get(
		rgbKey(clamp255(r) | 0, clamp255(g) | 0, clamp255(b) | 0),
	);
	if (exact !== undefined) return exact;
	if (lookup.lut) {
		const ri = Math.max(0, Math.min(31, Math.floor(r / 8)));
		const gi = Math.max(0, Math.min(31, Math.floor(g / 8)));
		const bi = Math.max(0, Math.min(31, Math.floor(b / 8)));
		return lookup.lut[(ri << 10) | (gi << 5) | bi]!;
	}
	return nearestPaletteIndexExact(lookup, r, g, b);
}

interface TwoColorLookup {
	low: number;
	high: number;
	lowLum: number;
	highLum: number;
}

function buildTwoColorLookup(
	lightColor: number,
	darkColor: number,
): TwoColorLookup {
	const light = unpackRgb(lightColor);
	const dark = unpackRgb(darkColor);
	const lightLum = luminance(light.r, light.g, light.b);
	const darkLum = luminance(dark.r, dark.g, dark.b);
	if (lightLum >= darkLum) {
		return {
			low: darkColor,
			high: lightColor,
			lowLum: darkLum,
			highLum: lightLum,
		};
	}
	return {
		low: lightColor,
		high: darkColor,
		lowLum: lightLum,
		highLum: darkLum,
	};
}

function chooseOrderedTwoColor(
	lookup: TwoColorLookup,
	r: number,
	g: number,
	b: number,
	threshold: number,
): number {
	const range = lookup.highLum - lookup.lowLum;
	if (range <= 0.0001) return lookup.low;
	const mix = Math.max(
		0,
		Math.min(1, (luminance(r, g, b) - lookup.lowLum) / range),
	);
	return mix > threshold ? lookup.high : lookup.low;
}

function chooseNearest(
	lookup: PaletteLookup | null,
	low: number,
	high: number,
	r: number,
	g: number,
	b: number,
): number {
	if (lookup) return lookup.packed[nearestPaletteIndex(lookup, r, g, b)]!;
	const lowRgb = unpackRgb(low);
	const highRgb = unpackRgb(high);
	const lowDistance =
		(r - lowRgb.r) ** 2 + (g - lowRgb.g) ** 2 + (b - lowRgb.b) ** 2;
	const highDistance =
		(r - highRgb.r) ** 2 + (g - highRgb.g) ** 2 + (b - highRgb.b) ** 2;
	return highDistance < lowDistance ? high : low;
}

function selectedAt(mask: Uint8Array | null, index: number): boolean {
	return !mask || mask[index] === 1;
}

/**
 * Converts the image to a two-color or palette target with ordered or
 * Floyd–Steinberg dithering. The selection mask limits writes and diffusion, so
 * an effect cannot leak outside the selected area.
 */
export function ditherPixels(
	pixels: Uint32Array,
	width: number,
	height: number,
	options: DitherFilterOptions,
): Uint32Array {
	const result = new Uint32Array(pixels);
	const count = width * height;
	if (count === 0 || width <= 0 || height <= 0) return result;

	const mask =
		options.mask && options.mask.length >= count ? options.mask : null;
	const palette =
		options.target === "palette" && options.palette && options.palette.length > 1
			? buildPaletteLookup(options.palette)
			: null;
	const twoColor = buildTwoColorLookup(
		options.lightColor,
		options.darkColor,
	);

	if (options.method === "diffusion") {
		return diffusePixels(
			pixels,
			width,
			height,
			options,
			palette,
			twoColor,
			mask,
		);
	}

	const size = BAYER_SIZES[options.matrix];
	const thresholds = BAYER_THRESHOLDS[options.matrix];
	const matrixMask = size - 1;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = y * width + x;
			if (!selectedAt(mask, index)) continue;
			const source = pixels[index]!;
			const alpha = source >>> 24;
			if (alpha === 0) continue;

			const threshold =
				thresholds[((y & matrixMask) * size + (x & matrixMask))]!;
			let next: number;
			if (palette) {
				// Leave pixels that already match a palette entry untouched; bias
				// the rest by the ordered threshold so gradients break into a
				// stable pattern.
				const sr = source & 0xff;
				const sg = (source >>> 8) & 0xff;
				const sb = (source >>> 16) & 0xff;
				const exact = palette.exact.get(rgbKey(sr, sg, sb));
				if (exact !== undefined) {
					next = palette.packed[exact]!;
				} else {
					const bias = (threshold - 0.5) * 96;
					next =
						palette.packed[
							nearestPaletteIndex(palette, sr + bias, sg + bias, sb + bias)
						]!;
				}
			} else {
				next = chooseOrderedTwoColor(
					twoColor,
					source & 0xff,
					(source >>> 8) & 0xff,
					(source >>> 16) & 0xff,
					threshold,
				);
			}
			result[index] = packWithAlpha(
				next & 0xff,
				(next >>> 8) & 0xff,
				(next >>> 16) & 0xff,
				alpha,
			);
		}
	}

	return result;
}

function diffusePixels(
	source: Uint32Array,
	width: number,
	height: number,
	options: DitherFilterOptions,
	palette: PaletteLookup | null,
	twoColor: TwoColorLookup,
	mask: Uint8Array | null,
): Uint32Array {
	const result = new Uint32Array(source);
	let currentError = new Float32Array(width * 3);
	let nextError = new Float32Array(width * 3);
	let rowError = new Float32Array(width * 3);
	const low = twoColor.low;
	const high = twoColor.high;

	const addError = (
		targetX: number,
		rowOffset: 0 | 1,
		er: number,
		eg: number,
		eb: number,
	): void => {
		if (targetX < 0 || targetX >= width) return;
		const buffer = rowOffset === 0 ? currentError : nextError;
		buffer[targetX * 3] = buffer[targetX * 3]! + er;
		buffer[targetX * 3 + 1] = buffer[targetX * 3 + 1]! + eg;
		buffer[targetX * 3 + 2] = buffer[targetX * 3 + 2]! + eb;
	};

	for (let y = 0; y < height; y++) {
		nextError.fill(0);
		const leftToRight = !options.serpentine || y % 2 === 0;
		const start = leftToRight ? 0 : width - 1;
		const end = leftToRight ? width : -1;
		const step = leftToRight ? 1 : -1;

		for (let x = start; x !== end; x += step) {
			const index = y * width + x;
			const sourceValue = source[index]!;
			const alpha = sourceValue >>> 24;
			if (alpha === 0 || !selectedAt(mask, index)) continue;

			const sr = sourceValue & 0xff;
			const sg = (sourceValue >>> 8) & 0xff;
			const sb = (sourceValue >>> 16) & 0xff;
			const er = currentError[x * 3]!;
			const eg = currentError[x * 3 + 1]!;
			const eb = currentError[x * 3 + 2]!;
			const r = sr + er;
			const g = sg + eg;
			const b = sb + eb;

			let chosen: number;
			if (palette) {
				chosen = palette.packed[nearestPaletteIndex(palette, r, g, b)]!;
			} else {
				const range = twoColor.highLum - twoColor.lowLum;
				const mix =
					range <= 0.0001
						? 0
						: Math.max(
								0,
								Math.min(
									1,
									(luminance(r, g, b) - twoColor.lowLum) / range,
								),
							);
				chosen = mix >= 0.5 ? high : low;
			}

			const cr = chosen & 0xff;
			const cg = (chosen >>> 8) & 0xff;
			const cb = (chosen >>> 16) & 0xff;
			const errorR = r - cr;
			const errorG = g - cg;
			const errorB = b - cb;

			result[index] = packWithAlpha(cr, cg, cb, alpha);

			const forward = leftToRight ? 1 : -1;
			const back = -forward;
			addError(x + forward, 0, (errorR * 7) / 16, (errorG * 7) / 16, (errorB * 7) / 16);
			addError(x + back, 1, (errorR * 3) / 16, (errorG * 3) / 16, (errorB * 3) / 16);
			addError(x, 1, (errorR * 5) / 16, (errorG * 5) / 16, (errorB * 5) / 16);
			addError(x + forward, 1, (errorR * 1) / 16, (errorG * 1) / 16, (errorB * 1) / 16);
		}

		rowError = currentError;
		currentError = nextError;
		nextError = rowError;
	}

	return result;
}

/** Rough number of palette colors a document would need after dithering. */
export function ditherColorCount(options: DitherFilterOptions): number {
	if (options.target === "palette") {
		return Math.max(2, options.palette?.length ?? 2);
	}
	return 2;
}
