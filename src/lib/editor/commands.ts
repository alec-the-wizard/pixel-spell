import { editor } from "./editor.svelte.js";
import { TOOLS } from "./tools.js";

export type CommandGroup =
	| "File"
	| "Edit"
	| "View"
	| "Project"
	| "Effects"
	| "Animation"
	| "Layers"
	| "Palette"
	| "Tools"
	| "Help";

/** Dialog and file-picker callbacks owned by the app shell. */
export interface CommandHost {
	openNewProject: () => void;
	openProject: () => void;
	openImport: () => void;
	openImportUrl: () => void;
	openExport: () => void;
	openScaleCanvas: () => void;
	openResizeCanvas: () => void;
	openOutline: () => void;
	openDropShadow: () => void;
	openColorReplace: () => void;
	openShortcuts: () => void;
	openAbout: () => void;
	openCommandPalette: () => void;
}

const NOOP_HOST: CommandHost = {
	openNewProject: () => {},
	openProject: () => {},
	openImport: () => {},
	openImportUrl: () => {},
	openExport: () => {},
	openScaleCanvas: () => {},
	openResizeCanvas: () => {},
	openOutline: () => {},
	openDropShadow: () => {},
	openColorReplace: () => {},
	openShortcuts: () => {},
	openAbout: () => {},
	openCommandPalette: () => {},
};

let host: CommandHost = NOOP_HOST;

/** App.svelte registers the live dialog callbacks during setup. */
export function setCommandHost(next: CommandHost): void {
	host = { ...next };
}

export interface CommandDef {
	id: string;
	label: string;
	group: CommandGroup;
	description?: string;
	/** Extra search terms for the command palette. */
	keywords?: string;
	defaultKeys?: string[];
	/** Keep the shortcut from firing repeatedly while the key is held. */
	ignoreRepeat?: boolean;
	/**
	 * Leave the key to the browser's native paste event. The window paste
	 * handler then chooses between an image file and the in-app clipboard.
	 */
	deferToPasteEvent?: boolean;
	enabled?: () => boolean;
	run: () => void;
}

/** Converts a tool's display shortcut ("H", "⇧ G") into a combo token. */
function toolCombo(shortcut: string): string {
	const trimmed = shortcut.trim();
	if (trimmed.startsWith("⇧")) {
		return `shift+${trimmed.slice(1).trim().toLowerCase()}`;
	}
	return trimmed.toLowerCase();
}

