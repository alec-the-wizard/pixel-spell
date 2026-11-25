import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	nativeTheme,
	screen,
	session,
	shell,
} from "electron";
import { existsSync } from "node:fs";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type DesktopMenuState,
	type DesktopProjectBytes,
	type DesktopReadResult,
	type DesktopSaveResult,
	type DesktopWriteResult,
} from "./desktop-types.js";
import {
	buildApplicationMenu,
	setRecentFiles,
	updateMenuState,
} from "./menu.js";
import {
	addRecentFile,
	clearRecentFiles,
	loadRecentFiles,
	loadWindowState,
	projectStem,
	saveWindowState,
} from "./storage.js";

const MAX_PROJECT_BYTES = 512 * 1024 * 1024;
const PROJECT_EXTENSION = ".pixelspell";
const DEV_SERVER_URL = process.env.PIXEL_SPELL_DEV_SERVER_URL;

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(currentDirectory, "preload.cjs");

let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
let allowWindowClose = false;
let closeRequestPending = false;
let quitAfterClose = false;
let saveBoundsTimer: NodeJS.Timeout | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
const pendingOpenPaths: string[] = [];

app.setName("Pixel Spell");
if (process.platform === "win32") {
	app.setAppUserModelId("com.pixelspell.app");
}

function isProjectPath(filePath: unknown): filePath is string {
	return (
		typeof filePath === "string" &&
		filePath.length > 0 &&
		path.isAbsolute(filePath) &&
		filePath.toLowerCase().endsWith(PROJECT_EXTENSION)
	);
}

function validateProjectPath(filePath: unknown): string | null {
	if (typeof filePath !== "string" || !filePath) return "No project path was provided.";
	if (!path.isAbsolute(filePath)) return "Project paths must be absolute.";
	if (!isProjectPath(filePath)) {
		return "Pixel Spell projects use the .pixelspell extension.";
	}
	return null;
}

function ensureProjectExtension(filePath: string): string {
	return filePath.toLowerCase().endsWith(PROJECT_EXTENSION)
		? filePath
		: `${filePath}${PROJECT_EXTENSION}`;
}

function safeFileName(value: string): string {
	const cleaned = value
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
	return cleaned || "pixel-spell";
}

function asBuffer(data: unknown): Buffer | null {
	if (data instanceof Uint8Array) {
		return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	}
	if (data instanceof ArrayBuffer) return Buffer.from(data);
	return null;
}

async function atomicWrite(filePath: string, bytes: Buffer): Promise<void> {
	const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, bytes);
	try {
		await rename(temporary, filePath);
	} catch {
		// Windows can reject a rename over a locked file. Fall back to a direct
		// write so a temporarily open folder indexer cannot lose the save.
		await writeFile(filePath, bytes);
		await unlink(temporary).catch(() => {});
	}
}

/** Serialize project writes so a slow autosave cannot overwrite a newer save. */
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
	const next = writeQueue.then(task, task);
	writeQueue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

function looksLikeProject(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 8 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x58 &&
		bytes[2] === 0x53 &&
		bytes[3] === 0x50
	);
}

async function readProjectBytes(filePath: string): Promise<DesktopReadResult> {
	const problem = validateProjectPath(filePath);
	if (problem) return { ok: false, error: problem };
	try {
		const info = await stat(filePath);
		if (!info.isFile()) return { ok: false, error: "That path is not a file." };
		if (info.size > MAX_PROJECT_BYTES) {
			return {
				ok: false,
				error: `That project is too large to open (${Math.round(
					MAX_PROJECT_BYTES / (1024 * 1024),
				)} MB limit).`,
			};
		}
		const data = await readFile(filePath);
		const bytes = new Uint8Array(data);
		if (!looksLikeProject(bytes)) {
			return {
				ok: false,
				error: "That file is not a Pixel Spell project.",
			};
		}
		return {
			ok: true,
			path: filePath,
			name: projectStem(filePath),
			data: bytes,
		};
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "The file could not be read.";
		return { ok: false, error: message };
	}
}

