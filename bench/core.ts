/**
 * Deterministic core benchmarks for Pixel Spell.
 *
 * These exercise the pure editor modules (no DOM). Run with:
 *   node bench/run.mjs
 *
 * The harness bundles this file with rolldown and executes it in Node so the
 * exact TypeScript sources used by the app are measured.
 */
import { MAX_CANVAS_SIZE } from "../src/lib/editor/canvas.js";
import { CANVAS_SIZE_PRESETS } from "../src/lib/editor/canvas-presets.js";
import { packColor, unpackColor } from "../src/lib/editor/color.js";
import {
	animationSequence,
	cloneDoc,
	compositeFrame,
	compositeFrameCachedIncremental,
	createDoc,
	createGroup,
	createLayer,
	isGroupLayer,
	normalizeAnimationMode,
} from "../src/lib/editor/doc.js";
import {
	blurPixels,
	fillPixels,
	gradientPixels,
	jumblePixels,
	paintBrush,
	plotShape,
	sprayPixels,
} from "../src/lib/editor/draw.js";
import {
	exportGif,
	sheetAnimations,
	sheetFrameInfos,
	sheetMetadata,
	sheetTagRanges,
} from "../src/lib/editor/export.js";
import { parseProject, serializeProject } from "../src/lib/editor/file.js";
import {
	LAYER_COLOR_PRESETS,
	layerTint,
	normalizeLayerColor,
} from "../src/lib/editor/layer-color.js";
import {
	nearestPaletteColor,
	reorderPaletteColor,
	sortPaletteColors,
} from "../src/lib/editor/palette.js";
import {
	buildPaletteCycleMap,
	paletteCycleColors,
	paletteCyclePeriod,
	paletteShiftForStep,
	remapPalettePixels,
} from "../src/lib/editor/palette-cycle.js";
import {
	analyzePaletteCoverage,
	unusedPaletteColors,
} from "../src/lib/editor/palette-analysis.js";
import { generatePaletteRamp } from "../src/lib/editor/palette-ramp.js";
import {
	lassoSelectionMask,
	magicWandMask,
	selectionBounds,
} from "../src/lib/editor/selection.js";
import {
	rotateRotsprite,
	transformSelection,
	warpScaleSkew,
} from "../src/lib/editor/transform.js";
import type { BlendMode, MirrorAxis, PixelDoc } from "../src/lib/editor/types.js";

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function makeDoc(
	width: number,
	height: number,
	layerCount: number,
	frameCount: number,
	seed = 1,
): PixelDoc {
	const random = mulberry32(seed);
	const doc = createDoc(width, height);
	doc.frames = Array.from({ length: frameCount }, (_, index) => ({
		id: `frame-${index}`,
	}));
	doc.layers = [];
	for (let layerIndex = 0; layerIndex < layerCount; layerIndex++) {
		const cels: Uint32Array[] = [];
		for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
			const cel = new Uint32Array(width * height);
			// Sparse pixel-art style content: ~18% coverage, a few flat colors.
			for (let index = 0; index < cel.length; index++) {
				if (random() > 0.18) continue;
				const paletteIndex = Math.floor(random() * 8);
				const alpha = random() > 0.85 ? 128 : 255;
				cel[index] = packColor(
					["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#ff004d", "#29adff", "#ffec27"][
						paletteIndex
					]!,
					alpha,
				);
			}
			cels.push(cel);
		}
		doc.layers.push({
			id: `layer-${layerIndex}`,
			name: `Layer ${layerIndex + 1}`,
			visible: true,
			locked: false,
			opacity: layerIndex === 1 ? 0.55 : 1,
			cels,
		});
	}
	return doc;
}

function makeFlatCel(width: number, height: number, seed = 2): Uint32Array {
	const random = mulberry32(seed);
	const cel = new Uint32Array(width * height);
	for (let index = 0; index < cel.length; index++) {
		if (random() > 0.45) continue;
		cel[index] = packColor(
			["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236"][
				Math.floor(random() * 5)
			]!,
			255,
		);
	}
	return cel;
}

function measure(label: string, iterations: number, warmup: number, fn: () => void): number {
	for (let index = 0; index < warmup; index++) fn();
	const samples: number[] = [];
	for (let index = 0; index < iterations; index++) {
		const start = performance.now();
		fn();
		samples.push(performance.now() - start);
	}
	samples.sort((a, b) => a - b);
	const median = samples[Math.floor(samples.length / 2)]!;
	const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
	results[label] = { median, mean, min: samples[0]!, max: samples[samples.length - 1]! };
	return median;
}

const results: Record<string, { median: number; mean: number; min: number; max: number }> = {};

// --- Document compositing -------------------------------------------------
const compositeDoc = makeDoc(512, 512, 4, 6, 7);
measure("compositeFrame 512x512x4 (per frame)", 12, 3, () => {
	for (let frame = 0; frame < compositeDoc.frames.length; frame++) {
		compositeFrame(compositeDoc, frame);
	}
});

const smallCompositeDoc = makeDoc(128, 128, 6, 20, 11);
measure("compositeFrame 128x128x6 (per frame)", 20, 5, () => {
	for (let frame = 0; frame < smallCompositeDoc.frames.length; frame++) {
		compositeFrame(smallCompositeDoc, frame);
	}
});

// Incremental compositing: with a warm cache, editing a single layer should
// recomposite only that layer and the layers above it.
const incrementalDoc = makeDoc(512, 512, 8, 6, 61);
measure("compositeFrame 512x512x8 (per frame)", 12, 3, () => {
	for (let frame = 0; frame < incrementalDoc.frames.length; frame++) {
		compositeFrame(incrementalDoc, frame);
	}
});
compositeFrameCachedIncremental(incrementalDoc, 0, false, 0, 0, "layer-0");
measure("compositeFrameIncremental 512x512x8 (edit top layer)", 12, 3, () => {
	compositeFrameCachedIncremental(incrementalDoc, 0, false, 0, 0, "layer-7");
});

