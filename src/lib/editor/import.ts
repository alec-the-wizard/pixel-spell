import { MAX_CANVAS_SIZE } from "./canvas.js";
import { normalizeHex, rgbToHex } from "./color.js";
import { MAX_PALETTE_COLORS } from "./palette.js";

/** Raster image formats that browsers can generally decode in a canvas. */
export const IMAGE_IMPORT_EXTENSIONS = [
	"png",
	"apng",
	"jpg",
	"jpeg",
	"jfif",
	"gif",
	"webp",
	"bmp",
	"avif",
	"ico",
	"svg",
] as const;

const IMAGE_EXTENSIONS = new Set<string>(IMAGE_IMPORT_EXTENSIONS);
const PALETTE_EXTENSIONS = new Set(["pal", "gpl", "hex"]);

export const IMAGE_IMPORT_ACCEPT = IMAGE_IMPORT_EXTENSIONS.map(
	(extension) => `.${extension}`,
).join(",");

export const IMPORT_ACCEPT = [...IMAGE_IMPORT_EXTENSIONS, ...PALETTE_EXTENSIONS]
	.map((extension) => `.${extension}`)
	.join(",");

/** Imported images are cropped to this many pixels in each dimension. */
export const MAX_IMPORT_DIMENSION = MAX_CANVAS_SIZE;

/** Reject huge files before decoding them in memory. */
export const MAX_IMPORT_FILE_BYTES = 64 * 1024 * 1024;

/** Anything longer than this is pasted garbage rather than an image link. */
export const MAX_IMPORT_URL_LENGTH = 2048;

/** A stalled download should not leave the import dialog spinning forever. */
const URL_FETCH_TIMEOUT_MS = 20_000;

/**
 * Palette extraction is exact for normal-sized images. Very large images are
 * sampled down so a single import cannot lock up the tab. Bands span the full
 * width so colors stay in true top-to-bottom, left-to-right appearance order.
 */
const MAX_PALETTE_SCAN_PIXELS = 32_000_000;
const MAX_PALETTE_SCAN_DIMENSION = 8192;
const PALETTE_SCAN_BAND_HEIGHT = 128;

export type ImportTabId =
	| "project"
	| "layer"
	| "frames"
	| "reference-board"
	| "palette";

export interface ImportProjectData {
	name: string;
	/** Cropped, importable dimensions (never larger than MAX_IMPORT_DIMENSION). */
	width: number;
	height: number;
	originalWidth: number;
	originalHeight: number;
	/** Packed little-endian RGBA in the editor's cel format. */
	pixels: Uint32Array;
	/** Object URL for the original file, owned by the import dialog. */
	previewUrl: string;
}

export interface ImportPaletteData {
	name: string;
	colors: string[];
	/** True when the source had more than MAX_PALETTE_COLORS unique colors. */
	truncated: boolean;
	source: "png" | "pal" | "gpl" | "hex";
}

/** The original image bytes and a canvas-ready buffer for reference images. */
export interface ImportReferenceData {
	name: string;
	bytes: Uint8Array;
	mime: string;
	/** Natural source dimensions. */
	width: number;
	height: number;
	/**
	 * The complete image fitted inside MAX_IMPORT_DIMENSION without cropping.
	 * Used when creating brushes or dither patterns from the source image.
	 */
	pixels: Uint32Array;
	pixelWidth: number;
	pixelHeight: number;
}

export interface ImportAnalysis {
	fileName: string;
	project: ImportProjectData | null;
	reference: ImportReferenceData | null;
	palette: ImportPaletteData | null;
	error: string | null;
}

interface ParsedPalette {
	name?: string;
	colors: string[];
	truncated: boolean;
}

interface DecodedImage {
	source: ImageBitmap | HTMLImageElement;
	width: number;
	height: number;
	previewUrl: string;
	close: () => void;
}

const UNSUPPORTED_MESSAGE =
	"This file type can't be imported. Choose an image (PNG, JPEG, GIF, WebP, BMP, AVIF, ICO, SVG) or a palette (JASC .pal, GIMP .gpl, or .hex).";

