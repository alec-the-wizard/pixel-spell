/**
 * Minimal 8-bit grayscale PNG encoder used by the export dialog.
 *
 * The browser canvas API only encodes RGBA PNGs, so a true grayscale PNG (PNG
 * color type 0, or type 4 with alpha) needs its own encoder. Scanlines are
 * filtered with "None" and compressed with `CompressionStream("deflate")`
 * when available; a stored-block zlib stream keeps the fallback dependency
 * free and always produces a valid file.
 */

import { perceptualLuminance } from "./grayscale.js";
import {
	PNG_SIGNATURE,
	assemblePng,
	deflate,
	pngChunk,
	writeUint32,
} from "./png.js";

export interface GrayscalePngOptions {
	/** Include an alpha channel (PNG color type 4). Defaults to false. */
	alpha?: boolean;
}

/**
 * Encodes packed RGBA pixels as an 8-bit grayscale PNG. RGB is reduced with
 * perceptual luminance; alpha is written only when requested.
 */
export async function encodeGrayscalePng(
	pixels: Uint32Array,
	width: number,
	height: number,
	options: GrayscalePngOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	const alpha = options.alpha === true;
	const channels = alpha ? 2 : 1;
	const rowLength = w * channels;
	const raw = new Uint8Array((rowLength + 1) * h);

	let offset = 0;
	for (let y = 0; y < h; y++) {
		raw[offset++] = 0; // Filter: None.
		const row = y * w;
		for (let x = 0; x < w; x++) {
			const value = pixels[row + x] ?? 0;
			const gray = Math.round(
				perceptualLuminance(
					value & 0xff,
					(value >>> 8) & 0xff,
					(value >>> 16) & 0xff,
				),
			);
			raw[offset++] = gray;
			if (alpha) raw[offset++] = value >>> 24;
		}
	}

	const ihdr = new Uint8Array(13);
	writeUint32(ihdr, 0, w);
	writeUint32(ihdr, 4, h);
	ihdr[8] = 8; // Bit depth.
	ihdr[9] = alpha ? 4 : 0; // Grayscale, optionally with alpha.
	ihdr[10] = 0; // Compression.
	ihdr[11] = 0; // Filter method.
	ihdr[12] = 0; // Interlace.

	return assemblePng([
		new Uint8Array(PNG_SIGNATURE),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", await deflate(raw)),
		pngChunk("IEND", new Uint8Array(0)),
	]);
}
