/**
 * Workspace grid presentation settings and the pure canvas renderer shared by
 * the canvas stage and the grid settings dialog.
 *
 * The main grid is independent of the pixel grid: the pixel grid always
 * separates individual document pixels, while the main grid can be square,
 * isometric, or hexagonal and carries its own size and offset.
 */

export type GridMode = "square" | "isometric" | "hexagonal";
export type HexGridOrientation = "pointy" | "flat";

export interface GridSettings {
	/** Main grid visibility. */
	enabled: boolean;
	/** Pixel grid visibility, independent of the main grid. */
	pixelEnabled: boolean;
	mode: GridMode;
	/** Cell width (horizontal size) in document pixels. */
	width: number;
	/** Cell height (vertical size) in document pixels. */
	height: number;
	/** Grid origin offset in document pixels. */
	offsetX: number;
	offsetY: number;
	hexOrientation: HexGridOrientation;
}

export const GRID_MIN_SIZE = 1;
export const GRID_MAX_SIZE = 64;
export const GRID_MAX_OFFSET = 4096;
/** A grid cell must be at least this many screen pixels wide to be useful. */
export const MIN_GRID_SCREEN_STEP = 6;
/** The pixel grid appears only once each pixel is this many screen pixels. */
export const MIN_PIXEL_GRID_ZOOM = 6;
/** Avoid pathological paints on very large canvases with tiny hex cells. */
const MAX_HEX_CELLS = 120_000;

export const GRID_STORAGE_KEY = "pixel-spell-grid";

export const DEFAULT_GRID_SETTINGS: GridSettings = {
	enabled: false,
	pixelEnabled: true,
	mode: "square",
	width: 8,
	height: 8,
	offsetX: 0,
	offsetY: 0,
	hexOrientation: "pointy",
};

const mod = (value: number, span: number): number => ((value % span) + span) % span;

export function normalizeGridSize(value: unknown, fallback = 8): number {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.max(GRID_MIN_SIZE, Math.min(GRID_MAX_SIZE, Math.round(number)));
}

export function normalizeGridOffset(value: unknown, fallback = 0): number {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.max(-GRID_MAX_OFFSET, Math.min(GRID_MAX_OFFSET, Math.round(number)));
}

export function normalizeGridMode(value: unknown): GridMode {
	return value === "isometric" || value === "hexagonal" ? value : "square";
}

export function normalizeHexOrientation(value: unknown): HexGridOrientation {
	return value === "flat" ? "flat" : "pointy";
}

export function normalizeGridSettings(value: unknown): GridSettings {
	const source =
		value && typeof value === "object"
			? (value as Partial<Record<keyof GridSettings, unknown>>)
			: {};
	return {
		enabled:
			typeof source.enabled === "boolean"
				? source.enabled
				: DEFAULT_GRID_SETTINGS.enabled,
		pixelEnabled:
			typeof source.pixelEnabled === "boolean"
				? source.pixelEnabled
				: DEFAULT_GRID_SETTINGS.pixelEnabled,
		mode: normalizeGridMode(source.mode),
		width: normalizeGridSize(source.width, DEFAULT_GRID_SETTINGS.width),
		height: normalizeGridSize(source.height, DEFAULT_GRID_SETTINGS.height),
		offsetX: normalizeGridOffset(source.offsetX, DEFAULT_GRID_SETTINGS.offsetX),
		offsetY: normalizeGridOffset(source.offsetY, DEFAULT_GRID_SETTINGS.offsetY),
		hexOrientation: normalizeHexOrientation(source.hexOrientation),
	};
}

/** Read workspace grid preferences from local storage. */
export function loadGridSettings(): GridSettings {
	try {
		const raw = localStorage.getItem(GRID_STORAGE_KEY);
		if (!raw) return { ...DEFAULT_GRID_SETTINGS };
		return normalizeGridSettings(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_GRID_SETTINGS };
	}
}

/** Persist workspace grid preferences. Storage failures are non-fatal. */
export function saveGridSettings(settings: GridSettings): void {
	try {
		localStorage.setItem(GRID_STORAGE_KEY, JSON.stringify(settings));
	} catch {
		// Storage can be unavailable in private browsing contexts.
	}
}

export interface GridDrawOptions {
	/** Document width in pixels. */
	width: number;
	/** Document height in pixels. */
	height: number;
	/** Screen pixels per document pixel. */
	zoom: number;
	devicePixelRatio: number;
	settings: GridSettings;
	gridColor: string;
	pixelColor: string;
}

/**
 * Redraw the whole grid overlay. The canvas buffer is sized by the caller and
 * drawing happens in document coordinates, so the grid follows canvas zoom and
 * rotation without extra math.
 */
export function drawGridOverlay(
	context: CanvasRenderingContext2D,
	options: GridDrawOptions,
): void {
	const { width, height, zoom, devicePixelRatio, settings } = options;
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, context.canvas.width, context.canvas.height);
	if (width <= 0 || height <= 0 || zoom <= 0) return;

	context.setTransform(devicePixelRatio * zoom, 0, 0, devicePixelRatio * zoom, 0, 0);
	// Center one screen-pixel strokes on the integer boundaries so they stay
	// crisp at every device-pixel ratio.
	context.translate(0.5 / zoom, 0.5 / zoom);
	context.lineWidth = 1 / zoom;
	context.lineCap = "butt";
	context.lineJoin = "miter";

	if (settings.pixelEnabled && zoom >= MIN_PIXEL_GRID_ZOOM) {
		context.beginPath();
		for (let x = 1; x < width; x++) {
			context.moveTo(x, 0);
			context.lineTo(x, height);
		}
		for (let y = 1; y < height; y++) {
			context.moveTo(0, y);
			context.lineTo(width, y);
		}
		context.strokeStyle = options.pixelColor;
		context.stroke();
	}

	if (!settings.enabled) return;
	if (Math.min(settings.width, settings.height) * zoom < MIN_GRID_SCREEN_STEP) {
		return;
	}

	context.strokeStyle = options.gridColor;
	context.beginPath();
	if (settings.mode === "square") {
		strokeSquareGrid(context, width, height, settings);
	} else if (settings.mode === "isometric") {
		strokeIsometricGrid(context, width, height, settings);
	} else {
		strokeHexGrid(context, width, height, settings);
	}
	context.stroke();
}