function rememberRecent(filePath: string, name?: string): void {
	setRecentFiles(addRecentFile(filePath, name));
}

async function writeProjectBytes(
	filePath: string,
	data: unknown,
	options: { recent?: boolean; name?: string } = {},
): Promise<DesktopWriteResult> {
	const problem = validateProjectPath(filePath);
	if (problem) return { ok: false, error: problem };
	const bytes = asBuffer(data);
	if (!bytes) return { ok: false, error: "The project data was not a byte array." };
	if (bytes.byteLength > MAX_PROJECT_BYTES) {
		return { ok: false, error: "The project is too large to save." };
	}
	try {
		await enqueueWrite(() => atomicWrite(filePath, bytes));
		if (options.recent !== false) rememberRecent(filePath, options.name);
		return { ok: true, path: filePath };
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "The project could not be written.";
		return { ok: false, error: message };
	}
}

async function showOpenProjectDialog(): Promise<DesktopProjectBytes> {
	const window = mainWindow;
	const options: Electron.OpenDialogOptions = {
		title: "Open Pixel Spell Project",
		properties: ["openFile"],
		filters: [
			{ name: "Pixel Spell Project", extensions: ["pixelspell"] },
			{ name: "All Files", extensions: ["*"] },
		],
	};
	const result = window
		? await dialog.showOpenDialog(window, options)
		: await dialog.showOpenDialog(options);
	if (result.canceled || result.filePaths.length === 0) {
		return { canceled: true };
	}
	const filePath = result.filePaths[0]!;
	const read = await readProjectBytes(filePath);
	if (!read.ok) return { canceled: false, error: read.error };
	rememberRecent(filePath, read.name);
	return {
		canceled: false,
		path: filePath,
		name: read.name,
		data: read.data,
	};
}

async function showSaveProjectDialog(
	data: unknown,
	suggestedName: string,
	currentPath?: string | null,
): Promise<DesktopSaveResult> {
	const bytes = asBuffer(data);
	if (!bytes) return { ok: false, error: "The project data was not a byte array." };
	if (bytes.byteLength > MAX_PROJECT_BYTES) {
		return { ok: false, error: "The project is too large to save." };
	}

	const fallback = path.join(
		app.getPath("documents"),
		ensureProjectExtension(safeFileName(suggestedName)),
	);
	const defaultPath =
		typeof currentPath === "string" && isProjectPath(currentPath)
			? currentPath
			: fallback;

	const options: Electron.SaveDialogOptions = {
		title: "Save Pixel Spell Project",
		defaultPath,
		filters: [{ name: "Pixel Spell Project", extensions: ["pixelspell"] }],
	};
	const window = mainWindow;
	const result = window
		? await dialog.showSaveDialog(window, options)
		: await dialog.showSaveDialog(options);
	if (result.canceled || !result.filePath) return { ok: false, canceled: true };

	const filePath = ensureProjectExtension(result.filePath);
	const written = await writeProjectBytes(filePath, bytes);
	if (!written.ok) return written;
	return {
		ok: true,
		path: filePath,
		name: projectStem(filePath),
	};
}

function currentWindowState(): { width: number; height: number; x: number; y: number; maximized: boolean } | null {
	const window = mainWindow;
	if (!window || window.isDestroyed()) return null;
	const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
	return { ...bounds, maximized: window.isMaximized() };
}

function scheduleSaveWindowState(): void {
	if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
	saveBoundsTimer = setTimeout(() => {
		saveBoundsTimer = null;
		const state = currentWindowState();
		if (state) saveWindowState(state);
	}, 400);
}

