/**
 * Non-destructive group effect stacks.
 *
 * Effects are attached to group nodes and run on the group's composited
 * contents at render/export time. The pure helpers here are shared by the
 * compositor, the project file format, and the timeline editor.
 */

import { normalizeHex, packColor } from "./color.js";
import { ditherPixels } from "./dither-filter.js";
import {
	MAX_EFFECT_THICKNESS,
	MAX_SHADOW_OFFSET,
	dropShadowPixels,
	outlinePixels,
	replaceColorPixels,
} from "./filters.js";
import {
	defaultGradientStops,
	gradientMapPixels,
	normalizeGradientSource,
	normalizeGradientSpace,
	normalizeGradientStops,
} from "./gradient-map.js";
import {
	grayscalePixels,
	normalizeGrayscaleBits,
	type GrayscaleBits,
} from "./grayscale.js";
import type {
	GroupEffect,
	GroupEffectKind,
	GroupEffectOptions,
} from "./types.js";

export const GROUP_EFFECT_KINDS: { id: GroupEffectKind; label: string }[] = [
	{ id: "outline", label: "Outline" },
	{ id: "drop-shadow", label: "Drop shadow" },
	{ id: "color-replace", label: "Color replace" },
	{ id: "dither", label: "Dither" },
	{ id: "gradient-map", label: "Gradient map" },
	{ id: "grayscale", label: "Grayscale" },
];

export const GROUP_EFFECT_LABELS: Record<GroupEffectKind, string> = {
	outline: "Outline",
	"drop-shadow": "Drop shadow",
	"color-replace": "Color replace",
	dither: "Dither",
	"gradient-map": "Gradient map",
	grayscale: "Grayscale",
};

export const MAX_GROUP_EFFECTS = 32;

let effectCounter = 0;

function nextEffectId(): string {
	effectCounter = (effectCounter + 1) % 1_000_000;
	return `effect-${Date.now().toString(36)}-${effectCounter.toString(36)}`;
}

const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value));

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) return fallback;
	return clamp(Math.round(number), min, max);
}

