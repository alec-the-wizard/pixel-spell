import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronPath = require("electron");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const devUrl = "http://localhost:5173";

const vite = spawn(
	process.execPath,
	[viteBin, "--port", "5173", "--strictPort"],
	{
		cwd: root,
		stdio: "inherit",
		env: { ...process.env, BROWSER: "none" },
	},
);

let stopping = false;

function stop(code = 0) {
	if (stopping) return;
	stopping = true;
	if (!vite.killed) vite.kill();
	process.exit(code);
}

vite.on("exit", (code) => {
	if (!stopping) {
		console.error(`Vite exited before the desktop app could start (${code ?? 1}).`);
		stop(code ?? 1);
	}
});

async function waitForServer() {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(devUrl);
			if (response.ok) return true;
		} catch {
			// The server is still starting.
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return false;
}

const ready = await waitForServer();
if (!ready) {
	console.error(`Vite did not start at ${devUrl}.`);
	stop(1);
}

const electron = spawn(electronPath, ["."], {
	cwd: root,
	stdio: "inherit",
	env: { ...process.env, PIXEL_SPELL_DEV_SERVER_URL: devUrl },
});

electron.on("exit", (code) => stop(code ?? 0));

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		if (!electron.killed) electron.kill();
		stop(0);
	});
}
