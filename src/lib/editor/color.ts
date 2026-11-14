export interface Rgb {
	r: number;
	g: number;
	b: number;
}

export interface Rgba extends Rgb {
	a: number;
}

const HEX_RE = /^#?([0-9a-f]{6})$/i;

/** Accepts `#rrggbb` or `rrggbb` and returns a normalized lowercase hex color. */
export function normalizeHex(input: string): string | null {
	const match = input.trim().match(HEX_RE);
	return match ? `#${match[1].toLowerCase()}` : null;
}

export function hexToRgb(hex: string): Rgb {
	const normalized = normalizeHex(hex) ?? "#000000";
	const value = Number.parseInt(normalized.slice(1), 16);
	return {
		r: (value >> 16) & 0xff,
		g: (value >> 8) & 0xff,
		b: value & 0xff,
	};
}

export function rgbToHex(r: number, g: number, b: number): string {
	const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
	return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;
}

/** Packs a hex color and alpha into the editor's little-endian RGBA buffer format. */
export function packColor(hex: string, alpha = 255): number {
	const { r, g, b } = hexToRgb(hex);
	return (((alpha & 0xff) << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export function unpackColor(value: number): Rgba {
	return {
		r: value & 0xff,
		g: (value >>> 8) & 0xff,
		b: (value >>> 16) & 0xff,
		a: (value >>> 24) & 0xff,
	};
}

export function isTransparent(value: number): boolean {
	return (value >>> 24) === 0;
}

export function colorWithAlpha(hex: string, alpha: number): string {
	const { r, g, b } = hexToRgb(hex);
	const a = Math.max(0, Math.min(1, alpha));
	return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export interface Hsv {
	/** Hue in degrees, 0..360. */
	h: number;
	/** Saturation, 0..1. */
	s: number;
	/** Value/brightness, 0..1. */
	v: number;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const delta = max - min;

	let h = 0;
	if (delta !== 0) {
		if (max === rn) h = ((gn - bn) / delta) % 6;
		else if (max === gn) h = (bn - rn) / delta + 2;
		else h = (rn - gn) / delta + 4;
		h *= 60;
		if (h < 0) h += 360;
	}

	return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export interface Oklab {
	/** Perceptual lightness, 0..1. */
	l: number;
	/** Green/red axis. */
	a: number;
	/** Blue/yellow axis. */
	b: number;
}

function srgbToLinear(channel: number): number {
	const value = channel / 255;
	return value <= 0.04045
		? value / 12.92
		: ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
	const value = Math.max(0, Math.min(1, channel));
	return (
		255 *
		(value <= 0.0031308
			? value * 12.92
			: 1.055 * value ** (1 / 2.4) - 0.055)
	);
}

/** Converts sRGB to OKLab for perceptual interpolation and color matching. */
export function rgbToOklab({ r, g, b }: Rgb): Oklab {
	const red = srgbToLinear(r);
	const green = srgbToLinear(g);
	const blue = srgbToLinear(b);

	const l = Math.cbrt(
		0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
	);
	const m = Math.cbrt(
		0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
	);
	const s = Math.cbrt(
		0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
	);

	return {
		l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	};
}

/** Converts an OKLab color back to sRGB. */
export function oklabToRgb({ l, a, b }: Oklab): Rgb {
	const lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
	const mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
	const sRoot = l - 0.0894841775 * a - 1.291485548 * b;

	const lCube = lRoot ** 3;
	const mCube = mRoot ** 3;
	const sCube = sRoot ** 3;

	return {
		r: linearToSrgb(
			4.0767416621 * lCube -
				3.3077115913 * mCube +
				0.2309699292 * sCube,
		),
		g: linearToSrgb(
			-1.2684380046 * lCube +
				2.6097574011 * mCube -
				0.3413193965 * sCube,
		),
		b: linearToSrgb(
			-0.0041960863 * lCube -
				0.7034186147 * mCube +
				1.707614701 * sCube,
		),
	};
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
	const hue = ((h % 360) + 360) % 360;
	const saturation = Math.max(0, Math.min(1, s));
	const value = Math.max(0, Math.min(1, v));
	const chroma = value * saturation;
	const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = value - chroma;

	let rp = 0;
	let gp = 0;
	let bp = 0;
	if (hue < 60) {
		rp = chroma;
		gp = x;
	} else if (hue < 120) {
		rp = x;
		gp = chroma;
	} else if (hue < 180) {
		gp = chroma;
		bp = x;
	} else if (hue < 240) {
		gp = x;
		bp = chroma;
	} else if (hue < 300) {
		rp = x;
		bp = chroma;
	} else {
		rp = chroma;
		bp = x;
	}

	return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}