function hexOr(value: unknown, fallback: string): string {
	return typeof value === "string" ? (normalizeHex(value) ?? fallback) : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function normalizePalette(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const palette: string[] = [];
	for (const entry of value) {
		const color = typeof entry === "string" ? normalizeHex(entry) : null;
		if (!color || palette.includes(color)) continue;
		palette.push(color);
		if (palette.length >= 256) break;
	}
	return palette;
}

/** Default options for a newly added effect block. */
export function defaultGroupEffectOptions(
	kind: GroupEffectKind,
	paletteColors: readonly string[] = [],
): GroupEffectOptions {
	switch (kind) {
		case "outline":
			return {
				thickness: 1,
				color: "#000000",
				placement: "outside",
				diagonals: true,
			};
		case "drop-shadow":
			return {
				offsetX: 1,
				offsetY: 1,
				spread: 0,
				color: "#000000",
				opacity: 50,
			};
		case "color-replace":
			return {
				from: "#000000",
				to: "#ffffff",
				tolerance: 0,
				preserveAlpha: true,
			};
		case "dither":
			return {
				method: "ordered",
				matrix: "bayer4",
				serpentine: true,
				target: "two-color",
				lightColor: "#ffffff",
				darkColor: "#000000",
				palette: normalizePalette(paletteColors) ?? [],
			};
		case "gradient-map":
			return {
				gradient: defaultGradientStops(),
				gradientSpace: "rgb",
				gradientSource: "luminance",
				gradientInvert: false,
			};
		case "grayscale":
			return { bits: 8 };
	}
}

export function createGroupEffect(
	kind: GroupEffectKind,
	paletteColors: readonly string[] = [],
): GroupEffect {
	return {
		id: nextEffectId(),
		kind,
		enabled: true,
		options: defaultGroupEffectOptions(kind, paletteColors),
	};
}

export function cloneGroupEffect(effect: GroupEffect): GroupEffect {
	return {
		id: effect.id,
		kind: effect.kind,
		enabled: effect.enabled,
		options: {
			...effect.options,
			...(effect.options.palette
				? { palette: [...effect.options.palette] }
				: {}),
			...(effect.options.gradient
				? {
						gradient: effect.options.gradient.map((stop) => ({
							...stop,
						})),
					}
				: {}),
		},
	};
}

export function cloneGroupEffects(
	effects: readonly GroupEffect[],
): GroupEffect[] {
	return effects.map(cloneGroupEffect);
}

export function normalizeGroupEffectOptions(
	kind: GroupEffectKind,
	value: unknown,
	paletteColors: readonly string[] = [],
): GroupEffectOptions {
	const raw = (value ?? {}) as Record<string, unknown>;
	const defaults = defaultGroupEffectOptions(kind, paletteColors);

	switch (kind) {
		case "outline":
			return {
				thickness: clampInteger(
					raw.thickness,
					1,
					MAX_EFFECT_THICKNESS,
					defaults.thickness ?? 1,
				),
				color: hexOr(raw.color, defaults.color ?? "#000000"),
				placement:
					raw.placement === "inside" ? "inside" : "outside",
				diagonals: boolOr(raw.diagonals, true),
			};
		case "drop-shadow":
			return {
				offsetX: clampInteger(
					raw.offsetX,
					-MAX_SHADOW_OFFSET,
					MAX_SHADOW_OFFSET,
					defaults.offsetX ?? 1,
				),
				offsetY: clampInteger(
					raw.offsetY,
					-MAX_SHADOW_OFFSET,
					MAX_SHADOW_OFFSET,
					defaults.offsetY ?? 1,
				),
				spread: clampInteger(
					raw.spread,
					0,
					MAX_EFFECT_THICKNESS,
					defaults.spread ?? 0,
				),
				color: hexOr(raw.color, defaults.color ?? "#000000"),
				opacity: clampInteger(raw.opacity, 0, 100, defaults.opacity ?? 50),
			};
		case "color-replace":
			return {
				from: hexOr(raw.from, defaults.from ?? "#000000"),
				to: hexOr(raw.to, defaults.to ?? "#ffffff"),
				tolerance: clampInteger(raw.tolerance, 0, 100, 0),
				preserveAlpha: boolOr(raw.preserveAlpha, true),
			};
		case "dither":
			return {
				method: raw.method === "diffusion" ? "diffusion" : "ordered",
				matrix:
					raw.matrix === "bayer2" || raw.matrix === "bayer8"
						? raw.matrix
						: "bayer4",
				serpentine: boolOr(raw.serpentine, true),
				target: raw.target === "palette" ? "palette" : "two-color",
				lightColor: hexOr(raw.lightColor, defaults.lightColor ?? "#ffffff"),
				darkColor: hexOr(raw.darkColor, defaults.darkColor ?? "#000000"),
				palette:
					normalizePalette(raw.palette) ??
					normalizePalette(paletteColors) ??
					[],
			};
		case "gradient-map":
			return {
				gradient: normalizeGradientStops(
					raw.gradient,
					defaults.gradient ?? defaultGradientStops(),
				),
				gradientSpace: normalizeGradientSpace(raw.gradientSpace),
				gradientSource: normalizeGradientSource(raw.gradientSource),
				gradientInvert: boolOr(raw.gradientInvert, false),
			};
		case "grayscale":
			return { bits: normalizeGrayscaleBits(raw.bits) };
	}
}

function isGroupEffectKind(value: unknown): value is GroupEffectKind {
	return GROUP_EFFECT_KINDS.some((entry) => entry.id === value);
}

/** Validates one effect from a project file or an in-memory patch. */
export function normalizeGroupEffect(
	value: unknown,
	paletteColors: readonly string[] = [],
): GroupEffect | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	if (!isGroupEffectKind(raw.kind)) return null;
	const kind = raw.kind;
	return {
		id:
			typeof raw.id === "string" && raw.id.trim()
				? raw.id
				: nextEffectId(),
		kind,
		enabled: raw.enabled !== false,
		options: normalizeGroupEffectOptions(kind, raw.options, paletteColors),
	};
}

/** Validates an effect list, dropping invalid entries and duplicate ids. */
export function normalizeGroupEffects(
	value: unknown,
	paletteColors: readonly string[] = [],
): GroupEffect[] {
	if (!Array.isArray(value)) return [];
	const effects: GroupEffect[] = [];
	const ids = new Set<string>();
	for (const entry of value) {
		const effect = normalizeGroupEffect(entry, paletteColors);
		if (!effect) continue;
		if (ids.has(effect.id)) effect.id = nextEffectId();
		ids.add(effect.id);
		effects.push(effect);
		if (effects.length >= MAX_GROUP_EFFECTS) break;
	}
	return effects;
}

