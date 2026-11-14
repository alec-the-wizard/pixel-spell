import { packColor } from "./color.js";

export type PaletteCycleDirection = "forward" | "reverse" | "ping-pong";

export interface PaletteCycleRange {
	/** Inclusive first palette index. */
	start: number;
	/** Inclusive last palette index. */
	end: number;
}

export const PALETTE_CYCLE_SPEEDS = [50, 80, 120, 200, 350, 500] as const;
export const DEFAULT_PALETTE_CYCLE_MS = 120;

/** Palette positions covered by a cycle range. */
export function paletteCycleLength(range: PaletteCycleRange): number {
	return Math.max(0, range.end - range.start + 1);
}

/**
 * Converts a monotonically increasing tick into the palette color offset for
 * the selected direction. Ping-pong travels forward and back without
 * repeating the endpoints.
 */
export function paletteShiftForStep(
	step: number,
	length: number,
	direction: PaletteCycleDirection,
): number {
	if (length < 2) return 0;
	const period = direction === "ping-pong" ? length * 2 - 2 : length;
	const tick = ((step % period) + period) % period;

	if (direction === "reverse") return (length - tick) % length;
	if (direction === "ping-pong") {
		return tick < length ? tick : period - tick;
	}
	return tick;
}

/**
 * Maps packed RGB values in the cycle range to the color they should display
 * at the current offset. Alpha is preserved by the caller, so the keys and
 * values only carry the low 24 bits.
 */
export function buildPaletteCycleMap(
	colors: string[],
	range: PaletteCycleRange,
	shift: number,
): Map<number, number> | null {
	const length = paletteCycleLength(range);
	if (length < 2 || shift === 0) return null;

	const map = new Map<number, number>();
	for (let offset = 0; offset < length; offset++) {
		const source = colors[range.start + offset];
		const target = colors[range.start + ((offset + shift) % length)];
		if (!source || !target || source === target) continue;
		map.set(packColor(source) & 0x00ffffff, packColor(target) & 0x00ffffff);
	}
	return map.size > 0 ? map : null;
}

/**
 * Applies a palette cycle map to a composited pixel buffer without touching
 * the source. Pass a reusable target buffer to avoid allocating on every tick.
 */
export function remapPalettePixels(
	source: Uint32Array,
	map: Map<number, number>,
	target?: Uint32Array,
): Uint32Array {
	const output =
		target && target.length >= source.length
			? target
			: new Uint32Array(source.length);

	for (let index = 0; index < source.length; index++) {
		const value = source[index]!;
		const alpha = value >>> 24;
		if (alpha === 0) {
			output[index] = 0;
			continue;
		}
		const mapped = map.get(value & 0x00ffffff);
		output[index] =
			mapped === undefined ? value : ((alpha << 24) | mapped) >>> 0;
	}
	return output;
}
