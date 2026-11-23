import {
	MAX_BRUSH_MASK_SIZE,
	createMask,
	maskFromPixels,
	maskFromSelection,
	scaleMaskToLongest,
	type PixelMask,
} from "./mask.js";

export type BuiltinBrushShape = "square" | "circle" | "diamond" | "ring";

export interface BrushPreset {
	id: string;
	name: string;
	builtin: boolean;
	/** Procedural shape for built-ins; custom brushes use `mask`. */
	shape?: BuiltinBrushShape;
	mask?: PixelMask;
	/** Size applied when the brush is selected. */
	defaultSize: number;
	/** Ink opacity applied when the brush is selected (1–100). */
	defaultOpacity: number;
}

export const DEFAULT_BRUSH_ID = "builtin.square";

export const BUILTIN_BRUSHES: readonly BrushPreset[] = [
	{
		id: "builtin.square",
		name: "Square",
		builtin: true,
		shape: "square",
		defaultSize: 1,
		defaultOpacity: 100,
	},
	{
		id: "builtin.circle",
		name: "Circle",
		builtin: true,
		shape: "circle",
		defaultSize: 5,
		defaultOpacity: 100,
	},
	{
		id: "builtin.diamond",
		name: "Diamond",
		builtin: true,
		shape: "diamond",
		defaultSize: 5,
		defaultOpacity: 100,
	},
	{
		id: "builtin.ring",
		name: "Ring",
		builtin: true,
		shape: "ring",
		defaultSize: 9,
		defaultOpacity: 100,
	},
];

function clampSize(size: number): number {
	if (!Number.isFinite(size)) return 1;
	return Math.max(1, Math.min(MAX_BRUSH_MASK_SIZE, Math.round(size)));
}

function proceduralMask(shape: BuiltinBrushShape, size: number): PixelMask {
	const span = clampSize(size);
	const mask = createMask(span, span);
	const center = span / 2;
	const outerRadius = Math.max(0.35, center - 0.08);
	const innerRadius = Math.max(0, outerRadius - Math.max(1, span / 8));

	for (let y = 0; y < span; y++) {
		for (let x = 0; x < span; x++) {
			const dx = x + 0.5 - center;
			const dy = y + 0.5 - center;
			let covered = false;
			if (shape === "square") {
				covered = true;
			} else if (shape === "circle") {
				covered = dx * dx + dy * dy <= outerRadius * outerRadius;
			} else if (shape === "diamond") {
				covered = Math.abs(dx) + Math.abs(dy) <= center;
			} else {
				const distance = Math.sqrt(dx * dx + dy * dy);
				covered = distance <= outerRadius && distance > innerRadius;
			}
			if (covered) mask.data[y * span + x] = 1;
		}
	}

	// Degenerate small shapes should still paint one pixel.
	if (!mask.data.some((value) => value)) {
		mask.data[Math.floor(mask.data.length / 2)] = 1;
	}
	return mask;
}

/**
 * Resolves a preset to the actual footprint stamped at the cursor. Built-ins
 * are generated at the requested size; custom masks keep their aspect ratio and
 * are nearest-neighbor resampled so the longest side matches the size slider.
 */
export function brushMaskFor(preset: BrushPreset, size: number): PixelMask {
	if (preset.shape) return proceduralMask(preset.shape, size);
	if (preset.mask) return scaleMaskToLongest(preset.mask, clampSize(size));
	return proceduralMask("square", size);
}

/** Normalized preview mask, fitting non-square custom brushes into a square. */
export function brushPreviewMask(preset: BrushPreset, box = 16): PixelMask {
	if (preset.shape) return proceduralMask(preset.shape, box);
	if (!preset.mask) return proceduralMask("square", box);
	const longest = Math.max(preset.mask.width, preset.mask.height);
	if (longest <= box) return preset.mask;
	return scaleMaskToLongest(preset.mask, box);
}

/** Creates an independent custom preset from a selection mask. */
export function brushFromSelection(
	selection: Uint8Array,
	docWidth: number,
	docHeight: number,
	id: string,
	name: string,
): BrushPreset | null {
	const result = maskFromSelection(selection, docWidth, docHeight);
	if (!result) return null;
	const longest = Math.max(result.mask.width, result.mask.height);
	const mask =
		longest > MAX_BRUSH_MASK_SIZE
			? scaleMaskToLongest(result.mask, MAX_BRUSH_MASK_SIZE)
			: result.mask;
	return {
		id,
		name,
		builtin: false,
		mask,
		defaultSize: Math.max(mask.width, mask.height),
		defaultOpacity: 100,
	};
}

/** Creates a custom preset from imported pixels (alpha or luminance coverage). */
export function brushFromImage(
	pixels: Uint32Array,
	width: number,
	height: number,
	id: string,
	name: string,
): BrushPreset {
	const mask = maskFromPixels(pixels, width, height);
	return {
		id,
		name,
		builtin: false,
		mask,
		defaultSize: Math.max(mask.width, mask.height),
		defaultOpacity: 100,
	};
}