function fileExtension(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? name;
	const dot = base.lastIndexOf(".");
	return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Best-effort file stem for a URL, used as the default import name. */
function nameFromUrl(url: URL): string {
	let segment = url.pathname.split("/").filter(Boolean).pop() ?? "";
	try {
		segment = decodeURIComponent(segment);
	} catch {
		// Keep the encoded segment when it is not valid percent-encoding.
	}
	const dot = segment.lastIndexOf(".");
	const stem = (dot > 0 ? segment.slice(0, dot) : segment).trim();
	return stem || url.hostname || "Imported";
}

function startsWithBytes(bytes: Uint8Array, signature: number[]): boolean {
	if (bytes.length < signature.length) return false;
	return signature.every((byte, index) => bytes[index] === byte);
}

function startsWithText(bytes: Uint8Array, text: string): boolean {
	if (bytes.length < text.length) return false;
	for (let index = 0; index < text.length; index++) {
		if (String.fromCharCode(bytes[index]!).toLowerCase() !== text[index]) return false;
	}
	return true;
}

/**
 * Detects common raster formats from their magic bytes. Some hosts serve an
 * `application/octet-stream` body or a URL without a file extension, so the
 * declared type alone is not always enough.
 */
function sniffImageExtension(bytes: Uint8Array): string {
	if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return "png";
	}
	if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "jpg";
	if (startsWithText(bytes, "gif8")) return "gif";
	if (startsWithText(bytes, "riff") && startsWithText(bytes.subarray(8), "webp")) {
		return "webp";
	}
	if (startsWithText(bytes, "bm")) return "bmp";
	if (startsWithBytes(bytes, [0x00, 0x00, 0x01, 0x00])) return "ico";
	if (startsWithText(bytes.subarray(4), "ftypavif") || startsWithText(bytes.subarray(4), "ftypavis")) {
		return "avif";
	}
	if (startsWithText(bytes, "<?xml") || startsWithText(bytes, "<svg")) return "svg";
	return "";
}

function mimeExtension(type: string): string {
	switch (type.toLowerCase()) {
		case "image/png":
			return "png";
		case "image/jpeg":
			return "jpg";
		case "image/gif":
			return "gif";
		case "image/webp":
			return "webp";
		case "image/bmp":
			return "bmp";
		case "image/avif":
			return "avif";
		case "image/x-icon":
		case "image/vnd.microsoft.icon":
			return "ico";
		case "image/svg+xml":
			return "svg";
		default:
			return "";
	}
}

function resolvedExtension(file: File): string {
	return fileExtension(file.name) || mimeExtension(file.type);
}

function resolvedMime(file: File, extension: string): string {
	if (file.type) return file.type;
	switch (extension) {
		case "png":
			return "image/png";
		case "apng":
			return "image/apng";
		case "jpg":
		case "jpeg":
		case "jfif":
			return "image/jpeg";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "bmp":
			return "image/bmp";
		case "avif":
			return "image/avif";
		case "ico":
			return "image/x-icon";
		case "svg":
			return "image/svg+xml";
		default:
			return "application/octet-stream";
	}
}

/** File name without its extension, used as the default import name. */
export function importNameFromFile(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? name;
	const dot = base.lastIndexOf(".");
	const stem = dot > 0 ? base.slice(0, dot) : base;
	return stem.trim() || "Imported";
}

async function decodeImage(file: File): Promise<DecodedImage> {
	const previewUrl = URL.createObjectURL(file);

	try {
		if (typeof createImageBitmap === "function") {
			const bitmap = await createImageBitmap(file);
			if (bitmap.width > 0 && bitmap.height > 0) {
				return {
					source: bitmap,
					width: bitmap.width,
					height: bitmap.height,
					previewUrl,
					close: () => bitmap.close(),
				};
			}
			bitmap.close();
		}
	} catch {
		// Some formats (notably SVG in some browsers) only work through <img>.
	}

	try {
		const image = new Image();
		image.decoding = "async";
		image.src = previewUrl;
		await image.decode();
		const width = image.naturalWidth || image.width;
		const height = image.naturalHeight || image.height;
		if (width <= 0 || height <= 0) throw new Error("Image has no dimensions");
		return {
			source: image,
			width,
			height,
			previewUrl,
			close: () => {},
		};
	} catch (error) {
		URL.revokeObjectURL(previewUrl);
		throw error;
	}
}