measure("cloneDoc 512x512x4x6", 8, 2, () => {
	cloneDoc(compositeDoc);
});

// Reference layers must be opt-in for viewport compositing and excluded by default.
{
	const referenceDoc = createDoc(2, 1);
	referenceDoc.layers[0]!.cels[0]!.fill(packColor("#ff0000"));
	const reference = createLayer("Reference", 2, 1, 1, "reference");
	reference.cels[0]!.fill(packColor("#0000ff"));
	referenceDoc.layers.push(reference);

	const exported = compositeFrame(referenceDoc, 0);
	const viewport = compositeFrame(referenceDoc, 0, true);
	if (exported[0] !== packColor("#ff0000")) {
		throw new Error("reference layer leaked into the default composite");
	}
	if (viewport[0] !== packColor("#0000ff")) {
		throw new Error("reference layer missing from the viewport composite");
	}
}



// --- Drawing --------------------------------------------------------------
const width = 512;
const height = 512;
const cel = makeFlatCel(width, height);
const mirrors: MirrorAxis[] = [
	{ kind: "x", position: height / 2 },
	{ kind: "y", position: width / 2 },
];

measure("fillPixels full 512x512", 20, 3, () => {
	const working = new Uint32Array(cel);
	fillPixels(working, width, height, 0, 0, 0xffffffff, 0, true);
});

measure("gradientPixels full 512x512 bayer4", 10, 2, () => {
	const working = new Uint32Array(cel);
	gradientPixels(
		working,
		width,
		height,
		0,
		0,
		width,
		height,
		0xff0000ff,
		0xffff0000,
		0,
		true,
		"linear",
		"bayer4",
	);
});

measure("blurPixels r16 512x512", 20, 3, () => {
	const working = new Uint32Array(cel);
	blurPixels(working, width, height, 256, 256, 16, 50);
});

measure("jumblePixels r16 512x512", 20, 3, () => {
	const working = new Uint32Array(cel);
	jumblePixels(working, width, height, 256, 256, 16, 50);
});

measure("paintBrush 10k stamps size4 + 2 mirrors", 20, 3, () => {
	const working = new Uint32Array(cel);
	for (let index = 0; index < 10_000; index++) {
		paintBrush(
			working,
			width,
			height,
			index % width,
			(index * 7) % height,
			4,
			0xff00ff00,
			mirrors,
		);
	}
});

measure("plotShape star 256x256 outline", 100, 10, () => {
	const working = new Uint32Array(width * height);
	plotShape("star", 32, 32, 288, 288, false, (x, y) => {
		if (x >= 0 && x < width && y >= 0 && y < height) working[y * width + x] = 0xffffffff;
	});
});

measure("sprayPixels r16 400 shots", 50, 5, () => {
	const working = new Uint32Array(cel);
	sprayPixels(working, width, height, 256, 256, 16, 400, 0xff00ff00, mirrors);
});

// --- Selection ------------------------------------------------------------
measure("magicWandMask 512x512", 20, 3, () => {
	magicWandMask(cel, width, height, 10, 10, false);
});

const fullMask = new Uint8Array(width * height).fill(1);
measure("selectionBounds full 512x512", 100, 10, () => {
	selectionBounds(fullMask, width, height);
});

const lassoPoints = Array.from({ length: 240 }, (_, index) => {
	const angle = (index / 240) * Math.PI * 2;
	return { x: 256 + Math.cos(angle) * 200, y: 256 + Math.sin(angle) * 180 };
});
measure("lassoSelectionMask 240 points", 50, 5, () => {
	lassoSelectionMask(lassoPoints, width, height);
});

// --- Project files --------------------------------------------------------
const projectDoc = makeDoc(256, 256, 4, 12, 21);
const palette = [
	"#000000",
	"#1d2b53",
	"#7e2553",
	"#008751",
	"#ab5236",
	"#ff004d",
	"#29adff",
	"#ffec27",
];

let serialized = new Uint8Array();
measure("serializeProject 256x256x4x12", 6, 1, () => {
	serialized = serializeProject(projectDoc, palette, "Benchmark", 3, "layer-0");
});
results["serializeProject bytes"] = {
	median: serialized.byteLength,
	mean: serialized.byteLength,
	min: serialized.byteLength,
	max: serialized.byteLength,
};
measure("parseProject 256x256x4x12", 6, 1, () => {
	const parsed = parseProject(serialized);
	if (!parsed) throw new Error("parseProject failed");
});

