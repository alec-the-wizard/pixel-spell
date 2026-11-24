<script lang="ts">
	import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
	import Download from "@lucide/svelte/icons/download";
	import Film from "@lucide/svelte/icons/film";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		VIDEO_FORMATS,
		downloadBlob,
		exportBaseName,
		exportFileName,
		flattenPixels,
		validateExportSize,
		videoFormatInfo,
		type ExportBackground,
		type VideoFormat,
	} from "$lib/editor/export.js";
	import { exportVideo } from "$lib/editor/export-video.js";
	import { drawScaled } from "$lib/editor/render.js";
	import type { TimelapseBuild } from "$lib/editor/timelapse.js";

	let { open = $bindable(false) } = $props();

	const PREVIEW_MAX_WIDTH = 600;
	const PREVIEW_MAX_HEIGHT = 132;

	const BACKGROUNDS: { id: ExportBackground; label: string; swatch: string }[] = [
		{ id: "transparent", label: "Transparent", swatch: "checkerboard" },
		{ id: "white", label: "White", swatch: "bg-white" },
		{ id: "black", label: "Black", swatch: "bg-black" },
	];

	let videoFormat = $state<VideoFormat>("gif");
	let videoScale = $state(1);
	let videoFps = $state(12);
	let videoLoop = $state(true);
	let videoBackground = $state<ExportBackground>("transparent");
	let videoQuality = $state(90);
	let videoFileName = $state("");

	let build = $state.raw<TimelapseBuild | null>(null);
	let preparing = $state(false);
	let exporting = $state(false);
	let error = $state<string | null>(null);
	let previewCanvas = $state<HTMLCanvasElement>();
	let previewTimer: number | undefined;
	let abortController: AbortController | null = null;
	let wasOpen = false;
	let buildGeneration = 0;

	let videoInfo = $derived(videoFormatInfo(videoFormat));
	let steps = $derived(build?.steps ?? editor.undoCount);
	let frameCount = $derived(build?.frames.length ?? Math.max(1, steps + 1));
	let outputWidth = $derived(editor.doc.width * videoScale);
	let outputHeight = $derived(editor.doc.height * videoScale);
	let sizeError = $derived(
		validateExportSize(outputWidth, outputHeight, frameCount, true),
	);
	let durationLabel = $derived.by(() => {
		const seconds = frameCount / Math.max(1, videoFps);
		return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
	});

	$effect(() => {
		if (open && !wasOpen) {
			videoFormat = "gif";
			videoScale = 1;
			videoFps = Math.max(1, Math.min(60, Math.round(editor.doc.fps || 12)));
			videoLoop = true;
			videoBackground = "transparent";
			videoQuality = 90;
			videoFileName = `${exportBaseName(editor.name)}-timelapse.gif`;
			build = null;
			preparing = true;
			exporting = false;
			error = null;

			const generation = ++buildGeneration;
			// Let the dialog paint its "preparing" state before the (possibly
			// heavy) history replay runs. The token ignores late callbacks.
			window.setTimeout(() => {
				if (!open || generation !== buildGeneration) return;
				try {
					build = editor.buildTimelapse();
				} catch (buildError) {
					error =
						buildError instanceof Error
							? buildError.message
							: "The timelapse could not be prepared.";
				} finally {
					preparing = false;
				}
			}, 30);
		} else if (!open && wasOpen) {
			// Release the composited states as soon as the dialog closes.
			buildGeneration++;
			build = null;
			preparing = false;
		}
		wasOpen = open;
	});

	$effect(() => {
		if (!open || !previewCanvas) return;
		const canvas = previewCanvas;
		const data = build;
		const background = videoBackground;
		const fps = Math.max(1, Math.min(60, Math.round(videoFps)));

		if (!data || data.frames.length === 0) {
			const context = canvas.getContext("2d");
			context?.clearRect(0, 0, canvas.width, canvas.height);
			return;
		}

		if (previewTimer !== undefined) {
			window.clearTimeout(previewTimer);
			previewTimer = undefined;
		}

		const width = data.doc.width;
		const height = data.doc.height;
		let position = 0;
		const draw = (): void => {
			const pixels = flattenPixels(data.frames[position % data.frames.length]!, background);
			const fit = fitPreview(width, height);
			canvas.style.width = `${fit.width}px`;
			canvas.style.height = `${fit.height}px`;
			drawScaled(canvas, pixels, width, height, fit.width, fit.height);
			position = (position + 1) % data.frames.length;
			if (data.frames.length <= 1) return;
			previewTimer = window.setTimeout(draw, Math.max(10, 1000 / fps));
		};
		draw();

		return () => {
			if (previewTimer !== undefined) {
				window.clearTimeout(previewTimer);
				previewTimer = undefined;
			}
		};
	});

	function fitPreview(
		sourceWidth: number,
		sourceHeight: number,
	): { width: number; height: number } {
		if (sourceWidth <= 0 || sourceHeight <= 0) return { width: 1, height: 1 };
		const scale = Math.min(
			PREVIEW_MAX_WIDTH / sourceWidth,
			PREVIEW_MAX_HEIGHT / sourceHeight,
		);
		return {
			width: Math.max(1, Math.round(sourceWidth * scale)),
			height: Math.max(1, Math.round(sourceHeight * scale)),
		};
	}

	function changeVideoFormat(event: Event): void {
		const next = (event.currentTarget as HTMLSelectElement).value as VideoFormat;
		videoFormat = next;
		const info = videoFormatInfo(next);
		if (videoFileName.trim()) {
			videoFileName = exportFileName(videoFileName, info.extension);
		}
		if (!info.alpha && videoBackground === "transparent") {
			videoBackground = "black";
		}
	}

	async function exportNow(): Promise<void> {
		if (exporting || preparing || sizeError || !build) return;

		error = null;
		exporting = true;
		abortController = new AbortController();
		const signal = abortController.signal;
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		// The encoders read timing from the synthetic document, so apply the
		// chosen playback rate before handing it over.
		const doc = { ...build.doc, fps: videoFps };
		try {
			const blob = await exportVideo(doc, {
				format: videoFormat,
				scale: videoScale,
				fps: videoFps,
				loop: videoLoop,
				background: videoBackground,
				quality: videoQuality,
				signal,
			});
			downloadBlob(exportFileName(videoFileName, videoInfo.extension), blob);
			open = false;
		} catch (exportError) {
			if ((exportError as { name?: string } | null)?.name === "AbortError") {
				error = null;
			} else {
				error =
					exportError instanceof Error
						? exportError.message
						: "The timelapse could not be exported.";
			}
		} finally {
			exporting = false;
			abortController = null;
		}
	}

	function cancelExport(): void {
		if (exporting) {
			abortController?.abort();
		} else {
			open = false;
		}
	}

	function formatSteps(value: number): string {
		return value === 1 ? "1 step" : `${value} steps`;
	}
