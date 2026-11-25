import {
	app,
	Menu,
	type BrowserWindow,
	type MenuItemConstructorOptions,
} from "electron";
import {
	DEFAULT_MENU_STATE,
	type DesktopMenuState,
	type DesktopRecentFile,
} from "./desktop-types.js";

interface MenuOptions {
	window: BrowserWindow;
	isDev: boolean;
	recent: DesktopRecentFile[];
	onClearRecent: () => void;
}

let targetWindow: BrowserWindow | null = null;
let isDevelopment = false;
let menuState: DesktopMenuState = { ...DEFAULT_MENU_STATE };
let recentFiles: DesktopRecentFile[] = [];
let clearRecentHandler: () => void = () => {};

function sendCommand(commandId: string): void {
	if (!targetWindow || targetWindow.isDestroyed()) return;
	targetWindow.webContents.send("desktop:menu-command", commandId);
}

function openRecent(filePath: string): void {
	if (!targetWindow || targetWindow.isDestroyed()) return;
	targetWindow.webContents.send("desktop:open-path", filePath);
}

function command(
	id: string,
	label: string,
	accelerator?: string,
	options: Omit<MenuItemConstructorOptions, "id" | "label" | "click"> = {},
): MenuItemConstructorOptions {
	return {
		id,
		label,
		...(accelerator
			? { accelerator, registerAccelerator: false }
			: {}),
		click: () => sendCommand(id),
		...options,
	};
}

function menuLabel(value: string): string {
	// Windows and Linux treat & as a mnemonic marker; double it for filenames.
	return process.platform === "darwin" ? value : value.replace(/&/g, "&&");
}

function recentSubmenu(): MenuItemConstructorOptions[] {
	if (recentFiles.length === 0) {
		return [{ label: "No Recent Projects", enabled: false }];
	}
	return [
		...recentFiles.map(
			(entry): MenuItemConstructorOptions => ({
				label: menuLabel(entry.name || entry.path),
				toolTip: entry.path,
				click: () => openRecent(entry.path),
			}),
		),
		{ type: "separator" },
		{
			label: "Clear Recently Opened",
			click: () => clearRecentHandler(),
		},
	];
}

function template(): MenuItemConstructorOptions[] {
	const isMac = process.platform === "darwin";
	const items: MenuItemConstructorOptions[] = [
		...(isMac
			? [
					{
						label: app.name,
						submenu: [
							{
								label: "About Pixel Spell",
								click: () => sendCommand("help.about"),
							},
							{ type: "separator" as const },
							{ role: "hide" as const },
							{ role: "hideOthers" as const },
							{ role: "unhide" as const },
							{ type: "separator" as const },
							{ role: "quit" as const },
						],
					},
				]
			: []),
		{
			label: "File",
			submenu: [
				command("file.new", "New Project…", "CmdOrCtrl+N"),
				command("file.open", "Open Project…", "CmdOrCtrl+O"),
				{ label: "Open Recent", submenu: recentSubmenu() },
				{ type: "separator" },
				command("file.save", "Save Project", "CmdOrCtrl+S"),
				command("file.save-as", "Save Project As…", "CmdOrCtrl+Shift+S"),
				command("file.show-in-folder", "Show Project in Folder"),
				{ type: "separator" },
				{
					id: "file.toggle-autosave",
					label: "Autosave to Project File",
					type: "checkbox",
					checked: menuState.desktopAutosave,
					click: () => sendCommand("file.toggle-autosave"),
				},
				{ type: "separator" },
				command("file.import", "Import…"),
				command("file.import-url", "Import from URL…"),
				command("file.export", "Export…"),
				command("file.export-timelapse", "Export Timelapse…"),
				...(isMac
					? []
					: [
							{ type: "separator" as const },
							{ role: "quit" as const, label: "Exit" },
						]),
			],
		},
		{
			label: "Edit",
			submenu: [
				command("edit.undo", "Undo", "CmdOrCtrl+Z", {
					enabled: menuState.canUndo,
				}),
				command("edit.redo", "Redo", "CmdOrCtrl+Shift+Z", {
					enabled: menuState.canRedo,
				}),
				{ type: "separator" },
				command("edit.history", "History…"),
				{ type: "separator" },
				command("edit.copy-selection", "Copy Selection", "CmdOrCtrl+C", {
					enabled: menuState.hasSelection,
				}),
				command("edit.paste-selection", "Paste Selection", "CmdOrCtrl+V", {
					enabled: menuState.hasClipboard,
				}),
				command("edit.select-all", "Select All", "CmdOrCtrl+A"),
				command("edit.delete-selection", "Delete Selection", "Delete"),
				command("edit.deselect", "Deselect", "Escape"),
				{ type: "separator" },
				command("edit.clear-layer", "Clear Layer"),
				command("edit.clear-frame", "Clear Frame"),
			],
		},
		{
			label: "Project",
			submenu: [
				command("project.scale-canvas", "Scale Canvas…"),
				command("project.resize-canvas", "Resize Canvas…"),
				{ type: "separator" },
				command("project.crop-content", "Crop to Content"),
				command("project.crop-selection", "Crop to Selection", undefined, {
					enabled: menuState.hasSelection,
				}),
				{ type: "separator" },
				{
					label: "Color Mode",
					submenu: [
						{
							id: "project.color-mode-rgba",
							label: "RGBA",
							type: "radio",
							checked: menuState.colorMode === "rgba",
							click: () => sendCommand("project.color-mode-rgba"),
						},
						{
							id: "project.color-mode-indexed",
							label: "Indexed",
							type: "radio",
							checked: menuState.colorMode === "indexed",
							click: () => sendCommand("project.color-mode-indexed"),
						},
					],
				},
			],
		},
		{
			label: "Animation",
			submenu: [
				command(
					"animation.play-pause",
					menuState.playing ? "Pause" : "Play",
					"Space",
				),
				command("animation.previous-frame", "Previous Frame"),
				command("animation.next-frame", "Next Frame"),
				{ type: "separator" },
				command("animation.toggle-onion", "Toggle Onion Skin"),
				command("animation.add-frame", "Add Frame"),
				command("animation.duplicate-frame", "Duplicate Selected Frames"),
				command("animation.delete-frame", "Delete Selected Frames"),
			],
		},
		{
			label: "Effects",
			submenu: [
				command("effects.outline", "Outline…"),
				command("effects.drop-shadow", "Drop Shadow…"),
				{ type: "separator" },
				command("effects.color-replace", "Color Replace…"),
				command("effects.dither", "Dither…"),
				command("effects.gradient-map", "Gradient Map…"),
				command("effects.grayscale", "Grayscale…"),
			],
		},
		{
			label: "View",
			submenu: [
				command("view.zoom-in", "Zoom In"),
				command("view.zoom-out", "Zoom Out"),
				command("view.fit-window", "Fit to Window"),
				{ type: "separator" },
				{
					id: "view.toggle-grid",
					label: "Show Grid",
					type: "checkbox",
					checked: menuState.showGrid,
					click: () => sendCommand("view.toggle-grid"),
				},
				{
					id: "view.toggle-pixel-grid",
					label: "Show Pixel Grid",
					type: "checkbox",
					accelerator: "Shift+G",
					registerAccelerator: false,
					checked: menuState.showPixelGrid,
					click: () => sendCommand("view.toggle-pixel-grid"),
				},
				command("view.grid-settings", "Grid Settings…"),
				{ type: "separator" },
				{
					id: "view.toggle-preview",
					label: "Show Preview",
					type: "checkbox",
					checked: menuState.showPreview,
					click: () => sendCommand("view.toggle-preview"),
				},
				{
					id: "view.toggle-brush-preview",
					label: "Show Brush Preview",
					type: "checkbox",
					checked: menuState.showBrushPreview,
					click: () => sendCommand("view.toggle-brush-preview"),
				},
				{
					id: "view.toggle-reference-board",
					label: "Show Reference Board",
					type: "checkbox",
					checked: menuState.showReferenceBoard,
					click: () => sendCommand("view.toggle-reference-board"),
				},
				{ type: "separator" },
				{
					id: "view.toggle-double-tool",
					label: "Double Tool Mode",
					type: "checkbox",
					checked: menuState.doubleTool,
					click: () => sendCommand("view.toggle-double-tool"),
				},
				command("view.toggle-theme", "Toggle Light / Dark Theme"),
				...(isDevelopment
					? [
							{ type: "separator" as const },
							{
								label: "Toggle Developer Tools",
								accelerator: "CmdOrCtrl+Shift+I",
								registerAccelerator: false,
								click: () => targetWindow?.webContents.toggleDevTools(),
							},
							{
								label: "Reload Window",
								accelerator: "CmdOrCtrl+R",
								registerAccelerator: false,
								click: () => targetWindow?.webContents.reload(),
							},
						]
					: []),
			],
		},
		{
			label: "Help",
			submenu: [
				command("app.command-palette", "Command Palette…", "CmdOrCtrl+K"),
				command("help.shortcuts", "Keyboard Shortcuts…"),
				{ type: "separator" },
				command("help.about", "About Pixel Spell"),
			],
		},
	];
	return items;
}

