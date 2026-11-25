/** Downloads the Electron binary once, without slowing down web-only installs. */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

let electronPath;
try {
	electronPath = require("electron");
} catch {
	electronPath = null;
}

if (typeof electronPath === "string" && existsSync(electronPath)) {
	process.exit(0);
}

let installScript;
try {
	installScript = require.resolve("electron/install.js");
} catch {
	console.error("The electron package is not installed. Run npm install first.");
	process.exit(1);
}

const result = spawnSync(process.execPath, [installScript], { stdio: "inherit" });
process.exit(result.status ?? 1);
