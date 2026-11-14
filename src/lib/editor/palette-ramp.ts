import {
	hexToRgb,
	hsvToRgb,
	normalizeHex,
	oklabToRgb,
	rgbToHex,
	rgbToHsv,
	rgbToOklab,
} from "./color.js";

/**
 * Interpolation space for palette ramps.
 *
 * `rgb` blends gamma-encoded sRGB channels (the classic pixel-art ramp),
 * `hsv` travels through the shortest hue arc, and `oklab` blends perceptual
 * lightness and chroma.
 */
export type RampSpace = "rgb" | "hsv" | "oklab";

export const MIN_RAMP_STEPS = 2;
export const MAX_RAMP_STEPS = 16;

function clampSteps(steps: number): number {
	if (!Number.isFinite(steps)) return 2;
	return Math.max(MIN_RAMP_STEPS, Math.min(MAX_RAMP_STEPS, Math.round(steps)));
}

/**
 * Generates a palette ramp that includes both endpoint colors. The result
 * always starts with `start` and ends with `end`, even when rounding would
 * otherwise drift from the requested colors.
 */
export function generatePaletteRamp(
	start: string,
	end: string,
	steps = 6,
	space: RampSpace = "rgb",
): string[] {
	const startHex = normalizeHex(start) ?? "#000000";
	const endHex = normalizeHex(end) ?? "#000000";
	const count = clampSteps(steps);
	if (count <= 2) return [startHex, endHex];

	const startRgb = hexToRgb(startHex);
	const endRgb = hexToRgb(endHex);
	const colors: string[] = [startHex];

	if (space === "hsv") {
		const from = rgbToHsv(startRgb);
		const to = rgbToHsv(endRgb);
		// Achromatic colors have no meaningful hue. Keep the other endpoint's
		// hue so black-to-red and white-to-blue ramps stay clean.
		const fromHue = from.s === 0 ? to.h : from.h;
		const toHue = to.s === 0 ? from.h : to.h;
		let delta = toHue - fromHue;
		if (delta > 180) delta -= 360;
		else if (delta < -180) delta += 360;

		for (let index = 1; index < count - 1; index++) {
			const t = index / (count - 1);
			const rgb = hsvToRgb(
				fromHue + delta * t,
				from.s + (to.s - from.s) * t,
				from.v + (to.v - from.v) * t,
			);
			colors.push(rgbToHex(rgb.r, rgb.g, rgb.b));
		}
	} else if (space === "oklab") {
		const from = rgbToOklab(startRgb);
		const to = rgbToOklab(endRgb);
		for (let index = 1; index < count - 1; index++) {
			const t = index / (count - 1);
			const rgb = oklabToRgb({
				l: from.l + (to.l - from.l) * t,
				a: from.a + (to.a - from.a) * t,
				b: from.b + (to.b - from.b) * t,
			});
			colors.push(rgbToHex(rgb.r, rgb.g, rgb.b));
		}
	} else {
		for (let index = 1; index < count - 1; index++) {
			const t = index / (count - 1);
			colors.push(
				rgbToHex(
					startRgb.r + (endRgb.r - startRgb.r) * t,
					startRgb.g + (endRgb.g - startRgb.g) * t,
					startRgb.b + (endRgb.b - startRgb.b) * t,
				),
			);
		}
	}

	colors.push(endHex);
	return colors;
}