function assertProjectRoundtrip(doc: PixelDoc, label: string): void {
	const bytes = serializeProject(doc, palette, label, 0, doc.layers[0]!.id);
	const parsed = parseProject(bytes);
	if (!parsed) throw new Error(`${label}: parse failed`);
	if (parsed.doc.width !== doc.width || parsed.doc.height !== doc.height) {
		throw new Error(`${label}: dimensions changed`);
	}
	if (parsed.doc.layers.length !== doc.layers.length) {
		throw new Error(`${label}: layer count changed`);
	}
	if (parsed.doc.references.length !== doc.references.length) {
		throw new Error(`${label}: reference count changed`);
	}
	if (parsed.doc.frames.length !== doc.frames.length) {
		throw new Error(`${label}: frame count changed`);
	}
	for (let index = 0; index < doc.frames.length; index++) {
		const original = doc.frames[index]!;
		const restored = parsed.doc.frames[index]!;
		if ((original.duration ?? null) !== (restored.duration ?? null)) {
			throw new Error(`${label}: frame duration changed`);
		}
		if ((original.tag ?? "") !== (restored.tag ?? "")) {
			throw new Error(`${label}: frame tag changed`);
		}
	}
	if (
		normalizeAnimationMode(doc.animationMode) !==
			normalizeAnimationMode(parsed.doc.animationMode) ||
		(doc.animationLoop !== false) !== (parsed.doc.animationLoop !== false)
	) {
		throw new Error(`${label}: animation settings changed`);
	}
	for (let layerIndex = 0; layerIndex < doc.layers.length; layerIndex++) {
		const originalLayer = doc.layers[layerIndex]!;
		const restoredLayer = parsed.doc.layers[layerIndex]!;
		if (originalLayer.role !== restoredLayer.role) {
			throw new Error(`${label}: layer role changed`);
		}
		if (originalLayer.color !== restoredLayer.color) {
			throw new Error(`${label}: layer color changed`);
		}
		if (originalLayer.locked !== restoredLayer.locked) {
			throw new Error(`${label}: layer lock changed`);
		}
		for (let frame = 0; frame < doc.frames.length; frame++) {
			const original = originalLayer.cels[frame]!;
			const restored = restoredLayer.cels[frame]!;
			if (original.length !== restored.length) {
				throw new Error(`${label}: cel length changed`);
			}
			for (let index = 0; index < original.length; index++) {
				if (original[index] !== restored[index]) {
					throw new Error(`${label}: pixel mismatch`);
				}
			}
		}
	}
	for (let index = 0; index < doc.references.length; index++) {
		const original = doc.references[index]!;
		const restored = parsed.doc.references[index]!;
		if (original.id !== restored.id || original.name !== restored.name) {
			throw new Error(`${label}: reference identity changed`);
		}
		if (original.bytes.length !== restored.bytes.length) {
			throw new Error(`${label}: reference byte length changed`);
		}
		for (let byte = 0; byte < original.bytes.length; byte++) {
			if (original.bytes[byte] !== restored.bytes[byte]) {
				throw new Error(`${label}: reference bytes changed`);
			}
		}
		if (
			original.x !== restored.x ||
			original.y !== restored.y ||
			original.width !== restored.width ||
			original.height !== restored.height ||
			original.opacity !== restored.opacity
		) {
			throw new Error(`${label}: reference transform changed`);
		}
	}
}

function assertLayerGroups(): void {
	// Blend modes on a 1×1 canvas (opaque colors give exact results).
	const blendCases: [BlendMode, string][] = [
		["multiply", "#000000"],
		["screen", "#ff00ff"],
		["darken", "#000000"],
		["lighten", "#ff00ff"],
		["add", "#ff00ff"],
		["subtract", "#ff0000"],
		["difference", "#ff00ff"],
		["exclusion", "#ff00ff"],
	];
	for (const [mode, expected] of blendCases) {
		const doc = createDoc(1, 1);
		doc.layers[0]!.cels[0]![0] = packColor("#ff0000");
		const top = createLayer("top", 1, 1, 1);
		top.cels[0]![0] = packColor("#0000ff");
		top.blendMode = mode;
		doc.layers.push(top);
		const result = compositeFrame(doc, 0)[0]!;
		if ((result & 0x00ffffff) !== (packColor(expected) & 0x00ffffff)) {
			throw new Error(`blend mode ${mode} changed`);
		}
	}

	// Clipping to the composited content below (2×1 canvas).
	const clipDoc = createDoc(2, 1);
	clipDoc.layers[0]!.cels[0]!.set([packColor("#ff0000"), 0]);
	const clipped = createLayer("clipped", 2, 1, 1);
	clipped.cels[0]!.fill(packColor("#0000ff"));
	clipped.clipping = true;
	clipDoc.layers.push(clipped);
	const clipResult = compositeFrame(clipDoc, 0);
	if (clipResult[0] !== packColor("#0000ff")) {
		throw new Error("clipping should not hide over opaque base");
	}
	if (clipResult[1] !== 0) {
		throw new Error("clipping should hide over transparent base");
	}

	// Group opacity (half-transparent blue over nothing).
	const groupOpacityDoc = createDoc(1, 1);
	groupOpacityDoc.layers = [];
	const group = createGroup("G");
	group.opacity = 0.5;
	const child = createLayer("child", 1, 1, 1);
	child.cels[0]![0] = packColor("#0000ff");
	child.parentId = group.id;
	groupOpacityDoc.layers.push(group, child);
	const go = unpackColor(compositeFrame(groupOpacityDoc, 0)[0]!);
	if (go.a !== 128 || go.b !== 255 || go.r !== 0) {
		throw new Error("group opacity composite changed");
	}

	// Group blend mode (multiply over red → black).
	const groupBlendDoc = createDoc(1, 1);
	groupBlendDoc.layers[0]!.cels[0]![0] = packColor("#ff0000");
	const groupBlend = createGroup("G2");
	groupBlend.blendMode = "multiply";
	const groupChild = createLayer("child2", 1, 1, 1);
	groupChild.cels[0]![0] = packColor("#0000ff");
	groupChild.parentId = groupBlend.id;
	groupBlendDoc.layers.push(groupBlend, groupChild);
	if ((compositeFrame(groupBlendDoc, 0)[0]! & 0x00ffffff) !== 0) {
		throw new Error("group blend mode composite changed");
	}

	// Round-trip a grouped, blended, clipped document.
	const round = createDoc(2, 2);
	round.layers = [];
	const outer = createGroup("Outer");
	outer.blendMode = "overlay";
	outer.clipping = true;
	const inner = createLayer("Inner", 2, 2, 1);
	inner.blendMode = "multiply";
	inner.clipping = true;
	inner.parentId = outer.id;
	inner.cels[0]![0] = packColor("#123456", 200);
	const plain = createLayer("Plain", 2, 2, 1);
	plain.cels[0]![1] = packColor("#abcdef");
	round.layers.push(plain, outer, inner);

	const bytes = serializeProject(round, palette, "groups", 0, plain.id);
	const parsed = parseProject(bytes);
	if (!parsed) throw new Error("group round-trip parse failed");
	if (parsed.doc.layers.length !== 3) {
		throw new Error("group round-trip layer count changed");
	}
	const [restoredPlain, restoredGroup, restoredInner] = parsed.doc.layers;
	if (!isGroupLayer(restoredGroup!)) {
		throw new Error("group round-trip lost group flag");
	}
	if (restoredGroup!.parentId !== undefined) {
		throw new Error("group round-trip parent changed");
	}
	if (restoredGroup!.blendMode !== "overlay") {
		throw new Error("group round-trip blend mode changed");
	}
	if (restoredGroup!.clipping !== true) {
		throw new Error("group round-trip clipping changed");
	}
	if (restoredInner!.parentId !== restoredGroup!.id) {
		throw new Error("group round-trip child parent changed");
	}
	if (restoredInner!.blendMode !== "multiply") {
		throw new Error("group round-trip child blend changed");
	}
	if (restoredInner!.cels[0]![0] !== packColor("#123456", 200)) {
		throw new Error("group round-trip child pixel changed");
	}
	if (restoredPlain!.cels[0]![1] !== packColor("#abcdef")) {
		throw new Error("group round-trip plain pixel changed");
	}
}

