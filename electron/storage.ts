import { app } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DesktopRecentFile } from "./desktop-types.js";

const MAX_RECENT_FILES = 12;

export interface WindowState {
	width: number;
	height: number;
	x?: number;
	y?: number;
	maximized?: boolean;
}

function userDataFile(name: string): string {
	return path.join(app.getPath("userData"), name);
}

function readJson<T>(file: string, fallback: T): T {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as T;
	} catch {
		return fallback;
	}
}

function writeJson(file: string, value: unknown): void {
	try {
		mkdirSync(path.dirname(file), { recursive: true });
		const temporary = `${file}.${process.pid}.tmp`;
		writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
		renameSync(temporary, file);
	} catch {
		// Preferences are best-effort; a read-only profile should not crash the app.
	}
}

export function loadRecentFiles(): DesktopRecentFile[] {
	const stored = readJson<unknown>(userDataFile("recent-projects.json"), []);
	if (!Array.isArray(stored)) return [];
	const seen = new Set<string>();
	const recent: DesktopRecentFile[] = [];
	for (const entry of stored) {
		if (!entry || typeof entry !== "object") continue;
		const value = entry as Partial<DesktopRecentFile>;
		if (typeof value.path !== "string" || !path.isAbsolute(value.path)) continue;
		const key = process.platform === "win32" ? value.path.toLowerCase() : value.path;
		if (seen.has(key)) continue;
		seen.add(key);
		recent.push({
			path: value.path,
			name:
				typeof value.name === "string" && value.name.trim()
					? value.name
					: projectStem(value.path),
			openedAt:
				typeof value.openedAt === "number" && Number.isFinite(value.openedAt)
					? value.openedAt
					: 0,
		});
		if (recent.length >= MAX_RECENT_FILES) break;
	}
	return recent;
}

export function addRecentFile(filePath: string, name?: string): DesktopRecentFile[] {
	const recent = loadRecentFiles().filter(
		(entry) =>
			(process.platform === "win32"
				? entry.path.toLowerCase()
				: entry.path) !==
			(process.platform === "win32" ? filePath.toLowerCase() : filePath),
	);
	recent.unshift({
		path: filePath,
		name: name?.trim() || projectStem(filePath),
		openedAt: Date.now(),
	});
	const trimmed = recent.slice(0, MAX_RECENT_FILES);
	writeJson(userDataFile("recent-projects.json"), trimmed);
	return trimmed;
}

export function clearRecentFiles(): DesktopRecentFile[] {
	writeJson(userDataFile("recent-projects.json"), []);
	return [];
}

export function loadWindowState(): WindowState {
	const stored = readJson<Partial<WindowState>>(
		userDataFile("window-state.json"),
		{},
	);
	const width =
		typeof stored.width === "number" && Number.isFinite(stored.width)
			? Math.max(960, Math.round(stored.width))
			: 1440;
	const height =
		typeof stored.height === "number" && Number.isFinite(stored.height)
			? Math.max(640, Math.round(stored.height))
			: 900;
	return {
		width,
		height,
		...(typeof stored.x === "number" && Number.isFinite(stored.x)
			? { x: Math.round(stored.x) }
			: {}),
		...(typeof stored.y === "number" && Number.isFinite(stored.y)
			? { y: Math.round(stored.y) }
			: {}),
		maximized: stored.maximized === true,
	};
}

export function saveWindowState(state: WindowState): void {
	writeJson(userDataFile("window-state.json"), state);
}

export function projectStem(filePath: string): string {
	const base = path.basename(filePath);
	return base.toLowerCase().endsWith(".pixelspell")
		? base.slice(0, -".pixelspell".length)
		: path.basename(base, path.extname(base));
}
