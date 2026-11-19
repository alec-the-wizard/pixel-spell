import { blendPixelPacked, normalizeBlendMode } from "./blend.js";
import { packColor } from "./color.js";
import type {
	AnimationMode,
	BackgroundKind,
	BlendMode,
	CelProps,
	Layer,
	LayerRole,
	PixelDoc,
} from "./types.js";

let idCounter = 0;

export function uid(prefix: string): string {
	idCounter = (idCounter + 1) % 1_000_000;
	return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function createLayer(
	name: string,
	width: number,
	height: number,
	frameCount: number,
	role?: LayerRole,
): Layer {
	return {
		id: uid("layer"),
		name,
		visible: true,
		locked: role === "reference",
		opacity: 1,
		cels: Array.from({ length: frameCount }, () => new Uint32Array(width * height)),
		...(role ? { role } : {}),
	};
}

/** True for timeline reference layers, which cannot be drawn on. */
export function isReferenceLayer(layer: Layer): boolean {
	return layer.role === "reference";
}

/** True for group container nodes, which hold no pixels of their own. */
export function isGroupLayer(layer: Layer): boolean {
	return layer.isGroup === true;
}

/** Creates a group container node. Groups store no cels of their own. */
export function createGroup(
	name: string,
	parentId?: string,
	blendMode: BlendMode = "normal",
): Layer {
	return {
		id: uid("group"),
		name,
		visible: true,
		locked: false,
		opacity: 1,
		cels: [],
		isGroup: true,
		...(parentId ? { parentId } : {}),
		...(blendMode !== "normal" ? { blendMode } : {}),
	};
}

/** Stable key for a cel's properties: `${layerId}:${frameId}`. */
export function celKey(layerId: string, frameId: string): string {
	return `${layerId}:${frameId}`;
}

/** Resolves a cel's presentation properties, or undefined when none are set. */
export function celPropsOf(
	doc: PixelDoc,
	layerId: string,
	frameId: string,
): CelProps | undefined {
	return doc.celProps?.[celKey(layerId, frameId)];
}

/** A cel's opacity (0..1), defaulting to fully opaque. */
export function celOpacityOf(
	doc: PixelDoc,
	layerId: string,
	frameId: string,
): number {
	const opacity = celPropsOf(doc, layerId, frameId)?.opacity;
	return opacity === undefined ? 1 : Math.max(0, Math.min(1, opacity));
}

/** A cel's custom z-index, or undefined when it uses the layer order. */
export function celZIndexOf(
	doc: PixelDoc,
	layerId: string,
	frameId: string,
): number | undefined {
	return celPropsOf(doc, layerId, frameId)?.zIndex;
}

/** A layer (or group) node resolved from the flat layer list. */
export interface LayerNode {
	layer: Layer;
	children: LayerNode[];
}

/** Builds the layer tree from a flat, bottom-to-top `doc.layers` array. */
export function buildLayerTree(layers: readonly Layer[]): {
	roots: LayerNode[];
	byId: Map<string, LayerNode>;
} {
	const byId = new Map<string, LayerNode>();
	for (const layer of layers) byId.set(layer.id, { layer, children: [] });
	const roots: LayerNode[] = [];
	for (const layer of layers) {
		const node = byId.get(layer.id)!;
		const parent = layer.parentId ? byId.get(layer.parentId) : undefined;
		if (parent && parent !== node) parent.children.push(node);
		else roots.push(node);
	}
	return { roots, byId };
}

/** A row in the timeline's flattened, top-to-bottom layer list. */
export interface LayerRow {
	layer: Layer;
	depth: number;
	/** True when this row is the last child of its parent (bottom of the group). */
	last: boolean;
}

/**
 * Flattens the layer tree into timeline display order (top first), expanding
 * groups in place and honoring each group's collapse state.
 */
export function flattenLayersTopFirst(layers: readonly Layer[]): LayerRow[] {
	const { roots } = buildLayerTree(layers);
	const rows: LayerRow[] = [];

	const visit = (node: LayerNode, depth: number, last: boolean): void => {
		rows.push({ layer: node.layer, depth, last });
		if (node.layer.collapsed) return;
		for (let index = node.children.length - 1; index >= 0; index--) {
			visit(node.children[index]!, depth + 1, index === 0);
		}
	};

	for (let index = roots.length - 1; index >= 0; index--) {
		visit(roots[index]!, 0, index === 0);
	}
	return rows;
}

/**
 * True when a document uses any tree/blend feature that prevents the flat
 * incremental compositing path from being correct.
 */
export function hasCompositeFeatures(doc: PixelDoc): boolean {
	for (const layer of doc.layers) {
		if (layer.isGroup || layer.clipping) return true;
		if (layer.blendMode && layer.blendMode !== "normal") return true;
	}
	return false;
}

export function createDoc(
	width = 32,
	height = 32,
	background: BackgroundKind = "transparent",
): PixelDoc {
	const layer = createLayer(
		background === "transparent" ? "Layer 1" : "Background",
		width,
		height,
		1,
	);

	if (background !== "transparent") {
		layer.cels[0]!.fill(
			packColor(background === "white" ? "#ffffff" : "#000000"),
		);
	}

	return {
		width,
		height,
		fps: 12,
		frames: [{ id: uid("frame") }],
		layers: [layer],
		references: [],
		animationMode: "forward",
		animationLoop: true,
	};
}

/** Custom per-frame duration bounds, in milliseconds. */
export const MIN_FRAME_DURATION = 10;
export const MAX_FRAME_DURATION = 10_000;

/** Coerces an unknown value to a valid animation mode. */
export function normalizeAnimationMode(value: unknown): AnimationMode {
	return value === "backward" || value === "ping-pong"
		? value
		: "forward";
}

/**
 * Expands frame indices into a playback sequence. Ping-pong plays forward then
 * backward; a looping ping-pong omits the repeated endpoint (`a, b, c, b`) so
 * the bounce stays even, while a one-shot ping-pong completes the full
 * there-and-back pass (`a, b, c, b, a`).
 */
export function animationSequence(
	indices: readonly number[],
	mode: AnimationMode,
	loop: boolean,
): number[] {
	if (indices.length === 0) return [];
	if (indices.length === 1) return [indices[0]!];
	if (mode === "forward") return [...indices];
	if (mode === "backward") return [...indices].reverse();

	const bounce = indices.slice(1, -1).reverse();
	return loop
		? [...indices, ...bounce]
		: [...indices, ...bounce, indices[0]!];
}

/** Resolves a frame's display duration, falling back to the document fps. */
export function frameDurationMs(doc: PixelDoc, frameIndex: number): number {
	const frame = doc.frames[frameIndex];
	if (frame && frame.duration !== undefined && Number.isFinite(frame.duration)) {
		return Math.max(
			MIN_FRAME_DURATION,
			Math.min(MAX_FRAME_DURATION, frame.duration),
		);
	}
	const fps = Math.max(1, Math.min(60, doc.fps || 12));
	return 1000 / fps;
}

/** Deep-clones a document into plain (non-reactive) objects. */
export function cloneDoc(doc: PixelDoc): PixelDoc {
	const frames = doc.frames.map((frame) => ({
		id: frame.id,
		...(frame.duration !== undefined ? { duration: frame.duration } : {}),
		...(frame.tag ? { tag: frame.tag } : {}),
	}));

	const layers = doc.layers.map((layer) => {
		// Linked cels share one buffer; clone each distinct buffer once so
		// write-through editing survives history snapshots and project switches.
		const buffers = new Map<Uint32Array, Uint32Array>();
		return {
			id: layer.id,
			name: layer.name,
			visible: layer.visible,
			locked: layer.locked,
			opacity: layer.opacity,
			cels: layer.cels.map((cel) => {
				let clone = buffers.get(cel);
				if (!clone) {
					clone = new Uint32Array(cel);
					buffers.set(cel, clone);
				}
				return clone;
			}),
			...(layer.role ? { role: layer.role } : {}),
			...(layer.color ? { color: layer.color } : {}),
			...(layer.isGroup ? { isGroup: true } : {}),
			...(layer.parentId ? { parentId: layer.parentId } : {}),
			...(layer.blendMode && layer.blendMode !== "normal"
				? { blendMode: layer.blendMode }
				: {}),
			...(layer.clipping ? { clipping: true } : {}),
			...(layer.collapsed ? { collapsed: true } : {}),
			...(layer.continuous ? { continuous: true } : {}),
		};
	});

	return {
		width: doc.width,
		height: doc.height,
		fps: doc.fps,
		frames,
		layers,
		// Reference bytes are immutable, so history and project snapshots can
		// share them while cloning the small transform metadata.
		references: doc.references.map((reference) => ({ ...reference })),
		animationMode: normalizeAnimationMode(doc.animationMode),
		animationLoop: doc.animationLoop !== false,
		...(doc.celProps
			? {
					celProps: Object.fromEntries(
						Object.entries(doc.celProps).map(([key, value]) => [
							key,
							{ ...value },
						]),
					),
				}
			: {}),
	};
}

/**
 * 256×256 lookup for `sourceAlpha * layerOpacity / 255`. Index is
 * `(sourceAlpha << 8) | opacityByte`. Keeps the compositing inner loop free of
 * floating point multiplication for the common opaque case.
 */
const ALPHA_PRODUCT = new Uint8Array(256 * 256);
for (let alpha = 0; alpha < 256; alpha++) {
	for (let opacity = 0; opacity < 256; opacity++) {
		ALPHA_PRODUCT[(alpha << 8) | opacity] = Math.round((alpha * opacity) / 255);
	}
}

/** Full alpha blend for the uncommon partially transparent case. */
function blendPixelSlow(
	source: number,
	destination: number,
	sa: number,
): number {
	const saF = sa / 255;
	const daF = (destination >>> 24) / 255;
	const oaF = saF + daF * (1 - saF);
	if (oaF <= 0) return destination;

	const inverse = 1 / oaF;
	const sr = source & 0xff;
	const sg = (source >>> 8) & 0xff;
	const sb = (source >>> 16) & 0xff;
	const dr = destination & 0xff;
	const dg = (destination >>> 8) & 0xff;
	const db = (destination >>> 16) & 0xff;

	const r = ((sr * saF + dr * daF * (1 - saF)) * inverse + 0.5) | 0;
	const g = ((sg * saF + dg * daF * (1 - saF)) * inverse + 0.5) | 0;
	const b = ((sb * saF + db * daF * (1 - saF)) * inverse + 0.5) | 0;
	const a = (oaF * 255 + 0.5) | 0;

	return (((a & 0xff) << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** One visible layer participating in a flat composite, pre-resolved to its cel. */
interface CompositeLayer {
	id: string;
	cel: Uint32Array;
	opacityByte: number;
}

/**
 * Resolves the ordered list of visible, flat layers that participate in a
 * composite. Only used by the incremental fast path, which is limited to
 * documents without groups, blend modes, or clipping. Reference layers are
 * excluded by default so every export path is safe; pass `includeReferences`
 * for viewport rendering only.
 */
function compositeLayers(
	doc: PixelDoc,
	frameIndex: number,
	includeReferences: boolean,
): CompositeLayer[] {
	const layers: CompositeLayer[] = [];
	for (const layer of frameOrderedLayers(doc, frameIndex)) {
		if (isGroupLayer(layer)) continue;
		if (!includeReferences && layer.role === "reference") continue;
		if (!layer.visible || layer.opacity <= 0) continue;
		const cel = layer.cels[frameIndex];
		if (!cel) continue;
		layers.push({
			id: layer.id,
			cel,
			opacityByte: effectiveOpacityByte(doc, layer, frameIndex),
		});
	}
	return layers;
}

function opacityByteOf(layer: Layer): number {
	return Math.max(0, Math.min(255, Math.round(layer.opacity * 255)));
}

/** Combined layer × cel opacity as a byte (0..255) for a frame's cel. */
function effectiveOpacityByte(
	doc: PixelDoc,
	layer: Layer,
	frameIndex: number,
): number {
	const frame = doc.frames[frameIndex];
	if (!frame) return opacityByteOf(layer);
	const celOpacity = celOpacityOf(doc, layer.id, frame.id);
	return Math.max(
		0,
		Math.min(255, Math.round(layer.opacity * celOpacity * 255)),
	);
}

/**
 * Layers in a frame's composite order. A cel with a custom z-index is stacked
 * at its z-index (higher composites later); otherwise layers keep their natural
 * bottom-to-top order. z-index reordering only applies to flat documents, where
 * every layer is a top-level sibling.
 */
function frameOrderedLayers(
	doc: PixelDoc,
	frameIndex: number,
): readonly Layer[] {
	const frame = doc.frames[frameIndex];
	if (!frame) return doc.layers;
	if (doc.layers.some((layer) => layer.isGroup)) return doc.layers;

	let needsSort = false;
	for (const layer of doc.layers) {
		if (celZIndexOf(doc, layer.id, frame.id) !== undefined) {
			needsSort = true;
			break;
		}
	}
	if (!needsSort) return doc.layers;

	return doc.layers
		.map((layer, index) => ({
			layer,
			index,
			z: celZIndexOf(doc, layer.id, frame.id) ?? 0,
		}))
		.sort((a, b) => a.z - b.z || a.index - b.index)
		.map((entry) => entry.layer);
}

/** Blends one buffer over `output` in place with an optional blend mode/clip. */
function blendLayerInto(
	output: Uint32Array,
	cel: Uint32Array,
	count: number,
	opacityByte: number,
	mode: BlendMode = "normal",
	clipping = false,
): void {
	if (mode === "normal" && !clipping) {
		for (let index = 0; index < count; index++) {
			const source = cel[index]!;
			const sourceAlpha = source >>> 24;
			if (sourceAlpha === 0) continue;
			const sa = ALPHA_PRODUCT[(sourceAlpha << 8) | opacityByte]!;
			if (sa === 0) continue;

			const destination = output[index]!;
			const destinationAlpha = destination >>> 24;
			if (destinationAlpha === 0) {
				output[index] = ((sa << 24) | (source & 0x00ffffff)) >>> 0;
				continue;
			}
			if (sa === 255) {
				output[index] = (0xff000000 | (source & 0x00ffffff)) >>> 0;
				continue;
			}
			output[index] = blendPixelSlow(source, destination, sa);
		}
		return;
	}

	for (let index = 0; index < count; index++) {
		const source = cel[index]!;
		const sourceAlpha = source >>> 24;
		if (sourceAlpha === 0) continue;
		let sa = ALPHA_PRODUCT[(sourceAlpha << 8) | opacityByte]!;
		if (sa === 0) continue;

		const destination = output[index]!;
		if (clipping) {
			sa = ALPHA_PRODUCT[(sa << 8) | (destination >>> 24)]!;
			if (sa === 0) continue;
		}
		output[index] = blendPixelPacked(mode, source, destination, sa);
	}
}

/** Composites one node (and its subtree) into `output` in place. */
function compositeNodeInto(
	node: LayerNode,
	doc: PixelDoc,
	frameIndex: number,
	includeReferences: boolean,
	output: Uint32Array,
	count: number,
): void {
	const layer = node.layer;

	if (isGroupLayer(layer)) {
		if (!layer.visible || layer.opacity <= 0) return;
		const groupBuffer = new Uint32Array(count);
		for (const child of node.children) {
			compositeNodeInto(
				child,
				doc,
				frameIndex,
				includeReferences,
				groupBuffer,
				count,
			);
		}
		blendLayerInto(
			output,
			groupBuffer,
			count,
			opacityByteOf(layer),
			layer.blendMode ?? "normal",
			layer.clipping === true,
		);
		return;
	}

	if (!includeReferences && layer.role === "reference") return;
	if (!layer.visible || layer.opacity <= 0) return;
	const cel = layer.cels[frameIndex];
	if (!cel) return;
	blendLayerInto(
		output,
		cel,
		count,
		effectiveOpacityByte(doc, layer, frameIndex),
		layer.blendMode ?? "normal",
		layer.clipping === true,
	);
}

/**
 * Flattens every visible layer of a frame into a single RGBA pixel buffer.
 * The buffer uses the same packed little-endian format as layer cels.
 *
 * Reference layers are excluded by default so every export path is safe.
 * Pass `includeReferences` for viewport rendering only.
 */
export function compositeFrame(
	doc: PixelDoc,
	frameIndex: number,
	includeReferences = false,
): Uint32Array {
	const count = doc.width * doc.height;
	const output = new Uint32Array(count);

	const { roots } = buildLayerTree(frameOrderedLayers(doc, frameIndex));
	for (const root of roots) {
		compositeNodeInto(root, doc, frameIndex, includeReferences, output, count);
	}

	return output;
}

/** Blends one source pixel over `output` with the node's opacity/blend/clip. */
function blendPixelInto(
	layer: Layer,
	source: number,
	output: number,
	opacityByte: number,
): number {
	const sourceAlpha = source >>> 24;
	if (sourceAlpha === 0) return output;
	let sa = ALPHA_PRODUCT[(sourceAlpha << 8) | opacityByte]!;
	if (sa === 0) return output;
	if (layer.clipping) {
		sa = ALPHA_PRODUCT[(sa << 8) | (output >>> 24)]!;
		if (sa === 0) return output;
	}
	return blendPixelPacked(layer.blendMode ?? "normal", source, output, sa);
}

/** Composites one node's subtree into a single pixel. */
function blendNodePixelInto(
	node: LayerNode,
	doc: PixelDoc,
	frameIndex: number,
	index: number,
	output: number,
): number {
	const layer = node.layer;

	if (isGroupLayer(layer)) {
		if (!layer.visible || layer.opacity <= 0) return output;
		let acc = 0;
		for (const child of node.children) {
			acc = blendNodePixelInto(child, doc, frameIndex, index, acc);
		}
		if (acc === 0) return output;
		return blendPixelInto(layer, acc, output, opacityByteOf(layer));
	}

	if (!layer.visible || layer.opacity <= 0) return output;
	const cel = layer.cels[frameIndex];
	if (!cel) return output;
	const source = cel[index];
	if (source === undefined) return output;
	return blendPixelInto(
		layer,
		source,
		output,
		effectiveOpacityByte(doc, layer, frameIndex),
	);
}

/** Composites a single pixel; used by the eyedropper instead of a full frame. */
export function compositePixel(
	doc: PixelDoc,
	frameIndex: number,
	x: number,
	y: number,
): number {
	if (x < 0 || x >= doc.width || y < 0 || y >= doc.height) return 0;
	const index = y * doc.width + x;

	const { roots } = buildLayerTree(frameOrderedLayers(doc, frameIndex));
	let output = 0;
	for (const root of roots) {
		output = blendNodePixelInto(root, doc, frameIndex, index, output);
	}
	return output;
}

interface CompositeCache {
	revision: number;
	frames: Map<string, Uint32Array>;
}

const COMPOSITE_CACHE_LIMIT = 8;
const compositeCaches = new WeakMap<PixelDoc, CompositeCache>();

/**
 * Memoized `compositeFrame` for the viewport and preview. The returned buffer
 * is shared and must be treated as read-only. Caches at most eight variants
 * per document and drops everything when the document revision changes.
 */
export function compositeFrameCached(
	doc: PixelDoc,
	frameIndex: number,
	revision: number,
	includeReferences = false,
): Uint32Array {
	let cache = compositeCaches.get(doc);
	if (!cache || cache.revision !== revision) {
		cache = { revision, frames: new Map() };
		compositeCaches.set(doc, cache);
	}

	const key = `${frameIndex}:${includeReferences ? 1 : 0}`;
	const existing = cache.frames.get(key);
	if (existing) return existing;

	const pixels = compositeFrame(doc, frameIndex, includeReferences);
	cache.frames.set(key, pixels);
	if (cache.frames.size > COMPOSITE_CACHE_LIMIT) {
		const oldest = cache.frames.keys().next().value;
		if (oldest !== undefined) cache.frames.delete(oldest);
	}
	return pixels;
}

/**
 * Per-frame prefix composites used by `compositeFrameCachedIncremental`.
 * `prefixes[i]` is the composite of layers `[0..i]`, so editing layer `i` only
 * needs to recomposite from `i` upward while reusing everything below it.
 */
interface FramePrefixes {
	layerIds: string[];
	prefixes: Uint32Array[];
}

interface IncrementalCompositeState {
	structureRevision: number;
	appearanceRevision: number;
	includeReferences: boolean;
	frames: Map<string, FramePrefixes>;
}

/**
 * Prefix buffers multiply memory by the layer count, so prefix caching is only
 * worth it while the per-frame prefix footprint stays bounded.
 */
const INCREMENTAL_PREFIX_MAX_PIXELS = 16_000_000;

const incrementalCompositeStates = new WeakMap<
	PixelDoc,
	IncrementalCompositeState
>();

function buildFramePrefixes(
	doc: PixelDoc,
	frameIndex: number,
	includeReferences: boolean,
): FramePrefixes {
	const count = doc.width * doc.height;
	const layers = compositeLayers(doc, frameIndex, includeReferences);
	const prefixes = new Array<Uint32Array>(layers.length);
	const layerIds = new Array<string>(layers.length);
	const output = new Uint32Array(count);

	for (let index = 0; index < layers.length; index++) {
		const layer = layers[index]!;
		layerIds[index] = layer.id;
		blendLayerInto(output, layer.cel, count, layer.opacityByte);
		prefixes[index] = new Uint32Array(output);
	}

	return { layerIds, prefixes };
}

function recomputePrefixesFrom(
	entry: FramePrefixes,
	layers: readonly CompositeLayer[],
	fromIndex: number,
	count: number,
): void {
	for (let index = fromIndex; index < layers.length; index++) {
		const destination = new Uint32Array(count);
		if (index > 0) destination.set(entry.prefixes[index - 1]!);
		blendLayerInto(
			destination,
			layers[index]!.cel,
			count,
			layers[index]!.opacityByte,
		);
		entry.prefixes[index] = destination;
	}
}

/**
 * Memoized `compositeFrame` that recomposites only the edited layer and the
 * layers above it. The returned buffer is shared and must be treated as
 * read-only.
 *
 * Structural changes (add/remove/reorder layers or frames, undo/redo, project
 * switches) and visibility/opacity changes invalidate the whole cache via
 * `structureRevision`/`appearanceRevision`. A plain pixel edit is expressed as
 * `editedLayerId`, so layers below the edited one are reused from the cached
 * prefixes instead of being blended again.
 */
export function compositeFrameCachedIncremental(
	doc: PixelDoc,
	frameIndex: number,
	includeReferences: boolean,
	structureRevision: number,
	appearanceRevision: number,
	editedLayerId: string | null,
): Uint32Array {
	// The flat prefix path is only correct without groups, blend modes, and
	// clipping; fall back to a full composite when any of those are present.
	if (hasCompositeFeatures(doc)) {
		return compositeFrame(doc, frameIndex, includeReferences);
	}

	const count = doc.width * doc.height;
	const layers = compositeLayers(doc, frameIndex, includeReferences);

	// Prefix caching costs `layers.length` buffers per frame; for very large
	// documents a single full composite is cheaper to recompute than to store.
	if (layers.length * count > INCREMENTAL_PREFIX_MAX_PIXELS) {
		return compositeFrame(doc, frameIndex, includeReferences);
	}

	let state = incrementalCompositeStates.get(doc);
	if (
		!state ||
		state.structureRevision !== structureRevision ||
		state.appearanceRevision !== appearanceRevision ||
		state.includeReferences !== includeReferences
	) {
		state = {
			structureRevision,
			appearanceRevision,
			includeReferences,
			frames: new Map(),
		};
		incrementalCompositeStates.set(doc, state);
	}

	const key = String(frameIndex);
	let entry = state.frames.get(key);
	if (!entry) {
		entry = buildFramePrefixes(doc, frameIndex, includeReferences);
		state.frames.set(key, entry);
		if (state.frames.size > COMPOSITE_CACHE_LIMIT) {
			const oldest = state.frames.keys().next().value;
			if (oldest !== undefined) state.frames.delete(oldest);
		}
	}

	const editedIndex =
		editedLayerId !== null ? entry.layerIds.indexOf(editedLayerId) : -1;
	if (editedIndex < 0) {
		// Unknown layer or no hint: the safe path is a full recomposite.
		entry = buildFramePrefixes(doc, frameIndex, includeReferences);
		state.frames.set(key, entry);
	} else {
		recomputePrefixesFrom(entry, layers, editedIndex, count);
	}

	return entry.prefixes[entry.prefixes.length - 1] ?? new Uint32Array(count);
}
