/** Shared IPC types for the Electron main process and preload bridge. */

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

export interface DesktopRecentFile {
	path: string;
	name: string;
	openedAt: number;
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

export const DEFAULT_MENU_STATE: DesktopMenuState = {
	canUndo: false,
	canRedo: false,
	hasSelection: false,
	hasClipboard: false,
	colorMode: "rgba",
	showGrid: false,
	showPixelGrid: false,
	showPreview: false,
	showBrushPreview: true,
	showReferenceBoard: false,
	doubleTool: false,
	playing: false,
	desktopAutosave: false,
	hasFile: false,
};