function rebuild(): void {
	Menu.setApplicationMenu(Menu.buildFromTemplate(template()));
}

export function buildApplicationMenu(options: MenuOptions): void {
	targetWindow = options.window;
	isDevelopment = options.isDev;
	recentFiles = options.recent;
	clearRecentHandler = options.onClearRecent;
	rebuild();
}

export function setRecentFiles(files: DesktopRecentFile[]): void {
	recentFiles = files;
	rebuild();
}

export function updateMenuState(next: Partial<DesktopMenuState>): void {
	menuState = { ...menuState, ...next };
	const menu = Menu.getApplicationMenu();
	if (!menu) return;

	const setChecked = (id: string, value: boolean): void => {
		const item = menu.getMenuItemById(id);
		if (item) item.checked = value;
	};
	const setEnabled = (id: string, value: boolean): void => {
		const item = menu.getMenuItemById(id);
		if (item) item.enabled = value;
	};

	setEnabled("edit.undo", menuState.canUndo);
	setEnabled("edit.redo", menuState.canRedo);
	setEnabled("edit.copy-selection", menuState.hasSelection);
	setEnabled("edit.paste-selection", menuState.hasClipboard);
	setEnabled("edit.delete-selection", menuState.hasSelection);
	setEnabled("project.crop-selection", menuState.hasSelection);
	setEnabled("file.show-in-folder", menuState.hasFile);
	setChecked("file.toggle-autosave", menuState.desktopAutosave);
	setChecked("view.toggle-grid", menuState.showGrid);
	setChecked("view.toggle-pixel-grid", menuState.showPixelGrid);
	setChecked("view.toggle-preview", menuState.showPreview);
	setChecked("view.toggle-brush-preview", menuState.showBrushPreview);
	setChecked("view.toggle-reference-board", menuState.showReferenceBoard);
	setChecked("view.toggle-double-tool", menuState.doubleTool);
	setChecked("project.color-mode-rgba", menuState.colorMode === "rgba");
	setChecked("project.color-mode-indexed", menuState.colorMode === "indexed");

	const playPause = menu.getMenuItemById("animation.play-pause");
	if (playPause) playPause.label = menuState.playing ? "Pause" : "Play";
}
