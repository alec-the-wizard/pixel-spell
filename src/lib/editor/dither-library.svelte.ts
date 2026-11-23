import {
	BUILTIN_DITHER_PATTERNS,
	DEFAULT_DITHER_PATTERN_ID,
	type DitherPattern,
} from "./dither.js";
import {
	MAX_DITHER_PATTERN_SIZE,
	decodeMask,
	encodeMask,
} from "./mask.js";

const STORAGE_KEY = "pixel-spell-dither-patterns";
const MAX_CUSTOM_PATTERNS = 64;
let idCounter = 0;

interface StoredPattern {
	id: string;
	name: string;
	width: number;
	height: number;
	data: string;
}

interface DitherStorage {
	version: 1;
	activeId: string;
	patterns: StoredPattern[];
}

export const ditherLibrary = $state<{
	custom: DitherPattern[];
	activeId: string;
	revision: number;
}>({
	custom: [],
	activeId: DEFAULT_DITHER_PATTERN_ID,
	revision: 0,
});

function newPatternId(): string {
	idCounter++;
	return `dither-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function normalizeName(value: string, fallback: string): string {
	const name = value.trim().replace(/\s+/g, " ");
	return name || fallback;
}

function save(): void {
	if (typeof localStorage === "undefined") return;
	const payload: DitherStorage = {
		version: 1,
		activeId: ditherLibrary.activeId,
		patterns: ditherLibrary.custom.map((pattern) => ({
			id: pattern.id,
			name: pattern.name,
			width: pattern.mask.width,
			height: pattern.mask.height,
			data: encodeMask(pattern.mask),
		})),
	};
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// Keep the in-memory library when storage is unavailable.
	}
}

export function loadDitherLibrary(): void {
	if (typeof localStorage === "undefined") return;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Partial<DitherStorage>;
		if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.patterns)) {
			return;
		}

		const custom: DitherPattern[] = [];
		const seen = new Set<string>();
		const names = new Set<string>();
		for (const stored of parsed.patterns.slice(0, MAX_CUSTOM_PATTERNS)) {
			if (!stored || typeof stored.id !== "string") continue;
			const mask = decodeMask(
				Number(stored.width) || 1,
				Number(stored.height) || 1,
				String(stored.data ?? ""),
				MAX_DITHER_PATTERN_SIZE,
			);
			if (!mask) continue;
			let id = stored.id;
			let suffix = 2;
			while (seen.has(id)) id = `${stored.id}-${suffix++}`;
			seen.add(id);
			let name = normalizeName(String(stored.name ?? ""), "Custom pattern");
			let unique = 2;
			const baseName = name;
			while (names.has(name.toLowerCase())) name = `${baseName} ${unique++}`;
			names.add(name.toLowerCase());
			custom.push({ id, name, builtin: false, mask });
		}

		ditherLibrary.custom = custom;
		const active = String(parsed.activeId ?? DEFAULT_DITHER_PATTERN_ID);
		ditherLibrary.activeId = findDitherPattern(active)
			? active
			: DEFAULT_DITHER_PATTERN_ID;
		ditherLibrary.revision++;
	} catch {
		// Ignore corrupt preferences.
	}
}

export function allDitherPatterns(): readonly DitherPattern[] {
	return [...BUILTIN_DITHER_PATTERNS, ...ditherLibrary.custom];
}

export function findDitherPattern(id: string): DitherPattern | undefined {
	return allDitherPatterns().find((pattern) => pattern.id === id);
}

export function activeDitherPatternPreset(): DitherPattern {
	return (
		findDitherPattern(ditherLibrary.activeId) ??
		BUILTIN_DITHER_PATTERNS[0]!
	);
}

export function setActiveDitherPattern(id: string): boolean {
	if (!findDitherPattern(id)) return false;
	ditherLibrary.activeId = id;
	save();
	return true;
}

export function addCustomDitherPattern(
	pattern: DitherPattern,
): DitherPattern | null {
	if (ditherLibrary.custom.length >= MAX_CUSTOM_PATTERNS) return null;
	let id = pattern.id;
	const existing = new Set(allDitherPatterns().map((item) => item.id));
	let suffix = 2;
	while (existing.has(id)) id = `${pattern.id}-${suffix++}`;
	const next: DitherPattern = {
		...pattern,
		id,
		builtin: false,
		name: normalizeName(pattern.name, "Custom pattern"),
		mask: {
			width: pattern.mask.width,
			height: pattern.mask.height,
			data: new Uint8Array(pattern.mask.data),
		},
	};
	ditherLibrary.custom = [...ditherLibrary.custom, next];
	ditherLibrary.revision++;
	save();
	return next;
}

export function updateCustomDitherPattern(
	id: string,
	changes: Partial<Pick<DitherPattern, "name" | "mask">>,
): DitherPattern | null {
	const index = ditherLibrary.custom.findIndex((pattern) => pattern.id === id);
	if (index < 0) return null;
	const current = ditherLibrary.custom[index]!;
	const next: DitherPattern = {
		...current,
		...changes,
		id: current.id,
		builtin: false,
		name: normalizeName(changes.name ?? current.name, current.name),
		mask: changes.mask
			? {
					width: changes.mask.width,
					height: changes.mask.height,
					data: new Uint8Array(changes.mask.data),
				}
			: current.mask,
	};
	const custom = [...ditherLibrary.custom];
	custom[index] = next;
	ditherLibrary.custom = custom;
	ditherLibrary.revision++;
	save();
	return next;
}

export function deleteCustomDitherPattern(id: string): boolean {
	const index = ditherLibrary.custom.findIndex((pattern) => pattern.id === id);
	if (index < 0) return false;
	ditherLibrary.custom = ditherLibrary.custom.filter(
		(pattern) => pattern.id !== id,
	);
	if (ditherLibrary.activeId === id) {
		ditherLibrary.activeId = DEFAULT_DITHER_PATTERN_ID;
	}
	ditherLibrary.revision++;
	save();
	return true;
}

export function duplicateDitherPattern(id: string): DitherPattern | null {
	const source = findDitherPattern(id);
	if (!source) return null;
	return addCustomDitherPattern({
		id: newPatternId(),
		name: `${source.name} copy`,
		builtin: false,
		mask: {
			width: source.mask.width,
			height: source.mask.height,
			data: new Uint8Array(source.mask.data),
		},
	});
}

export function createDitherPatternDraft(
	mask: DitherPattern["mask"],
	name = "Custom pattern",
): DitherPattern {
	return {
		id: newPatternId(),
		name,
		builtin: false,
		mask,
	};
}

loadDitherLibrary();