function assertLayerColors(): void {
	const seen = new Set<string>();
	for (const preset of LAYER_COLOR_PRESETS) {
		if (normalizeLayerColor(preset.value) !== preset.value) {
			throw new Error(`invalid layer color preset: ${preset.value}`);
		}
		if (seen.has(preset.value)) {
			throw new Error(`duplicate layer color preset: ${preset.value}`);
		}
		seen.add(preset.value);
	}
	if (normalizeLayerColor("not-a-color") !== undefined) {
		throw new Error("invalid layer color accepted");
	}
	if (normalizeLayerColor("#ABCDEF") !== "#abcdef") {
		throw new Error("layer color was not normalized");
	}
	const tint = layerTint("#ef4444", 50);
	if (!tint.startsWith("color-mix(")) {
		throw new Error("layer tint is not a color-mix value");
	}
	if (layerTint("#ef4444", 500).includes("500%")) {
		throw new Error("layer tint percentage was not clamped");
	}
}

function assertCanvasSizePresets(): void {
	const keys = new Set<string>();
	for (const preset of CANVAS_SIZE_PRESETS) {
		const key = `${preset.width}x${preset.height}`;
		if (keys.has(key)) throw new Error(`duplicate canvas size preset: ${key}`);
		keys.add(key);
		if (
			preset.width < 1 ||
			preset.height < 1 ||
			preset.width > MAX_CANVAS_SIZE ||
			preset.height > MAX_CANVAS_SIZE
		) {
			throw new Error(`canvas size preset out of range: ${key}`);
		}
	}
	for (let size = 8; size <= 1024; size *= 2) {
		if (!keys.has(`${size}x${size}`)) {
			throw new Error(`missing power-of-two canvas preset: ${size}x${size}`);
		}
	}
}

function assertPaletteSorting(): void {
	const colors = [
		"#ff0000",
		"#00ff00",
		"#0000ff",
		"#ffff00",
		"#ff00ff",
		"#00ffff",
		"#000000",
		"#ffffff",
	];
	const hue = sortPaletteColors(colors, "hue");
	const expected = [
		"#000000",
		"#ffffff",
		"#ff0000",
		"#ffff00",
		"#00ff00",
		"#00ffff",
		"#0000ff",
		"#ff00ff",
	];
	if (hue.join() !== expected.join()) {
		throw new Error("palette hue sort order changed");
	}
	const original = sortPaletteColors(colors, "original");
	if (original.join() !== colors.join()) {
		throw new Error("palette original order changed");
	}
	if (colors[0] !== "#ff0000") {
		throw new Error("palette sorting mutated the source");
	}
}

function assertPaletteReordering(): void {
	const colors = ["#111111", "#222222", "#333333", "#444444"];
	const down = reorderPaletteColor(colors, 0, 3);
	if (down.join() !== ["#222222", "#333333", "#111111", "#444444"].join()) {
		throw new Error("palette reorder into a later gap changed");
	}
	const up = reorderPaletteColor(colors, 3, 1);
	if (up.join() !== ["#111111", "#444444", "#222222", "#333333"].join()) {
		throw new Error("palette reorder into an earlier gap changed");
	}
	const end = reorderPaletteColor(colors, 1, colors.length);
	if (end.join() !== ["#111111", "#333333", "#444444", "#222222"].join()) {
		throw new Error("palette reorder to the end changed");
	}
	if (reorderPaletteColor(colors, 0, 0).join() !== colors.join()) {
		throw new Error("palette reorder into its own gap changed the order");
	}
	if (reorderPaletteColor(colors, 2, 3).join() !== colors.join()) {
		throw new Error("palette reorder into the next gap changed the order");
	}
	if (reorderPaletteColor(colors, 9, 0).join() !== colors.join()) {
		throw new Error("palette reorder accepted an invalid source index");
	}
	if (colors[0] !== "#111111") {
		throw new Error("palette reordering mutated the source");
	}
}