function readProjectPixels(
	source: CanvasImageSource,
	width: number,
	height: number,
): { width: number; height: number; pixels: Uint32Array } {
	const cropWidth = Math.max(1, Math.min(width, MAX_IMPORT_DIMENSION));
	const cropHeight = Math.max(1, Math.min(height, MAX_IMPORT_DIMENSION));

	const canvas = document.createElement("canvas");
	canvas.width = cropWidth;
	canvas.height = cropHeight;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("Canvas 2D is not available");

	context.imageSmoothingEnabled = false;
	context.drawImage(source, 0, 0, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

	const image = context.getImageData(0, 0, cropWidth, cropHeight);
	// The ImageData buffer is local to this function and already exactly the
	// size we need, so return a view instead of copying it a second time.
	const pixels = new Uint32Array(
		image.data.buffer,
		image.data.byteOffset,
		cropWidth * cropHeight,
	);

	return { width: cropWidth, height: cropHeight, pixels };
}

/**
 * Reads the whole image, scaled down to fit within `maxDimension`. Unlike
 * `readProjectPixels` this never crops the image, so the full source is
 * available when creating brushes, dither patterns, or board references.
 */
function readFittedPixels(
	source: CanvasImageSource,
	width: number,
	height: number,
	maxDimension: number,
): { width: number; height: number; pixels: Uint32Array } {
	const scale = Math.min(1, maxDimension / width, maxDimension / height);
	const fittedWidth = Math.max(1, Math.round(width * scale));
	const fittedHeight = Math.max(1, Math.round(height * scale));

	const canvas = document.createElement("canvas");
	canvas.width = fittedWidth;
	canvas.height = fittedHeight;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("Canvas 2D is not available");

	context.imageSmoothingEnabled = false;
	context.drawImage(
		source,
		0,
		0,
		width,
		height,
		0,
		0,
		fittedWidth,
		fittedHeight,
	);

	const image = context.getImageData(0, 0, fittedWidth, fittedHeight);
	const pixels = new Uint32Array(
		image.data.buffer,
		image.data.byteOffset,
		fittedWidth * fittedHeight,
	);
	return { width: fittedWidth, height: fittedHeight, pixels };
}

function collectPaletteColors(
	source: CanvasImageSource,
	width: number,
	height: number,
): { colors: string[]; truncated: boolean } {
	const colors: string[] = [];
	const seen = new Set<number>();
	let truncated = false;

	const totalPixels = width * height;
	const scale = Math.min(
		1,
		Math.sqrt(MAX_PALETTE_SCAN_PIXELS / totalPixels),
		MAX_PALETTE_SCAN_DIMENSION / width,
		MAX_PALETTE_SCAN_DIMENSION / height,
	);
	const scanWidth = Math.max(1, Math.floor(width * scale));
	const scanHeight = Math.max(1, Math.floor(height * scale));
	const scaleY = height / scanHeight;

	const canvas = document.createElement("canvas");
	canvas.width = scanWidth;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) return { colors, truncated };

	// Full-width bands keep temporary ImageData small while preserving the
	// image's row-major pixel order.
	scan: for (let y = 0; y < scanHeight; y += PALETTE_SCAN_BAND_HEIGHT) {
		const bandHeight = Math.min(PALETTE_SCAN_BAND_HEIGHT, scanHeight - y);
		canvas.height = bandHeight;
		context.imageSmoothingEnabled = false;
		context.drawImage(
			source,
			0,
			y * scaleY,
			width,
			bandHeight * scaleY,
			0,
			0,
			scanWidth,
			bandHeight,
		);

		const data = context.getImageData(0, 0, scanWidth, bandHeight).data;
		for (let index = 0; index < data.length; index += 4) {
			// Fully transparent pixels do not describe a usable palette color.
			if (data[index + 3] === 0) continue;

			const r = data[index]!;
			const g = data[index + 1]!;
			const b = data[index + 2]!;
			const key = (r | (g << 8) | (b << 16)) >>> 0;
			if (seen.has(key)) continue;

			seen.add(key);
			if (colors.length >= MAX_PALETTE_COLORS) {
				truncated = true;
				break scan;
			}
			colors.push(rgbToHex(r, g, b));
		}
	}

	return { colors, truncated };
}

function finalizePalette(rawColors: string[], name?: string): ParsedPalette | null {
	const colors: string[] = [];
	let truncated = false;

	for (const raw of rawColors) {
		const color = normalizeHex(raw);
		if (!color || colors.includes(color)) continue;
		if (colors.length >= MAX_PALETTE_COLORS) {
			truncated = true;
			break;
		}
		colors.push(color);
	}

	if (colors.length === 0) return null;
	return {
		name: name?.trim() || undefined,
		colors,
		truncated,
	};
}

