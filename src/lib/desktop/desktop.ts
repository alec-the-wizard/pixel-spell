/** Renderer-side bridge to the optional Electron desktop shell. */

export interface DesktopMenuState {
	canUndo: boolean;
	canRedo: boolean;
	hasSelection: boolean;
	hasClipboard: boolean;
	colorMode: "rgba" | "indexed";
	showGrid: boolean;
	showPixelGrid: boolean;
	showPreview: boolean;
	showBrushPreview: boolean;
	showReferenceBoard: boolean;
	doubleTool: boolean;
	playing: boolean;
	desktopAutosave: boolean;
	hasFile: boolean;
}

export interface DesktopProjectBytes {
	canceled: boolean;
	path?: string;
	name?: string;
	data?: Uint8Array;
	error?: string;
}

export interface DesktopReadResult {
	ok: boolean;
	path?: string;
	name?: string;
	data?: Uint8Array;
	error?: string;
}

export interface DesktopSaveResult {
	canceled?: boolean;
	ok: boolean;
	path?: string;
	name?: string;
	error?: string;
}

export interface DesktopWriteResult {
	ok: boolean;
	path?: string;
	error?: string;
}

export interface PixelSpellDesktopApi {
	isDesktop: true;
	platform: string;
	ready(): Promise<{ version: string; platform: string; dev: boolean }>;
	openProjectDialog(): Promise<DesktopProjectBytes>;
	readProjectFile(filePath: string): Promise<DesktopReadResult>;
	saveProjectDialog(
		data: Uint8Array,
		suggestedName: string,
		currentPath?: string | null,
	): Promise<DesktopSaveResult>;
	writeProjectFile(
		filePath: string,
		data: Uint8Array,
		name: string,
		remember?: boolean,
	): Promise<DesktopWriteResult>;
	showItemInFolder(filePath: string): Promise<boolean>;
	getPathForFile(file: File): string;
	setMenuState(state: DesktopMenuState): void;
	onMenuCommand(callback: (commandId: string) => void): () => void;
	onOpenPath(callback: (filePath: string) => void): () => void;
	onBeforeClose(callback: () => void): () => void;
	confirmClose(projectNames: string[]): Promise<boolean>;
	closeWindow(allow: boolean): void;
}

declare global {
	interface Window {
		pixelSpellDesktop?: PixelSpellDesktopApi;
	}
}

/** The desktop bridge, or null when the app runs in a normal browser tab. */
export function desktopApi(): PixelSpellDesktopApi | null {
	return typeof window === "undefined" ? null : (window.pixelSpellDesktop ?? null);
}

export function isDesktop(): boolean {
	return desktopApi() !== null;
}

/** Friendly desktop platform name for the About dialog. */
export function desktopPlatformName(platform: string | undefined): string {
	switch (platform) {
		case "win32":
			return "Windows";
		case "darwin":
			return "macOS";
		case "linux":
			return "Linux";
		default:
			return platform ?? "desktop";
	}
}

/** Lowercase stem without directories or the `.pixelspell` extension. */
export function pathStem(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");
	const base = normalized.slice(normalized.lastIndexOf("/") + 1);
	const withoutExtension = base.toLowerCase().endsWith(".pixelspell")
		? base.slice(0, -".pixelspell".length)
		: base.replace(/\.[^.]+$/, "");
	return withoutExtension || "pixel-spell";
}

export function isProjectFilePath(file: File): boolean {
	return file.name.toLowerCase().endsWith(".pixelspell");
}
