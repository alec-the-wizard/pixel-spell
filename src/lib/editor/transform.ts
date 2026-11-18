/**
 * Selection transform pixel helpers.
 *
 * These pure functions power the selection's scale/rotate/flip/skew handles:
 * `warpScaleSkew` applies a nearest-neighbor affine warp (scale, flip, and
 * skew folded together), and `rotateRotsprite` rotates a buffer using the
 * RotSprite algorithm so rotated pixel art stays crisp instead of gaining the
 * blur of bilinear interpolation.
 *
 * RotSprite (by Xenowhirl, as shipped in Aseprite) works in three steps:
 *   1. upscale the source 8× with Scale2x,
 *   2. rotate it with a nearest-neighbor parallelogram map at 8× resolution,
 *   3. downscale it back to 1× with nearest-neighbor sampling.
 * The 8× supersampling is what keeps hard pixel edges while rotating; no new
 * colors are introduced because Scale2x only copies existing pixels.
 */

/** Packed RGBA pixels plus a 0/1 selection mask, both `width` × `height`. */
export interface TransformBuffer {
	pixels: Uint32Array;
	mask: Uint8Array;
	width: number;
	height: number;
}

/** Parameters for a selection transform (flip is folded into negative scale). */
export interface SelectionTransform {
	scaleX: number;
	scaleY: number;
	skewX: number;
	skewY: number;
	/** Rotation in radians. */
	angle: number;
}

/** RotSprite upscale factor. */
const ROTSPRITE_ZOOM = 8;
/**
 * Cap on the upscaled pixel count so a huge selection (for example Select All
 * on a 2048×2048 canvas) cannot allocate gigabytes. Larger sources reduce the
 * upscale factor, degrading gracefully toward a plain nearest-neighbor rotate.
 */
const MAX_UPSCALED_PIXELS = 8_000_000;

/**
 * Scale2x: doubles an image while smoothing pixel-art diagonals. It compares
 * the four neighbors of every pixel and only ever copies an existing value, so
 * it never invents new colors.
 */
function scale2x(pixels: Uint32Array, width: number, height: number): Uint32Array {
	const outWidth = width * 2;
	const outHeight = height * 2;
	const output = new Uint32Array(outWidth * outHeight);

	for (let y = 0; y < height; y++) {
		const row = y * width;
		const outRow = y * 2 * outWidth;
		for (let x = 0; x < width; x++) {
			const p = pixels[row + x]!;
			const a = y > 0 ? pixels[row - width + x]! : p;
			const b = x < width - 1 ? pixels[row + x + 1]! : p;
			const c = x > 0 ? pixels[row + x - 1]! : p;
			const d = y < height - 1 ? pixels[row + width + x]! : p;

			// The four output pixels around the source pixel (top-left, top-right,
			// bottom-left, bottom-right), following the Scale2x rule set.
			output[outRow + x * 2] = c === a && c !== d && a !== b ? a : p;
			output[outRow + x * 2 + 1] = a === b && a !== c && b !== d ? b : p;
			output[outRow + outWidth + x * 2] = d === c && d !== b && c !== a ? c : p;
			output[outRow + outWidth + x * 2 + 1] = b === d && b !== a && d !== c ? d : p;
		}
	}

	return output;
}

/** Nearest-neighbor upscale of a binary mask by an integer factor. */
function scaleMaskNearest(
	mask: Uint8Array,
	width: number,
	height: number,
	factor: number,
): Uint8Array {
	const outWidth = width * factor;
	const output = new Uint8Array(outWidth * height * factor);
	for (let y = 0; y < height; y++) {
		const sourceRow = y * width;
		for (let x = 0; x < width; x++) {
			if (!mask[sourceRow + x]) continue;
			for (let dy = 0; dy < factor; dy++) {
				const outRow = (y * factor + dy) * outWidth + x * factor;
				output.fill(1, outRow, outRow + factor);
			}
		}
	}
	return output;
}

/**
 * Rotates a buffer around its center using RotSprite (Scale2x upscale +
 * nearest-neighbor rotation + nearest downscale). The result is returned as a
 * bounding-box buffer centered on the same point, ready to be placed with its
 * top-left at `(center - width / 2, center - height / 2)`.
 */
