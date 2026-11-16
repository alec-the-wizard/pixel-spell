import { normalizeHex } from "./color.js";

export interface LayerColorPreset {
	name: string;
	value: string;
}

/**
 * Curated choices for the timeline layer-color menu. Medium tones keep the
 * tint readable against both the light and dark app backgrounds.
 */
export const LAYER_COLOR_PRESETS: readonly LayerColorPreset[] = [
	{ name: "Red", value: "#ef4444" },
	{ name: "Orange", value: "#f97316" },
	{ name: "Amber", value: "#eab308" },
	{ name: "Lime", value: "#84cc16" },
	{ name: "Green", value: "#22c55e" },
	{ name: "Teal", value: "#14b8a6" },
	{ name: "Cyan", value: "#06b6d4" },
	{ name: "Blue", value: "#3b82f6" },
	{ name: "Indigo", value: "#6366f1" },
	{ name: "Violet", value: "#a855f7" },
	{ name: "Pink", value: "#ec4899" },
	{ name: "Slate", value: "#64748b" },
];

/** Normalizes a stored layer color, dropping anything that is not `#rrggbb`. */
export function normalizeLayerColor(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return normalizeHex(value) ?? undefined;
}

/** Name of a preset color, used by tooltips and accessibility labels. */
export function layerColorName(color: string): string {
	return (
		LAYER_COLOR_PRESETS.find((preset) => preset.value === color)?.name ??
		color
	);
}

/**
 * Builds a timeline row tint by mixing the layer color into a theme token.
 * The result is opaque, which sticky timeline cells require.
 */
export function layerTint(
	color: string,
	percent: number,
	base = "var(--background)",
): string {
	const amount = Math.max(0, Math.min(100, percent));
	return `color-mix(in oklab, ${color} ${amount}%, ${base})`;
}