function assertPaletteRamps(): void {
	const endpoint = "#1d2b53";
	const endColor = "#ff77a8";
	for (const space of ["rgb", "hsv", "oklab"] as const) {
		const ramp = generatePaletteRamp(endpoint, endColor, 7, space);
		if (ramp.length !== 7) {
			throw new Error(`palette ramp ${space}: step count changed`);
		}
		if (ramp[0] !== endpoint || ramp[ramp.length - 1] !== endColor) {
			throw new Error(`palette ramp ${space}: endpoints changed`);
		}
		if (generatePaletteRamp(endpoint, endColor, 2, space).join() !== [endpoint, endColor].join()) {
			throw new Error(`palette ramp ${space}: two-step ramp changed`);
		}
	}
	const clamped = generatePaletteRamp("#000000", "#ffffff", 999, "rgb");
	if (clamped.length !== 16) {
		throw new Error("palette ramp step limit changed");
	}
	if (nearestPaletteColor(["#000000", "#ff0000", "#ffffff"], "#fe0102") !== "#ff0000") {
		throw new Error("palette nearest-color matching changed");
	}
}

function assertPaletteCycling(): void {
	const forward = [0, 1, 2, 3, 4].map((step) =>
		paletteShiftForStep(step, 4, "forward"),
	);
	if (forward.join() !== [0, 1, 2, 3, 0].join()) {
		throw new Error("palette forward cycling changed");
	}
	const reverse = [0, 1, 2, 3, 4].map((step) =>
		paletteShiftForStep(step, 4, "reverse"),
	);
	if (reverse.join() !== [0, 3, 2, 1, 0].join()) {
		throw new Error("palette reverse cycling changed");
	}
	const pingPong = [0, 1, 2, 3, 4, 5, 6].map((step) =>
		paletteShiftForStep(step, 4, "ping-pong"),
	);
	if (pingPong.join() !== [0, 1, 2, 3, 2, 1, 0].join()) {
		throw new Error("palette ping-pong cycling changed");
	}
	if (paletteCyclePeriod(4, "forward") !== 4) {
		throw new Error("palette cycle period changed");
	}
	if (paletteCyclePeriod(4, "ping-pong") !== 6) {
		throw new Error("palette ping-pong period changed");
	}
	if (paletteCyclePeriod(1, "forward") !== 0) {
		throw new Error("palette cycle period accepted a single color");
	}
	const rotated = paletteCycleColors(
		["#000000", "#ff0000", "#00ff00", "#0000ff"],
		{ start: 1, end: 3 },
		1,
	);
	if (rotated.join() !== ["#00ff00", "#0000ff", "#ff0000"].join()) {
		throw new Error("palette cycle display order changed");
	}

	const colors = ["#000000", "#ff0000", "#00ff00", "#0000ff"];
	const map = buildPaletteCycleMap(colors, { start: 0, end: 3 }, 1);
	if (!map || map.size !== 4) throw new Error("palette cycle map changed");
	if (map.get(packColor("#000000") & 0xffffff) !== (packColor("#ff0000") & 0xffffff)) {
		throw new Error("palette cycle map forward mapping changed");
	}
	if (map.get(packColor("#0000ff") & 0xffffff) !== (packColor("#000000") & 0xffffff)) {
		throw new Error("palette cycle map wrap changed");
	}

	const source = new Uint32Array([
		packColor("#ff0000", 128),
		packColor("#123456"),
		0,
	]);
	const remapped = remapPalettePixels(source, map);
	if (remapped[0] !== packColor("#00ff00", 128)) {
		throw new Error("palette cycle remap lost alpha");
	}
	if (remapped[1] !== packColor("#123456")) {
		throw new Error("palette cycle remap touched an unrelated color");
	}
	if (remapped[2] !== 0) {
		throw new Error("palette cycle remap touched transparency");
	}
	if (source[0] !== packColor("#ff0000", 128)) {
		throw new Error("palette cycle remap mutated the source");
	}
}

function assertPaletteAnalysis(): void {
	const doc = createDoc(4, 4);
	doc.frames = [{ id: "frame-0" }, { id: "frame-1" }];
	const layer = doc.layers[0]!;
	layer.cels = doc.frames.map(() => new Uint32Array(16));
	layer.cels[0]!.set([
		packColor("#ff0000"),
		packColor("#00ff00"),
		packColor("#123456"),
	]);
	layer.cels[1]!.set([packColor("#ff0000"), packColor("#ff0000", 64)]);

	// Reference layers are not part of the palette usage analysis.
	const reference = createLayer("Reference", 4, 4, 2, "reference");
	reference.cels[1]!.fill(packColor("#0000ff"));
	doc.layers.push(reference);

	const palette = ["#ff0000", "#00ff00", "#0000ff", "#ffffff"];
	const unused = unusedPaletteColors(doc, palette);
	if (unused.join() !== ["#0000ff", "#ffffff"].join()) {
		throw new Error("unused palette color detection changed");
	}
	if (unusedPaletteColors(doc, ["#ff0000"]).length !== 0) {
		throw new Error("used palette colors were reported unused");
	}

	const analysis = analyzePaletteCoverage(doc, palette);
	if (analysis.paintedPixels !== 5) {
		throw new Error("palette analysis pixel count changed");
	}
	if (analysis.matchedPixels !== 4 || Math.abs(analysis.coverage - 0.8) > 1e-9) {
		throw new Error("palette analysis coverage changed");
	}
	if (analysis.usedColors !== 2 || analysis.unusedColors !== 2) {
		throw new Error("palette analysis used/unused counts changed");
	}
	if (
		analysis.entries[0]?.count !== 3 ||
		analysis.entries[1]?.count !== 1 ||
		analysis.entries[2]?.count !== 0
	) {
		throw new Error("palette analysis per-color counts changed");
	}
	if (
		analysis.offPaletteCount !== 1 ||
		analysis.offPalettePixels !== 1 ||
		analysis.offPalette[0]?.color !== "#123456"
	) {
		throw new Error("palette analysis off-palette detection changed");
	}
	if (analysis.hueBins[0]?.count !== 1 || analysis.hueBins[4]?.count !== 1) {
		throw new Error("palette analysis hue bins changed");
	}
	if (analysis.neutralColors !== 1) {
		throw new Error("palette analysis neutral colors changed");
	}
	if (analysis.valueBins[analysis.valueBins.length - 1]?.count !== 4) {
		throw new Error("palette analysis brightness bins changed");
	}

	const empty = analyzePaletteCoverage(createDoc(2, 2), palette);
	if (empty.paintedPixels !== 0 || empty.coverage !== 0) {
		throw new Error("palette analysis empty document changed");
	}
}