/** Applies one effect to a pixel buffer. Disabled effects are a no-op. */
export function applyGroupEffect(
	pixels: Uint32Array,
	width: number,
	height: number,
	effect: GroupEffect,
): Uint32Array {
	if (!effect.enabled) return pixels;
	const options = effect.options;

	switch (effect.kind) {
		case "outline":
			return outlinePixels(pixels, width, height, {
				thickness: options.thickness ?? 1,
				color: packColor(options.color ?? "#000000"),
				placement: options.placement === "inside" ? "inside" : "outside",
				diagonals: options.diagonals !== false,
			});
		case "drop-shadow":
			return dropShadowPixels(pixels, width, height, {
				offsetX: options.offsetX ?? 1,
				offsetY: options.offsetY ?? 1,
				spread: options.spread ?? 0,
				color: packColor(
					options.color ?? "#000000",
					Math.round(((options.opacity ?? 50) / 100) * 255),
				),
			});
		case "color-replace":
			return replaceColorPixels(pixels, width, height, {
				from: packColor(options.from ?? "#000000"),
				to: packColor(options.to ?? "#ffffff"),
				tolerance: options.tolerance ?? 0,
				preserveAlpha: options.preserveAlpha !== false,
			});
		case "dither": {
			const palette = (options.palette ?? []).map((color) => packColor(color));
			const target =
				options.target === "palette" && palette.length >= 2
					? "palette"
					: "two-color";
			return ditherPixels(pixels, width, height, {
				method: options.method === "diffusion" ? "diffusion" : "ordered",
				matrix: options.matrix ?? "bayer4",
				diffusion: "floyd-steinberg",
				serpentine: options.serpentine !== false,
				target,
				lightColor: packColor(options.lightColor ?? "#ffffff"),
				darkColor: packColor(options.darkColor ?? "#000000"),
				palette,
			});
		}
		case "gradient-map":
			return gradientMapPixels(pixels, width, height, {
				stops: options.gradient ?? defaultGradientStops(),
				space: normalizeGradientSpace(options.gradientSpace),
				source: normalizeGradientSource(options.gradientSource),
				invert: options.gradientInvert === true,
			});
		case "grayscale":
			return grayscalePixels(pixels, width, height, {
				bits: normalizeGrayscaleBits(options.bits),
			});
	}
}

/** Runs an effect stack left-to-right on a group's composited buffer. */
export function applyGroupEffectChain(
	pixels: Uint32Array,
	width: number,
	height: number,
	effects: readonly GroupEffect[] | undefined,
): Uint32Array {
	if (!effects || effects.length === 0) return pixels;
	let result = pixels;
	for (const effect of effects) {
		if (!effect.enabled) continue;
		result = applyGroupEffect(result, width, height, effect);
	}
	return result;
}

/** Short human-readable detail for a block tooltip. */
export function groupEffectSummary(effect: GroupEffect): string {
	const options = effect.options;
	switch (effect.kind) {
		case "outline":
			return `${options.thickness ?? 1} px ${options.placement === "inside" ? "inside" : "outside"}`;
		case "drop-shadow":
			return `${options.offsetX ?? 1}, ${options.offsetY ?? 1} · ${options.opacity ?? 50}%`;
		case "color-replace":
			return `${options.from ?? "#000000"} → ${options.to ?? "#ffffff"}`;
		case "dither":
			return options.method === "diffusion"
				? "Error diffusion"
				: `Ordered · ${options.matrix ?? "bayer4"}`;
		case "gradient-map": {
			const stops = normalizeGradientStops(options.gradient);
			const space = normalizeGradientSpace(options.gradientSpace);
			return `${stops.length} stops · ${space === "oklab" ? "OKLab" : "RGB"}`;
		}
		case "grayscale": {
			const bits: GrayscaleBits = normalizeGrayscaleBits(options.bits);
			return `${bits}-bit · ${1 << bits} levels`;
		}
	}
}
