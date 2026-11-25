import electron = require("electron");
const { contextBridge, ipcRenderer, webUtils } = electron;
import type {
	DesktopMenuState,
	DesktopProjectBytes,
	DesktopReadResult,
	DesktopSaveResult,
	DesktopWriteResult,
} from "./desktop-types.js";

type Unsubscribe = () => void;

function subscribe<T>(
	channel: string,
	callback: (value: T) => void,
): Unsubscribe {
	const listener = (_event: Electron.IpcRendererEvent, value: T): void => {
		callback(value);
	};
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
	isDesktop: true as const,
	platform: process.platform,
	ready: (): Promise<{
		version: string;
		platform: string;
		dev: boolean;
	}> => ipcRenderer.invoke("desktop:ready"),
	openProjectDialog: (): Promise<DesktopProjectBytes> =>
		ipcRenderer.invoke("desktop:open-project-dialog"),
	readProjectFile: (filePath: string): Promise<DesktopReadResult> =>
		ipcRenderer.invoke("desktop:read-project", filePath),
	saveProjectDialog: (
		data: Uint8Array,
		suggestedName: string,
		currentPath?: string | null,
	): Promise<DesktopSaveResult> =>
		ipcRenderer.invoke(
			"desktop:save-project-dialog",
			data,
			suggestedName,
			currentPath ?? null,
		),
	writeProjectFile: (
		filePath: string,
		data: Uint8Array,
		name: string,
		remember = true,
	): Promise<DesktopWriteResult> =>
		ipcRenderer.invoke(
			"desktop:write-project",
			filePath,
			data,
			name,
			remember,
		),
	showItemInFolder: (filePath: string): Promise<boolean> =>
		ipcRenderer.invoke("desktop:show-item", filePath),
	getPathForFile: (file: File): string => webUtils.getPathForFile(file),
	setMenuState: (state: DesktopMenuState): void =>
		ipcRenderer.send("desktop:menu-state", state),
	onMenuCommand: (callback: (commandId: string) => void): Unsubscribe =>
		subscribe("desktop:menu-command", callback),
	onOpenPath: (callback: (filePath: string) => void): Unsubscribe =>
		subscribe("desktop:open-path", callback),
	onBeforeClose: (callback: () => void): Unsubscribe => {
		const listener = (): void => callback();
		ipcRenderer.on("desktop:before-close", listener);
		return () => ipcRenderer.removeListener("desktop:before-close", listener);
	},
	confirmClose: (projectNames: string[]): Promise<boolean> =>
		ipcRenderer.invoke("desktop:confirm-close", projectNames),
	closeWindow: (allow: boolean): void =>
		ipcRenderer.send("desktop:close-response", allow),
};

contextBridge.exposeInMainWorld("pixelSpellDesktop", api);

export type PixelSpellDesktopApi = typeof api;
