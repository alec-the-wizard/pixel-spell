/**
 * Multi-stop gradient map filter.
 *
 * The filter reads a pixel's brightness (luminance or channel average) and
 * replaces its RGB channels with the matching color from a gradient. Alpha is
 * always preserved, so transparent and soft-edged pixels keep their shape.
 *
 * Everything here is pure: inputs are never mutated and the same options
 * always produce the same buffer. The Effects dialog and the non-destructive
 * group effect stack share these helpers.
 */

import {
	hexToRgb,
	normalizeHex,
	oklabToRgb,
	packColor,
	rgbToHex,
	rgbToOklab,
	type Rgb,
} from "./color.js";
import type { GradientStop } from "./types.js";

export const MIN_GRADIENT_STOPS = 2;
export const MAX_GRADIENT_STOPS = 16;
/** Resolution of the color lookup table built for each run. */
export const GRADIENT_LUT_SIZE = 256;

/** Interpolation space between gradient stops. */
export type GradientMapSpace = "rgb" | "oklab";
/** Which brightness reading drives the lookup. */
export type GradientMapSource = "luminance" | "average";

export const GRADIENT_MAP_SPACES: {
	id: GradientMapSpace;
	label: string;
	hint: string;
}[] = [
	{ id: "rgb", label: "RGB", hint: "Blends sRGB channels directly" },
	{ id: "oklab", label: "OKLab", hint: "Blends perceptually even colors" },
];

export const GRADIENT_MAP_SOURCES: {
	id: GradientMapSource;
	label: string;
	hint: string;
}[] = [
	{
		id: "luminance",
		label: "Luminance",
		hint: "Rec. 709 weighting matches perceived brightness",
	},
	{
		id: "average",
		label: "Average",
		hint: "Equal RGB weighting gives a flatter response",
	},
];

const DEFAULT_STOPS: GradientStop[] = [
	{ position: 0, color: "#1d2b53" },
	{ position: 0.4, color: "#7e2553" },
	{ position: 0.72, color: "#ffa300" },
	{ position: 1, color: "#fff1e8" },
];

/** A fresh copy of the default four-stop ramp. */
export function defaultGradientStops(): GradientStop[] {
	return DEFAULT_STOPS.map((stop) => ({ ...stop }));
}

function clampPosition(value: unknown): number {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) return 0;
	return Math.max(0, Math.min(1, number));
}

function parseStops(value: readonly unknown[]): GradientStop[] {
	const stops: GradientStop[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const raw = entry as Record<string, unknown>;
		const color =
			typeof raw.color === "string" ? normalizeHex(raw.color) : null;
		if (!color) continue;
		stops.push({ position: clampPosition(raw.position), color });
		if (stops.length >= MAX_GRADIENT_STOPS) break;
	}
	return stops;
}

function sortStops(stops: GradientStop[]): GradientStop[] {
	// A stable sort keeps deliberate hard stops (equal positions) in order.
	return stops
		.map((stop, index) => ({ stop, index }))
		.sort(
			(a, b) => a.stop.position - b.stop.position || a.index - b.index,
		)
		.map((entry) => entry.stop);
}

/**
 * Validates and sorts a gradient from a project file or an in-memory patch.
 * Invalid entries are dropped, missing endpoints are not invented, and the
 * result always contains at least two stops.
 */
export function normalizeGradientStops(
	value: unknown,
	fallback: readonly GradientStop[] = DEFAULT_STOPS,
): GradientStop[] {
	let stops = Array.isArray(value) ? parseStops(value) : [];
	if (stops.length === 0) stops = parseStops(fallback);
	if (stops.length === 0) return defaultGradientStops();
	if (stops.length === 1) {
		const color = stops[0]!.color;
		return [
			{ position: 0, color },
			{ position: 1, color },
		];
	}
	return sortStops(stops);
}

/** Normalizes one blend-space or brightness id. */
export function normalizeGradientSpace(value: unknown): GradientMapSpace {
	return value === "oklab" ? "oklab" : "rgb";
}

export function normalizeGradientSource(value: unknown): GradientMapSource {
	return value === "average" ? "average" : "luminance";
}

function lerpChannel(from: number, to: number, t: number): number {
	return from + (to - from) * t;
}

