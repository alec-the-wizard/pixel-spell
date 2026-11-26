import {
	type AutosaveRecord,
	deleteAutosave,
	writeAutosave,
} from "./autosave.js";
import {
	MAX_CANVAS_SIZE,
	MIN_CANVAS_SIZE,
	type PixelBounds,
	contentBoundsOf,
	resizePixels,
	scalePixelsNearest,
} from "./canvas.js";
import { isTransparent, normalizeHex, packColor, rgbToHex, unpackColor } from "./color.js";
import {
	MAX_FRAME_DURATION,
	MIN_FRAME_DURATION,
	animationSequence,
	celKey,
	celPropsOf,
	cloneDoc,
	compositeFrame,
	createDoc,
	createGroup,
	createLayer,
	flattenLayersTopFirst,
	frameDurationMs,
	isGroupLayer,
	normalizeAnimationMode,
	uid,
	type LayerRow,
} from "./doc.js";
import { normalizeBlendMode } from "./blend.js";
import {
	MAX_GROUP_EFFECTS,
	applyGroupEffect,
	createGroupEffect,
} from "./group-effects.js";
import {
	MAX_PROJECT_FRAMES,
	MAX_PROJECT_LAYERS,
	parseProject,
	saveProjectFile,
	serializeProject,
	type LoadedProject,
} from "./file.js";
import { desktopApi } from "../desktop/desktop.js";
import {
	DEFAULT_GRID_SETTINGS,
	loadGridSettings,
	normalizeGridOffset,
	normalizeGridSize,
	saveGridSettings,
	type GridMode,
	type GridSettings,
	type HexGridOrientation,
} from "./grid.js";
import { normalizeLayerColor } from "./layer-color.js";
import {
	MAX_REFERENCE_COUNT,
	cropPixelsToCanvas,
	defaultReferencePlacement,
	fitPixelsToCanvas,
} from "./reference.js";
import { selectionBounds } from "./selection.js";
import {
	snapDocToPalette,
	snapHexToPalette,
	snapPixelsToPalette,
	snapRegionToPalette,
} from "./indexed.js";
import { buildTimelapseDoc, type TimelapseBuild } from "./timelapse.js";
import {
	activeBrushPreset,
	brushLibrary,
	createBrushFromImportedPixels,
	createBrushFromSelection,
	findBrush,
	setActiveBrush,
} from "./brush-library.svelte.js";
import { brushMaskFor } from "./brush.js";
import {
	activeDitherPatternPreset,
	setActiveDitherPattern,
} from "./dither-library.svelte.js";
import {
	type DitherAlign,
	type DitherPattern,
	type DitherSampler,
} from "./dither.js";
import type { PixelMask } from "./mask.js";
import type { BrushPreset } from "./brush.js";
import { usesDither, usesPixelPerfect } from "./tools.js";
import { toolLayout } from "./tool-layout.svelte.js";
import {
	DEFAULT_PALETTE_ID,
	MAX_PALETTE_COLORS,
	createDefaultPalette,
	loadPaletteState,
	nearestPaletteColor,
	reorderPaletteColor,
	savePaletteState,
	sortPaletteColors,
	type Palette,
	type PaletteSortMode,
} from "./palette.js";
import {
	DEFAULT_PALETTE_CYCLE_MS,
	buildPaletteCycleMap,
	paletteCyclePeriod,
	paletteShiftForStep,
	remapPalettePixels,
	type PaletteCycleDirection,
	type PaletteCycleRange,
} from "./palette-cycle.js";
import {
	analyzePaletteCoverage,
	unusedPaletteColors,
} from "./palette-analysis.js";
import type {
	AnimationMode,
	BackgroundKind,
	BlendMode,
	CelProps,
	ColorMode,
	ColorSlot,
	EffectScope,
	Frame,
	GradientDither,
	GradientShape,
	GroupEffect,
	GroupEffectKind,
	GroupEffectOptions,
	Layer,
	MirrorAxis,
	MirrorKind,
	PixelDoc,
	Point,
	ProjectTab,
	RadialSymmetry,
	ReferenceImage,
	ShapeKind,
	ToolId,
	ViewportSize,
} from "./types.js";

/** Default number of undo steps kept per project. Workspace-configurable. */
export const DEFAULT_HISTORY_LIMIT = 80;
export const HISTORY_LIMIT_MIN = 10;
export const HISTORY_LIMIT_MAX = 500;
export const HISTORY_LIMIT_KEY = "pixel-spell-history-limit";
/** Keep undo history bounded even for very large documents. */
const HISTORY_BYTE_LIMIT = 128 * 1024 * 1024;

/** Reads the workspace-wide saved-step count from local storage. */
function loadHistoryLimit(): number {
	try {
		const raw = localStorage.getItem(HISTORY_LIMIT_KEY);
		if (!raw) return DEFAULT_HISTORY_LIMIT;
		const value = Number(raw);
		if (!Number.isFinite(value)) return DEFAULT_HISTORY_LIMIT;
		return Math.max(
			HISTORY_LIMIT_MIN,
			Math.min(HISTORY_LIMIT_MAX, Math.round(value)),
		);
	} catch {
		return DEFAULT_HISTORY_LIMIT;
	}
}

/** Persists the workspace-wide saved-step count. Storage failures are non-fatal. */
function saveHistoryLimit(value: number): void {
	try {
		localStorage.setItem(HISTORY_LIMIT_KEY, String(value));
	} catch {
		// Storage can be unavailable in private browsing contexts.
	}
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 64;
/** Zoom limits for the floating preview window. */
export const PREVIEW_ZOOM_MIN = 1;
export const PREVIEW_ZOOM_MAX = 8;

/** Radial symmetry copies include the original stroke point. */
export const RADIAL_SYMMETRY_MIN = 2;
export const RADIAL_SYMMETRY_MAX = 16;

const clamp = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(max, value));

/**
 * Depth of every layer in the flat array, following `parentId` links. Group
 * nodes and their descendants are stored contiguously, so depth lets us reason
 * about subtree extents for reorder/delete/reparent operations.
 */
function layerDepths(layers: readonly Layer[]): number[] {
	const byId = new Map<string, Layer>();
	for (const layer of layers) byId.set(layer.id, layer);
	const memo = new Map<string, number>();
	const depthOf = (id: string): number => {
		const cached = memo.get(id);
		if (cached !== undefined) return cached;
		const layer = byId.get(id);
		if (!layer || !layer.parentId) {
			memo.set(id, 0);
			return 0;
		}
		const depth = depthOf(layer.parentId) + 1;
		memo.set(id, depth);
		return depth;
	};
	return layers.map((layer) => depthOf(layer.id));
}

/** Inclusive-exclusive range of the contiguous subtree rooted at `index`. */
function subtreeRange(
	layers: readonly Layer[],
	index: number,
): { start: number; end: number } {
	const depths = layerDepths(layers);
	const depth = depths[index]!;
	let end = index + 1;
	while (end < layers.length && depths[end]! > depth) end++;
	return { start: index, end };
}

/** Contiguous sibling blocks at a given depth (each a node plus its subtree). */
function siblingBlocks(
	layers: readonly Layer[],
	depth: number,
): { start: number; end: number }[] {
	const depths = layerDepths(layers);
	const blocks: { start: number; end: number }[] = [];
	let index = 0;
	while (index < layers.length) {
		if (depths[index]! === depth) {
			let end = index + 1;
			while (end < layers.length && depths[end]! > depth) end++;
			blocks.push({ start: index, end });
			index = end;
		} else {
			index++;
		}
	}
	return blocks;
}

function readStoredTheme(): "light" | "dark" {
	try {
		return localStorage.getItem("pixel-spell-theme") === "dark" ? "dark" : "light";
	} catch {
		return "light";
	}
}

/** Desktop-only preference: mirror saved projects after edit pauses. */
function readDesktopAutosave(): boolean {
	try {
		return localStorage.getItem("pixel-spell-desktop-autosave") === "true";
	} catch {
		return false;
	}
}

const initialGrid = loadGridSettings();

interface CelPatch {
	layerId: string;
	frame: number;
	pixels: Uint32Array;
}

/** Common metadata for one undoable action, used by the history dialog. */
interface HistoryMeta {
	id: string;
	/** Action name, for example "Paint" or "Add layer". */
	label: string;
	/** Optional context, for example "Layer 2 · Frame 3". */
	detail?: string;
}

/**
 * History entries are either a full document clone (structural edits) or one
 * or more previous cel buffers (pixel edits). Pixel edits are the common case,
 * so this avoids cloning every layer and frame on every brush stroke.
 */
type HistoryEntry =
	| ({ kind: "full"; doc: PixelDoc } & HistoryMeta)
	| ({ kind: "cels"; patches: CelPatch[] } & HistoryMeta);

/**
 * One row of the undo history dialog. Positions count applied actions from
 * the oldest recorded state (0) to the newest redoable state.
 */
export interface HistoryRow {
	id: string;
	label: string;
	detail: string;
	position: number;
	/** Number of cel patches the entry stores, or 0 for a full snapshot. */
	cells: number;
	current: boolean;
	redoable: boolean;
}

interface ProjectSnapshot {
	doc: PixelDoc;
	activeLayerId: string;
	activeFrame: number;
	activeReferenceId: string | null;
	layerSelection: string[];
	layerAnchorId: string | null;
	frameSelection: string[];
	frameAnchorId: string | null;
	zoom: number | null;
	panX: number;
	panY: number;
	rotation: number;
	selection: Uint8Array | null;
	undo: HistoryEntry[];
	redo: HistoryEntry[];
	undoBytes: number;
	redoBytes: number;
}

/** Frames copied from the timeline, including one cel per layer. */
interface FrameClipboard {
	frames: {
		duration?: number;
		tag?: string;
		cels: Map<string, Uint32Array>;
	}[];
}

/** In-memory copy of selected pixels, independent of the OS clipboard. */
interface SelectionClipboard {
	originX: number;
	originY: number;
	width: number;
	height: number;
	pixels: Uint32Array;
	mask: Uint8Array;
}

/**
 * Pixels temporarily floating above a cel. They are not applied until the
 * floating selection is committed (deselected, replaced, or the move ends).
 */
export interface FloatingSelection {
	layerId: string;
	frame: number;
	originX: number;
	originY: number;
	width: number;
	height: number;
	pixels: Uint32Array;
	mask: Uint8Array;
	/** True once the pre-move document has been pushed to the undo stack. */
	historyPushed: boolean;
}

export class EditorState {
	doc = $state<PixelDoc>(createDoc(32, 32));
	activeLayerId = $state<string>(this.doc.layers[0].id);
	activeFrame = $state(0);
	/**
	 * Selected layer ids in the timeline. Always includes the active layer.
	 * Timeline selection is a layer selection plus a frame selection, not a
	 * grouping of individual cels.
	 */
	layerSelection = $state<string[]>([this.doc.layers[0].id]);
	/** Selected frame ids, including the active frame. */
	frameSelection = $state<string[]>([this.doc.frames[0]!.id]);
	/** Selected image on the project-level reference board. */
	activeReferenceId = $state<string | null>(null);

	tool = $state<ToolId>("pencil");
	/**
	 * When enabled, the left and right mouse buttons run separate tools.
	 * Workspace-wide preference, disabled by default.
	 */
	doubleToolEnabled = $state(false);
	/** Tool assigned to the left mouse button in double tool mode. */
	leftTool = $state<ToolId>("pencil");
	/** Tool assigned to the right mouse button in double tool mode. */
	rightTool = $state<ToolId>("eraser");
	/** Which mouse slot the tool options panel is showing. */
	activeToolSlot = $state<"left" | "right">("left");
	/** Zoom direction used by the zoom tool while double tool mode is enabled. */
	zoomDirection = $state<1 | -1>(1);
	/** Color slot the eyedropper writes to while double tool mode is enabled. */
	eyedropperTarget = $state<ColorSlot>("primary");
	primaryColor = $state("#18181b");
	alpha = $state(255);
	secondaryColor = $state("#ffffff");
	secondaryAlpha = $state(255);
	palettes = $state<Palette[]>([createDefaultPalette()]);
	activePaletteId = $state<string>(DEFAULT_PALETTE_ID);
	/** Restricts color picking to the active palette and blocks palette edits. */
	paletteLocked = $state(false);
	paletteRampOpen = $state(false);
	paletteCyclesOpen = $state(false);
	paletteCoverageOpen = $state(false);
	/** Effects dialogs. Previews live in the dialogs; applying is undoable. */
	effectOutlineOpen = $state(false);
	effectDropShadowOpen = $state(false);
	effectColorReplaceOpen = $state(false);
	effectDitherOpen = $state(false);
	effectGradientMapOpen = $state(false);
	effectGrayscaleOpen = $state(false);
	effectCustomShaderOpen = $state(false);
	/** Shared brush/pattern library dialog. */
	maskLibraryOpen = $state(false);
	maskLibraryTab = $state<"brush" | "pattern">("brush");
	/** When set, the library opens directly in its mask editor for this item. */
	maskLibraryEditId = $state<string | null>(null);
	/** Undo history dialog. */
	historyOpen = $state(false);
	/**
	 * Inclusive palette range used by the Color Cycles dialog. Cycling is a
	 * workspace preference and is intentionally not stored in project files.
	 */
	paletteCycleStart = $state(0);
	paletteCycleEnd = $state(3);
	paletteCycleMs = $state(DEFAULT_PALETTE_CYCLE_MS);
	paletteCycleDirection = $state<PaletteCycleDirection>("forward");

	brushSize = $state(1);
	/** Ink opacity for brush stamps, 1–100. */
	brushOpacity = $state(100);
	/** Show a footprint outline under the cursor for custom brush shapes. */
	showBrushPreview = $state(true);
	/** Live dither ink is enabled per drawing tool. */
	ditherEnabledByTool = $state<Partial<Record<ToolId, boolean>>>({});
	ditherOffsetX = $state(0);
	ditherOffsetY = $state(0);
	ditherAlign = $state<DitherAlign>("canvas");
	sprayRadius = $state(6);
	sprayRate = $state(40);
	blurRadius = $state(4);
	blurPower = $state(50);
	jumbleRadius = $state(4);
	jumblePower = $state(100);
	mirrorX = $state(false);
	mirrorY = $state(false);
	mirrorDiagonalDown = $state(false);
	mirrorDiagonalUp = $state(false);
	mirrorXOffset = $state(0);
	mirrorYOffset = $state(0);
	mirrorDiagonalDownOffset = $state(0);
	mirrorDiagonalUpOffset = $state(0);
	radialEnabled = $state(false);
	/** Number of rotational copies, including the original (2–16). */
	radialCount = $state(6);
	/** Radial symmetry center offset from the canvas center, in document pixels. */
	radialCenterX = $state(0);
	radialCenterY = $state(0);
	lockAlpha = $state(false);
	/** Per-tool pixel-perfect preference; absent means off. */
	pixelPerfectByTool = $state<Partial<Record<ToolId, boolean>>>({});
	shapeFilled = $state(false);
	/** Shape drawn by the combined shape tool. */
	shapeKind = $state<ShapeKind>("rectangle");
	/** Shape drawn by the combined selection tool. */
	selectionShape = $state<ShapeKind>("rectangle");
	fillTolerance = $state(0);
	fillContiguous = $state(true);
	gradientTolerance = $state(0);
	gradientContiguous = $state(true);
	gradientShape = $state<GradientShape>("linear");
	gradientDither = $state<GradientDither>("bayer2");
	sampleAllLayers = $state(true);
	magicWandDiagonal = $state(false);

	/** Selected pixel mask for the active document, or null when nothing is selected. */
	selection = $state<Uint8Array | null>(null);
	selectionRevision = $state(0);
	hasClipboard = $state(false);
	hasFrameClipboard = $state(false);
	/** Temporary preview content that has not been written into a cel yet. */
	floating = $state<FloatingSelection | null>(null);

	onionEnabled = $state(false);
	onionShowPrevious = $state(true);
	onionShowNext = $state(true);
	/** Number of neighboring frames drawn on each side (1–3). */
	onionRange = $state(1);
	/** Opacity multiplier applied to each onion frame. */
	onionOpacity = $state(0.3);
	onionTintPrevious = $state("#ef4444");
	onionTintNext = $state("#22c55e");

	showGrid = $state(initialGrid.enabled);
	showPixelGrid = $state(initialGrid.pixelEnabled);
	gridMode = $state<GridMode>(initialGrid.mode);
	gridWidth = $state(initialGrid.width);
	gridHeight = $state(initialGrid.height);
	gridOffsetX = $state(initialGrid.offsetX);
	gridOffsetY = $state(initialGrid.offsetY);
	gridHexOrientation = $state<HexGridOrientation>(initialGrid.hexOrientation);
	gridSettingsOpen = $state(false);
	showPreview = $state(false);
	/** Preview window converts its copy to 8-bit grayscale without touching cels. */
	previewGrayscale = $state(false);
	/** Integer zoom applied only to the floating preview window. */
	previewZoom = $state(1);
	showReferenceBoard = $state(false);
	zoom = $state<number | null>(null);
	/** Canvas center offset from the stage center, in screen pixels. */
	panX = $state(0);
	panY = $state(0);
	/** Canvas rotation in degrees, always a multiple of 15. */
	rotation = $state(0);
	viewport = $state<ViewportSize>({ w: 0, h: 0 });
	playing = $state(false);
	theme = $state<"light" | "dark">(readStoredTheme());

	cursor = $state<Point | null>(null);
	/** Last cursor position over the canvas, kept for the menu bar readout. */
	lastCursor = $state<Point | null>(null);
	revision = $state(0);
	/** Increments when layers/frames are added, removed, reordered, or restored. */
	structureRevision = $state(0);
	/** Increments when layer visibility or opacity changes. */
	layerAppearanceRevision = $state(0);
	dirty = $state(false);
	modified = $state(false);
	name = $state("Untitled");
	/** Absolute path of the active desktop project; null for unsaved tabs. */
	activeFilePath = $state<string | null>(null);
	/** Desktop-only preference, persisted in localStorage. */
	desktopAutosave = $state(readDesktopAutosave());

	projects = $state<ProjectTab[]>([]);
	activeProjectId = $state("");

	undoCount = $state(0);
	redoCount = $state(0);
	/** Workspace-wide number of undo steps retained per project. */
	historyLimit = $state(loadHistoryLimit());
	/** Increments only when undo/redo restores a document. */
	historyActionRevision = $state(0);

	#undo: HistoryEntry[] = [];
	#redo: HistoryEntry[] = [];
	#undoBytes = 0;
	#redoBytes = 0;
	#states = new Map<string, ProjectSnapshot>();
	#clipboard: SelectionClipboard | null = null;
	#frameClipboard: FrameClipboard | null = null;
	#layerAnchorId: string | null = this.doc.layers[0].id;
	#frameAnchorId: string | null = this.doc.frames[0]!.id;
	#playbackSequence: number[] = [];
	#playbackCursor = -1;

