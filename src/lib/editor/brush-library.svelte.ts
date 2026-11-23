import {
	DEFAULT_BRUSH_ID,
	BUILTIN_BRUSHES,
	brushFromImage,
	brushFromSelection,
	brushMaskFor,
	type BrushPreset,
} from "./brush.js";
import { decodeMask, encodeMask, MAX_BRUSH_MASK_SIZE } from "./mask.js";

const STORAGE_KEY = "pixel-spell-brushes";
const MAX_CUSTOM_BRUSHES = 64;
let idCounter = 0;

interface StoredBrush {
	id: string;
	name: string;
	width: number;
	height: number;
	data: string;
	defaultSize: number;
	defaultOpacity: number;
}

interface BrushStorage {
	version: 1;
	activeId: string;
	brushes: StoredBrush[];
}

export const brushLibrary = $state<{
	custom: BrushPreset[];
	activeId: string;
	revision: number;
}>({
	custom: [],
	activeId: DEFAULT_BRUSH_ID,
	revision: 0,
});

function newBrushId(): string {
	idCounter++;
	return `brush-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function clampSize(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.max(1, Math.min(MAX_BRUSH_MASK_SIZE, Math.round(value)));
}

function clampOpacity(value: number): number {
	if (!Number.isFinite(value)) return 100;
	return Math.max(1, Math.min(100, Math.round(value)));
}

function normalizeName(value: string, fallback: string): string {
	const name = value.trim().replace(/\s+/g, " ");
	return name || fallback;
}

function save(): void {
	if (typeof localStorage === "undefined") return;
	const payload: BrushStorage = {
		version: 1,
		activeId: brushLibrary.activeId,
		brushes: brushLibrary.custom.map((brush) => ({
			id: brush.id,
			name: brush.name,
			width: brush.mask?.width ?? 1,
			height: brush.mask?.height ?? 1,
			data: brush.mask ? encodeMask(brush.mask) : "",
			defaultSize: brush.defaultSize,
			defaultOpacity: brush.defaultOpacity,
		})),
	};
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// Private browsing or quota exhaustion: keep the in-memory library.
	}
}

export function loadBrushLibrary(): void {
	if (typeof localStorage === "undefined") return;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Partial<BrushStorage>;
		if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.brushes)) {
			return;
		}

		const custom: BrushPreset[] = [];
		const seen = new Set<string>();
		const names = new Set<string>();
		for (const stored of parsed.brushes.slice(0, MAX_CUSTOM_BRUSHES)) {
			if (!stored || typeof stored.id !== "string") continue;
			const mask = decodeMask(
				Number(stored.width) || 1,
				Number(stored.height) || 1,
				String(stored.data ?? ""),
			);
			if (!mask) continue;
			let id = stored.id;
			let suffix = 2;
			while (seen.has(id)) id = `${stored.id}-${suffix++}`;
			seen.add(id);
			let name = normalizeName(String(stored.name ?? ""), "Custom brush");
			let unique = 2;
			const baseName = name;
			while (names.has(name.toLowerCase())) name = `${baseName} ${unique++}`;
			names.add(name.toLowerCase());
			custom.push({
				id,
				name,
				builtin: false,
				mask,
				defaultSize: clampSize(Number(stored.defaultSize) || mask.width),
				defaultOpacity: clampOpacity(Number(stored.defaultOpacity) || 100),
			});
		}

		brushLibrary.custom = custom;
		const active = String(parsed.activeId ?? DEFAULT_BRUSH_ID);
		brushLibrary.activeId = findBrush(active) ? active : DEFAULT_BRUSH_ID;
		brushLibrary.revision++;
	} catch {
		// A damaged preference should never prevent the editor from starting.
	}
}

export function allBrushes(): readonly BrushPreset[] {
	return [...BUILTIN_BRUSHES, ...brushLibrary.custom];
}

export function findBrush(id: string): BrushPreset | undefined {
	return allBrushes().find((brush) => brush.id === id);
}

export function activeBrushPreset(): BrushPreset {
	return findBrush(brushLibrary.activeId) ?? BUILTIN_BRUSHES[0]!;
}

export function setActiveBrush(id: string): boolean {
	if (!findBrush(id)) return false;
	brushLibrary.activeId = id;
	save();
	return true;
}

export function addCustomBrush(preset: BrushPreset): BrushPreset | null {
	if (brushLibrary.custom.length >= MAX_CUSTOM_BRUSHES) return null;
	let id = preset.id;
	const existing = new Set(allBrushes().map((brush) => brush.id));
	let suffix = 2;
	while (existing.has(id)) id = `${preset.id}-${suffix++}`;
	const brush: BrushPreset = {
		...preset,
		id,
		builtin: false,
		name: normalizeName(preset.name, "Custom brush"),
		defaultSize: clampSize(preset.defaultSize),
		defaultOpacity: clampOpacity(preset.defaultOpacity),
		mask: preset.mask
			? {
					width: preset.mask.width,
					height: preset.mask.height,
					data: new Uint8Array(preset.mask.data),
				}
			: undefined,
	};
	brushLibrary.custom = [...brushLibrary.custom, brush];
	brushLibrary.revision++;
	save();
	return brush;
}

export function updateCustomBrush(
	id: string,
	changes: Partial<Pick<BrushPreset, "name" | "mask" | "defaultSize" | "defaultOpacity">>,
): BrushPreset | null {
	const index = brushLibrary.custom.findIndex((brush) => brush.id === id);
	if (index < 0) return null;
	const current = brushLibrary.custom[index]!;
	const next: BrushPreset = {
		...current,
		...changes,
		id: current.id,
		builtin: false,
		name: normalizeName(changes.name ?? current.name, current.name),
		defaultSize: clampSize(changes.defaultSize ?? current.defaultSize),
		defaultOpacity: clampOpacity(
			changes.defaultOpacity ?? current.defaultOpacity,
		),
		mask: changes.mask
			? {
					width: changes.mask.width,
					height: changes.mask.height,
					data: new Uint8Array(changes.mask.data),
				}
			: current.mask,
	};
	const custom = [...brushLibrary.custom];
	custom[index] = next;
	brushLibrary.custom = custom;
	brushLibrary.revision++;
	if (brushLibrary.activeId === id) {
		// Keep the active label in sync without changing the user's current size.
	}
	save();
	return next;
}

export function deleteCustomBrush(id: string): boolean {
	const index = brushLibrary.custom.findIndex((brush) => brush.id === id);
	if (index < 0) return false;
	brushLibrary.custom = brushLibrary.custom.filter((brush) => brush.id !== id);
	if (brushLibrary.activeId === id) brushLibrary.activeId = DEFAULT_BRUSH_ID;
	brushLibrary.revision++;
	save();
	return true;
}

export function duplicateCustomBrush(id: string): BrushPreset | null {
	const source = findBrush(id);
	if (!source) return null;
	const mask = source.mask
		? {
				width: source.mask.width,
				height: source.mask.height,
				data: new Uint8Array(source.mask.data),
			}
		: source.shape
			? undefined
			: undefined;
	if (source.builtin && source.shape) {
		// Built-ins are procedural; turn the duplicate into an editable mask at a
		// useful editing size instead of a one-pixel square.
		const bakedSize = Math.max(8, source.defaultSize);
		const baked = brushMaskFor(source, bakedSize);
		return addCustomBrush({
			...source,
			id: newBrushId(),
			name: `${source.name} copy`,
			builtin: false,
			shape: undefined,
			mask: baked,
			defaultSize: bakedSize,
		});
	}
	if (!mask) return null;
	return addCustomBrush({
		...source,
		id: newBrushId(),
		name: `${source.name} copy`,
		builtin: false,
		mask,
	});
}

export function createBrushFromSelection(
	selection: Uint8Array,
	docWidth: number,
	docHeight: number,
	name = "Selection brush",
): BrushPreset | null {
	const preset = brushFromSelection(
		selection,
		docWidth,
		docHeight,
		newBrushId(),
		name,
	);
	if (!preset) return null;
	const added = addCustomBrush(preset);
	if (added) setActiveBrush(added.id);
	return added;
}

export function createBrushFromImportedPixels(
	pixels: Uint32Array,
	width: number,
	height: number,
	name = "Imported brush",
): BrushPreset | null {
	const preset = brushFromImage(
		pixels,
		width,
		height,
		newBrushId(),
		name,
	);
	const added = addCustomBrush(preset);
	if (added) setActiveBrush(added.id);
	return added;
}

export function isBuiltinBrush(id: string): boolean {
	return BUILTIN_BRUSHES.some((brush) => brush.id === id);
}

loadBrushLibrary();