function parseJascPal(text: string): ParsedPalette | null {
	const lines = text
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/)
		.map((line) => line.trim());

	if (lines[0]?.toUpperCase() !== "JASC-PAL") return null;

	const declaredCount = Number.parseInt(lines[2] ?? "", 10);
	const colors: string[] = [];

	for (let index = 3; index < lines.length; index++) {
		const line = lines[index]!;
		if (!line) continue;

		const parts = line.split(/\s+/);
		if (parts.length < 3) continue;

		const r = Number.parseInt(parts[0]!, 10);
		const g = Number.parseInt(parts[1]!, 10);
		const b = Number.parseInt(parts[2]!, 10);
		if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue;

		colors.push(rgbToHex(r, g, b));
		if (Number.isFinite(declaredCount) && colors.length >= declaredCount) break;
	}

	return finalizePalette(colors);
}

function parseGimpGpl(text: string): ParsedPalette | null {
	const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
	if (!/^\s*GIMP Palette/i.test(lines[0] ?? "")) return null;

	let name: string | undefined;
	const colors: string[] = [];

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]!.trim();
		if (!line || line.startsWith("#") || index === 0) continue;

		const nameMatch = /^Name:\s*(.+)$/i.exec(line);
		if (nameMatch) {
			name = nameMatch[1]!.trim();
			continue;
		}
		if (/^Columns:/i.test(line)) continue;

		const parts = line.split(/\s+/);
		if (parts.length < 3) continue;

		const r = Number.parseInt(parts[0]!, 10);
		const g = Number.parseInt(parts[1]!, 10);
		const b = Number.parseInt(parts[2]!, 10);
		if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue;

		colors.push(rgbToHex(r, g, b));
	}

	return finalizePalette(colors, name);
}

function parseHexToken(token: string): string | null {
	let value = token.trim().toLowerCase();
	if (value.startsWith("#")) value = value.slice(1);
	if (value.startsWith("0x")) value = value.slice(2);

	if (/^[0-9a-f]{3}$/.test(value)) {
		return `#${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`;
	}
	if (/^[0-9a-f]{6}$/.test(value)) return `#${value}`;
	// Some tools include an alpha channel; palette entries are opaque hex.
	if (/^[0-9a-f]{8}$/.test(value)) return `#${value.slice(0, 6)}`;

	return null;
}

function parseHexPalette(text: string): ParsedPalette | null {
	const colors: string[] = [];

	for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith(";") || line.startsWith("//")) continue;

		// Accept both "RRGGBB" and "#RRGGBB"; ignore trailing color names.
		const token = line.split(/[\s,]+/)[0]!;
		const color = parseHexToken(token);
		if (color) colors.push(color);
	}

	return finalizePalette(colors);
}

/**
 * Inspects a dropped or selected file and reports every way it can be
 * imported. Files that are not supported return no tabs and an error message.
 */
