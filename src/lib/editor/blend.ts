import type { BlendMode } from "./types.js";

/** Blend modes in a stable display order for menus. */
export const BLEND_MODES: BlendMode[] = [
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"add",
	"subtract",
];

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
	normal: "Normal",
	multiply: "Multiply",
	screen: "Screen",
	overlay: "Overlay",
	darken: "Darken",
	lighten: "Lighten",
	"color-dodge": "Color dodge",
	"color-burn": "Color burn",
	"hard-light": "Hard light",
	"soft-light": "Soft light",
	difference: "Difference",
	exclusion: "Exclusion",
	add: "Add",
	subtract: "Subtract",
};

/** Coerces an unknown value to a known blend mode, defaulting to normal. */
export function normalizeBlendMode(value: unknown): BlendMode {
	return typeof value === "string" && (BLEND_MODES as string[]).includes(value)
		? (value as BlendMode)
		: "normal";
}

const clamp255 = (value: number): number =>
	value < 0 ? 0 : value > 255 ? 255 : value | 0;

/**
 * Separable blend functions `B(backdrop, source)` over normalized 0..1
 * channels, following the W3C compositing-and-blending definitions.
 */
type BlendFn = (backdrop: number, source: number) => number;

const multiply = (b: number, s: number) => b * s;
const screen = (b: number, s: number) => b + s - b * s;
const darken = (b: number, s: number) => Math.min(b, s);
const lighten = (b: number, s: number) => Math.max(b, s);

/** overlay(backdrop, source) == hardLight(source, backdrop). */
const overlay = (b: number, s: number) =>
	s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);

const colorDodge = (b: number, s: number) =>
	s >= 1 ? 1 : Math.min(1, b / (1 - s));

const colorBurn = (b: number, s: number) =>
	s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s);

const hardLight = (b: number, s: number) =>
	s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);

const softLightD = (x: number) =>
	x <= 0.25 ? ((16 * x - 12) * x + 4) * x : Math.sqrt(x);

const softLight = (b: number, s: number) =>
	s <= 0.5
		? b - (1 - 2 * s) * b * (1 - b)
		: b + (2 * s - 1) * (softLightD(b) - b);

const difference = (b: number, s: number) => Math.abs(b - s);
const exclusion = (b: number, s: number) => b + s - 2 * b * s;
const add = (b: number, s: number) => Math.min(1, b + s);
const subtract = (b: number, s: number) => Math.max(0, b - s);

const BLEND_FNS: Record<BlendMode, BlendFn> = {
	normal: (_, s) => s,
	multiply,
	screen,
	overlay,
	darken,
	lighten,
	"color-dodge": colorDodge,
	"color-burn": colorBurn,
	"hard-light": hardLight,
	"soft-light": softLight,
	difference,
	exclusion,
	add,
	subtract,
};

/**
 * Blends one packed RGBA source pixel over a destination pixel with the given
 * blend mode. `sa` is the effective source alpha (0..255), already scaled by
 * layer opacity and, when relevant, a clipping mask.
 *
 * Packed format is `(a << 24) | (b << 16) | (g << 8) | r`.
 */
export function blendPixelPacked(
	mode: BlendMode,
	source: number,
	destination: number,
	sa: number,
): number {
	if (sa <= 0) return destination;

	const da = destination >>> 24;
	if (da === 0) {
		// No backdrop: every blend mode reduces to source-over onto transparency.
		return ((sa << 24) | (source & 0x00ffffff)) >>> 0;
	}

	const as = sa / 255;
	const ab = da / 255;
	const fn = BLEND_FNS[mode] ?? BLEND_FNS.normal;

	const sr = (source & 0xff) / 255;
	const sg = ((source >>> 8) & 0xff) / 255;
	const sb = ((source >>> 16) & 0xff) / 255;
	const dr = (destination & 0xff) / 255;
	const dg = ((destination >>> 8) & 0xff) / 255;
	const db = ((destination >>> 16) & 0xff) / 255;

	// W3C "source over with blending": premultiplied output color per channel is
	//   as * ((1 - ab) * s + ab * B(b, s)) + ab * (1 - as) * b
	// and the output alpha is as + ab * (1 - as).
	const ao = as + ab * (1 - as);
	const r = as * ((1 - ab) * sr + ab * fn(dr, sr)) + ab * (1 - as) * dr;
	const g = as * ((1 - ab) * sg + ab * fn(dg, sg)) + ab * (1 - as) * dg;
	const b = as * ((1 - ab) * sb + ab * fn(db, sb)) + ab * (1 - as) * db;

	const outA = clamp255(ao * 255);
	if (outA === 0) return 0;
	return (
		((outA << 24) |
			(clamp255(b * 255) << 16) |
			(clamp255(g * 255) << 8) |
			clamp255(r * 255)) >>>
		0
	);
}
