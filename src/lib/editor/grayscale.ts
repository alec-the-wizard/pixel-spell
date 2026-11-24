/**
 * Grayscale conversion helpers.
 *
 * Grayscale is presentation/conversion behaviour rather than a document color
 * mode: the same packed RGBA cels are converted on demand by the destructive
 * effect, group effect blocks, the preview window, and export.
 *
 * Luminance uses the perceptual Rec. 709 weights instead of a flat RGB
 * average, so reds and greens keep the visual brightness artists expect.
 * Alpha is always preserved and transparent pixels stay transparent.
 */

export type GrayscaleBits = 1 | 2 | 4 | 8;

/** Bit depths offered by the grayscale effect and its dialogs. */
export const GRAYSCALE_BIT_OPTIONS: { id: GrayscaleBits; label: string }[] = [
	{ id: 1, label: "1-bit" },
	{ id: 2, label: "2-bit" },
	{ id: 4, label: "4-bit" },
	{ id: 8, label: "8-bit" },
];

/** Rec. 709 luminance weights used for every grayscale conversion. */
export const LUMINANCE_RED = 0.2126;
export const LUMINANCE_GREEN = 0.7152;
export const LUMINANCE_BLUE = 0.0722;

/** Normalizes an arbitrary bit-depth value to 1, 2, 4, or 8. */
export function normalizeGrayscaleBits(
	value: unknown,
	fallback: GrayscaleBits = 8,
): GrayscaleBits {
	const number = typeof value === "number" ? value : Number(value);
	return number === 1 || number === 2 || number === 4 || number === 8
		? number
		: fallback;
}

/** Perceptual luminance of an 8-bit RGB color, 0–255. */
export function perceptualLuminance(r: number, g: number, b: number): number {
	return LUMINANCE_RED * r + LUMINANCE_GREEN * g + LUMINANCE_BLUE * b;
}

/** Quantizes a luminance value to the ramp for a bit depth and returns 0–255. */
export function quantizeLuminance(value: number, bits: GrayscaleBits): number {
	const levels = (1 << bits) - 1;
	const scaled = Math.round((Math.max(0, Math.min(255, value)) / 255) * levels);
	return Math.round((scaled / levels) * 255);
}

/** Converts one packed RGBA pixel to a packed gray pixel. */
export function grayscalePixel(value: number, bits: GrayscaleBits = 8): number {
	const alpha = value >>> 24;
	if (alpha === 0) return 0;
	const luma = perceptualLuminance(
		value & 0xff,
		(value >>> 8) & 0xff,
		(value >>> 16) & 0xff,
	);
	const gray = quantizeLuminance(luma, bits);
	return ((alpha << 24) | (gray << 16) | (gray << 8) | gray) >>> 0;
}

export interface GrayscaleOptions {
	/** Bits per pixel color: 1, 2, 4, or 8. */
	bits?: GrayscaleBits;
	/** Optional selection mask; only masked pixels are written. */
	mask?: Uint8Array | null;
}

/**
 * Returns a new buffer where every opaque pixel is replaced by its quantized
 * perceptual gray value. Disabled by an absent mask only outside the mask;
 * pixels outside a selection keep their original color.
 */
export function grayscalePixels(
	pixels: Uint32Array,
	width: number,
	height: number,
	options: GrayscaleOptions = {},
): Uint32Array {
	const result = new Uint32Array(pixels);
	const count = Math.min(pixels.length, Math.max(0, width * height));
	const bits = normalizeGrayscaleBits(options.bits);
	const mask =
		options.mask && options.mask.length >= count ? options.mask : null;
	const levels = (1 << bits) - 1;

	for (let index = 0; index < count; index++) {
		if (mask && !mask[index]) continue;
		const value = pixels[index]!;
		const alpha = value >>> 24;
		if (alpha === 0) continue;
		const luma = perceptualLuminance(
			value & 0xff,
			(value >>> 8) & 0xff,
			(value >>> 16) & 0xff,
		);
		const scaled = Math.round(
			(Math.max(0, Math.min(255, luma)) / 255) * levels,
		);
		const gray = Math.round((scaled / levels) * 255);
		result[index] = ((alpha << 24) | (gray << 16) | (gray << 8) | gray) >>> 0;
	}

	return result;
}
