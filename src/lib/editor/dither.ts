import {
	createMask,
	maskFromRows,
	type PixelMask,
} from "./mask.js";

export type DitherAlign = "canvas" | "brush";

export interface DitherPattern {
	id: string;
	name: string;
	builtin: boolean;
	mask: PixelMask;
}

export interface DitherSampler {
	pattern: DitherPattern;
	offsetX: number;
	offsetY: number;
	align: DitherAlign;
}

export const DEFAULT_DITHER_PATTERN_ID = "builtin.checker";

/** Standard ordered Bayer matrices. Values are the classic 0..n²-1 ranks. */
export const BAYER_VALUES: Record<"bayer2" | "bayer4" | "bayer8", number[]> = {
	bayer2: [0, 2, 3, 1],
	bayer4: [
		0, 8, 2, 10,
		12, 4, 14, 6,
		3, 11, 1, 9,
		15, 7, 13, 5,
	],
	bayer8: [
		0, 32, 8, 40, 2, 34, 10, 42,
		48, 16, 56, 24, 50, 18, 58, 26,
		12, 44, 4, 36, 14, 46, 6, 38,
		60, 28, 52, 20, 62, 30, 54, 22,
		3, 35, 11, 43, 1, 33, 9, 41,
		51, 19, 59, 27, 49, 17, 57, 25,
		15, 47, 7, 39, 13, 45, 5, 37,
		63, 31, 55, 23, 61, 29, 53, 21,
	],
};

export const BAYER_MATRIX_OPTIONS = [
	{ id: "bayer2", label: "Bayer 2×2" },
	{ id: "bayer4", label: "Bayer 4×4" },
	{ id: "bayer8", label: "Bayer 8×8" },
] as const;

export type BayerMatrixId = (typeof BAYER_MATRIX_OPTIONS)[number]["id"];

/** Normalized threshold matrices used by gradients and the ordered filter. */
export const BAYER_THRESHOLDS: Record<BayerMatrixId, Float32Array> = {
	bayer2: new Float32Array(BAYER_VALUES.bayer2.map((value) => (value + 0.5) / 4)),
	bayer4: new Float32Array(
		BAYER_VALUES.bayer4.map((value) => (value + 0.5) / 16),
	),
	bayer8: new Float32Array(
		BAYER_VALUES.bayer8.map((value) => (value + 0.5) / 64),
	),
};

export const BAYER_SIZES: Record<BayerMatrixId, number> = {
	bayer2: 2,
	bayer4: 4,
	bayer8: 8,
};

function bayerMask(size: 4 | 8): PixelMask {
	const values =
		size === 4 ? BAYER_VALUES.bayer4 : BAYER_VALUES.bayer8;
	const threshold = (size * size) / 2;
	const mask = createMask(size, size);
	for (let index = 0; index < values.length; index++) {
		if (values[index]! < threshold) mask.data[index] = 1;
	}
	return mask;
}

export const BUILTIN_DITHER_PATTERNS: readonly DitherPattern[] = [
	{
		id: "builtin.checker",
		name: "Checkerboard",
		builtin: true,
		mask: maskFromRows(["#.", ".#"]),
	},
	{
		id: "builtin.sparse25",
		name: "Sparse 25%",
		builtin: true,
		mask: maskFromRows(["#...", "..#.", "...#", ".#.."]),
	},
	{
		id: "builtin.dense75",
		name: "Dense 75%",
		builtin: true,
		mask: maskFromRows([".###", "##.#", "###.", "#.##"]),
	},
	{
		id: "builtin.lines-h",
		name: "Horizontal lines",
		builtin: true,
		mask: maskFromRows(["##", ".."]),
	},
	{
		id: "builtin.lines-v",
		name: "Vertical lines",
		builtin: true,
		mask: maskFromRows(["#.", "#."]),
	},
	{
		id: "builtin.diagonal",
		name: "Diagonal",
		builtin: true,
		mask: maskFromRows(["#...", ".#..", "..#.", "...#"]),
	},
	{
		id: "builtin.bayer4",
		name: "Bayer 4×4 (50%)",
		builtin: true,
		mask: bayerMask(4),
	},
	{
		id: "builtin.bayer8",
		name: "Bayer 8×8 (50%)",
		builtin: true,
		mask: bayerMask(8),
	},
];

/** Positive modulo so negative offsets keep the tile phase stable. */
function positiveMod(value: number, modulus: number): number {
	const result = value % modulus;
	return result < 0 ? result + modulus : result;
}

export function ditherPatternAt(
	pattern: DitherPattern,
	x: number,
	y: number,
	offsetX = 0,
	offsetY = 0,
): number {
	const px = positiveMod(x + offsetX, pattern.mask.width);
	const py = positiveMod(y + offsetY, pattern.mask.height);
	return pattern.mask.data[py * pattern.mask.width + px] ?? 0;
}

/**
 * Returns whether a pixel passes the live dither mask. Canvas alignment keeps
 * the pattern anchored to the artwork; brush alignment moves the phase with the
 * current stamp, which is useful for textured strokes.
 */
export function ditherAllows(
	sampler: DitherSampler,
	x: number,
	y: number,
	localX: number,
	localY: number,
): boolean {
	const sampleX = sampler.align === "canvas" ? x : localX;
	const sampleY = sampler.align === "canvas" ? y : localY;
	return (
		ditherPatternAt(
			sampler.pattern,
			Math.floor(sampleX),
			Math.floor(sampleY),
			sampler.offsetX,
			sampler.offsetY,
		) !== 0
	);
}

/** Creates a checkerboard draft for the pattern editor. */
export function checkerDitherPattern(size = 4): PixelMask {
	const mask = createMask(size, size);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if ((x + y) % 2 === 0) mask.data[y * size + x] = 1;
		}
	}
	return mask;
}