function assertSheetMetadata(): void {
	const doc = createDoc(4, 4);
	doc.frames = [
		{ id: "frame-0" },
		{ id: "frame-1", tag: "walk" },
		{ id: "frame-2", tag: "walk" },
		{ id: "frame-3", tag: "run" },
	];
	const layer = doc.layers[0]!;
	layer.cels = doc.frames.map(() => new Uint32Array(16));
	layer.cels[1]!.set([
		0, 0, 0, 0,
		0, packColor("#ff0000"), packColor("#ff0000"), 0,
		0, packColor("#ff0000"), packColor("#ff0000"), 0,
		0, 0, 0, 0,
	]);
	// Reference layers must never affect trim bounds.
	const reference = createLayer("Reference", 4, 4, 4, "reference");
	reference.cels[1]!.fill(packColor("#0000ff"));
	doc.layers.push(reference);

	const sheet = {
		scale: 2,
		layout: "horizontal" as const,
		columns: 1,
		spacing: 1,
		format: "png" as const,
		background: "transparent" as const,
		quality: 90,
	};

	const infos = sheetFrameInfos(doc, sheet);
	if (infos.length !== 4) throw new Error("sheet metadata frame count changed");
	if (infos[1]!.rect.x !== 9 || infos[1]!.rect.y !== 0) {
		throw new Error("sheet metadata frame rect changed");
	}
	if (
		infos[1]!.rect.width !== 8 ||
		infos[1]!.rect.height !== 8 ||
		infos[1]!.sourceSize.width !== 8
	) {
		throw new Error("sheet metadata source size changed");
	}
	if (
		infos[1]!.trim.x !== 2 ||
		infos[1]!.trim.y !== 2 ||
		infos[1]!.trim.width !== 4 ||
		infos[1]!.trim.height !== 4
	) {
		throw new Error("sheet metadata trim changed");
	}
	if (infos[2]!.trim.width !== 8 || infos[2]!.trim.height !== 8) {
		throw new Error("sheet metadata transparent frame fallback changed");
	}

	const ranges = sheetTagRanges(doc);
	if (
		ranges.length !== 2 ||
		ranges[0]!.name !== "walk" ||
		ranges[0]!.from !== 1 ||
		ranges[0]!.to !== 2 ||
		ranges[1]!.name !== "run"
	) {
		throw new Error("sheet metadata tag ranges changed");
	}
	const animations = sheetAnimations(doc);
	if (animations.map((animation) => animation.name).join() !== "walk,run") {
		throw new Error("sheet metadata animations changed");
	}
	if (animations[0]!.frames.join() !== "1,2") {
		throw new Error("sheet metadata animation frames changed");
	}
	const untagged = sheetAnimations(createDoc(2, 2));
	if (
		untagged.length !== 1 ||
		untagged[0]!.name !== "default" ||
		untagged[0]!.frames.join() !== "0"
	) {
		throw new Error("sheet metadata default animation changed");
	}

	const aseprite = JSON.parse(
		sheetMetadata(doc, sheet, {
			format: "aseprite",
			image: "char.png",
			pivotX: 0.5,
			pivotY: 0.75,
		}),
	) as {
		frames: Record<
			string,
			{
				frame: { x: number; y: number; w: number; h: number };
				trim: { x: number; y: number; w: number; h: number };
				pivot: { x: number; y: number };
				duration: number;
			}
		>;
		meta: {
			size: { w: number; h: number };
			frameTags: { name: string; from: number; to: number }[];
			slices: { keys: { pivot: { x: number; y: number } }[] }[];
		};
	};
	const asepriteFrame = aseprite.frames["char 1.aseprite"];
	if (!asepriteFrame) throw new Error("aseprite metadata frame key changed");
	if (asepriteFrame.frame.x !== 9 || asepriteFrame.frame.w !== 8) {
		throw new Error("aseprite metadata frame rect changed");
	}
	if (asepriteFrame.trim.x !== 2 || asepriteFrame.trim.w !== 4) {
		throw new Error("aseprite metadata trim changed");
	}
	if (asepriteFrame.pivot.x !== 4 || asepriteFrame.pivot.y !== 6) {
		throw new Error("aseprite metadata pivot changed");
	}
	if (asepriteFrame.duration !== Math.round(1000 / doc.fps)) {
		throw new Error("aseprite metadata duration changed");
	}
	if (aseprite.meta.size.w !== 35 || aseprite.meta.size.h !== 8) {
		throw new Error("aseprite metadata sheet size changed");
	}
	if (aseprite.meta.frameTags[0]!.name !== "walk") {
		throw new Error("aseprite metadata tags changed");
	}
	if (aseprite.meta.slices[0]!.keys[1]!.pivot.x !== 4) {
		throw new Error("aseprite metadata slice pivot changed");
	}

	const texturePacker = JSON.parse(
		sheetMetadata(doc, sheet, {
			format: "texturepacker",
			image: "char.png",
			pivotX: 0.5,
			pivotY: 0.75,
		}),
	) as {
		frames: Record<string, { pivot: { x: number; y: number } }>;
		animations: Record<string, string[]>;
	};
	if (!texturePacker.frames["char_1.png"]) {
		throw new Error("texturepacker metadata frame key changed");
	}
	if (texturePacker.animations.walk!.join() !== "char_1.png,char_2.png") {
		throw new Error("texturepacker metadata animation changed");
	}
	if (texturePacker.animations.run!.join() !== "char_3.png") {
		throw new Error("texturepacker metadata run animation changed");
	}
	if (
		texturePacker.frames["char_1.png"]!.pivot.x !== 0.5 ||
		texturePacker.frames["char_1.png"]!.pivot.y !== 0.75
	) {
		throw new Error("texturepacker metadata pivot changed");
	}

	const godot = JSON.parse(
		sheetMetadata(doc, sheet, {
			format: "godot",
			image: "char.png",
			pivotX: 0.5,
			pivotY: 0.75,
		}),
	) as {
		frames: {
			region: { x: number };
			trim: { w: number };
			pivot: { x: number; y: number };
			duration: number;
		}[];
		animations: {
			name: string;
			frames: number[];
			speed: number;
			durations: number[];
		}[];
	};
	if (godot.frames[1]!.region.x !== 9 || godot.frames[1]!.trim.w !== 4) {
		throw new Error("godot metadata frame changed");
	}
	if (godot.frames[1]!.pivot.x !== 4 || godot.frames[1]!.pivot.y !== 6) {
		throw new Error("godot metadata pivot changed");
	}
	if (godot.animations[0]!.name !== "walk" || godot.animations[0]!.frames.join() !== "1,2") {
		throw new Error("godot metadata animation changed");
	}
	if (godot.animations[0]!.speed !== doc.fps) {
		throw new Error("godot metadata speed changed");
	}
	const expectedSeconds = Number((1000 / doc.fps / 1000).toFixed(4));
	if (godot.animations[0]!.durations[0] !== expectedSeconds) {
		throw new Error("godot metadata duration changed");
	}
}

