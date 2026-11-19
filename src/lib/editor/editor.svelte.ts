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
	MAX_PROJECT_FRAMES,
	MAX_PROJECT_LAYERS,
	saveProjectFile,
	serializeProject,
	type LoadedProject,
} from "./file.js";
import { normalizeLayerColor } from "./layer-color.js";
import {
	MAX_REFERENCE_COUNT,
	cropPixelsToCanvas,
	defaultReferencePlacement,
	fitPixelsToCanvas,
} from "./reference.js";
import { selectionBounds } from "./selection.js";
import { usesPixelPerfect } from "./tools.js";
import {
	DEFAULT_PALETTE_ID,
	MAX_PALETTE_COLORS,
	createDefaultPalette,
	loadPaletteState,
	nearestPaletteColor,
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
	ColorSlot,
	Frame,
	GradientDither,
	GradientShape,
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

const HISTORY_LIMIT = 80;
/** Keep undo history bounded even for very large documents. */
const HISTORY_BYTE_LIMIT = 128 * 1024 * 1024;
const MIN_ZOOM = 1;
const MAX_ZOOM = 64;

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

interface CelPatch {
	layerId: string;
	frame: number;
	pixels: Uint32Array;
}

/**
 * History entries are either a full document clone (structural edits) or one
 * or more previous cel buffers (pixel edits). Pixel edits are the common case,
 * so this avoids cloning every layer and frame on every brush stroke.
 */
type HistoryEntry =
	| { kind: "full"; doc: PixelDoc }
	| { kind: "cels"; patches: CelPatch[] };

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
	/** Which color slot the color panel is currently editing. */
	activeColorSlot = $state<ColorSlot>("primary");
	palettes = $state<Palette[]>([createDefaultPalette()]);
	activePaletteId = $state<string>(DEFAULT_PALETTE_ID);
	/** Restricts color picking to the active palette and blocks palette edits. */
	paletteLocked = $state(false);
	paletteRampOpen = $state(false);
	paletteCyclesOpen = $state(false);
	paletteCoverageOpen = $state(false);
	/**
	 * Inclusive palette range used by the Color Cycles dialog. Cycling is a
	 * workspace preference and is intentionally not stored in project files.
	 */
	paletteCycleStart = $state(0);
	paletteCycleEnd = $state(3);
	paletteCycleMs = $state(DEFAULT_PALETTE_CYCLE_MS);
	paletteCycleDirection = $state<PaletteCycleDirection>("forward");

	brushSize = $state(1);
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

	showGrid = $state(true);
	gridSize = $state(1);
	showPreview = $state(false);
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

	projects = $state<ProjectTab[]>([]);
	activeProjectId = $state("");

	undoCount = $state(0);
	redoCount = $state(0);
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
		return packColor(this.primaryColor, this.alpha);
	}

	get secondaryCurrentColor(): number {
		return packColor(this.secondaryColor, this.secondaryAlpha);
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

		this.pushHistoryCel(floating.layerId, floating.frame);

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
		let changed = false;

		for (let y = 0; y < floating.height && !changed; y++) {
			const destY = floating.originY + y;
			if (destY < 0 || destY >= height) continue;
			for (let x = 0; x < floating.width; x++) {
				const destX = floating.originX + x;
				if (destX < 0 || destX >= width) continue;
				const value = floating.pixels[y * floating.width + x]!;
				if (isTransparent(value)) continue;
				if (cel[destY * width + destX] !== value) {
					changed = true;
					break;
				}
			}
		}

		if (changed) {
			if (!floating.historyPushed) {
				this.pushHistoryCel(floating.layerId, floating.frame);
			}
			for (let y = 0; y < floating.height; y++) {
				const destY = floating.originY + y;
				if (destY < 0 || destY >= height) continue;
				for (let x = 0; x < floating.width; x++) {
					const destX = floating.originX + x;
					if (destX < 0 || destX >= width) continue;
					const value = floating.pixels[y * floating.width + x]!;
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
			pixels: new Uint32Array(clipboard.pixels),
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
		const hex = this.paletteLocked
			? (nearestPaletteColor(this.activePalette.colors, picked) ?? picked)
			: picked;
		this.setColor(slot, hex);
		this.setColorAlpha(slot, a);
		this.activeColorSlot = slot;
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
	snapColorToPalette(slot: ColorSlot = this.activeColorSlot): void {
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
		this.pushHistoryCels(patches);

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

		this.pushHistory();

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

		this.palettes.splice(index, 1);
		if (this.activePaletteId === id) {
			this.activePaletteId = DEFAULT_PALETTE_ID;
		}
		this.#persistPalettes();
	}

	renamePalette(id: string, name: string): void {
		const palette = this.palettes.find((item) => item.id === id);
		if (!palette || palette.builtin || this.paletteLocked) return;
		const trimmed = name.trim();
		if (!trimmed) return;
		palette.name = trimmed.slice(0, 40);
		this.#persistPalettes();
	}

	addPaletteColor(slot: ColorSlot = this.activeColorSlot): void {
		const palette = this.activePalette;
		if (!this.paletteEditable) return;

		const color = slot === "secondary" ? this.secondaryColor : this.primaryColor;
		if (palette.colors.includes(color)) return;
		if (palette.colors.length >= MAX_PALETTE_COLORS) return;

		palette.colors.push(color);
		palette.originalColors ??= [...palette.colors];
		if (!palette.originalColors.includes(color)) {
			palette.originalColors.push(color);
		}
		if (palette.sortMode && palette.sortMode !== "original") {
			palette.colors = sortPaletteColors(
				palette.originalColors,
				palette.sortMode,
			);
		}
		this.#persistPalettes();
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
		return palette.id;
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

	setGridSize(size: number): void {
		if (!Number.isFinite(size)) return;
		this.gridSize = clamp(Math.round(size), 1, 64);
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
			};
		} catch {
			// Documents that are too large for the project format remain fully
			// editable; they simply cannot be written to the recovery store.
			return null;
		}
	}

	#autosaveActiveProject(active: boolean): void {
		if (!this.dirty) return;
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
		);
		if (record) void writeAutosave(record);
	}

	/**
	 * Writes a recovery snapshot for the active project. Autosaves are kept in
	 * IndexedDB so unsaved tabs survive a crash or reload.
	 */
	autosaveNow(): void {
		this.#autosaveActiveProject(true);
	}

	/**
	 * Writes a snapshot for every dirty tab, including inactive ones. Used after
	 * restoring a workspace so a second crash cannot drop the other tabs.
	 */
	autosaveAll(): void {
		this.#autosaveActiveProject(true);
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

	/** Records a full document snapshot. Used for structural edits. */
	pushHistory(): void {
		// Any new edit implicitly applies content that is still floating.
		if (this.floating) this.commitFloatingSelection();
		const entry: HistoryEntry = { kind: "full", doc: cloneDoc(this.doc) };
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

	/**
	 * Records only the active cel before a pixel edit. This is the hot path for
	 * drawing, so it must not clone every layer and frame in the document.
	 */
	pushHistoryCel(
		layerId: string = this.activeLayerId,
		frame: number = this.activeFrame,
	): void {
		if (this.floating) this.commitFloatingSelection();
		const layer = this.doc.layers.find((item) => item.id === layerId);
		const cel = layer?.cels[frame];
		if (!cel) return;
		const entry: HistoryEntry = {
			kind: "cels",
			patches: [{ layerId, frame, pixels: new Uint32Array(cel) }],
		};
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

	/** Records several cels at once (for example, clearing a whole frame). */
	pushHistoryCels(patches: { layerId: string; frame: number }[]): void {
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
		const entry: HistoryEntry = { kind: "cels", patches: captured };
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

	#trimHistory(): void {
		while (
			this.#undo.length > HISTORY_LIMIT ||
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
			return { kind: "full", doc: cloneDoc(this.doc) };
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
		return { kind: "cels", patches };
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
		options: { name?: string; background?: BackgroundKind } = {},
	): void {
		const w = clamp(Math.round(width) || 32, MIN_CANVAS_SIZE, MAX_CANVAS_SIZE);
		const h = clamp(Math.round(height) || 32, MIN_CANVAS_SIZE, MAX_CANVAS_SIZE);
		const doc = createDoc(w, h, options.background ?? "transparent");
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
		options: { dirty?: boolean } = {},
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

		this.pushHistory();
		const layer = createLayer(
			image.name.trim().slice(0, 60) || "Imported layer",
			this.doc.width,
			this.doc.height,
			this.doc.frames.length,
		);
		const cel = layer.cels[this.activeFrame]!;
		cel.set(
			cropPixelsToCanvas(
				image.pixels,
				imageWidth,
				imageHeight,
				this.doc.width,
				this.doc.height,
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
		this.pushHistory();
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
			cropPixelsToCanvas(
				image.pixels,
				imageWidth,
				imageHeight,
				this.doc.width,
				this.doc.height,
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

		this.pushHistory();
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

		this.pushHistoryCel(layer.id, this.activeFrame);
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

		this.pushHistory();
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
		this.pushHistory();
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

	saveToFile(): void {
		if (this.floating) this.commitFloatingSelection();
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
			window.alert(
				error instanceof Error
					? error.message
					: "The project could not be saved.",
			);
		}
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

	/** Toggles a layer row in the selection (Ctrl/Cmd+click). */
	toggleLayerSelection(id: string): void {
		const layers = this.doc.layers;
		if (!layers.some((layer) => layer.id === id)) return;
		if (this.floating) this.commitFloatingSelection();
		this.activeReferenceId = null;

		if (this.layerSelection.includes(id)) {
			if (this.layerSelection.length <= 1) return;
			this.layerSelection = this.layerSelection.filter(
				(layerId) => layerId !== id,
			);
			if (this.activeLayerId === id) {
				this.activeLayerId =
					this.layerSelection[this.layerSelection.length - 1]!;
				this.#layerAnchorId = this.activeLayerId;
			}
			return;
		}

		this.layerSelection = [...this.layerSelection, id];
		this.activeLayerId = id;
		this.#layerAnchorId = id;
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

	/** Ctrl/Cmd+click on a cel: toggles its layer and frame in the selection. */
	toggleCelSelection(layerId: string, frameIndex: number): void {
		this.toggleLayerSelection(layerId);
		this.toggleFrameSelection(frameIndex);
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

	/** Gives a cel its own buffer copy, detaching it from any shared link. */
	#detachCel(layerId: string, frameIndex: number): void {
		const layer = this.doc.layers.find((item) => item.id === layerId);
		const cel = layer?.cels[frameIndex];
		if (cel) layer.cels[frameIndex] = new Uint32Array(cel);
	}

	/**
	 * Links the selected cel to its neighbor in `direction` (-1 left, +1 right).
	 * The selected cel's pixels overwrite the neighbor's.
	 */
	linkCel(layerId: string, frameIndex: number, direction: -1 | 1): void {
		const layer = this.doc.layers.find((item) => item.id === layerId);
		if (!layer || isGroupLayer(layer)) return;
		const other = frameIndex + direction;
		if (other < 0 || other >= this.doc.frames.length) return;
		if (this.isCelLinkedTo(layerId, frameIndex, direction)) return;

		this.pushHistory();
		// Detach any existing links first so each cel keeps one unambiguous link.
		this.#detachCel(layerId, frameIndex);
		this.#detachCel(layerId, other);

		const width = this.doc.width;
		const height = this.doc.height;
		const shared = new Uint32Array(
			layer.cels[frameIndex] ?? new Uint32Array(width * height),
		);
		layer.cels[frameIndex] = shared;
		layer.cels[other] = shared;
		this.structureRevision++;
		this.revision++;
	}

	/**
	 * Unlinks a cel from its neighbor in `direction` (-1 left, +1 right). The
	 * neighbor gets its own buffer copy, leaving the selected cel intact.
	 */
	unlinkCel(layerId: string, frameIndex: number, direction: -1 | 1): void {
		const layer = this.doc.layers.find((item) => item.id === layerId);
		if (!layer) return;
		const other = frameIndex + direction;
		if (other < 0 || other >= this.doc.frames.length) return;
		if (!this.isCelLinkedTo(layerId, frameIndex, direction)) return;

		this.pushHistory();
		this.#detachCel(layerId, other);
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
		this.pushHistory();
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
		this.pushHistory();
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

		this.pushHistory();
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
		this.pushHistory();
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
		this.pushHistory();
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

		this.pushHistory();
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
		this.pushHistory();

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

		this.pushHistory();
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

		this.pushHistory();
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

		this.pushHistoryCel(layer.id, this.activeFrame);
		for (let i = 0; i < cel.length; i++) {
			if (mask[i]) cel[i] = 0;
		}
		this.touch();
	}

	clearLayer(): void {
		const layer = this.activeLayer;
		if (!layer || isGroupLayer(layer) || layer.role === "reference") return;
		this.pushHistoryCel(layer.id, this.activeFrame);
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
	): void {
		this.pushHistory();
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
		this.#applyCanvasTransform(nextWidth, nextHeight, (cel) =>
			scalePixelsNearest(cel, oldWidth, oldHeight, nextWidth, nextHeight),
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
		this.#applyCanvasTransform(nextWidth, nextHeight, (cel) =>
			resizePixels(
				cel,
				oldWidth,
				oldHeight,
				nextWidth,
				nextHeight,
				offsetX,
				offsetY,
			),
		);
		return true;
	}

	/** Crops every cel to an explicit rectangle in the current canvas. */
	cropCanvasTo(
		x: number,
		y: number,
		width: number,
		height: number,
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

		this.#applyCanvasTransform(cropWidth, cropHeight, (cel) =>
			resizePixels(
				cel,
				oldWidth,
				oldHeight,
				cropWidth,
				cropHeight,
				-cropX,
				-cropY,
			),
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

	toggleFrameSelection(index: number): void {
		const next = clamp(Math.round(index), 0, this.doc.frames.length - 1);
		const id = this.doc.frames[next]!.id;
		if (this.floating) this.commitFloatingSelection();

		if (this.frameSelection.includes(id)) {
			if (this.selectedFrameIndices.length <= 1) return;
			this.frameSelection = this.frameSelection.filter(
				(frameId) => frameId !== id,
			);
			const remaining = this.selectedFrameIndices;
			this.activeFrame = remaining[remaining.length - 1] ?? 0;
			this.#frameAnchorId =
				this.doc.frames[this.activeFrame]?.id ?? null;
			return;
		}

		this.frameSelection = [...this.frameSelection, id];
		this.activeFrame = next;
		this.#frameAnchorId = id;
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

		this.pushHistory();
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
				layer.cels.splice(
					target,
					0,
					sourceCel
						? new Uint32Array(sourceCel)
						: new Uint32Array(width * height),
				);
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

		this.pushHistory();
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
		this.pushHistory();
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
		this.pushHistory();

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
		this.pushHistory();
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
		this.pushHistory();
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
		this.pushHistory();
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