	constructor() {
		const id = uid("project");
		this.projects = [
			{
				id,
				name: this.name,
				dirty: this.dirty,
				modified: this.modified,
			},
		];
		this.activeProjectId = id;
		this.#states.set(id, {
			doc: this.doc,
			activeLayerId: this.activeLayerId,
			activeFrame: this.activeFrame,
			activeReferenceId: null,
			layerSelection: this.layerSelection,
			layerAnchorId: this.#layerAnchorId,
			frameSelection: this.frameSelection,
			frameAnchorId: this.#frameAnchorId,
			zoom: this.zoom,
			panX: 0,
			panY: 0,
			rotation: 0,
			selection: null,
			undo: [],
			redo: [],
			undoBytes: 0,
			redoBytes: 0,
		});

		const paletteState = loadPaletteState();
		this.palettes = paletteState.palettes;
		this.activePaletteId = paletteState.activeId;
		this.paletteLocked = paletteState.locked;

		const brush = activeBrushPreset();
		this.brushSize = Math.max(1, Math.min(64, brush.defaultSize));
		this.brushOpacity = Math.max(1, Math.min(100, brush.defaultOpacity));
	}

	get activeLayer(): Layer {
		return (
			this.doc.layers.find((layer) => layer.id === this.activeLayerId) ??
			this.doc.layers[this.doc.layers.length - 1]!
		);
	}

	get activeReference(): ReferenceImage | null {
		return (
			this.doc.references.find(
				(reference) => reference.id === this.activeReferenceId,
			) ?? null
		);
	}

	get activeLayerDrawable(): boolean {
		const layer = this.activeLayer;
		return (
			!!layer &&
			!isGroupLayer(layer) &&
			layer.role !== "reference" &&
			!layer.locked &&
			layer.visible
		);
	}

	/** The timeline's flattened, top-to-bottom layer list (groups expanded). */
	get timelineLayers(): LayerRow[] {
		return flattenLayersTopFirst(this.doc.layers);
	}

	/** True when deleting the selected layers would leave a drawable layer behind. */
	get canDeleteSelectedLayers(): boolean {
		const layers = this.doc.layers;
		const selected = new Set(this.layerSelection);
		if (!layers.some((layer) => selected.has(layer.id))) return false;
		return layers.some(
			(layer) => !isGroupLayer(layer) && !selected.has(layer.id),
		);
	}

	/** True when at least one selected layer belongs to a group. */
	get canOutdentSelectedLayers(): boolean {
		return this.layerSelection.some((id) => {
			const layer = this.doc.layers.find((item) => item.id === id);
			return !!layer?.parentId;
		});
	}

	get referenceLayerCount(): number {
		return this.doc.layers.filter((layer) => layer.role === "reference").length;
	}

	/** True when at least one layer (including groups and references) is visible. */
	get anyLayerVisible(): boolean {
		return this.doc.layers.some((layer) => layer.visible);
	}

	/** True when at least one layer or group is not locked. */
	get anyLayerUnlocked(): boolean {
		return this.doc.layers.some(
			(layer) => layer.role !== "reference" && !layer.locked,
		);
	}

	/** True when at least one drawable layer links its newly added cels. */
	get anyLayerContinuous(): boolean {
		return this.doc.layers.some(
			(layer) =>
				!isGroupLayer(layer) &&
				layer.role !== "reference" &&
				layer.continuous === true,
		);
	}

	get activePalette(): Palette {
		return (
			this.palettes.find((palette) => palette.id === this.activePaletteId) ??
			this.palettes[0]!
		);
	}

	/** The active palette can be edited when it is custom and unlocked. */
	get paletteEditable(): boolean {
		return !this.activePalette.builtin && !this.paletteLocked;
	}

	/** The active document's color workflow (`rgba` when unset). */
	get colorMode(): ColorMode {
		return this.doc.colorMode === "indexed" ? "indexed" : "rgba";
	}

	/** True when the active document enforces the active palette. */
	get indexedMode(): boolean {
		return this.colorMode === "indexed";
	}

	/** Active workspace brush. */
	get activeBrush(): BrushPreset {
		return activeBrushPreset();
	}

	/** The footprint stamped at the current brush size. */
	get activeBrushMask(): PixelMask {
		return brushMaskFor(this.activeBrush, this.brushSize);
	}

	/** Longest side of the current footprint, for cursor previews. */
	get brushFootprintSize(): number {
		const mask = this.activeBrushMask;
		return Math.max(mask.width, mask.height);
	}

	/** Ink alpha in 0–255 for the paint pipeline. */
	get brushOpacityValue(): number {
		return Math.max(0, Math.min(255, Math.round(this.brushOpacity * 2.55)));
	}

	get activeDitherPattern(): DitherPattern {
		return activeDitherPatternPreset();
	}

	/** Whether live dither ink is enabled for a tool. */
	ditherEnabledFor(tool: ToolId): boolean {
		return usesDither(tool) && this.ditherEnabledByTool[tool] === true;
	}

	setDitherEnabled(tool: ToolId, enabled: boolean): void {
		if (!usesDither(tool)) return;
		this.ditherEnabledByTool = {
			...this.ditherEnabledByTool,
			[tool]: enabled,
		};
	}

	toggleDither(tool: ToolId = this.tool): void {
		this.setDitherEnabled(tool, !this.ditherEnabledFor(tool));
	}

	/** Snapshot object for one stroke/fill, or null when dither ink is off. */
	ditherSamplerFor(tool: ToolId): DitherSampler | null {
		if (!this.ditherEnabledFor(tool)) return null;
		return {
			pattern: this.activeDitherPattern,
			offsetX: Math.round(this.ditherOffsetX),
			offsetY: Math.round(this.ditherOffsetY),
			// Flood fill has no brush-local coordinate system; it is always
			// anchored to the artwork.
			align: tool === "fill" ? "canvas" : this.ditherAlign,
		};
	}

	setDitherOffset(x: number, y: number): void {
		if (Number.isFinite(x)) this.ditherOffsetX = Math.round(x);
		if (Number.isFinite(y)) this.ditherOffsetY = Math.round(y);
	}

	/**
	 * In indexed mode, snaps the whole active cel to the active palette. Used by
	 * tools that interpolate colors, such as the gradient tool.
	 */
	snapActiveCelToPalette(): boolean {
		if (!this.indexedMode) return false;
		const cel = this.activeLayer?.cels[this.activeFrame];
		if (!cel) return false;
		const next = snapPixelsToPalette(cel, this.activePalette.colors);
		if (next === cel) return false;
		cel.set(next);
		this.touch();
		return true;
	}

	/**
	 * In indexed mode, snaps a disk of the active cel to the active palette.
	 * Used by tools that synthesize colors, such as the blur tool.
	 */
	snapActiveCelRegionToPalette(
		centerX: number,
		centerY: number,
		radius: number,
	): boolean {
		if (!this.indexedMode) return false;
		const cel = this.activeLayer?.cels[this.activeFrame];
		if (!cel) return false;
		const changed = snapRegionToPalette(
			cel,
			this.doc.width,
			this.doc.height,
			centerX,
			centerY,
			radius,
			this.activePalette.colors,
		);
		if (changed) this.touch();
		return changed;
	}

	/** Selects a brush and optionally loads its saved size/opacity defaults. */
	selectBrush(id: string, applyDefaults = true): boolean {
		const preset = findBrush(id);
		if (!preset || !setActiveBrush(id)) return false;
		if (applyDefaults) {
			this.brushSize = Math.max(1, Math.min(64, preset.defaultSize));
			this.brushOpacity = Math.max(1, Math.min(100, preset.defaultOpacity));
		}
		return true;
	}

	setBrushSize(size: number): void {
		if (!Number.isFinite(size)) return;
		this.brushSize = Math.max(1, Math.min(64, Math.round(size)));
	}

	setBrushOpacity(opacity: number): void {
		if (!Number.isFinite(opacity)) return;
		this.brushOpacity = Math.max(1, Math.min(100, Math.round(opacity)));
	}

	/** Creates a custom brush from the current selection and selects it. */
	createBrushFromSelection(): BrushPreset | null {
		const mask = this.selection;
		if (!mask) return null;
		const preset = createBrushFromSelection(
			mask,
			this.doc.width,
			this.doc.height,
			`Selection brush ${brushLibrary.custom.length + 1}`,
		);
		if (preset) this.selectBrush(preset.id);
		return preset;
	}

	/** Imports a decoded image as a custom brush and selects it. */
	importBrushPixels(
		pixels: Uint32Array,
		width: number,
		height: number,
		name: string,
	): BrushPreset | null {
		const preset = createBrushFromImportedPixels(
			pixels,
			width,
			height,
			name,
		);
		if (preset) this.selectBrush(preset.id);
		return preset;
	}

	selectDitherPattern(id: string): boolean {
		return setActiveDitherPattern(id);
	}

	/** Opens the shared library on one tab, optionally editing an item. */
	openMaskLibrary(
		tab: "brush" | "pattern" = "brush",
		editId: string | null = null,
	): void {
		this.maskLibraryTab = tab;
		this.maskLibraryEditId = editId;
		this.maskLibraryOpen = true;
	}

	/**
	 * The inclusive palette range used by the Color Cycles dialog. Single-swatch
	 * or out-of-date values are widened to the nearest valid two-color span so
	 * the dialog always has a usable range.
	 */
	get paletteCycleRange(): PaletteCycleRange | null {
		const total = this.activePalette.colors.length;
		if (total < 2) return null;

		let start = clamp(
			Math.min(this.paletteCycleStart, this.paletteCycleEnd),
			0,
			total - 1,
		);
		let end = clamp(
			Math.max(this.paletteCycleStart, this.paletteCycleEnd),
			0,
			total - 1,
		);
		if (start === end) {
			if (end < total - 1) end++;
			else start--;
		}
		return { start, end };
	}

	get canUndo(): boolean {
		return this.undoCount > 0;
	}

	get canRedo(): boolean {
		return this.redoCount > 0;
	}

	/** Number of applied actions; also the index of the current history row. */
	get historyPosition(): number {
		return this.undoCount;
	}

	/** Applied plus redoable actions. */
	get historyTotal(): number {
		return this.undoCount + this.redoCount;
	}

	/** Approximate memory held by undo and redo snapshots, in bytes. */
	get historyBytes(): number {
		// The reactive counters invalidate this getter when history changes;
		// the byte totals themselves live outside the reactive graph.
		void this.undoCount;
		void this.redoCount;
		return this.#undoBytes + this.#redoBytes;
	}

	/** Bytes needed to store one single-cel pixel patch at the current size. */
	get historyStepBytes(): number {
		return this.doc.width * this.doc.height * 4;
	}

	/** Bytes needed for one full-document structural snapshot. */
	get historySnapshotBytes(): number {
		return (
			this.doc.width *
			this.doc.height *
			4 *
			Math.max(1, this.doc.frames.length) *
			Math.max(1, this.doc.layers.length)
		);
	}

	/**
	 * Changes the workspace-wide saved-step count, persists it, and trims the
	 * active project plus every inactive snapshot so the new limit applies
	 * immediately.
	 */
	setHistoryLimit(value: number): void {
		const next = Math.max(
			HISTORY_LIMIT_MIN,
			Math.min(HISTORY_LIMIT_MAX, Math.round(value)),
		);
		if (next === this.historyLimit) return;
		this.historyLimit = next;
		saveHistoryLimit(next);
		this.#trimHistory();
		for (const snapshot of this.#states.values()) {
			while (snapshot.undo.length > next) {
				const removed = snapshot.undo.shift();
				if (!removed) break;
				snapshot.undoBytes -= this.#entryBytes(removed);
			}
			if (snapshot.undoBytes < 0) snapshot.undoBytes = 0;
		}
		this.undoCount = this.#undo.length;
		this.redoCount = this.#redo.length;
	}

	/**
	 * Builds an export-ready document whose frames replay the retained history
	 * of the active animation frame. Does not modify the document or history.
	 */
	buildTimelapse(): TimelapseBuild {
		return buildTimelapseDoc(this.doc, this.#undo, this.activeFrame);
	}

	/**
	 * Linear list of history states for the history dialog: the oldest state
	 * first, then one row per applied action, then the redoable states.
	 */
	get historyRows(): HistoryRow[] {
		// Read the reactive counters so the row list refreshes after every push,
		// undo, redo, and project switch.
		const current = this.undoCount;
		const redoCount = this.redoCount;
		const undo = this.#undo;
		const redo = this.#redo;

		const rows: HistoryRow[] = [
			{
				id: "history-base",
				label: "Initial state",
				detail: "Earliest retained state",
				position: 0,
				cells: 0,
				current: current === 0,
				redoable: current !== 0,
			},
		];

		undo.forEach((entry, index) => {
			const position = index + 1;
			rows.push({
				id: entry.id,
				label: entry.label,
				detail: entry.detail ?? "",
				position,
				cells: entry.kind === "cels" ? entry.patches.length : 0,
				current: position === current,
				redoable: false,
			});
		});

		// The redo stack is last-in-first-out, so walk it backwards to show the
		// states in the order they would be restored.
		for (let index = redo.length - 1; index >= 0; index--) {
			const entry = redo[index]!;
			rows.push({
				id: entry.id,
				label: entry.label,
				detail: entry.detail ?? "",
				position: current + (redoCount - index),
				cells: entry.kind === "cels" ? entry.patches.length : 0,
				current: false,
				redoable: true,
			});
		}

		return rows;
	}

	get frameCount(): number {
		return this.doc.frames.length;
	}

	/** Selected frame indices in timeline order. */
	get selectedFrameIndices(): number[] {
		const selected = new Set(this.frameSelection);
		const indices: number[] = [];
		this.doc.frames.forEach((frame, index) => {
			if (selected.has(frame.id)) indices.push(index);
		});
		return indices;
	}

	get selectedFrameCount(): number {
		return this.selectedFrameIndices.length;
	}

	get selectedLayerCount(): number {
		return this.layerSelection.length;
	}

	/** Whether a layer row is part of the timeline selection. */
	isLayerSelected(id: string): boolean {
		return this.layerSelection.includes(id);
	}

	/** Playback order of the animation. */
	get animationMode(): AnimationMode {
		return normalizeAnimationMode(this.doc.animationMode);
	}

	/** Whether playback repeats after the sequence ends. */
	get animationLoop(): boolean {
		return this.doc.animationLoop !== false;
	}

	/**
	 * Frames included in the animation. A single selected frame means the whole
	 * timeline; two or more selected frames restrict playback and export to the
	 * selection, in timeline order.
	 */
	get animationFrameIndices(): number[] {
		const selected = this.selectedFrameIndices;
		if (selected.length >= 2) return selected;
		return this.doc.frames.map((_, index) => index);
	}

	/** Frame order the playback timer walks, including ping-pong reversal. */
	get animationSequence(): number[] {
		return animationSequence(
			this.animationFrameIndices,
			this.animationMode,
			this.animationLoop,
		);
	}

	/** Neighboring frames drawn as onion skins around the active frame. */
	get onionSkins(): {
		frame: number;
		direction: "previous" | "next";
		distance: number;
	}[] {
		if (!this.onionEnabled || this.playing || this.doc.frames.length <= 1) {
			return [];
		}

		const skins: {
			frame: number;
			direction: "previous" | "next";
			distance: number;
		}[] = [];
		const seen = new Set<number>([this.activeFrame]);
		const frameCount = this.doc.frames.length;

		const walk = (direction: "previous" | "next"): void => {
			if (direction === "previous" && !this.onionShowPrevious) return;
			if (direction === "next" && !this.onionShowNext) return;

			let index = this.activeFrame;
			for (let distance = 1; distance <= this.onionRange; distance++) {
				index =
					direction === "previous"
						? (index - 1 + frameCount) % frameCount
						: (index + 1) % frameCount;
				if (seen.has(index)) break;
				seen.add(index);
				skins.push({ frame: index, direction, distance });
			}
		};

		walk("previous");
		walk("next");
		return skins;
	}

	get hasSelection(): boolean {
		return this.selection !== null;
	}

	get mirrorAxes(): MirrorAxis[] {
		const width = this.doc.width;
		const height = this.doc.height;
		const axes: MirrorAxis[] = [];

		// X axis mirrors across the horizontal axis; Y axis across the vertical axis.
		if (this.mirrorX) {
			axes.push({
				kind: "x",
				position: clamp(height / 2 + this.mirrorXOffset, 0, height),
			});
		}
		if (this.mirrorY) {
			axes.push({
				kind: "y",
				position: clamp(width / 2 + this.mirrorYOffset, 0, width),
			});
		}
		if (this.mirrorDiagonalDown) {
			axes.push({
				kind: "diagonal-down",
				position: clamp(
					(height - width) / 2 + this.mirrorDiagonalDownOffset,
					-width,
					height,
				),
			});
		}
		if (this.mirrorDiagonalUp) {
			axes.push({
				kind: "diagonal-up",
				position: clamp(
					(width + height) / 2 + this.mirrorDiagonalUpOffset,
					0,
					width + height,
				),
			});
		}

		return axes;
	}

	get radialSymmetry(): RadialSymmetry | null {
		if (!this.radialEnabled) return null;
		return {
			count: clamp(
				Math.round(this.radialCount),
				RADIAL_SYMMETRY_MIN,
				RADIAL_SYMMETRY_MAX,
			),
			centerX: clamp(
				this.doc.width / 2 + this.radialCenterX,
				0,
				this.doc.width,
			),
			centerY: clamp(
				this.doc.height / 2 + this.radialCenterY,
				0,
				this.doc.height,
			),
		};
	}

	get currentColor(): number {
		return packColor(this.#indexedHex(this.primaryColor), this.alpha);
	}

	get secondaryCurrentColor(): number {
		return packColor(this.#indexedHex(this.secondaryColor), this.secondaryAlpha);
	}

	/**
	 * Resolves a color slot to a paintable hex. Indexed documents snap to the
	 * active palette so no tool can introduce an off-palette color.
	 */
	#indexedHex(hex: string): string {
		if (!this.indexedMode) return hex;
		return snapHexToPalette(this.activePalette.colors, hex);
	}

	/** In indexed mode, snaps a pixel buffer to the active palette. */
	#indexedPixels(pixels: Uint32Array): Uint32Array {
		if (!this.indexedMode) return pixels;
		return snapPixelsToPalette(pixels, this.activePalette.colors);
	}

	get fitZoom(): number {
		const availableWidth = Math.max(0, this.viewport.w - 64);
		const availableHeight = Math.max(0, this.viewport.h - 112);
		const radians = (this.rotation * Math.PI) / 180;
		const cosine = Math.abs(Math.cos(radians));
		const sine = Math.abs(Math.sin(radians));
		const rotatedWidth = this.doc.width * cosine + this.doc.height * sine;
		const rotatedHeight = this.doc.width * sine + this.doc.height * cosine;
		const fit = Math.floor(
			Math.min(availableWidth / rotatedWidth, availableHeight / rotatedHeight),
		);
		return clamp(Number.isFinite(fit) ? fit : 1, MIN_ZOOM, MAX_ZOOM);
	}

	get effectiveZoom(): number {
		return this.zoom ?? this.fitZoom;
	}

	setTool(tool: ToolId): void {
		this.tool = tool;
		if (this.doubleToolEnabled) {
			// Keyboard and command-palette activation target the left (primary) slot.
			this.leftTool = tool;
			this.activeToolSlot = "left";
		}
	}

	/** Assigns a tool to the left mouse button and shows its options. */
	setLeftTool(tool: ToolId): void {
		this.tool = tool;
		this.leftTool = tool;
		this.activeToolSlot = "left";
	}

	/** Assigns a tool to the right mouse button and shows its options. */
	setRightTool(tool: ToolId): void {
		this.tool = tool;
		this.rightTool = tool;
		this.activeToolSlot = "right";
	}

	/** The tool that runs for a pointer button in the current mode. */
	toolForButton(button: 0 | 2): ToolId {
		if (!this.doubleToolEnabled) return this.tool;
		return button === 2 ? this.rightTool : this.leftTool;
	}

	/** Shows the tool options for the other mouse slot. */
	showOtherToolOptions(): void {
		if (!this.doubleToolEnabled) return;
		this.activeToolSlot = this.activeToolSlot === "left" ? "right" : "left";
		this.tool = this.activeToolSlot === "left" ? this.leftTool : this.rightTool;
	}

	toggleDoubleToolMode(): void {
		this.doubleToolEnabled = !this.doubleToolEnabled;
		if (this.doubleToolEnabled) {
			// Start both buttons from the current tool until the user changes one.
			this.leftTool = this.tool;
			this.rightTool = this.tool;
			this.activeToolSlot = "left";
		}
	}

	/** Moves the active tool slots off tools that the user hid in the strip. */
	ensureEnabledTool(): void {
		const fallback = toolLayout.firstEnabled();
		if (!fallback) return;
		if (!toolLayout.isEnabled(this.tool)) this.tool = fallback;
		if (!toolLayout.isEnabled(this.leftTool)) this.leftTool = fallback;
		if (!toolLayout.isEnabled(this.rightTool)) this.rightTool = fallback;
		if (this.doubleToolEnabled) {
			this.tool =
				this.activeToolSlot === "right" ? this.rightTool : this.leftTool;
		}
	}

	/** Whether the tool has a pixel-perfect option and it is enabled. */
	pixelPerfectFor(tool: ToolId): boolean {
		return usesPixelPerfect(tool) && !!this.pixelPerfectByTool[tool];
	}

	setPixelPerfect(tool: ToolId, enabled: boolean): void {
		if (!usesPixelPerfect(tool)) return;
		this.pixelPerfectByTool[tool] = enabled;
	}

	setSelection(mask: Uint8Array | null, keepFloating = false): void {
		if (!keepFloating && this.floating) this.commitFloatingSelection();
		this.selection = mask;
		this.selectionRevision++;
	}

	clearSelection(): void {
		if (this.floating) this.commitFloatingSelection();
		if (!this.selection) return;
		this.selection = null;
		this.selectionRevision++;
	}

	selectAll(): void {
		const mask = new Uint8Array(this.doc.width * this.doc.height);
		mask.fill(1);
		this.setSelection(mask);
	}

	/** Builds a clipboard-style snapshot of the current selection. */
	#captureSelection(): SelectionClipboard | null {
		const mask = this.selection;
		if (!mask) return null;

		const floating = this.floating;
		if (
			floating &&
			floating.layerId === this.activeLayer?.id &&
			floating.frame === this.activeFrame
		) {
			return {
				originX: floating.originX,
				originY: floating.originY,
				width: floating.width,
				height: floating.height,
				pixels: new Uint32Array(floating.pixels),
				mask: new Uint8Array(floating.mask),
			};
		}

		const cel = this.activeLayer?.cels[this.activeFrame];
		if (!cel) return null;

		const bounds = selectionBounds(mask, this.doc.width, this.doc.height);
		if (!bounds) return null;

		const pixels = new Uint32Array(bounds.width * bounds.height);
		const clipMask = new Uint8Array(bounds.width * bounds.height);

		for (let y = 0; y < bounds.height; y++) {
			const sourceRow = (bounds.y + y) * this.doc.width + bounds.x;
			const targetRow = y * bounds.width;
			for (let x = 0; x < bounds.width; x++) {
				const sourceIndex = sourceRow + x;
				if (!mask[sourceIndex]) continue;
				clipMask[targetRow + x] = 1;

				const value = cel[sourceIndex]!;
				// Transparent pixels are ignored so they can never erase a
				// destination pixel when the content is applied.
				if (!isTransparent(value)) pixels[targetRow + x] = value;
			}
		}

		return {
			originX: bounds.x,
			originY: bounds.y,
			width: bounds.width,
			height: bounds.height,
			pixels,
			mask: clipMask,
		};
	}

	/** Copies the selected pixels of the active cel into the internal clipboard. */
	copySelection(): boolean {
		const data = this.#captureSelection();
		if (!data) return false;
		this.#clipboard = data;
		this.hasClipboard = true;
		return true;
	}

	/**
	 * Creates floating content from the current selection without changing the
	 * cel. The caller moves it and commits it when the drag ends.
	 */
	createFloatingSelection(): FloatingSelection | null {
		const layer = this.activeLayer;
		const cel = layer?.cels[this.activeFrame];
		if (!layer || !cel) return null;

		const data = this.#captureSelection();
		if (!data) return null;

		return {
			layerId: layer.id,
			frame: this.activeFrame,
			originX: data.originX,
			originY: data.originY,
			width: data.width,
			height: data.height,
			pixels: data.pixels,
			mask: data.mask,
			historyPushed: false,
		};
	}

	/**
	 * Starts moving an existing selection: pushes one history entry, removes the
	 * source pixels, and places the content in the floating layer.
	 */
	beginFloatingMove(
		floating: FloatingSelection,
		targetX: number,
		targetY: number,
	): boolean {
		const layer = this.doc.layers.find((item) => item.id === floating.layerId);
		const cel = layer?.cels[floating.frame];
		if (!cel) return false;

		this.pushHistoryCel(floating.layerId, floating.frame, "Move selection");

		const width = this.doc.width;
		const height = this.doc.height;
		const sourceX = floating.originX;
		const sourceY = floating.originY;

		for (let y = 0; y < floating.height; y++) {
			const pixelY = sourceY + y;
			if (pixelY < 0 || pixelY >= height) continue;
			for (let x = 0; x < floating.width; x++) {
				if (!floating.mask[y * floating.width + x]) continue;
				const pixelX = sourceX + x;
				if (pixelX < 0 || pixelX >= width) continue;
				cel[pixelY * width + pixelX] = 0;
			}
		}

		floating.historyPushed = true;
		floating.originX = targetX;
		floating.originY = targetY;
		this.floating = floating;
		this.#syncFloatingMask();
		this.revision++;
		return true;
	}

	/** Moves the current floating content without applying it. */
	moveFloatingSelection(x: number, y: number): void {
		const floating = this.floating;
		if (!floating) return;
		floating.originX = x;
		floating.originY = y;
		this.#syncFloatingMask();
	}

	#syncFloatingMask(): void {
		const floating = this.floating;
		if (!floating) return;

		const width = this.doc.width;
		const height = this.doc.height;
		const mask = new Uint8Array(width * height);

		for (let y = 0; y < floating.height; y++) {
			const destY = floating.originY + y;
			if (destY < 0 || destY >= height) continue;
			for (let x = 0; x < floating.width; x++) {
				const destX = floating.originX + x;
				if (destX < 0 || destX >= width) continue;
				if (floating.mask[y * floating.width + x]) {
					mask[destY * width + destX] = 1;
				}
			}
		}

		this.selection = mask;
		this.selectionRevision++;
	}

	/**
	 * Applies floating content to its original layer and frame. Transparent
	 * floating pixels leave the destination untouched.
	 */
	commitFloatingSelection(): boolean {
		const floating = this.floating;
		if (!floating) return false;

		// Detach first so the history push below cannot re-enter this method.
		this.floating = null;

		const layer = this.doc.layers.find((item) => item.id === floating.layerId);
		const cel = layer?.cels[floating.frame];
		if (!cel) {
			this.selectionRevision++;
			return false;
		}

		const width = this.doc.width;
		const height = this.doc.height;
		// Pasted/transformed content may carry off-palette colors into an
		// indexed document; snap once so the destination stays palette-only.
		const pixels = this.#indexedPixels(floating.pixels);
		let changed = false;

		for (let y = 0; y < floating.height && !changed; y++) {
			const destY = floating.originY + y;
			if (destY < 0 || destY >= height) continue;
			for (let x = 0; x < floating.width; x++) {
				const destX = floating.originX + x;
				if (destX < 0 || destX >= width) continue;
				const value = pixels[y * floating.width + x]!;
				if (isTransparent(value)) continue;
				if (cel[destY * width + destX] !== value) {
					changed = true;
					break;
				}
			}
		}

		if (changed) {
			if (!floating.historyPushed) {
				this.pushHistoryCel(
					floating.layerId,
					floating.frame,
					"Place selection",
				);
			}
			for (let y = 0; y < floating.height; y++) {
				const destY = floating.originY + y;
				if (destY < 0 || destY >= height) continue;
				for (let x = 0; x < floating.width; x++) {
					const destX = floating.originX + x;
					if (destX < 0 || destX >= width) continue;
					const value = pixels[y * floating.width + x]!;
					if (isTransparent(value)) continue;
					cel[destY * width + destX] = value;
				}
			}
			this.touch();
		}

		this.selectionRevision++;
		return changed;
	}

	/**
	 * Captures the current selection into floating content, clears its source
	 * pixels, and records one history entry. Used as the entry point for the
	 * selection's scale/rotate/flip/skew transform: the returned floating holds
	 * the untransformed source, and `setFloatingTransform` replaces it with the
	 * transformed buffer as the handle drag progresses.
	 */
	beginFloatingTransform(): FloatingSelection | null {
		const floating = this.createFloatingSelection();
		if (!floating) return null;
		this.beginFloatingMove(floating, floating.originX, floating.originY);
		return floating;
	}

	/**
	 * Replaces the floating content with a transformed buffer and refreshes the
	 * selection mask. The cel is not recomposited here (its source region is
	 * already cleared), so this only bumps the selection revision — not the
	 * pixel revision — keeping handle drags cheap.
	 */
	setFloatingTransform(
		floating: FloatingSelection,
		pixels: Uint32Array,
		mask: Uint8Array,
		originX: number,
		originY: number,
		width: number,
		height: number,
	): void {
		floating.pixels = pixels;
		floating.mask = mask;
		floating.originX = originX;
		floating.originY = originY;
		floating.width = width;
		floating.height = height;
		this.floating = floating;
		this.#syncFloatingMask();
	}

	/**
	 * Pastes the internal clipboard as floating content. It is not written into
	 * the cel until the user deselects or starts another selection.
	 */
	pasteSelection(): boolean {
		const clipboard = this.#clipboard;
		if (!clipboard) return false;

		const layer = this.activeLayer;
		if (!layer || layer.locked || !layer.visible) return false;
		if (!layer.cels[this.activeFrame]) return false;

		if (this.floating) this.commitFloatingSelection();

		const targetBounds = selectionBounds(
			this.selection,
			this.doc.width,
			this.doc.height,
		);
		const targetX = targetBounds ? targetBounds.x : clipboard.originX;
		const targetY = targetBounds ? targetBounds.y : clipboard.originY;

		this.floating = {
			layerId: layer.id,
			frame: this.activeFrame,
			originX: targetX,
			originY: targetY,
			width: clipboard.width,
			height: clipboard.height,
			pixels: this.#indexedPixels(new Uint32Array(clipboard.pixels)),
			mask: new Uint8Array(clipboard.mask),
			historyPushed: false,
		};
		this.#syncFloatingMask();
		return true;
	}

	toggleMirror(kind: MirrorKind): void {
		if (kind === "x") {
			this.mirrorX = !this.mirrorX;
			if (!this.mirrorX) this.mirrorXOffset = 0;
		} else if (kind === "y") {
			this.mirrorY = !this.mirrorY;
			if (!this.mirrorY) this.mirrorYOffset = 0;
		} else if (kind === "diagonal-down") {
			this.mirrorDiagonalDown = !this.mirrorDiagonalDown;
			if (!this.mirrorDiagonalDown) this.mirrorDiagonalDownOffset = 0;
		} else {
			this.mirrorDiagonalUp = !this.mirrorDiagonalUp;
			if (!this.mirrorDiagonalUp) this.mirrorDiagonalUpOffset = 0;
		}
		// Mirror guides have their own overlay; the sprite pixels do not change.
	}

	toggleRadial(): void {
		this.radialEnabled = !this.radialEnabled;
		if (!this.radialEnabled) {
			// A disabled radial guide always restarts at the canvas center.
			this.radialCenterX = 0;
			this.radialCenterY = 0;
		}
	}

	setRadialCount(count: number): void {
		if (!Number.isFinite(count)) return;
		this.radialCount = clamp(
			Math.round(count),
			RADIAL_SYMMETRY_MIN,
			RADIAL_SYMMETRY_MAX,
		);
	}

	setRadialCenter(x: number, y: number): void {
		if (!Number.isFinite(x) || !Number.isFinite(y)) return;
		this.radialCenterX = clamp(x, 0, this.doc.width) - this.doc.width / 2;
		this.radialCenterY = clamp(y, 0, this.doc.height) - this.doc.height / 2;
	}

	setMirrorPosition(kind: MirrorKind, position: number): void {
		const width = this.doc.width;
		const height = this.doc.height;

		if (kind === "x") {
			this.mirrorXOffset = clamp(position, 0, height) - height / 2;
		} else if (kind === "y") {
			this.mirrorYOffset = clamp(position, 0, width) - width / 2;
		} else if (kind === "diagonal-down") {
			this.mirrorDiagonalDownOffset =
				clamp(position, -width, height) - (height - width) / 2;
		} else {
			this.mirrorDiagonalUpOffset =
				clamp(position, 0, width + height) - (width + height) / 2;
		}
	}

	setPrimaryColor(hex: string): void {
		this.setColor("primary", hex);
	}

	setSecondaryColor(hex: string): void {
		this.setColor("secondary", hex);
	}

	setColor(slot: ColorSlot, hex: string): void {
		const normalized = normalizeHex(hex);
		if (!normalized) return;
		if (slot === "secondary") this.secondaryColor = normalized;
		else this.primaryColor = normalized;
	}

	setColorAlpha(slot: ColorSlot, alpha: number): void {
		if (!Number.isFinite(alpha)) return;
		const value = clamp(Math.round(alpha), 0, 255);
		if (slot === "secondary") this.secondaryAlpha = value;
		else this.alpha = value;
	}

	setColorFromPacked(value: number, slot: ColorSlot = "primary"): void {
		const { r, g, b, a } = unpackColor(value);
		if (a === 0) return;
		const picked = rgbToHex(r, g, b);
		const hex =
			this.paletteLocked || this.indexedMode
				? (nearestPaletteColor(this.activePalette.colors, picked) ?? picked)
				: picked;
		this.setColor(slot, hex);
		this.setColorAlpha(slot, a);
	}

	swapColors(): void {
		const primaryColor = this.primaryColor;
		const primaryAlpha = this.alpha;
		this.primaryColor = this.secondaryColor;
		this.alpha = this.secondaryAlpha;
		this.secondaryColor = primaryColor;
		this.secondaryAlpha = primaryAlpha;
	}

	#persistPalettes(): void {
		savePaletteState(
			this.palettes,
			this.activePaletteId,
			this.paletteLocked,
		);
	}

	/** Locks color picking to the active palette and blocks palette edits. */
	togglePaletteLock(): void {
		this.paletteLocked = !this.paletteLocked;
		this.#persistPalettes();
	}

	/**
	 * Snaps a color slot to the nearest palette entry. Called when a picker is
	 * released (or an eyedropper click lands), not while the user is dragging.
	 */
	snapColorToPalette(slot: ColorSlot = "primary"): void {
		if (!this.paletteLocked) return;
		const current =
			slot === "secondary" ? this.secondaryColor : this.primaryColor;
		const nearest = nearestPaletteColor(
			this.activePalette.colors,
			current,
		);
		if (nearest && nearest !== current) this.setColor(slot, nearest);
	}

	/** Normalizes and stores the palette range used by the Color Cycles dialog. */
	setPaletteCycleRange(start: number, end: number): void {
		const total = this.activePalette.colors.length;
		if (total < 2) return;
		if (!Number.isFinite(start) || !Number.isFinite(end)) return;
		let lo = clamp(Math.round(start), 0, total - 1);
		let hi = clamp(Math.round(end), 0, total - 1);
		if (lo > hi) [lo, hi] = [hi, lo];
		if (lo === hi) {
			if (hi < total - 1) hi++;
			else lo--;
		}
		this.paletteCycleStart = lo;
		this.paletteCycleEnd = hi;
	}

	setPaletteCycleMs(value: number): void {
		if (!Number.isFinite(value)) return;
		this.paletteCycleMs = clamp(Math.round(value), 40, 2000);
	}

	setPaletteCycleDirection(direction: PaletteCycleDirection): void {
		this.paletteCycleDirection = direction;
	}

	/**
	 * Writes one cycle phase into the visible normal layers of the active frame.
	 * Reference layers are left untouched. Returns the frame count.
	 */
	bakePaletteCycle(
		shift: number,
		frames: readonly number[] = [this.activeFrame],
	): number {
		const range = this.paletteCycleRange;
		if (!range) return 0;
		const length = range.end - range.start + 1;
		const resolved = ((Math.round(shift) % length) + length) % length;
		const map = buildPaletteCycleMap(
			this.activePalette.colors,
			range,
			resolved,
		);
		if (!map) return 0;

		const targets = frames.filter(
			(index) => index >= 0 && index < this.doc.frames.length,
		);
		const layers = this.doc.layers.filter(
			(layer) => !isGroupLayer(layer) && layer.role !== "reference" && layer.visible,
		);
		if (targets.length === 0 || layers.length === 0) return 0;

		const patches: { layerId: string; frame: number }[] = [];
		for (const frame of targets) {
			for (const layer of layers) patches.push({ layerId: layer.id, frame });
		}
		this.pushHistoryCels(patches, "Bake color cycle");

		for (const frame of targets) {
			for (const layer of layers) {
				const cel = layer.cels[frame];
				if (cel) layer.cels[frame] = remapPalettePixels(cel, map);
			}
		}
		// Baking edits every visible layer of the affected frames, so this is a
		// structural-level pixel change (full recomposite + thumbnail refresh),
		// not a single-layer edit.
		this.structureRevision++;
		this.revision++;
		return targets.length;
	}

	/**
	 * Inserts one full palette-cycle pass as new frames after the active frame.
	 * Every frame gets its own rotated copy of the active frame's cels, plus the
	 * requested duration and tag, so PNG, spritesheet, and GIF export animate
	 * without needing to store cycling metadata. The generated frames become the
	 * current selection, which also makes them the animation range. Returns the
	 * inserted count.
	 */
	generatePaletteCycleAnimation(options: {
		steps: number;
		durationMs?: number;
		tag?: string;
	}): number {
		const range = this.paletteCycleRange;
		if (!range) return 0;
		const colors = this.activePalette.colors;
		const length = range.end - range.start + 1;
		const period = paletteCyclePeriod(length, this.paletteCycleDirection);
		if (period < 2) return 0;

		const count = clamp(Math.round(options.steps), 2, period);
		if (this.doc.frames.length + count > MAX_PROJECT_FRAMES) return 0;

		const sourceIndex = this.activeFrame;
		const insertAt = sourceIndex + 1;
		const duration = clamp(
			Math.round(options.durationMs ?? this.paletteCycleMs),
			MIN_FRAME_DURATION,
			MAX_FRAME_DURATION,
		);
		const tag = options.tag?.trim().slice(0, 40) || undefined;
		const width = this.doc.width;
		const height = this.doc.height;

		this.pushHistory("Generate color cycle");

		const inserted: Frame[] = [];
		for (let step = 0; step < count; step++) {
			const frame: Frame = {
				id: uid("frame"),
				duration,
				...(tag ? { tag } : {}),
			};
			inserted.push(frame);
			const target = insertAt + step;
			const shift = paletteShiftForStep(
				step,
				length,
				this.paletteCycleDirection,
			);
			const map = buildPaletteCycleMap(colors, range, shift);

			this.doc.frames.splice(target, 0, frame);
			for (const layer of this.doc.layers) {
				if (isGroupLayer(layer)) continue;
				const source = layer.cels[sourceIndex];
				let pixels: Uint32Array;
				if (!source) {
					pixels = new Uint32Array(width * height);
				} else if (layer.role === "reference" || !map) {
					pixels = new Uint32Array(source);
				} else {
					pixels = remapPalettePixels(source, map);
				}
				layer.cels.splice(target, 0, pixels);
			}
		}

		this.activeFrame = insertAt;
		this.frameSelection = inserted.map((frame) => frame.id);
		this.#frameAnchorId = inserted[0]!.id;
		this.structureRevision++;
		this.revision++;
		return count;
	}

	/**
	 * Appends a generated ramp to the active palette. Existing colors are
	 * skipped, the sort mode resets to the add/import order so the ramp stays
	 * contiguous, and the palette can optionally be locked afterwards.
	 */
	addPaletteRamp(colors: string[], lockAfter = false): number {
		const palette = this.activePalette;
		if (!this.paletteEditable) return 0;

		const next = [...(palette.originalColors ?? palette.colors)];
		let added = 0;
		for (const color of colors) {
			const normalized = normalizeHex(color);
			if (!normalized) continue;
			if (next.includes(normalized)) continue;
			if (next.length >= MAX_PALETTE_COLORS) break;
			next.push(normalized);
			added++;
		}

		if (added > 0) {
			palette.originalColors = next;
			palette.colors = [...next];
			palette.sortMode = "original";
		}
		if (lockAfter) this.paletteLocked = true;
		if (added > 0 || lockAfter) this.#persistPalettes();
		return added;
	}

	#nextPaletteName(): string {
		const names = new Set(this.palettes.map((palette) => palette.name.toLowerCase()));
		let index = 1;
		while (names.has(`palette ${index}`)) index++;
		return `Palette ${index}`;
	}

	selectPalette(id: string): void {
		if (!this.palettes.some((palette) => palette.id === id)) return;
		if (this.activePaletteId === id) return;
		this.activePaletteId = id;
		this.#persistPalettes();
		// Indexed documents must always resolve against the active palette.
		this.#enforceIndexedPalette();
	}

	createPalette(): string {
		const palette: Palette = {
			id: uid("palette"),
			name: this.#nextPaletteName(),
			colors: [],
			originalColors: [],
			sortMode: "original",
		};
		this.palettes.push(palette);
		this.activePaletteId = palette.id;
		this.#persistPalettes();
		return palette.id;
	}

	deletePalette(id: string): void {
		const index = this.palettes.findIndex((palette) => palette.id === id);
		if (index < 0) return;
		const palette = this.palettes[index]!;
		if (palette.builtin || this.paletteLocked) return;

		const wasActive = this.activePaletteId === id;
		this.palettes.splice(index, 1);
		if (wasActive) {
			this.activePaletteId = DEFAULT_PALETTE_ID;
		}
		this.#persistPalettes();
		if (wasActive) this.#enforceIndexedPalette();
	}

	renamePalette(id: string, name: string): void {
		const palette = this.palettes.find((item) => item.id === id);
		if (!palette || palette.builtin || this.paletteLocked) return;
		const trimmed = name.trim();
		if (!trimmed) return;
		palette.name = trimmed.slice(0, 40);
		this.#persistPalettes();
	}

	/**
	 * Copies a read-only palette (the built-in default) into an editable
	 * workspace palette with the same colors and makes it active. Adding a color
	 * to a read-only palette forks it instead of failing, so the color dialog's
	 * **Add to palette** button always has a sensible destination.
	 */
	#forkReadonlyPalette(source: Palette): Palette {
		const baseName = `${source.name} copy`.slice(0, 40);
		const usedNames = new Set(
			this.palettes.map((palette) => palette.name.toLowerCase()),
		);
		let name = baseName;
		let suffixIndex = 2;
		while (usedNames.has(name.toLowerCase())) {
			const suffix = ` (${suffixIndex})`;
			name = `${baseName.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
			suffixIndex++;
		}

		const palette: Palette = {
			id: uid("palette"),
			name,
			colors: [...source.colors],
			originalColors: [...(source.originalColors ?? source.colors)],
			sortMode: source.sortMode ?? "original",
		};
		this.palettes.push(palette);
		this.activePaletteId = palette.id;
		return palette;
	}

	/**
	 * Appends a color to the active palette. Duplicates are allowed (the palette
	 * tools can remove them). Read-only palettes are forked first. Returns false
	 * when the palette is locked or full.
	 */
	addPaletteColor(color: string = this.primaryColor): boolean {
		if (this.paletteLocked) return false;
		const normalized = normalizeHex(color);
		if (!normalized) return false;

		const palette = this.activePalette.builtin
			? this.#forkReadonlyPalette(this.activePalette)
			: this.activePalette;
		if (palette.colors.length >= MAX_PALETTE_COLORS) return false;

		palette.colors.push(normalized);
		if (palette.originalColors) {
			palette.originalColors.push(normalized);
		} else {
			palette.originalColors = [...palette.colors];
		}
		if (palette.sortMode && palette.sortMode !== "original") {
			palette.colors = sortPaletteColors(
				palette.originalColors,
				palette.sortMode,
			);
		}
		this.#persistPalettes();
		return true;
	}

	removePaletteColor(index: number): void {
		const palette = this.activePalette;
		if (!this.paletteEditable) return;
		if (index < 0 || index >= palette.colors.length) return;
		this.#removePaletteColorAt(palette, index);
	}

	removeLastPaletteColor(): void {
		const palette = this.activePalette;
		if (!this.paletteEditable || palette.colors.length === 0) return;
		this.#removePaletteColorAt(palette, palette.colors.length - 1);
	}

	/**
	 * Moves a palette swatch into a new gap. A manual arrangement becomes the
	 * palette's original order and clears any active sort mode.
	 */
	movePaletteColor(from: number, insertAt: number): boolean {
		const palette = this.activePalette;
		if (!this.paletteEditable) return false;

		const colors = reorderPaletteColor(palette.colors, from, insertAt);
		if (colors.every((color, index) => color === palette.colors[index])) {
			return false;
		}

		palette.colors = colors;
		palette.originalColors = [...colors];
		palette.sortMode = "original";
		this.#persistPalettes();
		return true;
	}

	#removePaletteColorAt(palette: Palette, index: number): void {
		const [removed] = palette.colors.splice(index, 1);
		if (removed === undefined) return;

		const originalColors = palette.originalColors ?? [...palette.colors];
		const originalIndex = originalColors.indexOf(removed);
		if (originalIndex >= 0) originalColors.splice(originalIndex, 1);
		palette.originalColors = originalColors;

		if (palette.sortMode && palette.sortMode !== "original") {
			palette.colors = sortPaletteColors(originalColors, palette.sortMode);
		}
		this.#persistPalettes();
		// The removed color may still be painted on the canvas in indexed mode.
		this.#enforceIndexedPalette();
	}

	/** Sorts a custom palette without losing its original add/import order. */
	sortPalette(id: string, mode: PaletteSortMode): void {
		const palette = this.palettes.find((item) => item.id === id);
		if (!palette || palette.builtin || this.paletteLocked) return;

		const original = palette.originalColors ?? palette.colors;
		palette.originalColors = [...original];
		palette.colors = sortPaletteColors(original, mode);
		palette.sortMode = mode;
		this.#persistPalettes();
	}

	/** Removes duplicate colors from a custom palette and its original order. */
	dedupePalette(id: string): void {
		const palette = this.palettes.find((item) => item.id === id);
		if (!palette || palette.builtin || this.paletteLocked) return;

		const colors = [...new Set(palette.colors)];
		const originalColors = [
			...new Set(palette.originalColors ?? palette.colors),
		];
		const unchanged =
			colors.length === palette.colors.length &&
			originalColors.length ===
				(palette.originalColors?.length ?? palette.colors.length);
		if (unchanged) return;

		palette.originalColors = originalColors;
		palette.colors =
			palette.sortMode && palette.sortMode !== "original"
				? sortPaletteColors(originalColors, palette.sortMode)
				: colors;
		this.#persistPalettes();
	}

	/**
	 * Measures palette usage against every normal layer of the active document.
	 * Reference layers are ignored.
	 */
	analyzePaletteCoverage(colors: readonly string[] = this.activePalette.colors) {
		return analyzePaletteCoverage(this.doc, colors);
	}

	/**
	 * Removes palette entries that no normal layer uses in any frame. Reference
	 * layers are ignored, and the built-in or locked palettes are never touched.
	 * Returns the number of removed colors.
	 */
	removeUnusedPaletteColors(): number {
		const palette = this.activePalette;
		if (!this.paletteEditable) return 0;

		const unused = unusedPaletteColors(this.doc, palette.colors);
		if (unused.length === 0) return 0;
		const removed = new Set(unused);
		const originalColors = (palette.originalColors ?? palette.colors).filter(
			(color) => !removed.has(color),
		);
		palette.originalColors = originalColors;
		palette.colors =
			palette.sortMode && palette.sortMode !== "original"
				? sortPaletteColors(originalColors, palette.sortMode)
				: palette.colors.filter((color) => !removed.has(color));
		this.#persistPalettes();
		return unused.length;
	}

	/** Adds an imported palette, makes it active, and returns its id. */
	importPalette(name: string, colors: string[]): string | null {
		const unique: string[] = [];
		for (const color of colors) {
			const normalized = normalizeHex(color);
			if (!normalized || unique.includes(normalized)) continue;
			unique.push(normalized);
			if (unique.length >= MAX_PALETTE_COLORS) break;
		}
		if (unique.length === 0) return null;

		const baseName = (name.trim() || "Imported palette").slice(0, 40);
		const usedNames = new Set(this.palettes.map((palette) => palette.name.toLowerCase()));
		let paletteName = baseName;
		let suffixIndex = 2;
		while (usedNames.has(paletteName.toLowerCase())) {
			const suffix = ` (${suffixIndex})`;
			paletteName = `${baseName.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
			suffixIndex++;
		}

		const palette: Palette = {
			id: uid("palette"),
			name: paletteName,
			colors: unique,
			originalColors: [...unique],
			sortMode: "original",
		};
		this.palettes.push(palette);
		this.activePaletteId = palette.id;
		this.#persistPalettes();
		this.#enforceIndexedPalette();
		return palette.id;
	}

	/**
	 * Switches the document between RGBA and indexed color. Both directions are
	 * undoable. Converting to indexed records history first, then snaps every
	 * normal-layer cel to the active palette; converting back keeps the pixels.
	 */
	setColorMode(mode: ColorMode): boolean {
		if (mode !== "indexed" && mode !== "rgba") return false;
		if (mode === this.colorMode) return false;

		if (mode === "indexed") {
			this.pushHistory("Switch to indexed color");
			this.doc.colorMode = "indexed";
			snapDocToPalette(this.doc, this.activePalette.colors);
		} else {
			this.pushHistory("Switch to RGBA color");
			this.doc.colorMode = "rgba";
		}

		this.structureRevision++;
		this.revision++;
		this.dirty = true;
		this.modified = true;
		return true;
	}

	/**
	 * Snaps existing artwork to the active palette when the document is indexed.
	 * Used after palette edits that can orphan canvas colors (removing a swatch,
	 * switching or importing a palette). Palette changes are workspace-level and
	 * not undoable, so this pixel conversion is not a separate history entry.
	 * Returns the number of changed pixels.
	 */
	#enforceIndexedPalette(): number {
		if (!this.indexedMode) return 0;
		const changed = snapDocToPalette(this.doc, this.activePalette.colors);
		if (changed > 0) {
			this.structureRevision++;
			this.revision++;
			this.dirty = true;
			this.modified = true;
		}
		return changed;
	}

	toggleTheme(): void {
		this.theme = this.theme === "dark" ? "light" : "dark";
	}

	zoomIn(): void {
		this.zoom = clamp(this.effectiveZoom + 1, MIN_ZOOM, MAX_ZOOM);
	}

	zoomOut(): void {
		this.zoom = clamp(this.effectiveZoom - 1, MIN_ZOOM, MAX_ZOOM);
	}

	setGridWidth(size: number): void {
		this.gridWidth = normalizeGridSize(size, this.gridWidth);
	}

	setGridHeight(size: number): void {
		this.gridHeight = normalizeGridSize(size, this.gridHeight);
	}

	/** Set both directions at once; used by the pill's square presets. */
	setGridSize(size: number): void {
		const next = normalizeGridSize(size, this.gridWidth);
		this.gridWidth = next;
		this.gridHeight = next;
	}

	setGridOffsetX(offset: number): void {
		this.gridOffsetX = normalizeGridOffset(offset, this.gridOffsetX);
	}

	setGridOffsetY(offset: number): void {
		this.gridOffsetY = normalizeGridOffset(offset, this.gridOffsetY);
	}

	gridSnapshot(): GridSettings {
		return {
			enabled: this.showGrid,
			pixelEnabled: this.showPixelGrid,
			mode: this.gridMode,
			width: this.gridWidth,
			height: this.gridHeight,
			offsetX: this.gridOffsetX,
			offsetY: this.gridOffsetY,
			hexOrientation: this.gridHexOrientation,
		};
	}

	persistGridSettings(): void {
		saveGridSettings(this.gridSnapshot());
	}

	resetGridSettings(): void {
		this.showGrid = DEFAULT_GRID_SETTINGS.enabled;
		this.showPixelGrid = DEFAULT_GRID_SETTINGS.pixelEnabled;
		this.gridMode = DEFAULT_GRID_SETTINGS.mode;
		this.gridWidth = DEFAULT_GRID_SETTINGS.width;
		this.gridHeight = DEFAULT_GRID_SETTINGS.height;
		this.gridOffsetX = DEFAULT_GRID_SETTINGS.offsetX;
		this.gridOffsetY = DEFAULT_GRID_SETTINGS.offsetY;
		this.gridHexOrientation = DEFAULT_GRID_SETTINGS.hexOrientation;
	}

	setRotation(degrees: number): void {
		if (!Number.isFinite(degrees)) return;
		const snapped = Math.round(degrees / 15) * 15;
		this.rotation = clamp(snapped, -180, 180);
	}

	rotateBy(degrees: number): void {
		if (!Number.isFinite(degrees)) return;
		this.rotation = clamp(this.rotation + degrees, -180, 180);
	}

	fitToWindow(): void {
		this.zoom = null;
		this.panX = 0;
		this.panY = 0;
	}

	touch(): void {
		this.revision++;
		this.dirty = true;
		this.modified = true;
		// Editing a linked cel writes through to another frame, so that frame's
		// thumbnail and composite must refresh even though it is not active.
		if (
			this.isCelLinkedTo(this.activeLayerId, this.activeFrame, -1) ||
			this.isCelLinkedTo(this.activeLayerId, this.activeFrame, 1)
		) {
			this.structureRevision++;
		}
	}

	#autosaveRecord(
		id: string,
		doc: PixelDoc,
		name: string,
		activeFrame: number,
		activeLayerId: string,
		active: boolean,
		position: number,
		filePath?: string | null,
	): AutosaveRecord | null {
		try {
			return {
				id,
				name,
				bytes: serializeProject(
					doc,
					this.activePalette.colors,
					name,
					activeFrame,
					activeLayerId,
				),
				active,
				position,
				savedAt: Date.now(),
				...(filePath ? { filePath } : {}),
			};
		} catch {
			// Documents that are too large for the project format remain fully
			// editable; they simply cannot be written to the recovery store.
			return null;
		}
	}

	#autosaveActiveProject(active: boolean): AutosaveRecord | null {
		if (!this.dirty) return null;
		const record = this.#autosaveRecord(
			this.activeProjectId,
			this.doc,
			this.name,
			this.activeFrame,
			this.activeLayerId,
			active,
			Math.max(
				0,
				this.projects.findIndex(
					(project) => project.id === this.activeProjectId,
				),
			),
			this.activeFilePath,
		);
		if (record) void writeAutosave(record);
		return record;
	}

	/**
	 * Mirrors a recovery snapshot into the project file when the desktop app is
	 * running with autosave enabled. The browser never writes project files on
	 * its own, so this stays opt-in and desktop-only.
	 */
	#writeDesktopAutosave(record: AutosaveRecord | null): void {
		const api = desktopApi();
		const filePath = this.activeFilePath;
		if (!record || !api || !filePath || !this.desktopAutosave) return;
		const projectId = this.activeProjectId;
		const projectName = this.name;
		const revision = this.revision;
		const structureRevision = this.structureRevision;
		void api
			.writeProjectFile(filePath, record.bytes, this.name, false)
			.then((result) => {
				if (!result.ok) return;
				if (this.activeProjectId !== projectId) return;
				if (
					this.revision !== revision ||
					this.structureRevision !== structureRevision ||
					this.name !== projectName ||
					this.activeFilePath !== filePath ||
					!this.dirty
				) {
					return;
				}
				this.markSaved();
			})
			.catch(() => {
				// Disk autosave is best-effort; explicit Save reports its errors.
			});
	}

	/**
	 * Writes a recovery snapshot for the active project. Autosaves are kept in
	 * IndexedDB so unsaved tabs survive a crash or reload.
	 */
	autosaveNow(): void {
		const record = this.#autosaveActiveProject(true);
		this.#writeDesktopAutosave(record);
	}

	/**
	 * Writes a snapshot for every dirty tab, including inactive ones. Used after
	 * restoring a workspace so a second crash cannot drop the other tabs.
	 */
	autosaveAll(): void {
		const record = this.#autosaveActiveProject(true);
		this.#writeDesktopAutosave(record);
		for (const project of this.projects) {
			if (project.id === this.activeProjectId) continue;
			const snapshot = this.#states.get(project.id);
			if (!snapshot || !project.dirty) continue;
			const record = this.#autosaveRecord(
				project.id,
				snapshot.doc,
				project.name,
				snapshot.activeFrame,
				snapshot.activeLayerId,
				false,
				Math.max(
					0,
					this.projects.findIndex((item) => item.id === project.id),
				),
				project.filePath,
			);
			if (record) void writeAutosave(record);
		}
	}

	#entryBytes(entry: HistoryEntry): number {
		if (entry.kind === "cels") {
			let bytes = 0;
			for (const patch of entry.patches) bytes += patch.pixels.byteLength;
			return bytes;
		}
		return (
			entry.doc.width *
			entry.doc.height *
			4 *
			entry.doc.frames.length *
			entry.doc.layers.length
		);
	}

	/** Pushes a labeled entry and clears the redo stack. */
	#recordHistory(entry: HistoryEntry): void {
		this.#undo.push(entry);
		this.#undoBytes += this.#entryBytes(entry);
		this.#trimHistory();
		this.#redo = [];
		this.#redoBytes = 0;
		this.undoCount = this.#undo.length;
		this.redoCount = 0;
		this.dirty = true;
		this.modified = true;
	}

	/** Human-readable context for a cel patch, shown in the history dialog. */
	#celDetail(patches: readonly CelPatch[]): string {
		if (patches.length === 0) return "";
		const frames = new Set(patches.map((patch) => patch.frame));
		const layerIds = new Set(patches.map((patch) => patch.layerId));
		const first = patches[0]!;

		if (layerIds.size === 1) {
			const layer = this.doc.layers.find((item) => item.id === first.layerId);
			const name = layer?.name ?? "Layer";
			return frames.size === 1
				? `${name} · Frame ${first.frame + 1}`
				: `${name} · ${frames.size} frames`;
		}
		if (frames.size === 1) {
			return `${layerIds.size} layers · Frame ${first.frame + 1}`;
		}
		return `${patches.length} cels`;
	}

	/** Records a full document snapshot. Used for structural edits. */
	pushHistory(label = "Edit document"): void {
		// Any new edit implicitly applies content that is still floating.
		if (this.floating) this.commitFloatingSelection();
		this.#recordHistory({
			kind: "full",
			doc: cloneDoc(this.doc),
			id: uid("history"),
			label,
		});
	}

	/**
	 * Records only the active cel before a pixel edit. This is the hot path for
	 * drawing, so it must not clone every layer and frame in the document.
	 */
	pushHistoryCel(
		layerId: string = this.activeLayerId,
		frame: number = this.activeFrame,
		label = "Pixel edit",
	): void {
		if (this.floating) this.commitFloatingSelection();
		const layer = this.doc.layers.find((item) => item.id === layerId);
		const cel = layer?.cels[frame];
		if (!cel) return;
		const patches: CelPatch[] = [
			{ layerId, frame, pixels: new Uint32Array(cel) },
		];
		this.#recordHistory({
			kind: "cels",
			patches,
			id: uid("history"),
			label,
			detail: this.#celDetail(patches),
		});
	}

	/** Records several cels at once (for example, clearing a whole frame). */
	pushHistoryCels(
		patches: { layerId: string; frame: number }[],
		label = "Pixel edit",
	): void {
		if (this.floating) this.commitFloatingSelection();
		const captured: CelPatch[] = [];
		for (const patch of patches) {
			const layer = this.doc.layers.find((item) => item.id === patch.layerId);
			const cel = layer?.cels[patch.frame];
			if (!cel) continue;
			captured.push({
				layerId: patch.layerId,
				frame: patch.frame,
				pixels: new Uint32Array(cel),
			});
		}
		if (captured.length === 0) return;
		this.#recordHistory({
			kind: "cels",
			patches: captured,
			id: uid("history"),
			label,
			detail: this.#celDetail(captured),
		});
	}

	#trimHistory(): void {
		while (
			this.#undo.length > this.historyLimit ||
			(this.#undo.length > 1 && this.#undoBytes > HISTORY_BYTE_LIMIT)
		) {
			const removed = this.#undo.shift();
			if (!removed) break;
			this.#undoBytes -= this.#entryBytes(removed);
		}
		if (this.#undoBytes < 0) this.#undoBytes = 0;
	}

	/** Captures the current state of the cels an entry will overwrite. */
	#captureHistoryEntry(entry: HistoryEntry): HistoryEntry {
		if (entry.kind === "full") {
			return {
				kind: "full",
				doc: cloneDoc(this.doc),
				id: entry.id,
				label: entry.label,
				detail: entry.detail,
			};
		}
		const patches: CelPatch[] = [];
		for (const patch of entry.patches) {
			const layer = this.doc.layers.find((item) => item.id === patch.layerId);
			const cel = layer?.cels[patch.frame];
			patches.push({
				layerId: patch.layerId,
				frame: patch.frame,
				pixels: cel ? new Uint32Array(cel) : new Uint32Array(patch.pixels),
			});
		}
		return {
			kind: "cels",
			patches,
			id: entry.id,
			label: entry.label,
			detail: entry.detail,
		};
	}

	#applyHistoryEntry(entry: HistoryEntry): void {
		if (entry.kind === "full") {
			this.doc = entry.doc;
			return;
		}
		for (const patch of entry.patches) {
			const layer = this.doc.layers.find((item) => item.id === patch.layerId);
			const cel = layer?.cels[patch.frame];
			if (cel) cel.set(patch.pixels);
		}
	}

	undo(): void {
		if (this.floating) this.commitFloatingSelection();
		const previous = this.#undo.pop();
		if (!previous) return;
		this.#undoBytes -= this.#entryBytes(previous);
		const redoEntry = this.#captureHistoryEntry(previous);
		this.#redo.push(redoEntry);
		this.#redoBytes += this.#entryBytes(redoEntry);
		this.#applyHistoryEntry(previous);
		this.#afterHistoryRestore();
		this.undoCount = this.#undo.length;
		this.redoCount = this.#redo.length;
	}

	redo(): void {
		if (this.floating) this.commitFloatingSelection();
		const next = this.#redo.pop();
		if (!next) return;
		this.#redoBytes -= this.#entryBytes(next);
		const undoEntry = this.#captureHistoryEntry(next);
		this.#undo.push(undoEntry);
		this.#undoBytes += this.#entryBytes(undoEntry);
		this.#trimHistory();
		this.#applyHistoryEntry(next);
		this.#afterHistoryRestore();
		this.undoCount = this.#undo.length;
		this.redoCount = this.#redo.length;
	}

	/**
	 * Jumps to a history position (see `historyRows`). Position 0 is the oldest
	 * recorded state and `historyPosition` is the current one; later positions
	 * are redoable states. Each step reuses `undo`/`redo` so selection restore,
	 * labels, and byte accounting stay consistent.
	 */
	jumpToHistory(position: number): void {
		if (this.floating) this.commitFloatingSelection();
		const total = this.#undo.length + this.#redo.length;
		const target = clamp(Math.round(position), 0, total);
		let current = this.#undo.length;

		while (current > target) {
			this.undo();
			if (this.#undo.length === current) break;
			current = this.#undo.length;
		}
		while (current < target) {
			this.redo();
			if (this.#undo.length === current) break;
			current = this.#undo.length;
		}
	}

	/** Undoes until the document matches the earliest retained state. */
	revertHistory(): void {
		this.jumpToHistory(0);
	}

	#afterHistoryRestore(): void {
		if (!this.doc.layers.some((layer) => layer.id === this.activeLayerId)) {
			this.activeLayerId = this.doc.layers[this.doc.layers.length - 1]!.id;
		}
		this.#restoreLayerSelection(this.layerSelection, this.#layerAnchorId);
		if (
			this.activeReferenceId &&
			!this.doc.references.some(
				(reference) => reference.id === this.activeReferenceId,
			)
		) {
			this.activeReferenceId = null;
		}
		this.activeFrame = clamp(this.activeFrame, 0, this.doc.frames.length - 1);
		this.#restoreFrameSelection(this.frameSelection, this.#frameAnchorId);
		this.playing = false;
		this.floating = null;
		// The selection may no longer match the restored pixels.
		this.selection = null;
		this.selectionRevision++;
		this.structureRevision++;
		this.historyActionRevision++;
		this.revision++;
		this.dirty = true;
		this.modified = true;
	}

	#restoreLayerSelection(ids: string[], anchorId: string | null): void {
		const valid = new Set(this.doc.layers.map((layer) => layer.id));
		const selection = (Array.isArray(ids) ? ids : []).filter((id) =>
			valid.has(id),
		);
		const activeId = valid.has(this.activeLayerId)
			? this.activeLayerId
			: this.doc.layers[this.doc.layers.length - 1]?.id;
		if (activeId && this.activeLayerId !== activeId) {
			this.activeLayerId = activeId;
		}
		if (activeId && !selection.includes(activeId)) selection.push(activeId);
		this.layerSelection =
			selection.length > 0 ? selection : activeId ? [activeId] : [];
		this.#layerAnchorId =
			anchorId && valid.has(anchorId) ? anchorId : (activeId ?? null);
	}

	#restoreFrameSelection(ids: string[], anchorId: string | null): void {
		const valid = new Set(this.doc.frames.map((frame) => frame.id));
		const selection = (Array.isArray(ids) ? ids : []).filter((id) =>
			valid.has(id),
		);
		const activeId = this.doc.frames[this.activeFrame]?.id;
		if (activeId && !selection.includes(activeId)) selection.push(activeId);
		this.frameSelection =
			selection.length > 0 ? selection : activeId ? [activeId] : [];
		this.#frameAnchorId =
			anchorId && valid.has(anchorId) ? anchorId : (activeId ?? null);
	}

	#syncActiveProject(): void {
		if (this.floating) this.commitFloatingSelection();

		const tab = this.projects.find((project) => project.id === this.activeProjectId);
		const snapshot = this.#states.get(this.activeProjectId);
		if (!tab || !snapshot) return;

		// Persist the outgoing tab before its live fields are replaced. This is
		// skipped when the tab was already removed (for example, when closing
		// the last project), so a discarded autosave cannot be resurrected.
		this.#autosaveActiveProject(false);

		tab.name = this.name;
		tab.dirty = this.dirty;
		tab.modified = this.modified;
		tab.filePath = this.activeFilePath ?? undefined;
		snapshot.doc = this.doc;
		snapshot.activeLayerId = this.activeLayerId;
		snapshot.activeFrame = this.activeFrame;
		snapshot.activeReferenceId = this.activeReferenceId;
		snapshot.layerSelection = this.layerSelection;
		snapshot.layerAnchorId = this.#layerAnchorId;
		snapshot.frameSelection = this.frameSelection;
		snapshot.frameAnchorId = this.#frameAnchorId;
		snapshot.zoom = this.zoom;
		snapshot.panX = this.panX;
		snapshot.panY = this.panY;
		snapshot.rotation = this.rotation;
		snapshot.selection = this.selection;
		snapshot.undo = this.#undo;
		snapshot.redo = this.#redo;
		snapshot.undoBytes = this.#undoBytes;
		snapshot.redoBytes = this.#redoBytes;
	}

	#activateProject(id: string): void {
		const tab = this.projects.find((project) => project.id === id);
		const snapshot = this.#states.get(id);
		if (!tab || !snapshot) return;

		this.activeProjectId = id;
		this.doc = snapshot.doc;
		this.activeLayerId = snapshot.activeLayerId;
		this.activeFrame = snapshot.activeFrame;
		this.activeReferenceId = snapshot.activeReferenceId;
		this.#restoreLayerSelection(snapshot.layerSelection, snapshot.layerAnchorId);
		this.#restoreFrameSelection(snapshot.frameSelection, snapshot.frameAnchorId);
		this.zoom = snapshot.zoom;
		this.panX = snapshot.panX;
		this.panY = snapshot.panY;
		this.rotation = snapshot.rotation;
		this.floating = null;
		this.selection = snapshot.selection;
		this.selectionRevision++;
		this.name = tab.name;
		this.dirty = tab.dirty;
		this.modified = tab.modified;
		this.activeFilePath = tab.filePath ?? null;
		this.#undo = snapshot.undo;
		this.#redo = snapshot.redo;
		this.#undoBytes = snapshot.undoBytes;
		this.#redoBytes = snapshot.redoBytes;
		this.undoCount = snapshot.undo.length;
		this.redoCount = snapshot.redo.length;
		this.cursor = null;
		this.playing = false;
		this.structureRevision++;
		this.revision++;
	}

	#nextUntitledName(): string {
		const names = new Set(
			this.projects.map((project) =>
				project.id === this.activeProjectId ? this.name : project.name,
			),
		);
		if (!names.has("Untitled")) return "Untitled";
		let index = 2;
		while (names.has(`Untitled ${index}`)) index++;
		return `Untitled ${index}`;
	}

	isProjectDirty(id: string): boolean {
		if (id === this.activeProjectId) return this.dirty;
		return this.projects.find((project) => project.id === id)?.dirty ?? false;
	}

	isProjectModified(id: string): boolean {
		if (id === this.activeProjectId) return this.modified;
		return this.projects.find((project) => project.id === id)?.modified ?? false;
	}

	projectName(id: string): string {
		if (id === this.activeProjectId) return this.name;
		return this.projects.find((project) => project.id === id)?.name ?? "Untitled";
	}

	/** Desktop project path for a tab, or null when it has never been saved. */
	projectFilePath(id: string): string | null {
		if (id === this.activeProjectId) return this.activeFilePath;
		return this.projects.find((project) => project.id === id)?.filePath ?? null;
	}

	/** Associates the active tab with a desktop file path. */
	setActiveFilePath(filePath: string | null): void {
		this.activeFilePath = filePath;
		const tab = this.projects.find(
			(project) => project.id === this.activeProjectId,
		);
		if (tab) tab.filePath = filePath ?? undefined;
	}

	setDesktopAutosave(enabled: boolean): void {
		this.desktopAutosave = enabled;
		try {
			localStorage.setItem("pixel-spell-desktop-autosave", String(enabled));
		} catch {
			// Preferences are best-effort in restricted storage contexts.
		}
	}

	toggleDesktopAutosave(): void {
		this.setDesktopAutosave(!this.desktopAutosave);
	}

	/** Renames the active project tab and marks the project as unsaved. */
	renameProject(name: string): boolean {
		const trimmed = name.trim().slice(0, 60);
		if (!trimmed || trimmed === this.name) return false;

		this.name = trimmed;
		this.dirty = true;
		this.modified = true;

		const tab = this.projects.find(
			(project) => project.id === this.activeProjectId,
		);
		if (tab) {
			tab.name = trimmed;
			tab.dirty = true;
			tab.modified = true;
		}
		return true;
	}

	selectProject(id: string): void {
		if (id === this.activeProjectId) return;
		if (!this.projects.some((project) => project.id === id)) return;
		this.#syncActiveProject();
		this.#activateProject(id);
	}

	closeProject(id: string): void {
		const index = this.projects.findIndex((project) => project.id === id);
		if (index < 0) return;
		if (this.projects.length === 1 && !this.isProjectModified(id)) return;

		const wasActive = id === this.activeProjectId;
		this.projects.splice(index, 1);
		this.#states.delete(id);
		// Closing without saving explicitly discards the recoverable work.
		void deleteAutosave(id);

		if (this.projects.length === 0) {
			this.newProject(32, 32);
			return;
		}

		if (wasActive) {
			const next = this.projects[Math.min(index, this.projects.length - 1)]!;
			this.#activateProject(next.id);
		} else {
			this.revision++;
		}
	}

	newProject(
		width: number,
		height: number,
		options: {
			name?: string;
			background?: BackgroundKind;
			colorMode?: ColorMode;
		} = {},
	): void {
		const w = clamp(Math.round(width) || 32, MIN_CANVAS_SIZE, MAX_CANVAS_SIZE);
		const h = clamp(Math.round(height) || 32, MIN_CANVAS_SIZE, MAX_CANVAS_SIZE);
		const colorMode: ColorMode =
			options.colorMode === "indexed" ? "indexed" : "rgba";
		const doc = createDoc(w, h, options.background ?? "transparent", colorMode);
		// A white or black starter fill must also obey an indexed document.
		if (colorMode === "indexed") {
			snapDocToPalette(doc, this.activePalette.colors);
		}
		const requestedName = options.name?.trim().slice(0, 60);
		const name = requestedName || this.#nextUntitledName();

		this.#syncActiveProject();
		const id = uid("project");
		this.#states.set(id, {
			doc,
			activeLayerId: doc.layers[0].id,
			activeFrame: 0,
			activeReferenceId: null,
			layerSelection: [doc.layers[0].id],
			layerAnchorId: doc.layers[0].id,
			frameSelection: [doc.frames[0]!.id],
			frameAnchorId: doc.frames[0]!.id,
			zoom: null,
			panX: 0,
			panY: 0,
			rotation: 0,
			selection: null,
			undo: [],
			redo: [],
			undoBytes: 0,
			redoBytes: 0,
		});
		this.projects.push({ id, name, dirty: false, modified: false });
		this.#activateProject(id);
	}

	openProject(
		project: LoadedProject,
		options: { dirty?: boolean; filePath?: string } = {},
	): string {
		const doc = project.doc;
		const activeLayerId = doc.layers.some((layer) => layer.id === project.activeLayerId)
			? project.activeLayerId
			: doc.layers[doc.layers.length - 1]!.id;
		const activeFrame = clamp(project.activeFrame ?? 0, 0, doc.frames.length - 1);
		const name = project.name?.trim() || this.#nextUntitledName();

		this.#syncActiveProject();
		const id = uid("project");
		this.#states.set(id, {
			doc,
			activeLayerId,
			activeFrame,
			activeReferenceId: null,
			layerSelection: [activeLayerId],
			layerAnchorId: activeLayerId,
			frameSelection: [doc.frames[activeFrame]!.id],
			frameAnchorId: doc.frames[activeFrame]!.id,
			zoom: null,
			panX: 0,
			panY: 0,
			rotation: 0,
			selection: null,
			undo: [],
			redo: [],
			undoBytes: 0,
			redoBytes: 0,
		});
		this.projects.push({
			id,
			name,
			dirty: options.dirty === true,
			modified: true,
			...(options.filePath ? { filePath: options.filePath } : {}),
		});
		this.#activateProject(id);
		return id;
	}

	/** Creates a new, unsaved project tab from an imported image. */
	importImageProject(image: {
		name: string;
		width: number;
		height: number;
		pixels: Uint32Array;
	}): void {
		const width = clamp(Math.round(image.width) || 1, MIN_CANVAS_SIZE, MAX_CANVAS_SIZE);
		const height = clamp(Math.round(image.height) || 1, MIN_CANVAS_SIZE, MAX_CANVAS_SIZE);
		const pixels = new Uint32Array(width * height);
		pixels.set(image.pixels.subarray(0, Math.min(image.pixels.length, pixels.length)));

		const doc: PixelDoc = {
			width,
			height,
			fps: 12,
			frames: [{ id: uid("frame") }],
			layers: [
				{
					id: uid("layer"),
					name: "Imported image",
					visible: true,
					locked: false,
					opacity: 1,
					cels: [pixels],
				},
			],
			references: [],
		};

		const requestedName = image.name.trim().slice(0, 60);
		const name = requestedName || this.#nextUntitledName();

		this.#syncActiveProject();
		const id = uid("project");
		this.#states.set(id, {
			doc,
			activeLayerId: doc.layers[0]!.id,
			activeFrame: 0,
			activeReferenceId: null,
			layerSelection: [doc.layers[0]!.id],
			layerAnchorId: doc.layers[0]!.id,
			frameSelection: [doc.frames[0]!.id],
			frameAnchorId: doc.frames[0]!.id,
			zoom: null,
			panX: 0,
			panY: 0,
			rotation: 0,
			selection: null,
			undo: [],
			redo: [],
			undoBytes: 0,
			redoBytes: 0,
		});
		this.projects.push({ id, name, dirty: true, modified: true });
		this.#activateProject(id);
	}

	/** Adds an imported image as a new normal layer on the active frame. */
	importImageLayer(image: {
		name: string;
		width: number;
		height: number;
		pixels: Uint32Array;
	}): void {
		if (this.doc.layers.length >= MAX_PROJECT_LAYERS) return;
		const imageWidth = Math.max(1, Math.round(image.width));
		const imageHeight = Math.max(1, Math.round(image.height));
		if (image.pixels.length === 0) return;

		this.pushHistory("Import layer");
		const layer = createLayer(
			image.name.trim().slice(0, 60) || "Imported layer",
			this.doc.width,
			this.doc.height,
			this.doc.frames.length,
		);
		const cel = layer.cels[this.activeFrame]!;
		cel.set(
			this.#indexedPixels(
				cropPixelsToCanvas(
					image.pixels,
					imageWidth,
					imageHeight,
					this.doc.width,
					this.doc.height,
				),
			),
		);
		this.doc.layers.push(layer);
		this.#setActiveLayer(layer.id);
		this.activeReferenceId = null;
		this.structureRevision++;
		this.revision++;
	}

	/** Adds an imported image as a new frame on a normal layer. */
	importImageFrame(image: {
		name: string;
		width: number;
		height: number;
		pixels: Uint32Array;
	}): void {
		if (this.doc.frames.length >= MAX_PROJECT_FRAMES) return;
		const imageWidth = Math.max(1, Math.round(image.width));
		const imageHeight = Math.max(1, Math.round(image.height));
		if (image.pixels.length === 0) return;

		const active = this.activeLayer;
		let target =
			active && active.role !== "reference" && !active.locked ? active : null;
		if (!target) {
			for (let index = this.doc.layers.length - 1; index >= 0; index--) {
				const layer = this.doc.layers[index]!;
				if (layer.role !== "reference" && !layer.locked && layer.visible) {
					target = layer;
					break;
				}
			}
		}

		if (!target && this.doc.layers.length >= MAX_PROJECT_LAYERS) return;
		this.pushHistory("Import frame");
		if (!target) {
			target = createLayer(
				image.name.trim().slice(0, 60) || "Imported frame",
				this.doc.width,
				this.doc.height,
				this.doc.frames.length,
			);
			this.doc.layers.push(target);
		}

		const index = this.activeFrame + 1;
		const sourceFrame = this.doc.frames[this.activeFrame]!;
		const frame: Frame = {
			id: uid("frame"),
			...(sourceFrame.duration !== undefined
				? { duration: sourceFrame.duration }
				: {}),
		};
		this.doc.frames.splice(index, 0, frame);
		for (const layer of this.doc.layers) {
			if (isGroupLayer(layer)) continue;
			const source =
				layer.role === "reference" ? layer.cels[this.activeFrame] : undefined;
			layer.cels.splice(
				index,
				0,
				source
					? new Uint32Array(source)
					: new Uint32Array(this.doc.width * this.doc.height),
			);
		}

		const cel = target.cels[index]!;
		cel.set(
			this.#indexedPixels(
				cropPixelsToCanvas(
					image.pixels,
					imageWidth,
					imageHeight,
					this.doc.width,
					this.doc.height,
				),
			),
		);
		this.activeFrame = index;
		this.frameSelection = [this.doc.frames[index]!.id];
		this.#frameAnchorId = this.doc.frames[index]!.id;
		this.#setActiveLayer(target.id);
		this.activeReferenceId = null;
		this.structureRevision++;
		this.revision++;
	}

	/** Adds a locked, non-exported reference layer to the timeline. */
	importReferenceLayer(
		image: {
			name: string;
			width: number;
			height: number;
			pixels: Uint32Array;
		},
		options: { allFrames?: boolean } = {},
	): void {
		if (this.doc.layers.length >= MAX_PROJECT_LAYERS) return;
		const imageWidth = Math.max(1, Math.round(image.width));
		const imageHeight = Math.max(1, Math.round(image.height));
		if (image.pixels.length === 0) return;

		this.pushHistory("Import reference layer");
		const layer = createLayer(
			image.name.trim().slice(0, 60) || "Reference",
			this.doc.width,
			this.doc.height,
			this.doc.frames.length,
			"reference",
		);
		const fitted = fitPixelsToCanvas(
			image.pixels,
			imageWidth,
			imageHeight,
			this.doc.width,
			this.doc.height,
		);
		const allFrames = options.allFrames ?? true;
		if (allFrames) {
			for (const cel of layer.cels) cel.set(fitted);
		} else {
			layer.cels[this.activeFrame]?.set(fitted);
		}

		this.doc.layers.push(layer);
		this.#setActiveLayer(layer.id);
		this.activeReferenceId = null;
		this.structureRevision++;
		this.revision++;
	}

	/**
	 * Replaces the active reference layer's cel on the current frame. Returns
	 * false when the active layer is not a reference layer.
	 */
	setReferenceLayerImage(image: {
		width: number;
		height: number;
		pixels: Uint32Array;
	}): boolean {
		const layer = this.activeLayer;
		if (!layer || layer.role !== "reference") return false;
		const cel = layer.cels[this.activeFrame];
		if (!cel) return false;
		const imageWidth = Math.max(1, Math.round(image.width));
		const imageHeight = Math.max(1, Math.round(image.height));
		if (image.pixels.length === 0) return false;

		this.pushHistoryCel(layer.id, this.activeFrame, "Replace reference");
		cel.set(
			fitPixelsToCanvas(
				image.pixels,
				imageWidth,
				imageHeight,
				this.doc.width,
				this.doc.height,
			),
		);
		this.revision++;
		return true;
	}

	/** Adds an image to the project-level reference board. */
	addReferenceImage(image: {
		name: string;
		bytes: Uint8Array;
		mime: string;
		imageWidth: number;
		imageHeight: number;
	}): string | null {
		if (this.doc.references.length >= MAX_REFERENCE_COUNT) return null;
		if (image.bytes.length === 0) return null;
		const imageWidth = Math.max(1, Math.round(image.imageWidth));
		const imageHeight = Math.max(1, Math.round(image.imageHeight));

		this.pushHistory("Add board reference");
		const placement = defaultReferencePlacement(
			this.doc.width,
			this.doc.height,
			imageWidth,
			imageHeight,
			this.doc.references,
		);
		const reference: ReferenceImage = {
			id: uid("reference"),
			name: image.name.trim().slice(0, 60) || "Reference",
			bytes: image.bytes,
			mime: image.mime || "image/png",
			imageWidth,
			imageHeight,
			x: placement.x,
			y: placement.y,
			width: placement.width,
			height: placement.height,
			rotation: 0,
			opacity: 1,
			visible: true,
			locked: false,
		};
		this.doc.references.push(reference);
		this.activeReferenceId = reference.id;
		this.showReferenceBoard = true;
		this.structureRevision++;
		return reference.id;
	}

	removeReferenceImage(id: string): void {
		const index = this.doc.references.findIndex(
			(reference) => reference.id === id,
		);
		if (index < 0) return;
		this.pushHistory("Remove board reference");
		this.doc.references.splice(index, 1);
		if (this.activeReferenceId === id) this.activeReferenceId = null;
		this.structureRevision++;
	}

	moveReferenceImage(id: string, x: number, y: number): void {
		const reference = this.doc.references.find((item) => item.id === id);
		if (!reference || reference.locked || !Number.isFinite(x) || !Number.isFinite(y)) {
			return;
		}
		reference.x = x;
		reference.y = y;
		this.dirty = true;
		this.modified = true;
	}

	setReferenceSize(id: string, width: number): void {
		const reference = this.doc.references.find((item) => item.id === id);
		if (!reference || !Number.isFinite(width)) return;
		const nextWidth = clamp(Math.round(width), 1, 8192);
		const ratio = reference.imageHeight / Math.max(1, reference.imageWidth);
		const nextHeight = clamp(Math.round(nextWidth * ratio), 1, 8192);
		this.#resizeReferenceAroundCenter(reference, nextWidth, nextHeight);
	}

	setReferenceZoom(id: string, zoom: number): void {
		const reference = this.doc.references.find((item) => item.id === id);
		if (!reference || !Number.isFinite(zoom)) return;
		const nextZoom = clamp(zoom, 0.01, 4);
		const nextWidth = clamp(
			Math.round(reference.imageWidth * nextZoom),
			1,
			16384,
		);
		const nextHeight = clamp(
			Math.round(reference.imageHeight * nextZoom),
			1,
			16384,
		);
		this.#resizeReferenceAroundCenter(reference, nextWidth, nextHeight);
	}

	#resizeReferenceAroundCenter(
		reference: ReferenceImage,
		width: number,
		height: number,
	): void {
		const centerX = reference.x + reference.width / 2;
		const centerY = reference.y + reference.height / 2;
		reference.width = width;
		reference.height = height;
		reference.x = centerX - width / 2;
		reference.y = centerY - height / 2;
		this.dirty = true;
		this.modified = true;
	}

	setReferenceRotation(id: string, rotation: number): void {
		const reference = this.doc.references.find((item) => item.id === id);
		if (!reference || !Number.isFinite(rotation)) return;
		reference.rotation = clamp(rotation, -180, 180);
		this.dirty = true;
		this.modified = true;
	}

	setReferenceOpacity(id: string, opacity: number): void {
		const reference = this.doc.references.find((item) => item.id === id);
		if (!reference || !Number.isFinite(opacity)) return;
		reference.opacity = clamp(opacity, 0, 1);
		this.dirty = true;
		this.modified = true;
	}

	renameReference(id: string, name: string): void {
		const reference = this.doc.references.find((item) => item.id === id);
		const trimmed = name.trim();
		if (!reference || !trimmed) return;
		reference.name = trimmed.slice(0, 60);
		this.dirty = true;
		this.modified = true;
	}

	toggleReferenceVisibility(id: string): void {
		const reference = this.doc.references.find((item) => item.id === id);
		if (!reference) return;
		reference.visible = !reference.visible;
		this.dirty = true;
		this.modified = true;
	}

	toggleReferenceLock(id: string): void {
		const reference = this.doc.references.find((item) => item.id === id);
		if (!reference) return;
		reference.locked = !reference.locked;
		this.dirty = true;
		this.modified = true;
	}

	markSaved(): void {
		this.dirty = false;
		this.modified = true;
		// A saved project no longer needs a crash-recovery snapshot.
		void deleteAutosave(this.activeProjectId);
		this.#syncActiveProject();
	}

	#serializeActiveProject(): Uint8Array<ArrayBuffer> {
		return serializeProject(
			this.doc,
			this.activePalette.colors,
			this.name,
			this.activeFrame,
			this.activeLayerId,
		);
	}

	#reportSaveError(error: unknown): void {
		window.alert(
			error instanceof Error
				? error.message
				: "The project could not be saved.",
		);
	}

	/**
	 * Saves the active project. The browser downloads a file; the desktop app
	 * writes in place when the tab already has a path and otherwise opens the
	 * native Save dialog.
	 */
	async saveToFile(options: { saveAs?: boolean } = {}): Promise<void> {
		if (this.floating) this.commitFloatingSelection();

		const api = desktopApi();
		if (!api) {
			try {
				saveProjectFile(
					this.doc,
					this.activePalette.colors,
					this.name,
					this.activeFrame,
					this.activeLayerId,
				);
				this.markSaved();
			} catch (error) {
				this.#reportSaveError(error);
			}
			return;
		}

		try {
			const bytes = this.#serializeActiveProject();
			if (!options.saveAs && this.activeFilePath) {
				const result = await api.writeProjectFile(
					this.activeFilePath,
					bytes,
					this.name,
					true,
				);
				if (!result.ok) {
					throw new Error(result.error ?? "The project could not be saved.");
				}
				this.setActiveFilePath(result.path ?? this.activeFilePath);
			} else {
				const result = await api.saveProjectDialog(
					bytes,
					this.name,
					this.activeFilePath,
				);
				if (result.canceled) return;
				if (!result.ok || !result.path) {
					throw new Error(result.error ?? "The project could not be saved.");
				}
				const savedPath = result.path;
				this.setActiveFilePath(savedPath);
				if (result.name && result.name !== this.name) {
					this.name = result.name.slice(0, 60);
					const tab = this.projects.find(
						(project) => project.id === this.activeProjectId,
					);
					if (tab) tab.name = this.name;
					// The dialog wrote the old metadata name; rewrite so reopening the
					// file matches the renamed tab.
					const renamed = await api.writeProjectFile(
						savedPath,
						this.#serializeActiveProject(),
						this.name,
						true,
					);
					if (!renamed.ok) {
						throw new Error(
							renamed.error ?? "The project could not be saved.",
						);
					}
				}
			}
			this.markSaved();
		} catch (error) {
			this.#reportSaveError(error);
		}
	}

	/** Opens a project from a desktop path, returning the new tab id. */
	async openProjectFromPath(filePath: string): Promise<string | null> {
		const api = desktopApi();
		if (!api) return null;
		const read = await api.readProjectFile(filePath);
		if (!read.ok || !read.data) {
			window.alert(read.error ?? "That project could not be opened.");
			return null;
		}
		const project = parseProject(read.data);
		if (!project) {
			window.alert("That file could not be opened as a Pixel Spell project.");
			return null;
		}
		if (/^Untitled( \d+)?$/.test(project.name) && read.name) {
			project.name = read.name;
		}
		return this.openProject(project, { filePath: read.path ?? filePath });
	}

	selectLayer(id: string, options: { preserveSelection?: boolean } = {}): void {
		if (!this.doc.layers.some((layer) => layer.id === id)) return;
		if (this.floating) this.commitFloatingSelection();
		this.activeReferenceId = null;

		if (options.preserveSelection) {
			if (!this.layerSelection.includes(id)) {
				this.layerSelection = [...this.layerSelection, id];
			}
			this.activeLayerId = id;
			return;
		}

		this.activeLayerId = id;
		this.layerSelection = [id];
		this.#layerAnchorId = id;
	}

	/** Selects a single layer without disturbing multi-frame selection. */
	#setActiveLayer(id: string): void {
		this.activeLayerId = id;
		this.layerSelection = [id];
		this.#layerAnchorId = id;
	}

	#layerRange(fromId: string, toId: string): string[] {
		const layers = this.doc.layers;
		const a = layers.findIndex((layer) => layer.id === fromId);
		const b = layers.findIndex((layer) => layer.id === toId);
		if (a < 0 || b < 0) return [toId];
		const start = Math.min(a, b);
		const end = Math.max(a, b);
		return layers.slice(start, end + 1).map((layer) => layer.id);
	}

	/** Extends the layer selection from the last anchor to `id` (Shift+click). */
	extendLayerSelection(id: string): void {
		const layers = this.doc.layers;
		if (!layers.some((layer) => layer.id === id)) return;
		if (this.floating) this.commitFloatingSelection();
		this.activeReferenceId = null;
		const anchorId = this.#layerAnchorId ?? this.activeLayerId;
		this.activeLayerId = id;
		this.layerSelection = this.#layerRange(anchorId, id);
	}

	/** Selects one timeline cel (collapses both selections). */
	selectCel(layerId: string, frameIndex: number): void {
		this.selectLayer(layerId);
		this.selectFrame(frameIndex);
	}

	/** Shift+click on a cel: extends the layer and frame selections together. */
	extendCelSelection(layerId: string, frameIndex: number): void {
		const layers = this.doc.layers;
		if (!layers.some((layer) => layer.id === layerId)) return;
		const next = clamp(Math.round(frameIndex), 0, this.doc.frames.length - 1);
		if (this.floating) this.commitFloatingSelection();
		this.activeReferenceId = null;

		const layerAnchorId = this.#layerAnchorId ?? this.activeLayerId;
		const frameAnchorIndex = this.#frameAnchorId
			? this.doc.frames.findIndex((frame) => frame.id === this.#frameAnchorId)
			: this.activeFrame;
		const fromFrame = frameAnchorIndex >= 0 ? frameAnchorIndex : this.activeFrame;

		this.activeLayerId = layerId;
		this.layerSelection = this.#layerRange(layerAnchorId, layerId);
		this.activeFrame = next;
		this.frameSelection = this.#frameIdsBetween(fromFrame, next);
	}

	/**
	 * Selects the rectangular block of frames and layers between two cels.
	 * The end cel becomes the active layer/frame, so the main canvas shows it.
	 */
	selectCelRange(
		fromLayerId: string,
		fromFrame: number,
		toLayerId: string,
		toFrame: number,
	): void {
		const layers = this.doc.layers;
		if (!layers.some((layer) => layer.id === fromLayerId)) return;
		if (!layers.some((layer) => layer.id === toLayerId)) return;
		const lastFrame = clamp(
			Math.round(toFrame),
			0,
			this.doc.frames.length - 1,
		);
		const firstFrame = clamp(
			Math.round(fromFrame),
			0,
			this.doc.frames.length - 1,
		);
		if (this.floating) this.commitFloatingSelection();
		this.activeReferenceId = null;

		this.activeLayerId = toLayerId;
		this.layerSelection = this.#layerRange(fromLayerId, toLayerId);
		this.activeFrame = lastFrame;
		this.frameSelection = this.#frameIdsBetween(firstFrame, lastFrame);
	}

	#frameIdsBetween(a: number, b: number): string[] {
		const start = Math.min(a, b);
		const end = Math.max(a, b);
		return this.doc.frames.slice(start, end + 1).map((frame) => frame.id);
	}

	selectReferenceImage(id: string | null): void {
		if (
			id !== null &&
			!this.doc.references.some((reference) => reference.id === id)
		) {
			return;
		}
		this.activeReferenceId = id;
	}

	clearReferenceSelection(): void {
		this.activeReferenceId = null;
	}

	toggleLayerVisibility(id: string): void {
		const layer = this.doc.layers.find((item) => item.id === id);
		if (!layer) return;
		const visible = !layer.visible;
		// Groups show or hide their whole subtree, mirroring the group lock
		// toggle and the timeline-header bulk visibility button.
		const subtree = isGroupLayer(layer)
			? this.layerSubtreeIds(layer.id)
			: null;
		let changed = false;
		for (const item of this.doc.layers) {
			if (subtree ? !subtree.has(item.id) : item !== layer) continue;
			if (item.visible === visible) continue;
			item.visible = visible;
			changed = true;
		}
		if (!changed) return;
		this.dirty = true;
		this.modified = true;
		this.revision++;
		this.layerAppearanceRevision++;
	}

	toggleLayerLock(id: string): void {
		const layer = this.doc.layers.find((item) => item.id === id);
		if (!layer || layer.role === "reference") return;
		const locked = !layer.locked;
		// Groups lock and unlock their whole subtree, like the timeline-header
		// bulk toggle. Reference layers stay locked either way.
		const subtree = isGroupLayer(layer)
			? this.layerSubtreeIds(layer.id)
			: null;
		let changed = false;
		for (const item of this.doc.layers) {
			if (subtree ? !subtree.has(item.id) : item !== layer) continue;
			if (item.role === "reference") continue;
			if (item.locked === locked) continue;
			item.locked = locked;
			changed = true;
		}
		if (!changed) return;
		this.dirty = true;
		this.modified = true;
	}

	/** Shows or hides every layer in one step. */
	setAllLayersVisible(visible: boolean): void {
		let changed = false;
		for (const layer of this.doc.layers) {
			if (layer.visible === visible) continue;
			layer.visible = visible;
			changed = true;
		}
		if (!changed) return;
		this.dirty = true;
		this.modified = true;
		this.revision++;
		this.layerAppearanceRevision++;
	}

	/**
	 * Locks or unlocks every layer and group. Reference layers are always
	 * locked, so they are skipped.
	 */
	setAllLayersLocked(locked: boolean): void {
		let changed = false;
		for (const layer of this.doc.layers) {
			if (layer.role === "reference") continue;
			if (layer.locked === locked) continue;
			layer.locked = locked;
			changed = true;
		}
		if (!changed) return;
		this.dirty = true;
		this.modified = true;
	}

	/**
	 * Links or unlinks newly added cels on every layer. Groups have no cels and
	 * reference layers cannot be edited, so both are skipped.
	 */
	setAllLayersContinuous(continuous: boolean): void {
		let changed = false;
		for (const layer of this.doc.layers) {
			if (isGroupLayer(layer) || layer.role === "reference") continue;
			if ((layer.continuous === true) === continuous) continue;
			if (continuous) layer.continuous = true;
			else delete layer.continuous;
			changed = true;
		}
		if (!changed) return;
		this.dirty = true;
		this.modified = true;
	}

	renameLayer(id: string, name: string): void {
		const layer = this.doc.layers.find((item) => item.id === id);
		const trimmed = name.trim();
		if (!layer || !trimmed) return;
		layer.name = trimmed;
		this.dirty = true;
		this.modified = true;
	}

	/**
	 * Sets or clears a layer's timeline identity tint. This is presentation
	 * metadata only, so it is not undoable and does not touch pixel revisions.
	 */
	setLayerColor(id: string, color: string | null): void {
		const layer = this.doc.layers.find((item) => item.id === id);
		if (!layer) return;
		if (color === null) {
			if (!layer.color) return;
			delete layer.color;
		} else {
			const next = normalizeLayerColor(color);
			if (!next || next === layer.color) return;
			layer.color = next;
		}
		this.dirty = true;
		this.modified = true;
	}

	setLayerOpacity(id: string, opacity: number): void {
		if (!Number.isFinite(opacity)) return;
		const layer = this.doc.layers.find((item) => item.id === id);
		if (!layer) return;
		layer.opacity = clamp(opacity, 0, 1);
		this.dirty = true;
		this.modified = true;
		this.revision++;
		this.layerAppearanceRevision++;
	}

	/**
	 * Toggles a layer's "continuous" flag. Continuous layers link each newly
	 * added cel to the active frame so repeated content stays in sync.
	 */
	toggleLayerContinuous(id: string): void {
		const layer = this.doc.layers.find((item) => item.id === id);
		if (!layer || isGroupLayer(layer) || layer.role === "reference") return;
		if (layer.continuous) delete layer.continuous;
		else layer.continuous = true;
		this.dirty = true;
		this.modified = true;
	}

	/** Whether a cel shares its pixel buffer with its `direction` neighbor. */
	isCelLinkedTo(
		layerId: string,
		frameIndex: number,
		direction: -1 | 1,
	): boolean {
		const layer = this.doc.layers.find((item) => item.id === layerId);
		if (!layer) return false;
		const cel = layer.cels[frameIndex];
		const other = layer.cels[frameIndex + direction];
		return !!cel && cel === other;
	}

	/** Returns the cel's stored properties, or undefined when none are set. */
	getCelProps(layerId: string, frameIndex: number): CelProps | undefined {
		const frame = this.doc.frames[frameIndex];
		if (!frame) return undefined;
		return celPropsOf(this.doc, layerId, frame.id);
	}

	/** Whether the current cel selection can be linked. */
	get canLinkSelectedCels(): boolean {
		return this.selectedFrameCount >= 2;
	}

	/** Unlinking works for any cel selection, including a single cel. */
	get canUnlinkSelectedCels(): boolean {
		return this.selectedFrameCount >= 1;
	}

	/** Selected layers that own cels; group nodes have no pixels. */
	#selectedCelLayers(): Layer[] {
		const selected = new Set(this.layerSelection);
		return this.doc.layers.filter(
			(layer) => selected.has(layer.id) && !isGroupLayer(layer),
		);
	}

	/**
	 * Links every selected cel on each selected layer to one shared buffer.
	 * The active frame's pixels overwrite the rest of the selected cels.
	 */
	linkSelectedCels(): void {
		const frames = this.selectedFrameIndices;
		if (frames.length < 2) return;
		const layers = this.#selectedCelLayers();
		if (layers.length === 0) return;

		const selectedFrames = new Set(frames);
		const plans = layers.map((layer) => {
			const preferred = selectedFrames.has(this.activeFrame)
				? this.activeFrame
				: frames[0]!;
			const sourceFrame = layer.cels[preferred]
				? preferred
				: frames.find((frame) => layer.cels[frame]);
			const source =
				sourceFrame === undefined ? undefined : layer.cels[sourceFrame];
			const alreadyLinked =
				!!source &&
				frames.every((frame) => layer.cels[frame] === source) &&
				layer.cels.every(
					(cel, index) => selectedFrames.has(index) || cel !== source,
				);
			return { layer, source, alreadyLinked };
		});
		if (plans.every((plan) => plan.alreadyLinked)) return;

		this.pushHistory("Link cels");
		const size = this.doc.width * this.doc.height;
		for (const plan of plans) {
			if (plan.alreadyLinked) continue;
			const shared = plan.source
				? new Uint32Array(plan.source)
				: new Uint32Array(size);
			for (const frame of frames) plan.layer.cels[frame] = shared;
		}
		this.structureRevision++;
		this.revision++;
	}

	/**
	 * Gives every selected cel its own buffer, breaking its links to any other
	 * cel on the same layer. The operation runs for every selected layer.
	 */
	unlinkSelectedCels(): void {
		const frames = this.selectedFrameIndices;
		if (frames.length === 0) return;
		const layers = this.#selectedCelLayers();
		if (layers.length === 0) return;

		const plans = layers.map((layer) => {
			const counts = new Map<Uint32Array, number>();
			for (const cel of layer.cels) {
				if (cel) counts.set(cel, (counts.get(cel) ?? 0) + 1);
			}
			const targets = frames.filter((frame) => {
				const cel = layer.cels[frame];
				return !!cel && (counts.get(cel) ?? 0) > 1;
			});
			return { layer, targets };
		});
		if (plans.every((plan) => plan.targets.length === 0)) return;

		this.pushHistory("Unlink cels");
		for (const plan of plans) {
			for (const frame of plan.targets) {
				const cel = plan.layer.cels[frame];
				if (cel) plan.layer.cels[frame] = new Uint32Array(cel);
			}
		}
		this.structureRevision++;
		this.revision++;
	}

	/** Sets or clears a cel's custom opacity (null or >= 1 clears it). */
	setCelOpacity(
		layerId: string,
		frameIndex: number,
		opacity: number | null,
	): void {
		const layer = this.doc.layers.find((item) => item.id === layerId);
		const frame = this.doc.frames[frameIndex];
		if (!layer || isGroupLayer(layer) || !frame) return;

		const value =
			opacity === null || !Number.isFinite(opacity)
				? undefined
				: clamp(opacity, 0, 1);
		const normalized = value === undefined || value >= 1 ? undefined : value;

		const celProps = this.doc.celProps ?? (this.doc.celProps = {});
		const key = celKey(layerId, frame.id);
		const entry = celProps[key];
		if ((entry?.opacity ?? undefined) === normalized) return;

		if (normalized === undefined) {
			if (entry) delete entry.opacity;
		} else {
			(celProps[key] ?? (celProps[key] = {})).opacity = normalized;
		}

		const current = celProps[key];
		if (current && current.opacity === undefined && current.zIndex === undefined) {
			delete celProps[key];
		}
		this.dirty = true;
		this.modified = true;
		this.revision++;
		this.layerAppearanceRevision++;
	}

	/** Sets or clears a cel's custom z-index (null or 0 clears it). */
	setCelZIndex(
		layerId: string,
		frameIndex: number,
		zIndex: number | null,
	): void {
		const layer = this.doc.layers.find((item) => item.id === layerId);
		const frame = this.doc.frames[frameIndex];
		if (!layer || isGroupLayer(layer) || !frame) return;

		const value =
			zIndex === null || !Number.isFinite(zIndex)
				? undefined
				: Math.round(zIndex);
		const normalized = value === undefined || value === 0 ? undefined : value;

		const celProps = this.doc.celProps ?? (this.doc.celProps = {});
		const key = celKey(layerId, frame.id);
		const entry = celProps[key];
		if ((entry?.zIndex ?? undefined) === normalized) return;

		if (normalized === undefined) {
			if (entry) delete entry.zIndex;
		} else {
			(celProps[key] ?? (celProps[key] = {})).zIndex = normalized;
		}

		const current = celProps[key];
		if (current && current.opacity === undefined && current.zIndex === undefined) {
			delete celProps[key];
		}
		this.dirty = true;
		this.modified = true;
		this.revision++;
		this.layerAppearanceRevision++;
	}

	/** Drops cel metadata for removed layers and/or frames. */
	#pruneCelMeta(
		removedLayerIds?: Set<string>,
		removedFrameIds?: Set<string>,
	): void {
		const celProps = this.doc.celProps;
		if (!celProps) return;
		const next: Record<string, CelProps> = {};
		let changed = false;
		for (const [key, value] of Object.entries(celProps)) {
			const separator = key.lastIndexOf(":");
			const layerId = key.slice(0, separator);
			const frameId = key.slice(separator + 1);
			if (removedLayerIds?.has(layerId)) {
				changed = true;
				continue;
			}
			if (removedFrameIds?.has(frameId)) {
				changed = true;
				continue;
			}
			next[key] = value;
		}
		if (changed) this.doc.celProps = next;
	}

	/** Adds an empty layer at the bottom of the stack and makes it active. */
	addLayer(): void {
		if (this.doc.layers.length >= MAX_PROJECT_LAYERS) return;
		this.pushHistory("Add layer");
		const layer = createLayer(
			this.#nextLayerName(),
			this.doc.width,
			this.doc.height,
			this.doc.frames.length,
		);
		this.doc.layers.unshift(layer);
		this.#setActiveLayer(layer.id);
		this.activeReferenceId = null;
		this.structureRevision++;
		this.revision++;
	}

	#nextLayerName(): string {
		const names = new Set(this.doc.layers.map((layer) => layer.name.toLowerCase()));
		let index = 1;
		while (names.has(`layer ${index}`)) index++;
		return `Layer ${index}`;
	}

	#nextGroupName(): string {
		const names = new Set(this.doc.layers.map((layer) => layer.name.toLowerCase()));
		let index = 1;
		while (names.has(`group ${index}`)) index++;
		return `Group ${index}`;
	}

	/** Adds a new empty group at the bottom of the stack. */
	addGroup(): void {
		if (this.doc.layers.length >= MAX_PROJECT_LAYERS) return;
		this.pushHistory("Add group");
		const group = createGroup(this.#nextGroupName());
		this.doc.layers.unshift(group);
		this.#setActiveLayer(group.id);
		this.activeReferenceId = null;
		this.structureRevision++;
		this.revision++;
	}

	/** Wraps every selected layer in a new group at the topmost selection. */
	groupSelectedLayers(): void {
		const layers = this.doc.layers;
		const selected = new Set(this.layerSelection);
		if (layers.length >= MAX_PROJECT_LAYERS) return;
		if (!layers.some((layer) => selected.has(layer.id))) return;

		const parentById = new Map(
			layers.map((layer) => [layer.id, layer.parentId]),
		);
		const hasSelectedAncestor = (id: string): boolean => {
			let parentId = parentById.get(id);
			while (parentId) {
				if (selected.has(parentId)) return true;
				parentId = parentById.get(parentId);
			}
			return false;
		};

		// Nested selections are represented by their topmost selected ancestor.
		const roots = layers.filter(
			(layer) => selected.has(layer.id) && !hasSelectedAncestor(layer.id),
		);
		if (roots.length === 0) return;

		this.pushHistory("Group layers");
		const topmost = roots[roots.length - 1]!;
		const parentId = topmost.parentId;
		const removedIds = new Set<string>();
		const blocks: Layer[][] = [];
		for (const root of roots) {
			const index = layers.findIndex((layer) => layer.id === root.id);
			if (index < 0) continue;
			const { end } = subtreeRange(layers, index);
			const block = layers.slice(index, end);
			blocks.push(block);
			for (const item of block) removedIds.add(item.id);
		}

		const remaining = layers.filter((layer) => !removedIds.has(layer.id));
		const group = createGroup(this.#nextGroupName(), parentId);
		for (const block of blocks) block[0]!.parentId = group.id;

		let insertAt = remaining.length;
		if (parentId) {
			const parentIndex = remaining.findIndex(
				(layer) => layer.id === parentId,
			);
			if (parentIndex >= 0) {
				insertAt = subtreeRange(remaining, parentIndex).end;
			}
		} else {
			// Keep the group where the topmost selected block was.
			const topmostIndex = layers.findIndex(
				(layer) => layer.id === topmost.id,
			);
			let anchorId: string | undefined;
			for (let index = topmostIndex - 1; index >= 0; index--) {
				const candidate = layers[index]!;
				if (!removedIds.has(candidate.id)) {
					anchorId = candidate.id;
					break;
				}
			}
			if (anchorId) {
				const anchorIndex = remaining.findIndex(
					(layer) => layer.id === anchorId,
				);
				if (anchorIndex >= 0) {
					insertAt = subtreeRange(remaining, anchorIndex).end;
				}
			} else {
				insertAt = 0;
			}
		}

		remaining.splice(insertAt, 0, group, ...blocks.flat());
		layers.splice(0, layers.length, ...remaining);
		this.#setActiveLayer(group.id);
		this.activeReferenceId = null;
		this.structureRevision++;
		this.revision++;
	}

	/** Moves the active layer into the group immediately above it, if any. */
	indentActiveLayer(): void {
		const layers = this.doc.layers;
		const index = layers.findIndex((layer) => layer.id === this.activeLayerId);
		if (index < 0) return;
		const depths = layerDepths(layers);
		const depth = depths[index]!;
		let blockEnd = index + 1;
		while (blockEnd < layers.length && depths[blockEnd]! > depth) blockEnd++;

		// Only indent when the very next sibling above is a group.
		const target = layers[blockEnd];
		if (!target || depths[blockEnd]! !== depth || !isGroupLayer(target)) return;
		this.pushHistory("Indent layer");
		this.#reparentActiveBlock(target.id, target.id);
		this.activeReferenceId = null;
		this.structureRevision++;
		this.revision++;
	}

	/** Moves the active layer out of its group, above that group. */
	outdentActiveLayer(): void {
		this.#outdentLayers([this.activeLayerId]);
	}

	/** Moves every selected layer one level out of its group. */
	outdentSelectedLayers(): void {
		this.#outdentLayers(this.layerSelection);
	}

	#outdentLayers(ids: readonly string[]): void {
		const layers = this.doc.layers;
		const moving = layers.filter(
			(layer) => ids.includes(layer.id) && layer.parentId !== undefined,
		);
		if (moving.length === 0) return;
		this.pushHistory("Outdent layers");
		// Move topmost layers first so sibling order survives the moves.
		for (const source of moving.reverse()) {
			const index = layers.findIndex((layer) => layer.id === source.id);
			if (index < 0) continue;
			const layer = layers[index]!;
			const parent = layers.find((item) => item.id === layer.parentId);
			if (!parent) continue;
			const { end } = subtreeRange(layers, index);
			const block = layers.splice(index, end - index);
			block[0]!.parentId = parent.parentId;
			const parentIndex = layers.findIndex((item) => item.id === parent.id);
			if (parentIndex < 0) {
				layers.push(...block);
				continue;
			}
			// Land above the whole group so the flat list stays contiguous.
			const insertAt = subtreeRange(layers, parentIndex).end;
			layers.splice(insertAt, 0, ...block);
		}
		this.activeReferenceId = null;
		this.structureRevision++;
		this.revision++;
	}

	/**
	 * Re-parents the active layer's subtree to `parentId`, placing it right
	 * after the node `placeAfterId` (or at the top when that is undefined).
	 */
	#reparentActiveBlock(
		parentId: string | undefined,
		placeAfterId?: string,
	): void {
		const layers = this.doc.layers;
		const index = layers.findIndex((layer) => layer.id === this.activeLayerId);
		if (index < 0) return;
		const { end } = subtreeRange(layers, index);
		const block = layers.splice(index, end - index);
		block[0]!.parentId = parentId;
		const afterIndex =
			placeAfterId !== undefined
				? layers.findIndex((layer) => layer.id === placeAfterId)
				: -1;
		const insertAt = afterIndex >= 0 ? afterIndex + 1 : layers.length;
		layers.splice(insertAt, 0, ...block);
	}

	duplicateLayer(): void {
		if (this.doc.layers.length >= MAX_PROJECT_LAYERS) return;
		const layers = this.doc.layers;
		const index = layers.findIndex((layer) => layer.id === this.activeLayerId);
		if (index < 0) return;
		const source = layers[index]!;
		const { end } = subtreeRange(layers, index);
		const block = layers.slice(index, end);
		if (layers.length + block.length > MAX_PROJECT_LAYERS) return;

		this.pushHistory("Duplicate layer");
		const idMap = new Map<string, string>();
		for (const item of block) {
			idMap.set(item.id, uid(isGroupLayer(item) ? "group" : "layer"));
		}
		const clones = block.map((item) => {
			const nextId = idMap.get(item.id)!;
			const nextParentId = item.parentId
				? (idMap.get(item.parentId) ?? item.parentId)
				: item.parentId;
			return {
				...item,
				id: nextId,
				name: item.id === source.id ? `${item.name} copy` : item.name,
				cels: isGroupLayer(item)
					? []
					: item.cels.map((cel) => new Uint32Array(cel)),
				...(nextParentId ? { parentId: nextParentId } : {}),
			};
		});
		layers.splice(end, 0, ...clones);
		this.#setActiveLayer(idMap.get(source.id)!);
		this.activeReferenceId = null;
		this.structureRevision++;
		this.revision++;
	}

	/**
	 * Deletes every selected layer. A selected group is dissolved instead:
	 * its children are promoted one level and only the group node is removed.
	 */
	deleteSelectedLayers(): void {
		if (!this.canDeleteSelectedLayers) return;
		const layers = this.doc.layers;
		const selected = new Set(this.layerSelection);
		const anchorIndex = Math.max(
			0,
			layers.findIndex((layer) => selected.has(layer.id)),
		);
		this.pushHistory("Delete layers");

		const groupIds = layers
			.filter((layer) => selected.has(layer.id) && isGroupLayer(layer))
			.map((layer) => layer.id);
		const removedLayerIds = new Set<string>();
		for (const id of groupIds.reverse()) {
			const index = layers.findIndex((layer) => layer.id === id);
			if (index < 0) continue;
			const group = layers[index]!;
			for (const child of layers) {
				if (child.parentId === group.id) child.parentId = group.parentId;
			}
			removedLayerIds.add(group.id);
			layers.splice(index, 1);
		}

		const deleteIds = layers
			.filter((layer) => selected.has(layer.id) && !isGroupLayer(layer))
			.map((layer) => layer.id);
		for (const id of deleteIds.reverse()) {
			const index = layers.findIndex((layer) => layer.id === id);
			if (index < 0) continue;
			const { end } = subtreeRange(layers, index);
			for (let position = index; position < end; position++) {
				removedLayerIds.add(layers[position]!.id);
			}
			layers.splice(index, end - index);
		}
		this.#pruneCelMeta(removedLayerIds, undefined);

		if (layers.length > 0) {
			this.#setActiveLayer(
				layers[Math.min(anchorIndex, layers.length - 1)]!.id,
			);
		}
		this.activeReferenceId = null;
		this.structureRevision++;
		this.revision++;
	}

	#moveActiveBlock(direction: 1 | -1): void {
		const layers = this.doc.layers;
		const index = layers.findIndex((layer) => layer.id === this.activeLayerId);
		if (index < 0) return;
		const depths = layerDepths(layers);
		const depth = depths[index]!;
		const blocks = siblingBlocks(layers, depth);
		const blockIndex = blocks.findIndex(
			(block) => block.start <= index && index < block.end,
		);
		if (blockIndex < 0) return;
		const target = blockIndex + direction;
		if (target < 0 || target >= blocks.length) return;

		this.pushHistory("Reorder layer");
		const a = blocks[blockIndex]!;
		const b = blocks[target]!;
		const aLayers = layers.slice(a.start, a.end);
		const bLayers = layers.slice(b.start, b.end);
		const minStart = Math.min(a.start, b.start);
		const maxEnd = Math.max(a.end, b.end);
		const replacement =
			a.start < b.start ? [...bLayers, ...aLayers] : [...aLayers, ...bLayers];
		layers.splice(minStart, maxEnd - minStart, ...replacement);
		this.activeReferenceId = null;
		this.structureRevision++;
		this.revision++;
	}

	moveLayerUp(): void {
		this.#moveActiveBlock(1);
	}

	moveLayerDown(): void {
		this.#moveActiveBlock(-1);
	}

	/**
	 * Moves a layer (and its subtree) to a drop position produced by timeline
	 * drag-and-drop. `before`/`after` reorder the block as a sibling of the
	 * reference node; `into` nests it as the last child of a group.
	 */
	moveLayerTo(
		id: string,
		spec:
			| { kind: "before" | "after"; refId: string }
			| { kind: "into"; groupId: string },
	): boolean {
		const layers = this.doc.layers;
		const index = layers.findIndex((layer) => layer.id === id);
		if (index < 0) return false;
		const { start, end } = subtreeRange(layers, index);
		const block = layers.slice(start, end);
		const root = block[0]!;

		let newParentId: string | undefined;
		let anchorId: string;
		let anchorBefore: boolean;

		if (spec.kind === "into") {
			const groupIndex = layers.findIndex(
				(layer) => layer.id === spec.groupId,
			);
			if (groupIndex < 0 || !isGroupLayer(layers[groupIndex]!)) return false;
			if (groupIndex >= start && groupIndex < end) return false;
			newParentId = spec.groupId;
			anchorId = layers[subtreeRange(layers, groupIndex).end - 1]!.id;
			anchorBefore = false;
		} else {
			const refIndex = layers.findIndex((layer) => layer.id === spec.refId);
			if (refIndex < 0) return false;
			if (refIndex >= start && refIndex < end) return false;
			newParentId = layers[refIndex]!.parentId;
			if (spec.kind === "before") {
				// Above the reference in display order = after its subtree in the
				// bottom-to-top flat array.
				anchorId = layers[subtreeRange(layers, refIndex).end - 1]!.id;
				anchorBefore = false;
			} else {
				// Below the reference in display order = before it in flat.
				anchorId = layers[refIndex]!.id;
				anchorBefore = true;
			}
		}

		// Build the desired final order and skip a no-op move.
		const rest = [...layers.slice(0, start), ...layers.slice(end)];
		const anchorIndex = rest.findIndex((layer) => layer.id === anchorId);
		const insertAt = anchorBefore ? anchorIndex : anchorIndex + 1;
		const desired = [
			...rest.slice(0, insertAt),
			...block,
			...rest.slice(insertAt),
		];
		if (
			root.parentId === newParentId &&
			desired.every((layer, layerIndex) => layer.id === layers[layerIndex]!.id)
		) {
			return false;
		}

		this.pushHistory("Move layer");
		layers.splice(0, layers.length, ...desired);
		if (newParentId) root.parentId = newParentId;
		else delete root.parentId;
		this.activeReferenceId = null;
		this.structureRevision++;
		this.revision++;
		return true;
	}

	/**
	 * Returns the ids of a layer's subtree (itself included), or null when the
	 * id is unknown. Used by timeline drag-and-drop to reject dropping a node
	 * onto itself or one of its own descendants.
	 */
	layerSubtreeIds(id: string): Set<string> | null {
		const layers = this.doc.layers;
		const index = layers.findIndex((layer) => layer.id === id);
		if (index < 0) return null;
		const { start, end } = subtreeRange(layers, index);
		const ids = new Set<string>();
		for (let position = start; position < end; position++) {
			ids.add(layers[position]!.id);
		}
		return ids;
	}

	setLayerBlendMode(id: string, mode: BlendMode): void {
		const layer = this.doc.layers.find((item) => item.id === id);
		if (!layer) return;
		const next = normalizeBlendMode(mode);
		if ((layer.blendMode ?? "normal") === next) return;
		if (next === "normal") delete layer.blendMode;
		else layer.blendMode = next;
		this.dirty = true;
		this.modified = true;
		this.revision++;
		this.layerAppearanceRevision++;
	}

	toggleLayerClipping(id: string): void {
		const layer = this.doc.layers.find((item) => item.id === id);
		if (!layer) return;
		const next = layer.clipping !== true;
		if (next) layer.clipping = true;
		else delete layer.clipping;
		this.dirty = true;
		this.modified = true;
		this.revision++;
		this.layerAppearanceRevision++;
	}

	toggleGroupCollapsed(id: string): void {
		const layer = this.doc.layers.find((item) => item.id === id);
		if (!layer || !isGroupLayer(layer)) return;
		const next = layer.collapsed !== true;
		if (next) layer.collapsed = true;
		else delete layer.collapsed;
		this.dirty = true;
		this.modified = true;
	}

	/** Marks a group effect stack change for the composite and thumbnails. */
	#afterGroupEffectChange(): void {
		this.structureRevision++;
		this.layerAppearanceRevision++;
		this.revision++;
		this.dirty = true;
		this.modified = true;
	}

	#groupEffectTarget(
		layerId: string,
		effectId: string,
	): { group: Layer; effect: GroupEffect; index: number } | null {
		const group = this.doc.layers.find((layer) => layer.id === layerId);
		if (!group || !isGroupLayer(group)) return null;
		const index = group.effects?.findIndex((effect) => effect.id === effectId) ?? -1;
		if (index < 0) return null;
		return { group, effect: group.effects![index]!, index };
	}

	/** Appends a new effect block to a group and returns its id. */
	addGroupEffect(layerId: string, kind: GroupEffectKind): string | null {
		const group = this.doc.layers.find((layer) => layer.id === layerId);
		if (!group || !isGroupLayer(group)) return null;
		if ((group.effects?.length ?? 0) >= MAX_GROUP_EFFECTS) return null;
		this.pushHistory("Add group effect");
		const effect = createGroupEffect(kind, this.activePalette.colors);
		group.effects = [...(group.effects ?? []), effect];
		this.#afterGroupEffectChange();
		return effect.id;
	}

	/** Replaces one effect's options. Returns false when nothing changed. */
	updateGroupEffect(
		layerId: string,
		effectId: string,
		options: GroupEffectOptions,
	): boolean {
		const target = this.#groupEffectTarget(layerId, effectId);
		if (!target) return false;
		const next: GroupEffectOptions = {
			...options,
			...(options.palette ? { palette: [...options.palette] } : {}),
			...(options.gradient
				? { gradient: options.gradient.map((stop) => ({ ...stop })) }
				: {}),
		};
		if (JSON.stringify(target.effect.options) === JSON.stringify(next)) {
			return false;
		}
		this.pushHistory("Edit group effect");
		target.effect.options = next;
		this.#afterGroupEffectChange();
		return true;
	}

	toggleGroupEffect(layerId: string, effectId: string): void {
		const target = this.#groupEffectTarget(layerId, effectId);
		if (!target) return;
		this.pushHistory(
			target.effect.enabled ? "Disable group effect" : "Enable group effect",
		);
		target.effect.enabled = !target.effect.enabled;
		this.#afterGroupEffectChange();
	}

	removeGroupEffect(layerId: string, effectId: string): void {
		const target = this.#groupEffectTarget(layerId, effectId);
		if (!target) return;
		this.pushHistory("Remove group effect");
		const next = (target.group.effects ?? []).filter(
			(effect) => effect.id !== effectId,
		);
		if (next.length > 0) target.group.effects = next;
		else delete target.group.effects;
		this.#afterGroupEffectChange();
	}

	/** Moves an effect block before or after another block in the same group. */
	moveGroupEffect(
		layerId: string,
		effectId: string,
		targetId: string,
		side: "before" | "after",
	): void {
		const target = this.#groupEffectTarget(layerId, targetId);
		if (!target || effectId === targetId) return;
		const effects = target.group.effects;
		if (!effects) return;
		const from = effects.findIndex((effect) => effect.id === effectId);
		if (from < 0) return;
		const next = [...effects];
		const [moved] = next.splice(from, 1);
		if (!moved) return;
		let to = next.findIndex((effect) => effect.id === targetId);
		if (to < 0) return;
		if (side === "after") to++;
		this.pushHistory("Reorder group effects");
		next.splice(to, 0, moved);
		target.group.effects = next;
		this.#afterGroupEffectChange();
	}

	/** Composites the active frame with a staged effect on one group. */
	previewGroupEffect(
		layerId: string,
		effectId: string,
		draft: GroupEffect,
	): Uint32Array {
		const layers = this.doc.layers.map((layer) => {
			if (layer.id !== layerId) return layer;
			const effects = (layer.effects ?? []).map((effect) =>
				effect.id === effectId
					? {
							...draft,
							options: {
								...draft.options,
								...(draft.options.palette
									? { palette: [...draft.options.palette] }
									: {}),
								...(draft.options.gradient
									? {
											gradient: draft.options.gradient.map((stop) => ({
												...stop,
											})),
										}
									: {}),
							},
						}
					: effect,
			);
			if (!effects.some((effect) => effect.id === effectId)) {
				effects.push(draft);
			}
			return { ...layer, effects };
		});
		return compositeFrame({ ...this.doc, layers }, this.activeFrame, true);
	}

	/**
	 * Writes one effect into every paint-layer cel inside the group (all frames)
	 * and removes the block. Linked cels stay linked because each distinct buffer
	 * is only transformed once. Returns the number of buffers that changed.
	 */
	bakeGroupEffect(
		layerId: string,
		effectId: string,
		options?: GroupEffectOptions,
	): number {
		const layers = this.doc.layers;
		const groupIndex = layers.findIndex((layer) => layer.id === layerId);
		if (groupIndex < 0) return 0;
		const group = layers[groupIndex]!;
		if (!isGroupLayer(group)) return 0;
		const effect = group.effects?.find((entry) => entry.id === effectId);
		if (!effect) return 0;

		const { start, end } = subtreeRange(layers, groupIndex);
		const targets = layers
			.slice(start + 1, end)
			.filter(
				(layer) =>
					!isGroupLayer(layer) &&
					layer.role !== "reference" &&
					layer.visible &&
					layer.opacity > 0,
			);
		if (targets.length === 0) return 0;

		const bakeEffect: GroupEffect = {
			...effect,
			enabled: true,
			options: {
				...effect.options,
				...options,
				...(options?.palette ? { palette: [...options.palette] } : {}),
				...(options?.gradient
					? { gradient: options.gradient.map((stop) => ({ ...stop })) }
					: {}),
			},
		};

		this.pushHistory("Bake group effect");
		let changed = 0;
		for (const layer of targets) {
			const transformed = new Map<Uint32Array, Uint32Array>();
			layer.cels = layer.cels.map((cel) => {
				const cached = transformed.get(cel);
				if (cached) return cached;
				const next = this.#indexedPixels(
					applyGroupEffect(
						cel,
						this.doc.width,
						this.doc.height,
						bakeEffect,
					),
				);
				const result = this.#sameCelPixels(cel, next) ? cel : next;
				if (result !== cel) changed++;
				transformed.set(cel, result);
				return result;
			});
		}

		const remaining = (group.effects ?? []).filter(
			(entry) => entry.id !== effectId,
		);
		if (remaining.length > 0) group.effects = remaining;
		else delete group.effects;
		this.#afterGroupEffectChange();
		return changed;
	}

	deleteSelection(): void {
		if (this.floating) {
			// Deleting a floating selection discards its unapplied content.
			this.floating = null;
			this.selection = null;
			this.selectionRevision++;
			this.revision++;
			return;
		}

		const mask = this.selection;
		if (!mask) return;

		const layer = this.activeLayer;
		if (!layer || layer.locked || !layer.visible) return;
		const cel = layer.cels[this.activeFrame];
		if (!cel) return;

		let changed = false;
		for (let i = 0; i < cel.length; i++) {
			if (mask[i] && cel[i] !== 0) {
				changed = true;
				break;
			}
		}
		if (!changed) return;

		this.pushHistoryCel(layer.id, this.activeFrame, "Delete selection");
		for (let i = 0; i < cel.length; i++) {
			if (mask[i]) cel[i] = 0;
		}
		this.touch();
	}

	clearLayer(): void {
		const layer = this.activeLayer;
		if (!layer || isGroupLayer(layer) || layer.role === "reference") return;
		this.pushHistoryCel(layer.id, this.activeFrame, "Clear layer");
		const cel = layer.cels[this.activeFrame];
		if (cel) this.#clearCel(cel);
		this.revision++;
	}

	clearFrame(): void {
		const frame = this.activeFrame;
		const editableLayers = this.doc.layers.filter(
			(layer) => !isGroupLayer(layer) && layer.role !== "reference",
		);
		this.pushHistoryCels(
			editableLayers.map((layer) => ({ layerId: layer.id, frame })),
			"Clear frame",
		);
		for (const layer of editableLayers) {
			const cel = layer.cels[frame];
			if (cel) this.#clearCel(cel);
		}
		this.structureRevision++;
		this.revision++;
	}

	#clearCel(cel: Uint32Array): void {
		const mask = this.selection;
		if (!mask) {
			cel.fill(0);
			return;
		}
		for (let i = 0; i < cel.length; i++) {
			if (mask[i]) cel[i] = 0;
		}
	}

	/**
	 * Cels an effect may rewrite in the active frame. The active-cel scope
	 * requires a visible, unlocked paint layer; the visible-layers scope skips
	 * groups, reference layers, hidden layers, and locked layers.
	 */
	effectTargetLayers(scope: EffectScope): Layer[] {
		if (scope === "active-cel") {
			const layer = this.activeLayer;
			if (
				!layer ||
				isGroupLayer(layer) ||
				layer.role === "reference" ||
				layer.locked ||
				!layer.visible
			) {
				return [];
			}
			return [layer];
		}

		return this.doc.layers.filter(
			(layer) =>
				!isGroupLayer(layer) &&
				layer.role !== "reference" &&
				layer.visible &&
				!layer.locked,
		);
	}

	#sameCelPixels(a: Uint32Array, b: Uint32Array): boolean {
		if (a.length !== b.length) return false;
		for (let index = 0; index < a.length; index++) {
			if (a[index] !== b[index]) return false;
		}
		return true;
	}

	/**
	 * Runs a pure pixel filter over the scope's cels and records one undoable
	 * history entry. The filter result is written into the existing buffers so
	 * linked cels stay linked (and undo restores every linked frame at once).
	 * Returns the number of cels that actually changed.
	 */
	applyEffect(
		scope: EffectScope,
		transform: (pixels: Uint32Array) => Uint32Array,
		label = "Apply effect",
	): number {
		if (this.floating) this.commitFloatingSelection();

		const frame = this.activeFrame;
		const pending: { layer: Layer; cel: Uint32Array; next: Uint32Array }[] = [];
		for (const layer of this.effectTargetLayers(scope)) {
			const cel = layer.cels[frame];
			if (!cel) continue;
			const next = this.#indexedPixels(transform(cel));
			if (next === cel || this.#sameCelPixels(cel, next)) continue;
			pending.push({ layer, cel, next });
		}
		if (pending.length === 0) return 0;

		this.pushHistoryCels(
			pending.map((entry) => ({ layerId: entry.layer.id, frame })),
			label,
		);
		for (const entry of pending) entry.cel.set(entry.next);
		// An effect can rewrite every visible layer at once, so every cel
		// thumbnail needs a refresh, not just the active one.
		this.structureRevision++;
		this.touch();
		return pending.length;
	}

	/**
	 * Composites the active frame with an effect applied in memory. Only the
	 * active frame's target cels are transformed, so the preview stays cheap.
	 */
	previewEffect(
		scope: EffectScope,
		transform: (pixels: Uint32Array) => Uint32Array,
	): Uint32Array {
		const frame = this.activeFrame;
		const targetIds = new Set(
			this.effectTargetLayers(scope).map((layer) => layer.id),
		);
		const layers = this.doc.layers.map((layer) => {
			if (!targetIds.has(layer.id)) return layer;
			const cel = layer.cels[frame];
			if (!cel) return layer;
			return {
				...layer,
				cels: layer.cels.map((item, index) =>
					index === frame ? this.#indexedPixels(transform(item)) : item,
				),
			};
		});
		const previewDoc: PixelDoc = { ...this.doc, layers };
		return compositeFrame(previewDoc, frame, true);
	}

	/** Tight bounds of painted pixels across all frames and normal layers. */
	findContentBounds(): PixelBounds | null {
		return contentBoundsOf(this.doc);
	}

	/** Bounds of the current pixel selection, or null when nothing is selected. */
	selectionCropBounds(): PixelBounds | null {
		return selectionBounds(this.selection, this.doc.width, this.doc.height);
	}

	#applyCanvasTransform(
		width: number,
		height: number,
		transform: (cel: Uint32Array) => Uint32Array,
		label: string,
	): void {
		this.pushHistory(label);
		for (const layer of this.doc.layers) {
			// Transform each distinct buffer once so linked cels stay linked.
			const transformed = new Map<Uint32Array, Uint32Array>();
			layer.cels = layer.cels.map((cel) => {
				let result = transformed.get(cel);
				if (!result) {
					result = transform(cel);
					transformed.set(cel, result);
				}
				return result;
			});
		}
		this.doc.width = width;
		this.doc.height = height;
		// The old mask and floating content no longer match the document size.
		this.selection = null;
		this.selectionRevision++;
		this.structureRevision++;
		this.revision++;
	}

	/** Resamples every cel to the new dimensions with nearest-neighbor scaling. */
	scaleCanvas(width: number, height: number): boolean {
		const nextWidth = clamp(
			Number.isFinite(width) ? Math.round(width) : MIN_CANVAS_SIZE,
			MIN_CANVAS_SIZE,
			MAX_CANVAS_SIZE,
		);
		const nextHeight = clamp(
			Number.isFinite(height) ? Math.round(height) : MIN_CANVAS_SIZE,
			MIN_CANVAS_SIZE,
			MAX_CANVAS_SIZE,
		);
		if (nextWidth === this.doc.width && nextHeight === this.doc.height) {
			return false;
		}

		const oldWidth = this.doc.width;
		const oldHeight = this.doc.height;
		this.#applyCanvasTransform(
			nextWidth,
			nextHeight,
			(cel) =>
				scalePixelsNearest(cel, oldWidth, oldHeight, nextWidth, nextHeight),
			"Scale canvas",
		);
		return true;
	}

	/**
	 * Grows or crops every cel around an anchor. Anchor values are 0, 0.5, or 1
	 * on each axis. New pixels are transparent.
	 */
	resizeCanvas(
		width: number,
		height: number,
		anchorX = 0.5,
		anchorY = 0.5,
	): boolean {
		const nextWidth = clamp(
			Number.isFinite(width) ? Math.round(width) : MIN_CANVAS_SIZE,
			MIN_CANVAS_SIZE,
			MAX_CANVAS_SIZE,
		);
		const nextHeight = clamp(
			Number.isFinite(height) ? Math.round(height) : MIN_CANVAS_SIZE,
			MIN_CANVAS_SIZE,
			MAX_CANVAS_SIZE,
		);
		if (nextWidth === this.doc.width && nextHeight === this.doc.height) {
			return false;
		}

		const oldWidth = this.doc.width;
		const oldHeight = this.doc.height;
		const offsetX = Math.round(
			(nextWidth - oldWidth) * clamp(anchorX, 0, 1),
		);
		const offsetY = Math.round(
			(nextHeight - oldHeight) * clamp(anchorY, 0, 1),
		);
		this.#applyCanvasTransform(
			nextWidth,
			nextHeight,
			(cel) =>
				resizePixels(
					cel,
					oldWidth,
					oldHeight,
					nextWidth,
					nextHeight,
					offsetX,
					offsetY,
				),
			"Resize canvas",
		);
		return true;
	}

	/** Crops every cel to an explicit rectangle in the current canvas. */
	cropCanvasTo(
		x: number,
		y: number,
		width: number,
		height: number,
		label = "Crop canvas",
	): boolean {
		const oldWidth = this.doc.width;
		const oldHeight = this.doc.height;
		const cropX = clamp(
			Number.isFinite(x) ? Math.round(x) : 0,
			0,
			oldWidth - 1,
		);
		const cropY = clamp(
			Number.isFinite(y) ? Math.round(y) : 0,
			0,
			oldHeight - 1,
		);
		const cropWidth = clamp(
			Number.isFinite(width) ? Math.round(width) : 1,
			1,
			oldWidth - cropX,
		);
		const cropHeight = clamp(
			Number.isFinite(height) ? Math.round(height) : 1,
			1,
			oldHeight - cropY,
		);
		if (
			cropX === 0 &&
			cropY === 0 &&
			cropWidth === oldWidth &&
			cropHeight === oldHeight
		) {
			return false;
		}

		this.#applyCanvasTransform(
			cropWidth,
			cropHeight,
			(cel) =>
				resizePixels(
					cel,
					oldWidth,
					oldHeight,
					cropWidth,
					cropHeight,
					-cropX,
					-cropY,
				),
			label,
		);
		return true;
	}

	/** Trims transparent borders around all painted content. */
	cropToContent(): boolean {
		const bounds = this.findContentBounds();
		if (!bounds) return false;
		return this.cropCanvasTo(
			bounds.x,
			bounds.y,
			bounds.width,
			bounds.height,
			"Crop to content",
		);
	}

	/** Crops to the smallest rectangle containing the selected pixels. */
	cropToSelection(): boolean {
		const bounds = this.selectionCropBounds();
		if (!bounds) return false;
		return this.cropCanvasTo(
			bounds.x,
			bounds.y,
			bounds.width,
			bounds.height,
			"Crop to selection",
		);
	}

	selectFrame(
		index: number,
		options: { extend?: boolean; preserveSelection?: boolean } = {},
	): void {
		const next = clamp(Math.round(index), 0, this.doc.frames.length - 1);
		const nextId = this.doc.frames[next]!.id;
		if (this.floating) this.commitFloatingSelection();

		if (options.extend) {
			const anchorIndex = this.#frameAnchorId
				? this.doc.frames.findIndex(
						(frame) => frame.id === this.#frameAnchorId,
					)
				: this.activeFrame;
			const from = anchorIndex >= 0 ? anchorIndex : this.activeFrame;
			const start = Math.min(from, next);
			const end = Math.max(from, next);
			this.activeFrame = next;
			this.frameSelection = this.doc.frames
				.slice(start, end + 1)
				.map((frame) => frame.id);
			return;
		}

		if (options.preserveSelection) {
			this.activeFrame = next;
			return;
		}

		if (
			next === this.activeFrame &&
			this.frameSelection.length === 1 &&
			this.frameSelection[0] === nextId
		) {
			return;
		}
		this.activeFrame = next;
		this.frameSelection = [nextId];
		this.#frameAnchorId = nextId;
	}

	selectFrameRange(start: number, end: number): void {
		const last = this.doc.frames.length - 1;
		const a = clamp(Math.round(start), 0, last);
		const b = clamp(Math.round(end), 0, last);
		const from = Math.min(a, b);
		const to = Math.max(a, b);
		if (this.floating) this.commitFloatingSelection();
		this.activeFrame = b;
		this.frameSelection = this.doc.frames
			.slice(from, to + 1)
			.map((frame) => frame.id);
		this.#frameAnchorId = this.doc.frames[from]!.id;
	}

	selectAllFrames(): void {
		this.frameSelection = this.doc.frames.map((frame) => frame.id);
		this.#frameAnchorId = this.doc.frames[0]?.id ?? null;
	}

	isFrameSelected(index: number): boolean {
		const frame = this.doc.frames[index];
		return !!frame && this.frameSelection.includes(frame.id);
	}

	nextFrame(): void {
		this.selectFrame((this.activeFrame + 1) % this.doc.frames.length);
	}

	previousFrame(): void {
		this.selectFrame(
			(this.activeFrame - 1 + this.doc.frames.length) % this.doc.frames.length,
		);
	}

	frameDurationAt(index: number = this.activeFrame): number {
		return frameDurationMs(this.doc, index);
	}

	#shiftFramePixels(
		source: Uint32Array,
		dx: number,
		dy: number,
	): Uint32Array {
		const width = this.doc.width;
		const height = this.doc.height;
		const output = new Uint32Array(width * height);
		if (dx === 0 && dy === 0) {
			output.set(source);
			return output;
		}
		for (let y = 0; y < height; y++) {
			const targetY = y + dy;
			if (targetY < 0 || targetY >= height) continue;
			for (let x = 0; x < width; x++) {
				const targetX = x + dx;
				if (targetX < 0 || targetX >= width) continue;
				output[targetY * width + targetX] = source[y * width + x]!;
			}
		}
		return output;
	}

	copyFrames(): boolean {
		const indices = this.selectedFrameIndices;
		if (indices.length === 0) return false;

		this.#frameClipboard = {
			frames: indices.map((index) => {
				const frame = this.doc.frames[index]!;
				const cels = new Map<string, Uint32Array>();
				for (const layer of this.doc.layers) {
					const cel = layer.cels[index];
					if (cel) cels.set(layer.id, new Uint32Array(cel));
				}
				return {
					...(frame.duration !== undefined
						? { duration: frame.duration }
						: {}),
					...(frame.tag ? { tag: frame.tag } : {}),
					cels,
				};
			}),
		};
		this.hasFrameClipboard = true;
		return true;
	}

	pasteFrames(): boolean {
		const clipboard = this.#frameClipboard;
		if (!clipboard || clipboard.frames.length === 0) return false;
		if (
			this.doc.frames.length + clipboard.frames.length >
			MAX_PROJECT_FRAMES
		) {
			return false;
		}

		const selected = this.selectedFrameIndices;
		const insertAt =
			(selected.length > 0
				? selected[selected.length - 1]!
				: this.activeFrame) + 1;
		const width = this.doc.width;
		const height = this.doc.height;

		this.pushHistory("Paste frames");
		const pasted: Frame[] = [];
		for (const [offset, source] of clipboard.frames.entries()) {
			const target = insertAt + offset;
			const frame: Frame = {
				id: uid("frame"),
				...(source.duration !== undefined
					? { duration: source.duration }
					: {}),
				...(source.tag ? { tag: source.tag } : {}),
			};
			pasted.push(frame);
			this.doc.frames.splice(target, 0, frame);
			for (const layer of this.doc.layers) {
				if (isGroupLayer(layer)) continue;
				const sourceCel = source.cels.get(layer.id);
				let pixels: Uint32Array = sourceCel
					? new Uint32Array(sourceCel)
					: new Uint32Array(width * height);
				if (layer.role !== "reference") pixels = this.#indexedPixels(pixels);
				layer.cels.splice(target, 0, pixels);
			}
		}

		this.activeFrame = insertAt;
		this.frameSelection = pasted.map((frame) => frame.id);
		this.#frameAnchorId = pasted[0]!.id;
		this.structureRevision++;
		this.revision++;
		return true;
	}

	duplicateFrame(): void {
		this.duplicateFrames(0, 0);
	}

	duplicateFrames(
		offsetX = 0,
		offsetY = 0,
	): boolean {
		const indices = this.selectedFrameIndices;
		if (indices.length === 0) return false;
		if (
			this.doc.frames.length + indices.length >
			MAX_PROJECT_FRAMES
		) {
			return false;
		}

		const insertAt = indices[indices.length - 1]! + 1;
		const dx = Number.isFinite(offsetX) ? Math.round(offsetX) : 0;
		const dy = Number.isFinite(offsetY) ? Math.round(offsetY) : 0;

		this.pushHistory("Duplicate frames");
		const duplicated: Frame[] = [];
		for (const [offset, sourceIndex] of indices.entries()) {
			const source = this.doc.frames[sourceIndex]!;
			const target = insertAt + offset;
			const frame: Frame = {
				id: uid("frame"),
				...(source.duration !== undefined
					? { duration: source.duration }
					: {}),
				...(source.tag ? { tag: source.tag } : {}),
			};
			duplicated.push(frame);
			this.doc.frames.splice(target, 0, frame);
			for (const layer of this.doc.layers) {
				if (isGroupLayer(layer)) continue;
				const sourceCel = layer.cels[sourceIndex];
				layer.cels.splice(
					target,
					0,
					sourceCel
						? this.#shiftFramePixels(sourceCel, dx, dy)
						: new Uint32Array(this.doc.width * this.doc.height),
				);
			}
		}

		this.activeFrame = insertAt;
		this.frameSelection = duplicated.map((frame) => frame.id);
		this.#frameAnchorId = duplicated[0]!.id;
		this.structureRevision++;
		this.revision++;
		return true;
	}

	deleteFrame(): void {
		this.deleteSelectedFrames();
	}

	deleteSelectedFrames(): void {
		const indices = this.selectedFrameIndices;
		if (indices.length === 0) return;
		if (indices.length >= this.doc.frames.length) return;

		const activeId = this.doc.frames[this.activeFrame]?.id;
		this.pushHistory("Delete frames");
		const removedFrameIds = new Set<string>();
		for (let position = indices.length - 1; position >= 0; position--) {
			const index = indices[position]!;
			removedFrameIds.add(this.doc.frames[index]!.id);
			this.doc.frames.splice(index, 1);
			for (const layer of this.doc.layers) {
				if (isGroupLayer(layer)) continue;
				layer.cels.splice(index, 1);
			}
		}
		this.#pruneCelMeta(undefined, removedFrameIds);

		const nextIndex = clamp(indices[0]!, 0, this.doc.frames.length - 1);
		this.activeFrame =
			activeId && !indices.includes(this.activeFrame)
				? clamp(
						this.doc.frames.findIndex((frame) => frame.id === activeId),
						0,
						this.doc.frames.length - 1,
					)
				: nextIndex;
		const frame = this.doc.frames[this.activeFrame]!;
		this.frameSelection = [frame.id];
		this.#frameAnchorId = frame.id;
		this.structureRevision++;
		this.revision++;
	}

	moveSelectedFrames(direction: -1 | 1): void {
		const indices = this.selectedFrameIndices;
		if (indices.length === 0) return;
		if (direction < 0) {
			const first = indices[0]!;
			if (first <= 0) return;
			this.moveFramesTo(first - 1);
		} else {
			const last = indices[indices.length - 1]!;
			if (last >= this.doc.frames.length - 1) return;
			this.moveFramesTo(last + 2);
		}
	}

	/**
	 * Moves the selected frames so they are inserted before `targetIndex`.
	 * Frames and every layer's cels move together.
	 */
	moveFramesTo(targetIndex: number, frameIds: readonly string[] = this.frameSelection): void {
		const count = this.doc.frames.length;
		const selectedSet = new Set(frameIds);
		const selectedIndices: number[] = [];
		this.doc.frames.forEach((frame, index) => {
			if (selectedSet.has(frame.id)) selectedIndices.push(index);
		});
		if (selectedIndices.length === 0 || selectedIndices.length >= count) {
			return;
		}

		let insertion = clamp(Math.round(targetIndex), 0, count);
		for (const index of selectedIndices) {
			if (index < insertion) insertion--;
		}
		insertion = clamp(insertion, 0, count - selectedIndices.length);

		const order: number[] = [];
		for (let index = 0; index < count; index++) {
			if (!selectedIndices.includes(index)) order.push(index);
		}
		for (const [offset, index] of selectedIndices.entries()) {
			order.splice(insertion + offset, 0, index);
		}
		if (order.every((value, index) => value === index)) return;

		const activeId = this.doc.frames[this.activeFrame]!.id;
		this.pushHistory("Reorder frames");

		const frames = this.doc.frames.slice();
		this.doc.frames.splice(
			0,
			this.doc.frames.length,
			...order.map((index) => frames[index]!),
		);
		for (const layer of this.doc.layers) {
			if (isGroupLayer(layer)) continue;
			const cels = layer.cels.slice();
			layer.cels.splice(
				0,
				layer.cels.length,
				...order.map((index) => cels[index]!),
			);
		}

		this.activeFrame = clamp(
			this.doc.frames.findIndex((frame) => frame.id === activeId),
			0,
			this.doc.frames.length - 1,
		);
		this.structureRevision++;
		this.revision++;
	}

	setFrameDuration(duration: number | null): void {
		const indices = this.selectedFrameIndices;
		if (indices.length === 0) return;
		const value =
			duration === null || !Number.isFinite(duration)
				? undefined
				: clamp(
						Math.round(duration),
						MIN_FRAME_DURATION,
						MAX_FRAME_DURATION,
					);
		if (indices.every((index) => this.doc.frames[index]!.duration === value)) {
			return;
		}
		this.pushHistory("Frame duration");
		for (const index of indices) {
			this.doc.frames[index]!.duration = value;
		}
	}

	setFrameTag(tag: string): void {
		const indices = this.selectedFrameIndices;
		if (indices.length === 0) return;
		const trimmed = tag.trim().slice(0, 40);
		const value = trimmed || undefined;
		if (
			indices.every(
				(index) => (this.doc.frames[index]!.tag || undefined) === value,
			)
		) {
			return;
		}
		this.pushHistory("Frame tag");
		for (const index of indices) {
			this.doc.frames[index]!.tag = value;
		}
	}

	setAnimationMode(mode: AnimationMode): void {
		const next = normalizeAnimationMode(mode);
		if (this.animationMode === next) return;
		this.doc.animationMode = next;
		this.dirty = true;
		this.modified = true;
	}

	setAnimationLoop(loop: boolean): void {
		if (this.animationLoop === loop) return;
		this.doc.animationLoop = loop;
		this.dirty = true;
		this.modified = true;
	}

	/**
	 * Rebuilds the playback cursor from the current selection, mode, and loop
	 * setting. Called when playback starts and whenever those inputs change.
	 */
	preparePlayback(): void {
		this.#playbackSequence = this.animationSequence;
		this.#playbackCursor = this.#playbackSequence.indexOf(this.activeFrame);
	}

	/**
	 * Advances the playback cursor. Returns `null` when a non-looping animation
	 * reaches the end of its single pass.
	 */
	nextPlaybackFrame(): number | null {
		let sequence = this.#playbackSequence;
		if (sequence.length === 0) {
			this.preparePlayback();
			sequence = this.#playbackSequence;
			if (sequence.length === 0) return null;
		}

		if (this.#playbackCursor < 0) {
			this.#playbackCursor = 0;
			return sequence[0]!;
		}

		const next = this.#playbackCursor + 1;
		if (next < sequence.length) {
			this.#playbackCursor = next;
			return sequence[next]!;
		}
		if (!this.animationLoop) return null;
		this.#playbackCursor = 0;
		return sequence[0]!;
	}

	/** Adds an empty frame at the end of the timeline and makes it active. */
	addFrame(): void {
		if (this.doc.frames.length >= MAX_PROJECT_FRAMES) return;
		this.pushHistory("Add frame");
		const index = this.doc.frames.length;
		const sourceIndex = this.activeFrame;
		const sourceFrame = this.doc.frames[sourceIndex]!;
		const frame: Frame = {
			id: uid("frame"),
			...(sourceFrame.duration !== undefined
				? { duration: sourceFrame.duration }
				: {}),
		};
		this.doc.frames.splice(index, 0, frame);
		for (const layer of this.doc.layers) {
			if (isGroupLayer(layer)) continue;
			// A static reference should stay visible on a newly inserted frame,
			// and a continuous layer links its new cel to the active frame so the
			// two stay in sync.
			const continuous = layer.continuous === true && layer.role !== "reference";
			const source =
				layer.role === "reference" || continuous
					? layer.cels[sourceIndex]
					: undefined;
			layer.cels.splice(
				index,
				0,
				source
					? new Uint32Array(source)
					: new Uint32Array(this.doc.width * this.doc.height),
			);
			if (continuous) {
				// Share the active frame's buffer directly so a continuous layer's
				// whole chain stays linked as more frames are added.
				layer.cels[index] = layer.cels[sourceIndex]!;
			}
		}
		this.activeFrame = index;
		this.frameSelection = [frame.id];
		this.#frameAnchorId = frame.id;
		this.structureRevision++;
		this.revision++;
	}

	setFps(value: number): void {
		if (!Number.isFinite(value)) return;
		this.doc.fps = clamp(Math.round(value), 1, 60);
		this.dirty = true;
		this.modified = true;
	}

	toggleOnion(): void {
		this.onionEnabled = !this.onionEnabled;
	}

	setOnionRange(value: number): void {
		if (!Number.isFinite(value)) return;
		this.onionRange = clamp(Math.round(value), 1, 3);
	}

	setOnionOpacity(value: number): void {
		if (!Number.isFinite(value)) return;
		this.onionOpacity = clamp(value, 0.05, 1);
	}

	setOnionTint(direction: "previous" | "next", hex: string): void {
		const color = normalizeHex(hex);
		if (!color) return;
		if (direction === "previous") this.onionTintPrevious = color;
		else this.onionTintNext = color;
	}

	stopPlayback(): void {
		if (!this.playing) return;
		this.playing = false;
		this.#playbackSequence = [];
		this.#playbackCursor = -1;
	}

	togglePlayback(): void {
		if (this.playing) {
			this.stopPlayback();
			return;
		}

		const sequence = this.animationSequence;
		if (sequence.length === 0) return;
		if (!sequence.includes(this.activeFrame)) {
			this.selectFrame(sequence[0]!, { preserveSelection: true });
		}
		this.preparePlayback();
		this.playing = true;
	}
}

export const editor = new EditorState();