function sampleColor(
	stops: readonly GradientStop[],
	t: number,
	space: GradientMapSpace,
): Rgb {
	const clamped = Math.max(0, Math.min(1, t));
	const first = stops[0]!;
	const last = stops[stops.length - 1]!;
	if (clamped <= first.position) return hexToRgb(first.color);
	if (clamped >= last.position) return hexToRgb(last.color);

	for (let index = 0; index < stops.length - 1; index++) {
		const from = stops[index]!;
		const to = stops[index + 1]!;
		if (clamped > to.position) continue;
		const span = to.position - from.position;
		// Equal positions form a hard stop: the later color wins exactly at
		// that position, so the edge stays crisp.
		if (span <= 0) return hexToRgb(to.color);

		const ratio = (clamped - from.position) / span;
		const fromRgb = hexToRgb(from.color);
		const toRgb = hexToRgb(to.color);
		if (space === "oklab") {
			const a = rgbToOklab(fromRgb);
			const b = rgbToOklab(toRgb);
			return oklabToRgb({
				l: lerpChannel(a.l, b.l, ratio),
				a: lerpChannel(a.a, b.a, ratio),
				b: lerpChannel(a.b, b.b, ratio),
			});
		}
		return {
			r: lerpChannel(fromRgb.r, toRgb.r, ratio),
			g: lerpChannel(fromRgb.g, toRgb.g, ratio),
			b: lerpChannel(fromRgb.b, toRgb.b, ratio),
		};
	}

	return hexToRgb(last.color);
}

/** Samples a gradient at `t` (0..1) and returns a normalized hex color. */
export function sampleGradientHex(
	stops: readonly GradientStop[],
	t: number,
	space: GradientMapSpace = "rgb",
): string {
	const rgb = sampleColor(normalizeGradientStops(stops), t, space);
	return rgbToHex(rgb.r, rgb.g, rgb.b);
}

/**
 * Builds a packed-color lookup table for `pixels` runs. The alpha byte is
 * always 255; callers keep the source pixel's own alpha.
 */
export function buildGradientLut(
	stops: readonly GradientStop[],
	space: GradientMapSpace = "rgb",
	size = GRADIENT_LUT_SIZE,
): Uint32Array {
	const count = Math.max(2, Math.min(1024, Math.round(size)));
	const sorted = normalizeGradientStops(stops);
	const lut = new Uint32Array(count);
	for (let index = 0; index < count; index++) {
		const t = index / (count - 1);
		const rgb = sampleColor(sorted, t, space);
		lut[index] = packColor(rgbToHex(rgb.r, rgb.g, rgb.b));
	}
	return lut;
}

/**
 * A CSS `linear-gradient` approximation of the stops for preview bars. Colors
 * are sampled through the same interpolation space as the filter, so OKLab
 * ramps preview accurately instead of falling back to a browser RGB blend.
 */
export function gradientCss(
	stops: readonly GradientStop[],
	space: GradientMapSpace = "rgb",
	steps = 64,
): string {
	const count = Math.max(2, Math.min(64, Math.round(steps)));
	const sorted = normalizeGradientStops(stops);
	const parts: string[] = [];
	for (let index = 0; index < count; index++) {
		const t = index / (count - 1);
		const rgb = sampleColor(sorted, t, space);
		const percent = (t * 100).toFixed(1);
		parts.push(`${rgbToHex(rgb.r, rgb.g, rgb.b)} ${percent}%`);
	}
	return `linear-gradient(to right, ${parts.join(", ")})`;
}

export interface GradientMapOptions {
	stops: readonly GradientStop[];
	space?: GradientMapSpace;
	source?: GradientMapSource;
	/** Read the gradient backwards (bright pixels use the low end). */
	invert?: boolean;
	/** Optional selection mask; only masked pixels are written. */
	mask?: Uint8Array | null;
}

function brightness(value: number, source: GradientMapSource): number {
	const r = value & 0xff;
	const g = (value >>> 8) & 0xff;
	const b = (value >>> 16) & 0xff;
	if (source === "average") return (r + g + b) / 3;
	// Rec. 709 luma on gamma-encoded channels, matching how pixel artists
	// read brightness rather than linear-light intensity.
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Maps every opaque pixel's brightness through the gradient. Transparent
 * pixels are left untouched, and partially transparent pixels keep their
 * alpha so anti-aliased or soft edges survive.
 */
export function gradientMapPixels(
	pixels: Uint32Array,
	width: number,
	height: number,
	options: GradientMapOptions,
): Uint32Array {
	const result = new Uint32Array(pixels);
	const count = width * height;
	if (count <= 0 || width <= 0 || height <= 0) return result;

	const stops = normalizeGradientStops(options.stops);
	const lut = buildGradientLut(stops, options.space ?? "rgb");
	const lastLutIndex = lut.length - 1;
	const source = normalizeGradientSource(options.source);
	const invert = options.invert === true;
	const mask =
		options.mask && options.mask.length >= count ? options.mask : null;

	for (let index = 0; index < count; index++) {
		if (mask && !mask[index]) continue;
		const value = pixels[index]!;
		const alpha = value >>> 24;
		if (alpha === 0) continue;
		const level = brightness(value, source) / 255;
		const shade = invert ? 1 - level : level;
		const mapped = lut[Math.round(shade * lastLutIndex)]!;
		result[index] = ((alpha << 24) | (mapped & 0x00ffffff)) >>> 0;
	}

	return result;
}