function strokeSquareGrid(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	settings: GridSettings,
): void {
	const stepX = settings.width;
	const stepY = settings.height;
	const startX = mod(settings.offsetX, stepX);
	const startY = mod(settings.offsetY, stepY);
	for (let x = startX; x < width; x += stepX) {
		context.moveTo(x, 0);
		context.lineTo(x, height);
	}
	for (let y = startY; y < height; y += stepY) {
		context.moveTo(0, y);
		context.lineTo(width, y);
	}
}

function strokeIsometricGrid(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	settings: GridSettings,
): void {
	const tileWidth = settings.width;
	const tileHeight = settings.height;
	const slope = tileHeight / tileWidth;
	const originX = mod(settings.offsetX, tileWidth);
	const originY = mod(settings.offsetY, tileHeight);

	// Rising edges: y = slope * (x - originX) + originY + k * tileHeight.
	const risingBase = originY - slope * originX;
	const risingStart = Math.floor((-slope * width - risingBase) / tileHeight);
	const risingEnd = Math.ceil((height - risingBase) / tileHeight);
	for (let k = risingStart; k <= risingEnd; k++) {
		const intercept = risingBase + k * tileHeight;
		context.moveTo(0, intercept);
		context.lineTo(width, slope * width + intercept);
	}

	// Falling edges: y = -slope * (x - originX) + originY + k * tileHeight.
	const fallingBase = originY + slope * originX;
	const fallingStart = Math.floor(-fallingBase / tileHeight);
	const fallingEnd = Math.ceil((height + slope * width - fallingBase) / tileHeight);
	for (let k = fallingStart; k <= fallingEnd; k++) {
		const intercept = fallingBase + k * tileHeight;
		context.moveTo(0, intercept);
		context.lineTo(width, -slope * width + intercept);
	}
}

function strokeHexGrid(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	settings: GridSettings,
): void {
	const hexWidth = settings.width;
	const hexHeight = settings.height;
	const pointy = settings.hexOrientation === "pointy";

	const columnStep = pointy ? hexWidth : hexWidth * 0.75;
	const rowStep = pointy ? hexHeight * 0.75 : hexHeight;
	const columns = Math.ceil(width / columnStep) + 5;
	const rows = Math.ceil(height / rowStep) + 5;
	if (columns * rows > MAX_HEX_CELLS) return;

	const originX = mod(settings.offsetX, pointy ? hexWidth : columnStep);
	const originY = mod(settings.offsetY, pointy ? rowStep : hexHeight);

	for (let row = -2; row <= rows; row++) {
		const rowY = originY + row * rowStep;
		if (pointy) {
			const shift = mod(row, 2) === 1 ? hexWidth / 2 : 0;
			for (let column = -2; column <= columns; column++) {
				addPointyHex(
					context,
					originX + column * hexWidth + shift,
					rowY,
					hexWidth,
					hexHeight,
				);
			}
		} else {
			for (let column = -2; column <= columns; column++) {
				const shift = mod(column, 2) === 1 ? hexHeight / 2 : 0;
				addFlatHex(
					context,
					originX + column * columnStep,
					rowY + shift,
					hexWidth,
					hexHeight,
				);
			}
		}
	}
}

/**
 * Draw three consecutive edges of one pointy-top hex. Adjacent hexes draw the
 * complementary edges, so every edge appears exactly once across the lattice.
 */
function addPointyHex(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
): void {
	const halfWidth = width / 2;
	const halfHeight = height / 2;
	const quarterHeight = height / 4;
	// Top vertex, upper-right, lower-right, bottom.
	const topX = x;
	const topY = y - halfHeight;
	const upperRightX = x + halfWidth;
	const upperRightY = y - quarterHeight;
	const lowerRightX = x + halfWidth;
	const lowerRightY = y + quarterHeight;
	const bottomX = x;
	const bottomY = y + halfHeight;
	context.moveTo(topX, topY);
	context.lineTo(upperRightX, upperRightY);
	context.moveTo(upperRightX, upperRightY);
	context.lineTo(lowerRightX, lowerRightY);
	context.moveTo(lowerRightX, lowerRightY);
	context.lineTo(bottomX, bottomY);
}

/** Counterpart to `addPointyHex` for flat-top hexagons. */
function addFlatHex(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
): void {
	const halfWidth = width / 2;
	const halfHeight = height / 2;
	const quarterWidth = width / 4;
	// Top-left, top-right, right, bottom-right.
	const topLeftX = x - quarterWidth;
	const topLeftY = y - halfHeight;
	const topRightX = x + quarterWidth;
	const topRightY = y - halfHeight;
	const rightX = x + halfWidth;
	const rightY = y;
	const bottomRightX = x + quarterWidth;
	const bottomRightY = y + halfHeight;
	context.moveTo(topLeftX, topLeftY);
	context.lineTo(topRightX, topRightY);
	context.moveTo(topRightX, topRightY);
	context.lineTo(rightX, rightY);
	context.moveTo(rightX, rightY);
	context.lineTo(bottomRightX, bottomRightY);
}