</script>

{#snippet backgroundPicker(
	value: ExportBackground,
	allowTransparent: boolean,
	onchange: (next: ExportBackground) => void,
)}
	<div class="grid grid-cols-3 gap-2" role="group" aria-label="Background">
		{#each BACKGROUNDS as option (option.id)}
			<Button
				variant={value === option.id ? "default" : "outline"}
				size="sm"
				class="h-auto flex-col gap-1.5 py-2"
				onclick={() => onchange(option.id)}
				disabled={option.id === "transparent" && !allowTransparent}
				aria-pressed={value === option.id}
			>
				<span
					class="size-5 rounded-sm border {option.swatch}"
					style={option.id === "transparent" ? "background-size: 6px 6px" : undefined}
					aria-hidden="true"
				></span>
				<span class="text-[10px]">{option.label}</span>
			</Button>
		{/each}
	</div>
{/snippet}

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Film class="size-4 text-muted-foreground" />
				Export timelapse
			</Dialog.Title>
			<Dialog.Description>
				Replay the retained history of “{editor.name}” frame {editor.activeFrame + 1} as
				an animation or video. History steps are kept by the saved-steps setting in
				<button
					type="button"
					class="font-medium text-foreground underline underline-offset-2"
					onclick={() => {
						open = false;
						editor.historyOpen = true;
					}}
				>
					Edit → History
				</button>.
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-2">
			<div
				class="checkerboard relative flex h-36 items-center justify-center overflow-hidden rounded-lg ring-1 ring-border"
			>
				<canvas bind:this={previewCanvas} class="block" aria-label="Timelapse preview"></canvas>
				{#if preparing}
					<div
						class="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-xs font-medium backdrop-blur-[1px]"
					>
						<LoaderCircle class="size-4 animate-spin" />
						Preparing {formatSteps(steps)}…
					</div>
				{/if}
			</div>
			<div class="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
				<span class="font-mono tabular-nums">
					{outputWidth} × {outputHeight} px · {frameCount}
					{frameCount === 1 ? "frame" : "frames"} · {durationLabel}
				</span>
				<span class="truncate">
					{formatSteps(steps)} of retained history · {videoInfo.label}
				</span>
			</div>
		</div>

		<div class="grid gap-4">
			<div class="grid gap-1.5">
				<Label for="timelapse-name">File name</Label>
				<Input
					id="timelapse-name"
					bind:value={videoFileName}
					maxlength={120}
					placeholder="project-timelapse.gif"
					autocomplete="off"
				/>
			</div>

			<div class="grid gap-1.5">
				<Label for="timelapse-format">Format</Label>
				<select
					id="timelapse-format"
					class="h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
					value={videoFormat}
					onchange={changeVideoFormat}
				>
					{#each VIDEO_FORMATS as option (option.id)}
						<option value={option.id}>{option.label}</option>
					{/each}
				</select>
			</div>

			<div class="grid gap-2">
				<div class="flex items-center justify-between">
					<span class="text-xs font-medium">Scale</span>
					<span
						class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
					>
						{videoScale}×
					</span>
				</div>
				<Slider type="single" min={1} max={10} step={1} bind:value={videoScale} />
			</div>

			<div class="grid gap-2">
				<div class="flex items-center justify-between">
					<span class="text-xs font-medium">Playback speed</span>
					<span
						class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
					>
						{Math.round(videoFps)} fps
					</span>
				</div>
				<Slider type="single" min={1} max={60} step={1} bind:value={videoFps} />
				<p class="text-[10px] text-muted-foreground">
					Each history step becomes one frame. Lower speeds make the process easier to
					follow.
				</p>
			</div>

			{#if videoInfo.quality}
				<div class="grid gap-2">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium">Quality</span>
						<span
							class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
						>
							{Math.round(videoQuality)}%
						</span>
					</div>
					<Slider type="single" min={1} max={100} step={1} bind:value={videoQuality} />
					{#if videoInfo.realtime}
						<p class="text-[10px] text-muted-foreground">
							{videoInfo.label} records in real time, so the timelapse plays at the
							chosen speed while exporting.
						</p>
					{/if}
				</div>
			{/if}

			{#if videoInfo.loop}
				<label
					class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
				>
					<span class="grid gap-0.5">
						<span class="text-xs font-medium">Loop animation</span>
						<span class="text-[10px] text-muted-foreground">
							Repeat forever when the player allows it.
						</span>
					</span>
					<Switch bind:checked={videoLoop} />
				</label>
			{/if}

			<div class="grid gap-2">
				<span class="text-xs font-medium">Background</span>
				{@render backgroundPicker(
					videoBackground,
					videoInfo.alpha,
					(next) => (videoBackground = next),
				)}
				{#if videoFormat === "gif"}
					<p class="text-[10px] text-muted-foreground">
						Transparent GIFs use a 50% alpha cutoff because GIF supports only binary
						transparency.
					</p>
				{:else if !videoInfo.alpha}
					<p class="text-[10px] text-muted-foreground">
						{videoInfo.label} has no alpha channel, so transparency is flattened to the
						chosen background.
					</p>
				{/if}
			</div>
		</div>

		{#if steps === 0 && !preparing}
			<div class="flex gap-2.5 rounded-lg border bg-muted/30 p-3 text-xs">
				<AlertTriangle class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<p>
					No history steps yet. Draw or edit the canvas first; this dialog replays the
					undo steps kept by <span class="font-medium text-foreground">Edit → History</span>.
				</p>
			</div>
		{/if}

		{#if sizeError || error}
			<div class="flex gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
				<AlertTriangle class="mt-0.5 size-4 shrink-0 text-destructive" />
				<p>{sizeError ?? error}</p>
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={cancelExport}>
				{exporting ? "Cancel export" : "Cancel"}
			</Button>
			<Button
				onclick={exportNow}
				disabled={exporting || preparing || Boolean(sizeError) || steps === 0 || !build}
			>
				{#if exporting}
					<LoaderCircle class="size-4 animate-spin" />
					Exporting…
				{:else}
					<Download class="size-4" />
					Export timelapse
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