function assertSelectionTransform(): void {
	const A = packColor("#ff0000");
	const B = packColor("#00ff00");
	const C = packColor("#0000ff");
	const D = packColor("#ffff00");
	const E = packColor("#ff00ff");
	const F = packColor("#00ffff");
	const pixels = new Uint32Array([A, B, C, D, E, F]);
	// Every pixel is selected except (1,1) = D.
	const mask = new Uint8Array([1, 1, 1, 0, 1, 1]);
	const source = { pixels, mask, width: 2, height: 3 };

	const identity = transformSelection(source, {
		scaleX: 1,
		scaleY: 1,
		skewX: 0,
		skewY: 0,
		angle: 0,
	});
	if (
		identity.width !== 2 ||
		identity.height !== 3 ||
		identity.pixels.join() !== pixels.join() ||
		identity.mask.join() !== mask.join()
	) {
		throw new Error("selection transform identity changed");
	}

	const flipped = warpScaleSkew(source, -1, 1, 0, 0);
	if (flipped.pixels.join() !== [B, A, D, C, F, E].join()) {
		throw new Error("selection transform horizontal flip changed");
	}
	if (flipped.mask.join() !== [1, 1, 0, 1, 1, 1].join()) {
		throw new Error("selection transform flip mask changed");
	}

	const doubled = warpScaleSkew(source, 2, 2, 0, 0);
	if (doubled.width !== 4 || doubled.height !== 6) {
		throw new Error("selection transform 2× dimensions changed");
	}
	if (doubled.pixels.slice(0, 4).join() !== [A, A, B, B].join()) {
		throw new Error("selection transform 2× scale changed");
	}

	const quarter = rotateRotsprite(source, Math.PI / 2);
	if (quarter.width !== 3 || quarter.height !== 2) {
		throw new Error("selection transform 90° dimensions changed");
	}
	if (quarter.pixels.join() !== [E, C, A, F, D, B].join()) {
		throw new Error("selection transform 90° rotation changed");
	}
	if (quarter.mask.join() !== [1, 1, 1, 1, 0, 1].join()) {
		throw new Error("selection transform 90° mask changed");
	}

	const rotated = rotateRotsprite(source, 0.7);
	if (rotated.width <= 0 || rotated.height <= 0 || rotated.pixels.length === 0) {
		throw new Error("selection transform arbitrary rotation empty");
	}
}

assertCanvasSizePresets();
assertLayerColors();
assertPaletteSorting();
assertPaletteReordering();
assertPaletteRamps();
assertPaletteCycling();
assertPaletteAnalysis();
assertSheetMetadata();
assertLayerGroups();
assertSelectionTransform();
assertProjectRoundtrip(makeDoc(64, 64, 2, 3, 41), "sparse");
const opaqueDoc = makeDoc(64, 64, 1, 1, 42);
for (const cel of opaqueDoc.layers[0]!.cels) cel.fill(0xff336699);
assertProjectRoundtrip(opaqueDoc, "flat");

const referenceDoc = makeDoc(64, 64, 2, 3, 43);
referenceDoc.layers[0]!.role = "reference";
referenceDoc.layers[0]!.locked = true;
referenceDoc.layers[0]!.color = "#14b8a6";
referenceDoc.layers[1]!.color = "#ef4444";
referenceDoc.references.push({
	id: "reference-1",
	name: "Mood board",
	bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5, 6, 7, 8]),
	mime: "image/png",
	imageWidth: 1024,
	imageHeight: 768,
	x: -80,
	y: 24,
	width: 128,
	height: 96,
	rotation: 0,
	opacity: 0.75,
	visible: true,
	locked: false,
});
assertProjectRoundtrip(referenceDoc, "reference board");

const timingDoc = makeDoc(32, 32, 2, 4, 44);
timingDoc.frames[0]!.duration = 250;
timingDoc.frames[1]!.tag = "walk";
timingDoc.frames[2]!.tag = "walk";
timingDoc.frames[3]!.duration = 40;
timingDoc.frames[3]!.tag = "run";
timingDoc.animationMode = "ping-pong";
timingDoc.animationLoop = false;
assertProjectRoundtrip(timingDoc, "frame metadata");