function visibleWindowState(): {
	width: number;
	height: number;
	x?: number;
	y?: number;
	maximized: boolean;
} {
	const state = loadWindowState();
	const displays = screen.getAllDisplays();
	const fits = displays.some((display) => {
		const area = display.workArea;
		return (
			state.x !== undefined &&
			state.y !== undefined &&
			state.x < area.x + area.width &&
			state.x + state.width > area.x &&
			state.y < area.y + area.height &&
			state.y + state.height > area.y
		);
	});
	const largest = displays.reduce(
		(best, display) =>
			display.workArea.width * display.workArea.height >
			best.width * best.height
				? { width: display.workArea.width, height: display.workArea.height }
				: best,
		{ width: 1920, height: 1080 },
	);
	const width = Math.min(state.width, largest.width);
	const height = Math.min(state.height, largest.height);
	return {
		width,
		height,
		...(fits && state.x !== undefined && state.y !== undefined
			? { x: state.x, y: state.y }
			: {}),
		maximized: state.maximized === true,
	};
}

function flushOpenPaths(): void {
	if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
	while (pendingOpenPaths.length > 0) {
		mainWindow.webContents.send("desktop:open-path", pendingOpenPaths.shift());
	}
}

function requestOpenPath(filePath: string): void {
	if (!isProjectPath(filePath)) return;
	if (!existsSync(filePath)) return;
	if (!pendingOpenPaths.includes(filePath)) pendingOpenPaths.push(filePath);
	flushOpenPaths();
}

function projectPathsFromArguments(argv: readonly string[]): string[] {
	return argv
		.filter((argument): argument is string => typeof argument === "string")
		.filter((argument) => argument.toLowerCase().endsWith(PROJECT_EXTENSION))
		.map((argument) => path.resolve(argument))
		.filter((argument) => existsSync(argument));
}

function createWindow(): void {
	allowWindowClose = false;
	quitAfterClose = false;
	closeRequestPending = false;
	const state = visibleWindowState();
	const windowIcon = path.join(app.getAppPath(), "build", "icon.png");
	const window = new BrowserWindow({
		width: state.width,
		height: state.height,
		...(existsSync(windowIcon) ? { icon: windowIcon } : {}),
		...(state.x !== undefined && state.y !== undefined
			? { x: state.x, y: state.y }
			: {}),
		minWidth: 960,
		minHeight: 600,
		show: false,
		// Keep the in-app menu bar as the single visible menu on Windows/Linux;
		// the native menu remains available with Alt. macOS uses its system menu.
		autoHideMenuBar: process.platform !== "darwin",
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0f14" : "#ffffff",
		title: "Pixel Spell",
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webviewTag: false,
			spellcheck: false,
		},
	});
	mainWindow = window;

	window.once("ready-to-show", () => {
		if (state.maximized) window.maximize();
		window.show();
	});
	window.on("resize", scheduleSaveWindowState);
	window.on("move", scheduleSaveWindowState);
	window.on("maximize", scheduleSaveWindowState);
	window.on("unmaximize", scheduleSaveWindowState);

	window.on("close", (event) => {
		const bounds = currentWindowState();
		if (bounds) saveWindowState(bounds);
		if (allowWindowClose) return;
		if (!rendererReady || window.webContents.isDestroyed()) {
			allowWindowClose = true;
			return;
		}
		event.preventDefault();
		if (closeRequestPending) return;
		closeRequestPending = true;
		window.webContents.send("desktop:before-close");
	});

	window.on("closed", () => {
		mainWindow = null;
		rendererReady = false;
		closeRequestPending = false;
		if (quitAfterClose) {
			quitAfterClose = false;
			app.quit();
		}
	});

	window.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (url !== window.webContents.getURL()) event.preventDefault();
	});
	window.webContents.on("render-process-gone", () => {
		allowWindowClose = true;
		window.close();
	});

	if (DEV_SERVER_URL) {
		void window.loadURL(DEV_SERVER_URL);
	} else {
		void window.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
	}

	buildApplicationMenu({
		window,
		isDev: Boolean(DEV_SERVER_URL),
		recent: loadRecentFiles(),
		onClearRecent: () => setRecentFiles(clearRecentFiles()),
	});
	flushOpenPaths();
}