export async function analyzeImportFile(file: File): Promise<ImportAnalysis> {
	if (file.size > MAX_IMPORT_FILE_BYTES) {
		return {
			fileName: file.name,
			project: null,
			reference: null,
			palette: null,
			error: `This file is larger than ${Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024))} MB. Choose a smaller image or palette.`,
		};
	}

	const extension = resolvedExtension(file);
	const isImage = IMAGE_EXTENSIONS.has(extension);
	const isPalette = PALETTE_EXTENSIONS.has(extension);

	let project: ImportProjectData | null = null;
	let reference: ImportReferenceData | null = null;
	let palette: ImportPaletteData | null = null;
	let error: string | null = null;

	if (isImage) {
		let decoded: DecodedImage | null = null;
		try {
			decoded = await decodeImage(file);
			const cropped = readProjectPixels(decoded.source, decoded.width, decoded.height);
			project = {
				name: importNameFromFile(file.name),
				width: cropped.width,
				height: cropped.height,
				originalWidth: decoded.width,
				originalHeight: decoded.height,
				pixels: cropped.pixels,
				previewUrl: decoded.previewUrl,
			};
			const fitted = readFittedPixels(
				decoded.source,
				decoded.width,
				decoded.height,
				MAX_IMPORT_DIMENSION,
			);
			reference = {
				name: importNameFromFile(file.name),
				bytes: new Uint8Array(await file.arrayBuffer()),
				mime: resolvedMime(file, extension),
				width: decoded.width,
				height: decoded.height,
				pixels: fitted.pixels,
				pixelWidth: fitted.width,
				pixelHeight: fitted.height,
			};

			if (extension === "png") {
				const collected = collectPaletteColors(
					decoded.source,
					decoded.width,
					decoded.height,
				);
				if (collected.colors.length > 0) {
					palette = {
						name: importNameFromFile(file.name),
						colors: collected.colors,
						truncated: collected.truncated,
						source: "png",
					};
				}
			}
		} catch {
			// If decoding or pixel extraction failed there is no project to own
			// the preview URL, so release it immediately.
			if (!project && decoded) URL.revokeObjectURL(decoded.previewUrl);
			error =
				"This image could not be read. It may be corrupted or use a format this browser cannot decode.";
		} finally {
			decoded?.close();
		}
	} else if (isPalette) {
		try {
			const text = await file.text();
			const parsed =
				extension === "gpl"
					? parseGimpGpl(text)
					: extension === "pal"
						? parseJascPal(text)
						: parseHexPalette(text);

			if (parsed) {
				palette = {
					name: parsed.name || importNameFromFile(file.name),
					colors: parsed.colors,
					truncated: parsed.truncated,
					source: extension as "pal" | "gpl" | "hex",
				};
			} else {
				error = `This file could not be read as a ${extension.toUpperCase()} palette.`;
			}
		} catch {
			error = "This palette file could not be read.";
		}
	} else {
		error = UNSUPPORTED_MESSAGE;
	}

	if (!project && !palette) {
		error ??= UNSUPPORTED_MESSAGE;
	}

	return { fileName: file.name, project, reference, palette, error };
}

function failedAnalysis(fileName: string, error: string): ImportAnalysis {
	return { fileName, project: null, reference: null, palette: null, error };
}

/**
 * Downloads an image URL and analyzes it exactly like a dropped file. The
 * browser only exposes pixels for cross-origin responses that opt in to CORS,
 * so hosts that block it produce a readable error instead of a broken import.
 */
export async function analyzeImportUrl(rawUrl: string): Promise<ImportAnalysis> {
	const trimmed = rawUrl.trim();
	if (!trimmed) return failedAnalysis("URL", "Enter an image URL.");
	if (trimmed.length > MAX_IMPORT_URL_LENGTH) {
		return failedAnalysis("URL", "That URL is too long to be an image link.");
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return failedAnalysis(trimmed, "That is not a valid URL. Include http:// or https://.");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return failedAnalysis(trimmed, "Only http:// and https:// image URLs can be imported.");
	}

	const stem = nameFromUrl(url);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			mode: "cors",
			credentials: "omit",
			referrerPolicy: "no-referrer",
			signal: controller.signal,
		});

		if (!response.ok) {
			const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
			return failedAnalysis(stem, `The server returned ${status}.`);
		}

		const blob = await response.blob();
		if (blob.size > MAX_IMPORT_FILE_BYTES) {
			return failedAnalysis(
				stem,
				`This image is larger than ${Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024))} MB. Choose a smaller image.`,
			);
		}

		const bytes = new Uint8Array(await blob.arrayBuffer());
		const urlExtension = fileExtension(url.pathname);
		const knownExtension =
			IMAGE_EXTENSIONS.has(urlExtension) || PALETTE_EXTENSIONS.has(urlExtension)
				? urlExtension
				: "";
		// The declared type and magic bytes describe the payload better than a
		// URL that may end in a query string or a script name.
		const extension =
			mimeExtension(blob.type) || sniffImageExtension(bytes) || knownExtension;
		const fileName = extension ? `${stem}.${extension}` : stem;

		return await analyzeImportFile(
			new File([bytes], fileName, { type: blob.type || undefined }),
		);
	} catch (error) {
		if ((error as { name?: string } | null)?.name === "AbortError") {
			return failedAnalysis(stem, "The image took too long to download.");
		}
		return failedAnalysis(
			stem,
			"This URL could not be loaded. The host may block cross-origin (CORS) requests, so download the image and import the file instead.",
		);
	} finally {
		clearTimeout(timer);
	}
}