export function rotateRotsprite(buffer: TransformBuffer, angle: number): TransformBuffer {
	const { width, height } = buffer;
	if (width <= 0 || height <= 0) {
		return { pixels: new Uint32Array(0), mask: new Uint8Array(0), width: 0, height: 0 };
	}

	const radians = angle % (Math.PI * 2);

	// Axis-aligned rotations are lossless and far cheaper, so they bypass the
	// 8× upscale entirely (this also keeps a 0° "rotation" a strict no-op).
	const turns = radians / (Math.PI / 2);
	const roundedTurns = Math.round(turns);
	if (Math.abs(turns - roundedTurns) < 1e-6) {
		return rotateQuarterTurns(buffer, ((roundedTurns % 4) + 4) % 4);
	}

	// Pick an upscale factor that fits within the pixel budget.
	let zoom = ROTSPRITE_ZOOM;
	while (zoom > 1 && width * zoom * height * zoom > MAX_UPSCALED_PIXELS) {
		zoom /= 2;
	}

	let bigPixels = buffer.pixels;
	let bigWidth = width;
	let bigHeight = height;
	let remaining = zoom;
	while (remaining > 1) {
		bigPixels = scale2x(bigPixels, bigWidth, bigHeight);
		bigWidth *= 2;
		bigHeight *= 2;
		remaining /= 2;
	}
	const bigMask = scaleMaskNearest(buffer.mask, width, height, zoom);

	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const centerX = bigWidth / 2;
	const centerY = bigHeight / 2;

	// Rotate the four outer corners to bound the output.
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const corners: [number, number][] = [
		[0, 0],
		[bigWidth, 0],
		[bigWidth, bigHeight],
		[0, bigHeight],
	];
	for (const [cornerX, cornerY] of corners) {
		const dx = cornerX - centerX;
		const dy = cornerY - centerY;
		const rx = centerX + dx * cos - dy * sin;
		const ry = centerY + dx * sin + dy * cos;
		if (rx < minX) minX = rx;
		if (rx > maxX) maxX = rx;
		if (ry < minY) minY = ry;
		if (ry > maxY) maxY = ry;
	}

	const outWidth = Math.max(1, Math.ceil((maxX - minX) / zoom));
	const outHeight = Math.max(1, Math.ceil((maxY - minY) / zoom));
	const outPixels = new Uint32Array(outWidth * outHeight);
	const outMask = new Uint8Array(outWidth * outHeight);

	// Inverse-map each output pixel through the rotation, sampling the upscaled
	// source with nearest-neighbor. Sampling the top-left pixel of each 8×
	// block reproduces the nearest-neighbor downscale Aseprite applies to the
	// rotated image.
	for (let oy = 0; oy < outHeight; oy++) {
		for (let ox = 0; ox < outWidth; ox++) {
			const px = minX + ox * zoom + 0.5;
			const py = minY + oy * zoom + 0.5;
			const dx = px - centerX;
			const dy = py - centerY;
			const sx = centerX + dx * cos + dy * sin;
			const sy = centerY - dx * sin + dy * cos;
			const ix = Math.floor(sx);
			const iy = Math.floor(sy);
			if (ix < 0 || ix >= bigWidth || iy < 0 || iy >= bigHeight) continue;

			const index = iy * bigWidth + ix;
			if (bigMask[index]) outMask[oy * outWidth + ox] = 1;
			const value = bigPixels[index]!;
			if ((value >>> 24) !== 0) outPixels[oy * outWidth + ox] = value;
		}
	}

	return { pixels: outPixels, mask: outMask, width: outWidth, height: outHeight };
}

