/**
 * Shared 1-bit mask helpers used by custom brushes and dither patterns.
 *
 * Masks are deliberately monochrome: pixel-art brushes and dither tiles are
 * coverage masks, not images. The current ink color is applied when stamping.
 */

export const MAX_BRUSH_MASK_SIZE = 64;
export const MAX_DITHER_PATTERN_SIZE = 32;

export interface PixelMask {
	width: number;
	height: number;
	/** Row-major coverage values, 0 or 1. */
	data: Uint8Array;
}

function clampInteger(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.max(min, Math.min(max, Math.round(value)));
}

export function createMask(width: number, height: number, filled = 0): PixelMask {
	const w = clampInteger(width, 1, MAX_BRUSH_MASK_SIZE);
	const h = clampInteger(height, 1, MAX_BRUSH_MASK_SIZE);
	const data = new Uint8Array(w * h);
	if (filled) data.fill(1);
	return { width: w, height: h, data };
}

export function cloneMask(mask: PixelMask): PixelMask {
	return {
		width: mask.width,
		height: mask.height,
		data: new Uint8Array(mask.data),
	};
}

/** Builds a mask from readable rows where `#` (or any non-dot) is painted. */
export function maskFromRows(rows: readonly string[]): PixelMask {
	const height = Math.max(1, rows.length);
	const width = Math.max(1, ...rows.map((row) => row.length));
	const mask = createMask(width, height);
	for (let y = 0; y < height; y++) {
		const row = rows[y] ?? "";
		for (let x = 0; x < width; x++) {
			const cell = row[x] ?? ".";
			mask.data[y * width + x] = cell === "." || cell === " " ? 0 : 1;
		}
	}
	return mask;
}

export function maskAt(mask: PixelMask, x: number, y: number): number {
	if (x < 0 || x >= mask.width || y < 0 || y >= mask.height) return 0;
	return mask.data[y * mask.width + x] ?? 0;
}

export function setMaskAt(
	mask: PixelMask,
	x: number,
	y: number,
	value: number,
): void {
	if (x < 0 || x >= mask.width || y < 0 || y >= mask.height) return;
	mask.data[y * mask.width + x] = value ? 1 : 0;
}

export function maskDensity(mask: PixelMask): number {
	if (mask.data.length === 0) return 0;
	let painted = 0;
	for (const value of mask.data) painted += value ? 1 : 0;
	return painted / mask.data.length;
}

export function invertMask(mask: PixelMask): void {
	for (let index = 0; index < mask.data.length; index++) {
		mask.data[index] = mask.data[index] ? 0 : 1;
	}
}

export function clearMask(mask: PixelMask): void {
	mask.data.fill(0);
}

export function fillMask(mask: PixelMask): void {
	mask.data.fill(1);
}

/** Flips the mask horizontally in place. */
export function flipMaskHorizontal(mask: PixelMask): void {
	const { width, height, data } = mask;
	for (let y = 0; y < height; y++) {
		const row = y * width;
		for (let x = 0; x < width >> 1; x++) {
			const other = width - 1 - x;
			const value = data[row + x]!;
			data[row + x] = data[row + other]!;
			data[row + other] = value;
		}
	}
}

/** Flips the mask vertically in place. */
export function flipMaskVertical(mask: PixelMask): void {
	const { width, height, data } = mask;
	for (let y = 0; y < height >> 1; y++) {
		const other = height - 1 - y;
		const row = y * width;
		const otherRow = other * width;
		for (let x = 0; x < width; x++) {
			const value = data[row + x]!;
			data[row + x] = data[otherRow + x]!;
			data[otherRow + x] = value;
		}
	}
}

/** Rotates the mask clockwise by 90 degrees, returning a new mask. */
export function rotateMaskClockwise(mask: PixelMask): PixelMask {
	const result = createMask(mask.height, mask.width);
	for (let y = 0; y < mask.height; y++) {
		for (let x = 0; x < mask.width; x++) {
			const nextX = mask.height - 1 - y;
			const nextY = x;
			result.data[nextY * result.width + nextX] = mask.data[y * mask.width + x]!;
		}
	}
	return result;
}

/** Crops or pads a mask around the top-left corner. */
export function resizeMaskCanvas(
	mask: PixelMask,
	width: number,
	height: number,
	maxSize = MAX_BRUSH_MASK_SIZE,
): PixelMask {
	const w = clampInteger(width, 1, maxSize);
	const h = clampInteger(height, 1, maxSize);
	const result = createMask(w, h);
	const copyWidth = Math.min(w, mask.width);
	const copyHeight = Math.min(h, mask.height);
	for (let y = 0; y < copyHeight; y++) {
		result.data.set(
			mask.data.subarray(y * mask.width, y * mask.width + copyWidth),
			y * w,
		);
	}
	return result;
}