// Cel links, per-cel opacity, and continuous layers.
{
	const celDoc = createDoc(2, 2);
	celDoc.frames = [{ id: "frame-a" }, { id: "frame-b" }];
	const celLayer = celDoc.layers[0]!;
	celLayer.cels = [new Uint32Array(4), new Uint32Array(4)];
	celLayer.continuous = true;
	celLayer.cels[0]![0] = packColor("#ff0000");
	celLayer.cels[1]![1] = packColor("#00ff00");
	// Link frame 0 to frame 1 (frame 1's pixels take priority).
	celLayer.cels[0] = celLayer.cels[1]!;
	celDoc.celProps = {
		[`${celLayer.id}:frame-a`]: { opacity: 0.5 },
		[`${celLayer.id}:frame-b`]: { zIndex: 2 },
	};

	const celBytes = serializeProject(
		celDoc,
		palette,
		"cel features",
		0,
		celLayer.id,
	);
	const celParsed = parseProject(celBytes);
	if (!celParsed) throw new Error("cel features round-trip parse failed");
	const restoredCelLayer = celParsed.doc.layers[0]!;
	if (restoredCelLayer.continuous !== true) {
		throw new Error("cel features round-trip lost continuous");
	}
	if (restoredCelLayer.cels[0] !== restoredCelLayer.cels[1]) {
		throw new Error("cel features round-trip lost shared buffer");
	}
	const restoredCelProps = celParsed.doc.celProps;
	if (!restoredCelProps) throw new Error("cel features round-trip lost celProps");
	const restoredOpacity =
		restoredCelProps[`${restoredCelLayer.id}:${celParsed.doc.frames[0]!.id}`]
			?.opacity;
	const restoredZIndex =
		restoredCelProps[`${restoredCelLayer.id}:${celParsed.doc.frames[1]!.id}`]
			?.zIndex;
	if (restoredOpacity !== 0.5) {
		throw new Error("cel features round-trip lost opacity");
	}
	if (restoredZIndex !== 2) {
		throw new Error("cel features round-trip lost z-index");
	}
}

// --- Palette ramps and cycling -------------------------------------------
measure("generatePaletteRamp oklab 16 steps", 2000, 100, () => {
	generatePaletteRamp("#1d2b53", "#ff77a8", 16, "oklab");
});

const cyclePalette = [
	"#000000",
	"#1d2b53",
	"#7e2553",
	"#008751",
	"#ab5236",
	"#ff004d",
	"#29adff",
	"#ffec27",
];
const cycleMap = buildPaletteCycleMap(cyclePalette, { start: 0, end: 7 }, 3);
if (!cycleMap) throw new Error("palette cycle benchmark map missing");
const cycleSource = new Uint32Array(512 * 512);
for (let index = 0; index < cycleSource.length; index++) {
	cycleSource[index] =
		index % 3 === 0
			? packColor(cyclePalette[index % cyclePalette.length]!, 255)
			: packColor("#123456", 255);
}
const cycleTarget = new Uint32Array(cycleSource.length);
measure("palette cycle remap 512x512", 40, 5, () => {
	remapPalettePixels(cycleSource, cycleMap, cycleTarget);
});

// --- GIF export -----------------------------------------------------------
const gifDoc = makeDoc(128, 128, 3, 12, 31);
measure("exportGif 128x128x12", 4, 1, () => {
	const blob = exportGif(gifDoc, {
		scale: 1,
		fps: 12,
		loop: true,
		background: "transparent",
	});
	results["exportGif bytes"] = {
		median: blob.size,
		mean: blob.size,
		min: blob.size,
		max: blob.size,
	};
});

// --- Animation sequencing ------------------------------------------------
function assertAnimationSequence(): void {
	const expected: [readonly number[], "forward" | "backward" | "ping-pong", boolean, number[]][] = [
		[[0, 1, 2], "forward", true, [0, 1, 2]],
		[[0, 1, 2], "forward", false, [0, 1, 2]],
		[[0, 1, 2], "backward", true, [2, 1, 0]],
		[[0, 1, 2], "ping-pong", true, [0, 1, 2, 1]],
		[[0, 1, 2], "ping-pong", false, [0, 1, 2, 1, 0]],
		[[4, 5], "ping-pong", true, [4, 5]],
		[[4, 5], "ping-pong", false, [4, 5, 4]],
		[[7], "ping-pong", true, [7]],
		[[7], "backward", false, [7]],
		[[], "forward", true, []],
	];
	for (const [indices, mode, loop, sequence] of expected) {
		const actual = animationSequence(indices, mode, loop);
		if (actual.join(",") !== sequence.join(",")) {
			throw new Error(
				`animationSequence(${indices.join(",")}, ${mode}, ${loop}) = ${actual.join(",")}`,
			);
		}
	}
	if (normalizeAnimationMode("nope") !== "forward") {
		throw new Error("normalizeAnimationMode fallback changed");
	}
	if (normalizeAnimationMode("backward") !== "backward") {
		throw new Error("normalizeAnimationMode rejected backward");
	}
}
assertAnimationSequence();

// --- Report ---------------------------------------------------------------
const report = {
	generatedAt: new Date().toISOString(),
	node: process.version,
	results: Object.fromEntries(
		Object.entries(results).map(([label, value]) => [
			label,
			{
				medianMs: Number(value.median.toFixed(3)),
				meanMs: Number(value.mean.toFixed(3)),
				minMs: Number(value.min.toFixed(3)),
				maxMs: Number(value.max.toFixed(3)),
			},
		]),
	),
};

console.log(JSON.stringify(report, null, 2));