/** Lossless 0°/90°/180°/270° rotation (clockwise quarter turns). */
function rotateQuarterTurns(buffer: TransformBuffer, quarter: number): TransformBuffer {
	const { width, height } = buffer;
	if (quarter === 0) {
		return {
			pixels: new Uint32Array(buffer.pixels),
			mask: new Uint8Array(buffer.mask),
			width,
			height,
		};
	}
	if (quarter === 2) {
		const pixels = new Uint32Array(buffer.pixels.length);
		const mask = new Uint8Array(buffer.mask.length);
		for (let index = 0; index < buffer.pixels.length; index++) {
			pixels[index] = buffer.pixels[buffer.pixels.length - 1 - index]!;
			mask[index] = buffer.mask[buffer.mask.length - 1 - index]!;
		}
		return { pixels, mask, width, height };
	}

	const outWidth = height;
	const outHeight = width;
	const pixels = new Uint32Array(width * height);
	const mask = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const source = y * width + x;
			const dx = quarter === 1 ? height - 1 - y : y;
			const dy = quarter === 1 ? x : width - 1 - x;
			const target = dy * outWidth + dx;
			pixels[target] = buffer.pixels[source]!;
			mask[target] = buffer.mask[source]!;
		}
	}
	return { pixels, mask, width: outWidth, height: outHeight };
}

/**
 * Applies a nearest-neighbor affine warp (scale, horizontal/vertical flip via
 * negative scale, and skew) around the buffer center. The result is returned
 * as a bounding-box buffer centered on the same point.
 */
export function warpScaleSkew(
	buffer: TransformBuffer,
	scaleX: number,
	scaleY: number,
	skewX: number,
	skewY: number,
): TransformBuffer {
	const { width, height } = buffer;
	if (width <= 0 || height <= 0 || scaleX === 0 || scaleY === 0) {
		return { pixels: new Uint32Array(0), mask: new Uint8Array(0), width: 0, height: 0 };
	}

	const halfWidth = width / 2;
	const halfHeight = height / 2;
	const determinant = 1 - skewX * skewY;

	// Transform the four source corners to bound the output.
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const corners: [number, number][] = [
		[-halfWidth, -halfHeight],
		[halfWidth, -halfHeight],
		[halfWidth, halfHeight],
		[-halfWidth, halfHeight],
	];
	for (const [localX, localY] of corners) {
		const scaledX = localX * scaleX;
		const scaledY = localY * scaleY;
		const kx = scaledX + skewX * scaledY;
		const ky = scaledY + skewY * scaledX;
		if (kx < minX) minX = kx;
		if (kx > maxX) maxX = kx;
		if (ky < minY) minY = ky;
		if (ky > maxY) maxY = ky;
	}

	const outWidth = Math.max(1, Math.ceil(maxX - minX));
	const outHeight = Math.max(1, Math.ceil(maxY - minY));
	const outPixels = new Uint32Array(outWidth * outHeight);
	const outMask = new Uint8Array(outWidth * outHeight);

	for (let oy = 0; oy < outHeight; oy++) {
		for (let ox = 0; ox < outWidth; ox++) {
			const kx = minX + ox + 0.5;
			const ky = minY + oy + 0.5;

			let scaledX: number;
			let scaledY: number;
			if (determinant === 0) {
				scaledX = 0;
				scaledY = 0;
			} else {
				scaledX = (kx - skewX * ky) / determinant;
				scaledY = (ky - skewY * kx) / determinant;
			}
			const localX = scaledX / scaleX;
			const localY = scaledY / scaleY;
			// Convert the centered source coordinate back to a source pixel index.
			// The source spans [-halfWidth, halfWidth] in these centered
			// coordinates, so adding halfWidth yields the edge coordinate and
			// `Math.floor` selects the pixel that covers the sampled point.
			const u = localX + halfWidth;
			const v = localY + halfHeight;
			const ix = Math.floor(u);
			const iy = Math.floor(v);
			if (ix < 0 || ix >= width || iy < 0 || iy >= height) continue;

			const index = iy * width + ix;
			if (buffer.mask[index]) outMask[oy * outWidth + ox] = 1;
			const value = buffer.pixels[index]!;
			if ((value >>> 24) !== 0) outPixels[oy * outWidth + ox] = value;
		}
	}

	return { pixels: outPixels, mask: outMask, width: outWidth, height: outHeight };
}

/** Warps (scale/flip/skew) and then rotates a selection buffer. */
export function transformSelection(
	source: TransformBuffer,
	transform: SelectionTransform,
): TransformBuffer {
	const warped = warpScaleSkew(
		source,
		transform.scaleX,
		transform.scaleY,
		transform.skewX,
		transform.skewY,
	);
	return rotateRotsprite(warped, transform.angle);
}