const ACTION_COMMANDS: CommandDef[] = [
	{
		id: "file.new",
		label: "New project…",
		group: "File",
		defaultKeys: ["mod+n"],
		run: () => host.openNewProject(),
	},
	{
		id: "file.open",
		label: "Open project…",
		group: "File",
		defaultKeys: [],
		run: () => host.openProject(),
	},
	{
		id: "file.import",
		label: "Import…",
		group: "File",
		keywords: "image palette reference",
		defaultKeys: [],
		run: () => host.openImport(),
	},
	{
		id: "file.import-url",
		label: "Import from URL…",
		group: "File",
		keywords: "image web link clipboard paste",
		defaultKeys: [],
		run: () => host.openImportUrl(),
	},
	{
		id: "file.save",
		label: "Save project",
		group: "File",
		defaultKeys: ["mod+s"],
		run: () => editor.saveToFile(),
	},
	{
		id: "file.export",
		label: "Export…",
		group: "File",
		keywords: "png gif sprite sheet",
		defaultKeys: [],
		run: () => host.openExport(),
	},
	{
		id: "edit.undo",
		label: "Undo",
		group: "Edit",
		defaultKeys: ["mod+z"],
		enabled: () => editor.canUndo,
		run: () => editor.undo(),
	},
	{
		id: "edit.redo",
		label: "Redo",
		group: "Edit",
		defaultKeys: ["mod+shift+z", "mod+y"],
		enabled: () => editor.canRedo,
		run: () => editor.redo(),
	},
	{
		id: "edit.history",
		label: "History…",
		group: "Edit",
		keywords: "undo redo steps states timeline past",
		run: () => (editor.historyOpen = true),
	},
	{
		id: "edit.copy-selection",
		label: "Copy selection",
		group: "Edit",
		defaultKeys: ["mod+c"],
		enabled: () => editor.hasSelection,
		run: () => editor.copySelection(),
	},
	{
		id: "edit.paste-selection",
		label: "Paste selection",
		group: "Edit",
		defaultKeys: ["mod+v"],
		enabled: () => editor.hasClipboard,
		deferToPasteEvent: true,
		run: () => editor.pasteSelection(),
	},
	{
		id: "edit.select-all",
		label: "Select all",
		group: "Edit",
		defaultKeys: ["mod+a"],
		run: () => editor.selectAll(),
	},
	{
		id: "edit.delete-selection",
		label: "Delete selection",
		group: "Edit",
		defaultKeys: ["delete"],
		enabled: () => editor.hasSelection,
		run: () => editor.deleteSelection(),
	},
	{
		id: "edit.deselect",
		label: "Deselect",
		group: "Edit",
		defaultKeys: ["escape"],
		run: () => {
			editor.playing = false;
			editor.clearSelection();
			editor.clearReferenceSelection();
		},
	},
	{
		id: "edit.clear-layer",
		label: "Clear layer",
		group: "Edit",
		run: () => editor.clearLayer(),
	},
	{
		id: "edit.clear-frame",
		label: "Clear frame",
		group: "Edit",
		run: () => editor.clearFrame(),
	},
	{
		id: "view.zoom-in",
		label: "Zoom in",
		group: "View",
		run: () => editor.zoomIn(),
	},
	{
		id: "view.zoom-out",
		label: "Zoom out",
		group: "View",
		run: () => editor.zoomOut(),
	},
	{
		id: "view.fit-window",
		label: "Fit to window",
		group: "View",
		run: () => editor.fitToWindow(),
	},
	{
		id: "view.rotate-left",
		label: "Rotate canvas left 15°",
		group: "View",
		run: () => editor.rotateBy(-15),
	},
	{
		id: "view.rotate-right",
		label: "Rotate canvas right 15°",
		group: "View",
		run: () => editor.rotateBy(15),
	},
	{
		id: "view.toggle-grid",
		label: "Toggle pixel grid",
		group: "View",
		defaultKeys: ["shift+g"],
		run: () => (editor.showGrid = !editor.showGrid),
	},
	{
		id: "view.toggle-preview",
		label: "Toggle preview",
		group: "View",
		run: () => (editor.showPreview = !editor.showPreview),
	},
	{
		id: "view.toggle-reference-board",
		label: "Toggle reference board",
		group: "View",
		run: () => (editor.showReferenceBoard = !editor.showReferenceBoard),
	},
	{
		id: "view.toggle-theme",
		label: "Toggle light / dark theme",
		group: "View",
		run: () => editor.toggleTheme(),
	},
	{
		id: "view.toggle-double-tool",
		label: "Double tool mode",
		group: "View",
		keywords: "left right mouse button tool mapping paint erase",
		run: () => editor.toggleDoubleToolMode(),
	},
	{
		id: "view.mirror-x",
		label: "Toggle X axis mirror",
		group: "View",
		keywords: "symmetry horizontal",
		run: () => editor.toggleMirror("x"),
	},
	{
		id: "view.mirror-y",
		label: "Toggle Y axis mirror",
		group: "View",
		keywords: "symmetry vertical",
		run: () => editor.toggleMirror("y"),
	},
	{
		id: "view.mirror-diagonal-down",
		label: "Toggle diagonal \\ mirror",
		group: "View",
		keywords: "symmetry",
		run: () => editor.toggleMirror("diagonal-down"),
	},
	{
		id: "view.mirror-diagonal-up",
		label: "Toggle diagonal / mirror",
		group: "View",
		keywords: "symmetry",
		run: () => editor.toggleMirror("diagonal-up"),
	},
	{
		id: "view.toggle-radial",
		label: "Toggle radial symmetry",
		group: "View",
		keywords: "rotational",
		run: () => editor.toggleRadial(),
	},
	{
		id: "project.scale-canvas",
		label: "Scale Canvas…",
		group: "Project",
		defaultKeys: [],
		run: () => host.openScaleCanvas(),
	},
	{
		id: "project.resize-canvas",
		label: "Resize Canvas…",
		group: "Project",
		defaultKeys: [],
		run: () => host.openResizeCanvas(),
	},
	{
		id: "project.crop-content",
		label: "Crop to Content",
		group: "Project",
		run: () => editor.cropToContent(),
	},
	{
		id: "project.crop-selection",
		label: "Crop to Selection",
		group: "Project",
		run: () => editor.cropToSelection(),
	},
	{
		id: "effects.outline",
		label: "Outline…",
		group: "Effects",
		keywords: "border stroke silhouette edge",
		run: () => host.openOutline(),
	},
	{
		id: "effects.drop-shadow",
		label: "Drop shadow…",
		group: "Effects",
		keywords: "shadow offset spread silhouette",
		run: () => host.openDropShadow(),
	},
	{
		id: "effects.color-replace",
		label: "Color replace…",
		group: "Effects",
		keywords: "recolor swap palette tolerance",
		run: () => host.openColorReplace(),
	},
	{
		id: "animation.play-pause",
		label: "Play / pause",
		group: "Animation",
		defaultKeys: ["space"],
		ignoreRepeat: true,
		run: () => editor.togglePlayback(),
	},
	{
		id: "animation.previous-frame",
		label: "Previous frame",
		group: "Animation",
		defaultKeys: ["[", ","],
		run: () => editor.previousFrame(),
	},
	{
		id: "animation.next-frame",
		label: "Next frame",
		group: "Animation",
		defaultKeys: ["]", "."],
		run: () => editor.nextFrame(),
	},
	{
		id: "animation.toggle-onion",
		label: "Toggle onion skin",
		group: "Animation",
		defaultKeys: ["o"],
		run: () => editor.toggleOnion(),
	},
	{
		id: "animation.move-frame-left",
		label: "Move selected frames left",
		group: "Animation",
		defaultKeys: ["alt+left"],
		run: () => editor.moveSelectedFrames(-1),
	},
	{
		id: "animation.move-frame-right",
		label: "Move selected frames right",
		group: "Animation",
		defaultKeys: ["alt+right"],
		run: () => editor.moveSelectedFrames(1),
	},
	{
		id: "animation.add-frame",
		label: "Add frame",
		group: "Animation",
		run: () => editor.addFrame(),
	},
	{
		id: "animation.duplicate-frame",
		label: "Duplicate selected frames",
		group: "Animation",
		run: () => editor.duplicateFrames(),
	},
	{
		id: "animation.delete-frame",
		label: "Delete selected frames",
		group: "Animation",
		enabled: () => editor.frameCount > 1,
		run: () => editor.deleteSelectedFrames(),
	},
	{
		id: "animation.copy-frames",
		label: "Copy selected frames",
		group: "Animation",
		run: () => editor.copyFrames(),
	},
	{
		id: "animation.paste-frames",
		label: "Paste frames",
		group: "Animation",
		enabled: () => editor.hasFrameClipboard,
		run: () => editor.pasteFrames(),
	},
	{
		id: "layer.add",
		label: "Add layer",
		group: "Layers",
		run: () => editor.addLayer(),
	},
	{
		id: "layer.add-group",
		label: "New group",
		group: "Layers",
		keywords: "folder container nest",
		run: () => editor.addGroup(),
	},
	{
		id: "layer.group",
		label: "Group selected layers",
		group: "Layers",
		keywords: "folder container nest wrap",
		run: () => editor.groupSelectedLayers(),
	},
	{
		id: "layer.ungroup",
		label: "Ungroup selected layers",
		group: "Layers",
		keywords: "folder flatten container outdent",
		enabled: () => editor.canOutdentSelectedLayers,
		run: () => editor.outdentSelectedLayers(),
	},
	{
		id: "layer.indent",
		label: "Move into group above",
		group: "Layers",
		keywords: "folder nest indent parent",
		run: () => editor.indentActiveLayer(),
	},
	{
		id: "layer.outdent",
		label: "Move out of group",
		group: "Layers",
		keywords: "folder unnest outdent parent",
		enabled: () => !!editor.activeLayer.parentId,
		run: () => editor.outdentActiveLayer(),
	},
	{
		id: "layer.duplicate",
		label: "Duplicate layer",
		group: "Layers",
		run: () => editor.duplicateLayer(),
	},
	{
		id: "layer.delete",
		label: "Delete selected layers",
		group: "Layers",
		enabled: () => editor.canDeleteSelectedLayers,
		run: () => editor.deleteSelectedLayers(),
	},
	{
		id: "layer.move-up",
		label: "Move layer up",
		group: "Layers",
		run: () => editor.moveLayerUp(),
	},
	{
		id: "layer.move-down",
		label: "Move layer down",
		group: "Layers",
		run: () => editor.moveLayerDown(),
	},
	{
		id: "layer.clear-color",
		label: "Clear layer color",
		group: "Layers",
		keywords: "tint track row identity",
		enabled: () => !!editor.activeLayer.color,
		run: () => editor.setLayerColor(editor.activeLayerId, null),
	},
	{
		id: "palette.generate-ramp",
		label: "Generate palette ramp…",
		group: "Palette",
		keywords: "gradient colors interpolate ramp",
		enabled: () => editor.paletteEditable,
		run: () => (editor.paletteRampOpen = true),
	},
	{
		id: "palette.toggle-lock",
		label: "Toggle palette lock",
		group: "Palette",
		keywords: "indexed restrict snap",
		run: () => editor.togglePaletteLock(),
	},
	{
		id: "palette.color-cycles",
		label: "Color cycles…",
		group: "Palette",
		keywords: "animate rotate palette range bake frames gif",
		run: () => (editor.paletteCyclesOpen = true),
	},
	{
		id: "palette.remove-unused",
		label: "Remove unused palette colors",
		group: "Palette",
		keywords: "prune clean unused coverage palette analysis",
		enabled: () => editor.paletteEditable,
		run: () => editor.removeUnusedPaletteColors(),
	},
	{
		id: "palette.coverage",
		label: "Palette coverage analysis…",
		group: "Palette",
		keywords: "used unused colors report stats palette analysis",
		run: () => (editor.paletteCoverageOpen = true),
	},
	{
		id: "app.command-palette",
		label: "Command palette…",
		group: "Help",
		keywords: "search actions commands",
		defaultKeys: ["mod+k"],
		run: () => host.openCommandPalette(),
	},
	{
		id: "help.shortcuts",
		label: "Keyboard shortcuts…",
		group: "Help",
		keywords: "keybindings editor",
		run: () => host.openShortcuts(),
	},
	{
		id: "help.about",
		label: "About Pixel Spell",
		group: "Help",
		run: () => host.openAbout(),
	},
];

const TOOL_COMMANDS: CommandDef[] = TOOLS.map((tool) => ({
	id: `tool.${tool.id}`,
	label: tool.label,
	description: tool.description,
	group: "Tools",
	defaultKeys: [toolCombo(tool.shortcut)],
	run: () => editor.setTool(tool.id),
}));

export const COMMANDS: CommandDef[] = [
	...ACTION_COMMANDS.filter((command) => command.group !== "Help"),
	...TOOL_COMMANDS,
	...ACTION_COMMANDS.filter((command) => command.group === "Help"),
];

export const COMMAND_BY_ID: Record<string, CommandDef> = Object.fromEntries(
	COMMANDS.map((command) => [command.id, command]),
);

export function runCommand(commandId: string): void {
	COMMAND_BY_ID[commandId]?.run();
}
