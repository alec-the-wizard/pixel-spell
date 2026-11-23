/**
 * Pure pixel filters shared by the Effects dialogs and their previews.
 *
 * Every function returns a new buffer and never mutates its input. A selection
 * mask, when present, only limits where pixels are written; the shape used to
 * grow an outline or a shadow is always read from the whole cel.
 */

export const MIN_EFFECT_THICKNESS = 1;
export const MAX_EFFECT_THICKNESS = 8;
export const MAX_SHADOW_OFFSET = 64;

function clampInteger(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.max(min, Math.min(max, Math.round(value)));
}

interface NeighborOffset {
	dx: number;
	dy: number;
}

function neighborOffsets(diagonals: boolean): NeighborOffset[] {
	const offsets: NeighborOffset[] = [
		{ dx: 0, dy: -1 },
		{ dx: -1, dy: 0 },
		{ dx: 1, dy: 0 },
		{ dx: 0, dy: 1 },
	];
	if (diagonals) {
		offsets.push(
			{ dx: -1, dy: -1 },
			{ dx: 1, dy: -1 },
			{ dx: -1, dy: 1 },
			{ dx: 1, dy: 1 },
		);
	}
	return offsets;
}

function touchesMask(
	mask: Uint8Array,
	width: number,
	height: number,
	x: number,
	y: number,
	offsets: readonly NeighborOffset[],
): boolean {
	for (const offset of offsets) {
		const nx = x + offset.dx;
		const ny = y + offset.dy;
		if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
		if (mask[ny * width + nx]) return true;
	}
	return false;
}

export type OutlinePlacement = "outside" | "inside";

export interface OutlineOptions {
	/** Outline width in pixels (1–8). */
	thickness: number;
	/** Packed little-endian RGBA color used for the outline. */
	color: number;
	/** Grow the outline outwards or recolor the sprite's inner edge. */
	placement: OutlinePlacement;
	/** Include diagonal neighbors (8-way) instead of only the four sides. */
	diagonals: boolean;
	/** Optional selection mask; only masked pixels are written. */
	mask?: Uint8Array | null;
}

/**
 * Adds a hard pixel outline around (or inside) every opaque pixel. The source
 * pixels are kept, so an outside outline only ever fills transparent space.
 */
export function outlinePixels(
	pixels: Uint32Array,
	width: number,
	height: number,
	options: OutlineOptions,
): Uint32Array {
	const result = new Uint32Array(pixels);
	const count = width * height;
	if (count === 0 || width <= 0 || height <= 0) return result;

	const thickness = clampInteger(
		options.thickness,
		0,
		MAX_EFFECT_THICKNESS,
	);
	if (thickness <= 0 || (options.color >>> 24) === 0) return result;

	const mask =
		options.mask && options.mask.length >= count ? options.mask : null;
	const covered = new Uint8Array(count);
	for (let index = 0; index < count; index++) {
		covered[index] = (pixels[index]! >>> 24) > 0 ? 1 : 0;
	}

	const offsets = neighborOffsets(options.diagonals);

	if (options.placement === "inside") {
		// Erode the shape from its transparent edge inwards. Reached pixels are
		// marked even outside the selection so the band keeps its full width.
		const outside = new Uint8Array(count);
		for (let index = 0; index < count; index++) {
			if (!covered[index]) outside[index] = 1;
		}

		for (let step = 0; step < thickness; step++) {
			const reached: number[] = [];
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					const index = y * width + x;
					if (!covered[index] || outside[index]) continue;
					// The canvas border also counts as an edge, so a sprite that
					// fills the canvas still receives an inner outline.
					const onBorder =
						x === 0 || y === 0 || x === width - 1 || y === height - 1;
					if (
						!onBorder &&
						!touchesMask(outside, width, height, x, y, offsets)
					) {
						continue;
					}
					reached.push(index);
				}
			}
			if (reached.length === 0) break;
			for (const index of reached) {
				outside[index] = 1;
				if (!mask || mask[index]) result[index] = options.color;
			}
		}
		return result;
	}

	for (let step = 0; step < thickness; step++) {
		const added: number[] = [];
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const index = y * width + x;
				if (covered[index]) continue;
				if (mask && !mask[index]) continue;
				if (!touchesMask(covered, width, height, x, y, offsets)) continue;
				added.push(index);
			}
		}
		if (added.length === 0) break;
		for (const index of added) {
			covered[index] = 1;
			result[index] = options.color;
		}
	}

	return result;
}

export interface DropShadowOptions {
	/** Horizontal offset in pixels. */
	offsetX: number;
	/** Vertical offset in pixels. */
	offsetY: number;
	/** Grow the shadow silhouette before offsetting it (0–8). */
	spread: number;
	/** Packed little-endian RGBA shadow color. */
	color: number;
	/** Optional selection mask; only masked pixels are written. */
	mask?: Uint8Array | null;
}

/**
 * Places a flat drop shadow behind the cel's opaque pixels. The shadow never
 * paints over existing pixels, so the sprite silhouette stays untouched.
 */