function registerIpc(): void {
	ipcMain.handle("desktop:ready", () => {
		rendererReady = true;
		flushOpenPaths();
		return {
			version: app.getVersion(),
			platform: process.platform,
			dev: Boolean(DEV_SERVER_URL),
		};
	});

	ipcMain.handle("desktop:open-project-dialog", () => showOpenProjectDialog());

	ipcMain.handle("desktop:read-project", async (_event, filePath: unknown) => {
		const read = await readProjectBytes(String(filePath ?? ""));
		if (read.ok && read.path) rememberRecent(read.path, read.name);
		return read;
	});

	ipcMain.handle(
		"desktop:save-project-dialog",
		(_event, data: unknown, suggestedName: unknown, currentPath: unknown) =>
			showSaveProjectDialog(
				data,
				safeFileName(String(suggestedName ?? "pixel-spell")),
				typeof currentPath === "string" ? currentPath : null,
			),
	);

	ipcMain.handle(
		"desktop:write-project",
		(_event, filePath: unknown, data: unknown, name: unknown, remember: unknown) =>
			writeProjectBytes(String(filePath ?? ""), data, {
				name: typeof name === "string" ? name : undefined,
				recent: remember !== false,
			}),
	);

	ipcMain.handle("desktop:show-item", (_event, filePath: unknown) => {
		if (!isProjectPath(filePath) || !existsSync(filePath)) return false;
		shell.showItemInFolder(filePath);
		return true;
	});

	ipcMain.handle("desktop:confirm-close", async (_event, names: unknown) => {
		const projects = Array.isArray(names)
			? names.filter((name): name is string => typeof name === "string")
			: [];
		const listed = projects.slice(0, 8).map((name) => `• ${name}`).join("\n");
		const extra =
			projects.length > 8 ? `\n…and ${projects.length - 8} more` : "";
		const options: Electron.MessageBoxOptions = {
			type: "warning",
			title: "Unsaved Changes",
			message:
				projects.length === 1
					? "Close Pixel Spell with unsaved changes?"
					: `Close Pixel Spell with ${projects.length} projects that have unsaved changes?`,
			detail: `${listed}${extra}\n\nRecovery snapshots are kept, but the project files were not saved.`,
			buttons: ["Cancel", "Close Without Saving"],
			defaultId: 0,
			cancelId: 0,
			noLink: true,
		};
		const window = mainWindow;
		const result = window
			? await dialog.showMessageBox(window, options)
			: await dialog.showMessageBox(options);
		return result.response === 1;
	});

	ipcMain.on("desktop:close-response", (_event, allow: unknown) => {
		closeRequestPending = false;
		const window = mainWindow;
		if (allow !== true || !window || window.isDestroyed()) {
			quitAfterClose = false;
			return;
		}
		allowWindowClose = true;
		window.close();
	});

	ipcMain.on("desktop:menu-state", (_event, state: unknown) => {
		if (state && typeof state === "object") {
			updateMenuState(state as Partial<DesktopMenuState>);
		}
	});
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
	app.quit();
} else {
	app.on("second-instance", (_event, argv) => {
		const paths = projectPathsFromArguments(argv);
		if (!mainWindow) createWindow();
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
		}
		for (const filePath of paths) requestOpenPath(filePath);
	});

	app.on("open-file", (event, filePath) => {
		event.preventDefault();
		requestOpenPath(filePath);
	});

	// Ask the renderer about unsaved tabs before letting a Quit/Exit request
	// destroy the window. The close handler owns the actual confirmation.
	app.on("before-quit", (event) => {
		if (allowWindowClose) return;
		const window = mainWindow;
		if (!window || window.isDestroyed()) return;
		event.preventDefault();
		quitAfterClose = true;
		closeRequestPending = false;
		window.close();
	});

	app.whenReady().then(() => {
		registerIpc();

		session.defaultSession.on("will-download", (_event, item) => {
			item.setSaveDialogOptions({
				title: "Save Export",
				defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
			});
		});

		for (const filePath of projectPathsFromArguments(process.argv)) {
			if (!pendingOpenPaths.includes(filePath)) pendingOpenPaths.push(filePath);
		}

		createWindow();

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
}