/** Nearest-neighbor resamples a mask to exact target dimensions. */
export function resampleMaskNearest(
	mask: PixelMask,
	targetWidth: number,
	targetHeight: number,
): PixelMask {
	const width = clampInteger(targetWidth, 1, MAX_BRUSH_MASK_SIZE);
	const height = clampInteger(targetHeight, 1, MAX_BRUSH_MASK_SIZE);
	const result = createMask(width, height);
	for (let y = 0; y < height; y++) {
		const sourceY = Math.min(
			mask.height - 1,
			Math.floor((y * mask.height) / height),
		);
		for (let x = 0; x < width; x++) {
			const sourceX = Math.min(
				mask.width - 1,
				Math.floor((x * mask.width) / width),
			);
			result.data[y * width + x] = mask.data[sourceY * mask.width + sourceX]!;
		}
	}
	return result;
}

/**
 * Resizes a mask while preserving its aspect ratio. The longest side becomes
 * `size`, and the other side follows proportionally.
 */
export function scaleMaskToLongest(mask: PixelMask, size: number): PixelMask {
	const requested = Math.max(1, Math.round(size));
	const longest = Math.max(mask.width, mask.height);
	const scale = requested / longest;
	const width = Math.max(1, Math.round(mask.width * scale));
	const height = Math.max(1, Math.round(mask.height * scale));
	return resampleMaskNearest(mask, width, height);
}

/**
 * Builds a mask from the current selection's bounding rectangle. Only selected
 * pixels are painted, so holes in the selection become holes in the brush.
 */
export function maskFromSelection(
	selection: Uint8Array,
	docWidth: number,
	docHeight: number,
): { mask: PixelMask; x: number; y: number } | null {
	const bounds = maskBounds(selection, docWidth, docHeight);
	if (!bounds) return null;
	const { x, y, width, height } = bounds;
	// Use a raw allocation: selections can be larger than the brush cap and the
	// caller decides how to fit them.
	const data = new Uint8Array(width * height);
	for (let row = 0; row < height; row++) {
		const sourceRow = (y + row) * docWidth + x;
		for (let col = 0; col < width; col++) {
			if (selection[sourceRow + col]) data[row * width + col] = 1;
		}
	}
	return { mask: { width, height, data }, x, y };
}

interface MaskBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

function maskBounds(
	mask: Uint8Array,
	width: number,
	height: number,
): MaskBounds | null {
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < height; y++) {
		const row = y * width;
		for (let x = 0; x < width; x++) {
			if (!mask[row + x]) continue;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	}
	if (maxX < minX || maxY < minY) return null;
	return {
		x: minX,
		y: minY,
		width: maxX - minX + 1,
		height: maxY - minY + 1,
	};
}

/**
 * Builds a brush mask from an imported raster. If the image has transparency,
 * alpha decides coverage; otherwise dark pixels are treated as ink so an image
 * on a light background still produces a useful stamp.
 */
export function maskFromPixels(
	pixels: Uint32Array,
	width: number,
	height: number,
	maxSize = MAX_BRUSH_MASK_SIZE,
): PixelMask {
	let hasTransparency = false;
	for (let index = 0; index < pixels.length; index++) {
		if ((pixels[index]! >>> 24) < 128) {
			hasTransparency = true;
			break;
		}
	}

	const source = {
		width,
		height,
		data: new Uint8Array(width * height),
	};
	for (let index = 0; index < pixels.length; index++) {
		const value = pixels[index]!;
		const alpha = value >>> 24;
		let covered: boolean;
		if (hasTransparency) {
			covered = alpha >= 128;
		} else {
			const red = value & 0xff;
			const green = (value >>> 8) & 0xff;
			const blue = (value >>> 16) & 0xff;
			const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
			covered = luminance < 128;
		}
		if (covered) source.data[index] = 1;
	}

	const longest = Math.max(width, height);
	if (longest <= maxSize) return source;
	const scale = maxSize / longest;
	return resampleMaskNearest(
		source,
		Math.max(1, Math.round(width * scale)),
		Math.max(1, Math.round(height * scale)),
	);
}

/** Packs a 1-bit mask into base64 so localStorage stays compact. */
export function encodeMask(mask: PixelMask): string {
	const bytes = new Uint8Array(Math.ceil(mask.data.length / 8));
	for (let index = 0; index < mask.data.length; index++) {
		if (!mask.data[index]) continue;
		const byteIndex = index >> 3;
		bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (1 << (index & 7));
	}
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** Decodes an encoded mask, returning null for malformed or oversized data. */
export function decodeMask(
	width: number,
	height: number,
	encoded: string,
	maxSize = MAX_BRUSH_MASK_SIZE,
): PixelMask | null {
	const w = clampInteger(width, 1, maxSize);
	const h = clampInteger(height, 1, maxSize);
	const count = w * h;
	const expectedBytes = Math.ceil(count / 8);
	let binary: string;
	try {
		binary = atob(encoded);
	} catch {
		return null;
	}
	if (binary.length !== expectedBytes) return null;

	const mask = createMask(w, h);
	for (let index = 0; index < count; index++) {
		const byte = binary.charCodeAt(index >> 3);
		if ((byte >> (index & 7)) & 1) mask.data[index] = 1;
	}
	return mask;
}

/** A simple procedural square mask used by the classic brush path. */
export function squareMask(size: number): PixelMask {
	const span = clampInteger(size, 1, MAX_BRUSH_MASK_SIZE);
	return createMask(span, span, 1);
}