export function dropShadowPixels(
	pixels: Uint32Array,
	width: number,
	height: number,
	options: DropShadowOptions,
): Uint32Array {
	const result = new Uint32Array(pixels);
	const count = width * height;
	if (count === 0 || width <= 0 || height <= 0) return result;
	if ((options.color >>> 24) === 0) return result;

	const offsetX = clampInteger(
		options.offsetX,
		-MAX_SHADOW_OFFSET,
		MAX_SHADOW_OFFSET,
	);
	const offsetY = clampInteger(
		options.offsetY,
		-MAX_SHADOW_OFFSET,
		MAX_SHADOW_OFFSET,
	);
	const spread = clampInteger(options.spread, 0, MAX_EFFECT_THICKNESS);
	const mask =
		options.mask && options.mask.length >= count ? options.mask : null;

	let silhouette = new Uint8Array(count);
	for (let index = 0; index < count; index++) {
		if ((pixels[index]! >>> 24) > 0) silhouette[index] = 1;
	}

	if (spread > 0) {
		const offsets = neighborOffsets(true);
		for (let step = 0; step < spread; step++) {
			const next = new Uint8Array(silhouette);
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					if (silhouette[y * width + x]) continue;
					if (touchesMask(silhouette, width, height, x, y, offsets)) {
						next[y * width + x] = 1;
					}
				}
			}
			silhouette = next;
		}
	}

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!silhouette[y * width + x]) continue;
			const targetX = x + offsetX;
			const targetY = y + offsetY;
			if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) {
				continue;
			}
			const target = targetY * width + targetX;
			if ((result[target]! >>> 24) > 0) continue;
			if (mask && !mask[target]) continue;
			result[target] = options.color;
		}
	}

	return result;
}

export interface ColorReplaceOptions {
	/** Packed color to look for; only the RGB channels are compared. */
	from: number;
	/** Packed replacement color. */
	to: number;
	/** 0 (exact) to 100 (nearly everything) RGB distance tolerance. */
	tolerance: number;
	/** Keep each source pixel's alpha instead of using the target alpha. */
	preserveAlpha: boolean;
	/** Optional selection mask; only masked pixels are written. */
	mask?: Uint8Array | null;
}

const MAX_RGB_DISTANCE = Math.sqrt(3 * 255 * 255);

function replacementThresholdSquared(tolerance: number): number {
	const percent = Math.max(0, Math.min(100, tolerance));
	const distance = (percent / 100) * MAX_RGB_DISTANCE;
	return distance * distance;
}

function matchesReplacement(
	value: number,
	fromR: number,
	fromG: number,
	fromB: number,
	thresholdSquared: number,
): boolean {
	if ((value >>> 24) === 0) return false;
	const dr = (value & 0xff) - fromR;
	const dg = ((value >>> 8) & 0xff) - fromG;
	const db = ((value >>> 16) & 0xff) - fromB;
	return dr * dr + dg * dg + db * db <= thresholdSquared;
}

/**
 * Replaces every pixel close enough to the source color. Matching ignores
 * transparency, so transparent pixels never become opaque by accident.
 */
export function replaceColorPixels(
	pixels: Uint32Array,
	width: number,
	height: number,
	options: ColorReplaceOptions,
): Uint32Array {
	const result = new Uint32Array(pixels);
	const count = width * height;
	if (count === 0) return result;

	const fromR = options.from & 0xff;
	const fromG = (options.from >>> 8) & 0xff;
	const fromB = (options.from >>> 16) & 0xff;
	const thresholdSquared = replacementThresholdSquared(options.tolerance);
	const targetRgb = options.to & 0x00ffffff;
	const targetAlpha = options.to >>> 24;
	const mask =
		options.mask && options.mask.length >= count ? options.mask : null;

	for (let index = 0; index < count; index++) {
		if (mask && !mask[index]) continue;
		const value = pixels[index]!;
		if (
			!matchesReplacement(value, fromR, fromG, fromB, thresholdSquared)
		) {
			continue;
		}
		const alpha = options.preserveAlpha ? value >>> 24 : targetAlpha;
		result[index] = ((alpha << 24) | targetRgb) >>> 0;
	}

	return result;
}

/** Number of pixels a color replacement would rewrite. */
export function countColorReplacement(
	pixels: Uint32Array,
	width: number,
	height: number,
	options: ColorReplaceOptions,
): number {
	const count = width * height;
	if (count === 0) return 0;

	const fromR = options.from & 0xff;
	const fromG = (options.from >>> 8) & 0xff;
	const fromB = (options.from >>> 16) & 0xff;
	const thresholdSquared = replacementThresholdSquared(options.tolerance);
	const mask =
		options.mask && options.mask.length >= count ? options.mask : null;

	let matches = 0;
	for (let index = 0; index < count; index++) {
		if (mask && !mask[index]) continue;
		if (
			matchesReplacement(pixels[index]!, fromR, fromG, fromB, thresholdSquared)
		) {
			matches++;
		}
	}
	return matches;
}
