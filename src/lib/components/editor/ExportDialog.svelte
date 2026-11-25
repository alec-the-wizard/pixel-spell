<script lang="ts">
	import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
	import AppWindow from "@lucide/svelte/icons/app-window";
	import Download from "@lucide/svelte/icons/download";
	import Film from "@lucide/svelte/icons/film";
	import ImageIcon from "@lucide/svelte/icons/image";
	import LayoutGrid from "@lucide/svelte/icons/layout-grid";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { compositeFrameCached, frameDurationMs } from "$lib/editor/doc.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { exportIcon } from "$lib/editor/export-icon.js";
	import { exportVideo } from "$lib/editor/export-video.js";
	import {
		EXPORT_FORMATS,
		EXPORT_TAB_LABELS,
		FORMAT_EXTENSION,
		ICON_FORMATS,
		SHEET_METADATA_FORMATS,
		VIDEO_FORMATS,
		animationFrameIndices,
		downloadBlob,
		exportBaseName,
		exportFileName,
		exportFormatSupportsGrayscale,
		exportFormatSupportsIndexed,
		exportFrameImage,
		exportSpriteSheet,
		flattenPixels,
		getSheetGeometry,
		iconFormatInfo,
		sheetMetadata,
		validateExportSize,
		videoFormatInfo,
		type ExportBackground,
		type ExportFormat,
		type ExportTabId,
		type IconFormat,
		type SheetLayout,
		type SheetMetadataChoice,
		type VideoFormat,
	} from "$lib/editor/export.js";
	import { drawPixels, drawScaled } from "$lib/editor/render.js";
	import { grayscalePixels } from "$lib/editor/grayscale.js";
	import { snapHexToPalette } from "$lib/editor/indexed.js";
	import { indexedPreviewPixels } from "$lib/editor/indexed-png.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	const TABS: ExportTabId[] = ["image", "spritesheet", "video", "icon"];
	const BACKGROUNDS: { id: ExportBackground; label: string; swatch: string }[] = [
		{ id: "transparent", label: "Transparent", swatch: "checkerboard" },
		{ id: "white", label: "White", swatch: "bg-white" },
		{ id: "black", label: "Black", swatch: "bg-black" },
	];
	const LAYOUTS: { id: SheetLayout; label: string }[] = [
		{ id: "horizontal", label: "Horizontal" },
		{ id: "vertical", label: "Vertical" },
		{ id: "grid", label: "Grid" },
	];
	const PREVIEW_MAX_WIDTH = 600;
	const PREVIEW_MAX_HEIGHT = 132;

	let activeTab = $state<ExportTabId>("image");
	let exporting = $state(false);
	let error = $state<string | null>(null);
	let previewCanvas = $state<HTMLCanvasElement>();
	let previewTimer: number | undefined;
	let wasOpen = false;
	let sheetSourceCanvas: HTMLCanvasElement | null = null;
	let abortController: AbortController | null = null;

	let imageFrame = $state(0);
	let imageScale = $state(1);
	let imageFormat = $state<ExportFormat>("png");
	let imageBackground = $state<ExportBackground>("transparent");
	let imageQuality = $state(90);
	let imageFileName = $state("");
	let imageGrayscale = $state(false);
	let imageIndexed = $state(false);

	let sheetScale = $state(1);
	let sheetLayout = $state<SheetLayout>("horizontal");
	let sheetColumns = $state(1);
	let sheetSpacing = $state(0);
	let sheetFormat = $state<ExportFormat>("png");
	let sheetBackground = $state<ExportBackground>("transparent");
	let sheetQuality = $state(90);
	let sheetFileName = $state("");
	let sheetGrayscale = $state(false);
	let sheetIndexed = $state(false);
	let sheetMetadataFormat = $state<SheetMetadataChoice>("none");
	let sheetPivotX = $state(50);
	let sheetPivotY = $state(50);

	let videoFormat = $state<VideoFormat>("gif");
	let videoScale = $state(1);
	let videoFps = $state(12);
	let videoLoop = $state(true);
	let videoBackground = $state<ExportBackground>("transparent");
	let videoQuality = $state(90);
	let videoFileName = $state("");

	let iconFormat = $state<IconFormat>("ico");
	let iconFrame = $state(0);
	let iconBackground = $state<ExportBackground>("transparent");
	let iconFileName = $state("");

	let imageWidth = $derived(editor.doc.width * imageScale);
	let imageHeight = $derived(editor.doc.height * imageScale);
	let imageSizeError = $derived(validateExportSize(imageWidth, imageHeight));

	let sheetGeometry = $derived(
		getSheetGeometry(
			editor.doc.width * sheetScale,
			editor.doc.height * sheetScale,
			editor.doc.frames.length,
			sheetLayout,
			sheetColumns,
			sheetSpacing,
		),
	);
	let sheetSizeError = $derived(
		validateExportSize(sheetGeometry.width, sheetGeometry.height),
	);

	let videoInfo = $derived(videoFormatInfo(videoFormat));
	let iconInfo = $derived(iconFormatInfo(iconFormat));

	let paletteColors = $derived(editor.activePalette.colors);
	let paletteEmpty = $derived(paletteColors.length === 0);
	let paletteName = $derived(editor.activePalette.name);

	let videoWidth = $derived(editor.doc.width * videoScale);
	let videoHeight = $derived(editor.doc.height * videoScale);
	let videoFrames = $derived(
		animationFrameIndices(editor.doc, editor.animationFrameIndices),
	);
	let videoFrameCount = $derived(videoFrames.length);
	let videoSizeError = $derived(
		validateExportSize(videoWidth, videoHeight, videoFrameCount, true),
	);

	let sizeError = $derived(
		activeTab === "image"
			? imageSizeError
			: activeTab === "spritesheet"
				? sheetSizeError
				: activeTab === "video"
					? videoSizeError
					: null,
	);

	let outputLabel = $derived.by(() => {
		if (activeTab === "image") return `${imageWidth} × ${imageHeight} px`;
		if (activeTab === "spritesheet") {
			return `${sheetGeometry.width} × ${sheetGeometry.height} px · ${sheetGeometry.columns} × ${sheetGeometry.rows}`;
		}
		if (activeTab === "video") {
			return `${videoWidth} × ${videoHeight} px · ${videoFrameCount} ${videoFrameCount === 1 ? "frame" : "frames"}`;
		}
		return `${iconInfo.label} · multi-size`;
	});

	let formatLabel = $derived.by(() => {
		const format = (id: ExportFormat): string =>
			EXPORT_FORMATS.find((entry) => entry.id === id)?.label ?? id.toUpperCase();

		if (activeTab === "image") {
			const grayscale =
				imageGrayscale && exportFormatSupportsGrayscale(imageFormat)
					? " · 8-bit grayscale"
					: "";
			const indexed =
				imageIndexed && exportFormatSupportsIndexed(imageFormat)
					? ` · indexed (${paletteName})`
					: "";
			return `${format(imageFormat)} · ${imageBackground}${indexed}${grayscale}`;
		}
		if (activeTab === "spritesheet") {
			const metadata =
				SHEET_METADATA_FORMATS.find(
					(entry) => entry.id === sheetMetadataFormat,
				)?.summary ?? "";
			const grayscale =
				sheetGrayscale && exportFormatSupportsGrayscale(sheetFormat)
					? " · 8-bit grayscale"
					: "";
			const indexed =
				sheetIndexed && exportFormatSupportsIndexed(sheetFormat)
					? ` · indexed (${paletteName})`
					: "";
			return `${format(sheetFormat)} · ${sheetBackground}${indexed}${grayscale}${metadata ? ` · ${metadata}` : ""}`;
		}
		if (activeTab === "video") {
			const selectedCount = editor.selectedFrameIndices.length;
			const rangeLabel =
				selectedCount >= 2 ? ` · ${selectedCount} selected frames` : "";
			if (videoFormat === "gif") {
				return `GIF · ${Math.round(videoFps)} fps fallback${videoLoop ? " · loop" : ""}${rangeLabel}`;
			}
			if (videoFormat === "apng") {
				return `APNG${videoLoop ? " · loop" : ""}${rangeLabel}`;
			}
			if (videoFormat === "webp") {
				return `Animated WebP · q${Math.round(videoQuality)}${videoLoop ? " · loop" : ""}${rangeLabel}`;
			}
			return `${videoInfo.label} · ${videoBackground}${rangeLabel}`;
		}
		return `${iconInfo.label} · ${iconBackground}`;
	});

	$effect(() => {
		if (open && !wasOpen) {
			activeTab = "image";
			imageFrame = editor.activeFrame;
			imageScale = 1;
			imageFormat = "png";
			imageBackground = "transparent";
			imageQuality = 90;
			imageFileName = `${exportBaseName(editor.name)}-frame-${editor.activeFrame + 1}.png`;
			imageGrayscale = false;
			imageIndexed = editor.indexedMode;

			sheetScale = 1;
			sheetLayout = "horizontal";
			sheetColumns = Math.max(
				1,
				Math.min(
					editor.doc.frames.length,
					Math.round(Math.sqrt(editor.doc.frames.length)),
				),
			);
			sheetSpacing = 0;
			sheetFormat = "png";
			sheetBackground = "transparent";
			sheetQuality = 90;
			sheetFileName = `${exportBaseName(editor.name)}-spritesheet.png`;
			sheetMetadataFormat = "none";
			sheetPivotX = 50;
			sheetPivotY = 50;
			sheetGrayscale = false;
			sheetIndexed = editor.indexedMode;

			videoFormat = "gif";
			videoScale = 1;
			videoFps = editor.doc.fps;
			videoLoop = true;
			videoBackground = "transparent";
			videoQuality = 90;
			videoFileName = `${exportBaseName(editor.name)}.gif`;

			iconFormat = "ico";
			iconFrame = editor.activeFrame;
			iconBackground = "transparent";
			iconFileName = `${exportBaseName(editor.name)}.ico`;

			error = null;
			exporting = false;
		}
		wasOpen = open;
	});

	function fitPreview(
		sourceWidth: number,
		sourceHeight: number,
	): { width: number; height: number } {
		if (
			!Number.isFinite(sourceWidth) ||
			!Number.isFinite(sourceHeight) ||
			sourceWidth <= 0 ||
			sourceHeight <= 0
		) {
			return { width: 1, height: 1 };
		}
		const scale = Math.min(
			PREVIEW_MAX_WIDTH / sourceWidth,
			PREVIEW_MAX_HEIGHT / sourceHeight,
		);
		return {
			width: Math.max(1, Math.round(sourceWidth * scale)),
			height: Math.max(1, Math.round(sourceHeight * scale)),
		};
	}

	function drawPixelPreview(
		canvas: HTMLCanvasElement,
		pixels: Uint32Array,
		width: number,
		height: number,
	): void {
		const fit = fitPreview(width, height);
		canvas.style.width = `${fit.width}px`;
		canvas.style.height = `${fit.height}px`;
		drawScaled(canvas, pixels, width, height, fit.width, fit.height);
	}

	function drawSheetPreview(
		canvas: HTMLCanvasElement,
		doc: typeof editor.doc,
		layout: SheetLayout,
		columns: number,
		scale: number,
		spacing: number,
		background: ExportBackground,
		grayscale: boolean,
		indexed: boolean,
		palette: readonly string[],
	): void {
		const geometry = getSheetGeometry(
			doc.width * scale,
			doc.height * scale,
			doc.frames.length,
			layout,
			columns,
			spacing,
		);
		const fit = fitPreview(geometry.width, geometry.height);
		const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
		const backingWidth = Math.max(1, Math.round(fit.width * dpr));
		const backingHeight = Math.max(1, Math.round(fit.height * dpr));

		if (canvas.width !== backingWidth) canvas.width = backingWidth;
		if (canvas.height !== backingHeight) canvas.height = backingHeight;
		canvas.style.width = `${fit.width}px`;
		canvas.style.height = `${fit.height}px`;

		const context = canvas.getContext("2d");
		if (!context) return;
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, backingWidth, backingHeight);
		if (background !== "transparent") {
			const solid = background === "white" ? "#ffffff" : "#000000";
			context.fillStyle =
				indexed && palette.length > 0
					? snapHexToPalette(palette, solid)
					: solid;
			context.fillRect(0, 0, backingWidth, backingHeight);
		}
		context.scale(backingWidth / geometry.width, backingHeight / geometry.height);
		context.imageSmoothingEnabled = false;

		if (!sheetSourceCanvas) sheetSourceCanvas = document.createElement("canvas");
		const source = sheetSourceCanvas;

		for (let frameIndex = 0; frameIndex < doc.frames.length; frameIndex++) {
			const composited = compositeFrameCached(doc, frameIndex, editor.revision);
			const pixels =
				indexed && palette.length > 0
					? indexedPreviewPixels(composited, palette)
					: grayscale
						? grayscalePixels(composited, doc.width, doc.height, { bits: 8 })
						: composited;
			drawPixels(source, pixels, doc.width, doc.height);
			const column = frameIndex % geometry.columns;
			const row = Math.floor(frameIndex / geometry.columns);
			context.drawImage(
				source,
				column * (geometry.frameWidth + geometry.spacing),
				row * (geometry.frameHeight + geometry.spacing),
				geometry.frameWidth,
				geometry.frameHeight,
			);
		}
	}

	$effect(() => {
		if (!open || !previewCanvas) return;
		const canvas = previewCanvas;
		const doc = editor.doc;
		editor.revision;
		const tab = activeTab;

		if (previewTimer !== undefined) {
			window.clearTimeout(previewTimer);
			previewTimer = undefined;
		}

		if (tab === "image") {
			const frame = Math.max(0, Math.min(imageFrame, doc.frames.length - 1));
			const composited = compositeFrameCached(doc, frame, editor.revision);
			const flattened = flattenPixels(composited, imageBackground);
			const indexed =
				imageIndexed &&
				exportFormatSupportsIndexed(imageFormat) &&
				paletteColors.length > 0;
			const pixels = indexed
				? indexedPreviewPixels(flattened, paletteColors)
				: imageGrayscale && exportFormatSupportsGrayscale(imageFormat)
					? grayscalePixels(flattened, doc.width, doc.height, { bits: 8 })
					: flattened;
			drawPixelPreview(canvas, pixels, doc.width, doc.height);
			return;
		}

		if (tab === "spritesheet") {
			drawSheetPreview(
				canvas,
				doc,
				sheetLayout,
				sheetColumns,
				sheetScale,
				sheetSpacing,
				sheetBackground,
				sheetGrayscale && exportFormatSupportsGrayscale(sheetFormat),
				sheetIndexed && exportFormatSupportsIndexed(sheetFormat),
				paletteColors,
			);
			return;
		}

		if (tab === "icon") {
			const frame = Math.max(0, Math.min(iconFrame, doc.frames.length - 1));
			const pixels = flattenPixels(
				compositeFrameCached(doc, frame, editor.revision),
				iconBackground,
			);
			drawPixelPreview(canvas, pixels, doc.width, doc.height);
			return;
		}

		const frames = animationFrameIndices(doc, editor.animationFrameIndices);
		// Track per-frame timing changes so the preview restarts.
		doc.frames.map((frame) => frame.duration ?? 0).join(",");

		let position = 0;
		const draw = (): void => {
			const frame = frames[position % frames.length]!;
			const pixels = flattenPixels(
				compositeFrameCached(doc, frame, editor.revision),
				videoBackground,
			);
			drawPixelPreview(canvas, pixels, doc.width, doc.height);
			position = (position + 1) % frames.length;

			if (frames.length <= 1) return;
			const customDuration = doc.frames[frame]?.duration;
			const duration =
				customDuration !== undefined || !videoInfo.frameRate
					? frameDurationMs(doc, frame)
					: 1000 / Math.max(1, Math.min(60, Math.round(videoFps)));
			previewTimer = window.setTimeout(draw, Math.max(10, duration));
		};
		draw();

		return () => {
			if (previewTimer !== undefined) {
				window.clearTimeout(previewTimer);
				previewTimer = undefined;
			}
		};
	});

	function changeImageFrame(event: Event): void {
		const next = Number((event.currentTarget as HTMLSelectElement).value);
		imageFrame = next;
		const match = /^(.*-frame-)\d+(\.(?:png|jpe?g|webp))$/i.exec(imageFileName.trim());
		if (match) {
			imageFileName = `${match[1]}${next + 1}${match[2]}`;
		}
	}

	function changeImageFormat(event: Event): void {
		const next = (event.currentTarget as HTMLSelectElement).value as ExportFormat;
		imageFormat = next;
		if (imageFileName.trim()) {
			imageFileName = exportFileName(imageFileName, FORMAT_EXTENSION[next]);
		}
		if (next === "jpeg" && imageBackground === "transparent") {
			imageBackground = "white";
		}
	}

	function changeSheetFormat(event: Event): void {
		const next = (event.currentTarget as HTMLSelectElement).value as ExportFormat;
		sheetFormat = next;
		if (sheetFileName.trim()) {
			sheetFileName = exportFileName(sheetFileName, FORMAT_EXTENSION[next]);
		}
		if (next === "jpeg" && sheetBackground === "transparent") {
			sheetBackground = "white";
		}
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

	function changeIconFormat(event: Event): void {
		const next = (event.currentTarget as HTMLSelectElement).value as IconFormat;
		iconFormat = next;
		if (iconFileName.trim()) {
			iconFileName = exportFileName(iconFileName, iconFormatInfo(next).extension);
		}
	}

	function pivotPercent(value: number): number {
		return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;
	}

	async function exportNow(): Promise<void> {
		if (exporting || sizeError) return;

		error = null;
		exporting = true;
		abortController = new AbortController();
		const signal = abortController.signal;
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		const doc = editor.doc;
		try {
			if (activeTab === "image") {
				const blob = await exportFrameImage(doc, {
					frame: imageFrame,
					scale: imageScale,
					format: imageFormat,
					background: imageBackground,
					quality: imageQuality,
					grayscale: imageGrayscale,
					indexed: imageIndexed,
					palette: paletteColors,
				});
				downloadBlob(exportFileName(imageFileName, FORMAT_EXTENSION[imageFormat]), blob);
			} else if (activeTab === "spritesheet") {
				const sheetOptions = {
					scale: sheetScale,
					layout: sheetLayout,
					columns: sheetColumns,
					spacing: sheetSpacing,
					format: sheetFormat,
					background: sheetBackground,
					quality: sheetQuality,
					grayscale: sheetGrayscale,
					indexed: sheetIndexed,
					palette: paletteColors,
				};
				const blob = await exportSpriteSheet(doc, sheetOptions);
				const sheetName = exportFileName(
					sheetFileName,
					FORMAT_EXTENSION[sheetFormat],
				);
				// Build the sidecar before starting the image download so a
				// metadata error does not leave a half-finished export.
				const metadataBlob =
					sheetMetadataFormat === "none"
						? null
						: new Blob(
								[
									sheetMetadata(doc, sheetOptions, {
										format: sheetMetadataFormat,
										image: sheetName,
										pivotX: pivotPercent(sheetPivotX) / 100,
										pivotY: pivotPercent(sheetPivotY) / 100,
									}),
								],
								{ type: "application/json" },
							);
				downloadBlob(sheetName, blob);
				if (metadataBlob) {
					const metadataName = exportFileName(sheetFileName, "json");
					// Browsers only allow downloads close to the user gesture;
					// a short delay keeps both files while letting the first
					// download start cleanly.
					window.setTimeout(
						() => downloadBlob(metadataName, metadataBlob),
						150,
					);
				}
			} else if (activeTab === "video") {
				const blob = await exportVideo(doc, {
					format: videoFormat,
					scale: videoScale,
					fps: videoFps,
					loop: videoLoop,
					background: videoBackground,
					frames: videoFrames,
					quality: videoQuality,
					signal,
				});
				downloadBlob(exportFileName(videoFileName, videoInfo.extension), blob);
			} else {
				const blob = await exportIcon(doc, {
					format: iconFormat,
					frame: iconFrame,
					background: iconBackground,
				});
				downloadBlob(exportFileName(iconFileName, iconInfo.extension), blob);
			}
			open = false;
		} catch (exportError) {
			if ((exportError as { name?: string } | null)?.name === "AbortError") {
				// Cancelled by the user; keep the dialog open and idle.
				error = null;
			} else {
				error =
					exportError instanceof Error
						? exportError.message
						: "The file could not be exported.";
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
			<Dialog.Title>Export file</Dialog.Title>
			<Dialog.Description>
				Export “{editor.name}” as an image, a sprite sheet, an animation or video,
				or an app icon. Sheets can include Aseprite, TexturePacker, or Godot JSON
				metadata.
			</Dialog.Description>
		</Dialog.Header>

		<div
			role="tablist"
			aria-label="Export type"
			class="inline-flex w-fit items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5"
		>
			{#each TABS as tab (tab)}
				<button
					type="button"
					role="tab"
					aria-selected={activeTab === tab}
					class={cn(
						"flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
						activeTab === tab
							? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
							: "text-muted-foreground hover:text-foreground",
					)}
					onclick={() => {
						activeTab = tab;
						error = null;
					}}
				>
					{#if tab === "image"}
						<ImageIcon class="size-3.5" />
					{:else if tab === "spritesheet"}
						<LayoutGrid class="size-3.5" />
					{:else if tab === "video"}
						<Film class="size-3.5" />
					{:else}
						<AppWindow class="size-3.5" />
					{/if}
					{EXPORT_TAB_LABELS[tab]}
				</button>
			{/each}
		</div>

		<div class="grid gap-2">
			<div
				class="checkerboard relative flex h-36 items-center justify-center overflow-hidden rounded-lg ring-1 ring-border"
			>
				<canvas bind:this={previewCanvas} class="block" aria-label="Export preview"></canvas>
			</div>
			<div class="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
				<span class="font-mono tabular-nums">{outputLabel}</span>
				<span class="truncate">{formatLabel}</span>
			</div>
		</div>

		{#if activeTab === "image"}
			<div class="grid gap-4">
				<div class="grid gap-1.5">
					<Label for="export-image-name">File name</Label>
					<Input
						id="export-image-name"
						bind:value={imageFileName}
						maxlength={120}
						placeholder="project-frame-1.png"
						autocomplete="off"
					/>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-1.5">
						<Label for="export-image-frame">Frame</Label>
						<select
							id="export-image-frame"
							class="h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
							value={imageFrame}
							onchange={changeImageFrame}
						>
							{#each editor.doc.frames as _frame, index (index)}
								<option value={index}>Frame {index + 1}</option>
							{/each}
						</select>
					</div>

					<div class="grid gap-1.5">
						<Label for="export-image-format">Format</Label>
						<select
							id="export-image-format"
							class="h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
							value={imageFormat}
							onchange={changeImageFormat}
						>
							{#each EXPORT_FORMATS as option (option.id)}
								<option value={option.id}>{option.label}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="grid gap-2">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium">Scale</span>
						<span
							class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
						>
							{imageScale}×
						</span>
					</div>
					<Slider type="single" min={1} max={10} step={1} bind:value={imageScale} />
				</div>

				<div class="grid gap-2">
					<span class="text-xs font-medium">Background</span>
					{@render backgroundPicker(
						imageBackground,
						imageFormat !== "jpeg",
						(next) => (imageBackground = next),
					)}
					{#if imageFormat === "jpeg"}
						<p class="text-[10px] text-muted-foreground">
							JPEG does not support transparency, so the background is always solid.
						</p>
					{/if}
				</div>

				{#if exportFormatSupportsIndexed(imageFormat)}
					<label
						class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
						class:opacity-60={paletteEmpty}
					>
						<span class="grid gap-0.5">
							<span class="text-xs font-medium">Indexed palette</span>
							<span class="text-[10px] text-muted-foreground">
								{#if paletteEmpty}
									The active palette is empty. Add colors before exporting an
									indexed PNG.
								{:else}
									Write a palette PNG (color type 3) using “{paletteName}”.
									Colors snap to the palette and alpha below 50% becomes
									transparent.
								{/if}
							</span>
						</span>
						<Switch
							checked={imageIndexed}
							disabled={paletteEmpty}
							onCheckedChange={(checked) => {
								imageIndexed = checked;
								if (checked) imageGrayscale = false;
							}}
						/>
					</label>
				{/if}

				{#if exportFormatSupportsGrayscale(imageFormat)}
					<label
						class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
					>
						<span class="grid gap-0.5">
							<span class="text-xs font-medium">8-bit grayscale</span>
							<span class="text-[10px] text-muted-foreground">
								Write a single-channel PNG with perceptual luminance instead of
								RGB color.
							</span>
						</span>
						<Switch
							checked={imageGrayscale}
							onCheckedChange={(checked) => {
								imageGrayscale = checked;
								if (checked) imageIndexed = false;
							}}
						/>
					</label>
				{/if}

				{#if imageFormat !== "png"}
					<div class="grid gap-2">
						<div class="flex items-center justify-between">
							<span class="text-xs font-medium">Quality</span>
							<span
								class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
							>
								{imageQuality}%
							</span>
						</div>
						<Slider type="single" min={1} max={100} step={1} bind:value={imageQuality} />
					</div>
				{/if}
			</div>
		{:else if activeTab === "spritesheet"}
			<div class="grid gap-4">
				<div class="grid gap-1.5">
					<Label for="export-sheet-name">File name</Label>
					<Input
						id="export-sheet-name"
						bind:value={sheetFileName}
						maxlength={120}
						placeholder="project-spritesheet.png"
						autocomplete="off"
					/>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-1.5">
						<Label for="export-sheet-layout">Layout</Label>
						<select
							id="export-sheet-layout"
							class="h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
							value={sheetLayout}
							onchange={(event) =>
								(sheetLayout = (event.currentTarget as HTMLSelectElement)
									.value as SheetLayout)}
						>
							{#each LAYOUTS as option (option.id)}
								<option value={option.id}>{option.label}</option>
							{/each}
						</select>
					</div>

					<div class="grid gap-1.5">
						<Label for="export-sheet-format">Format</Label>
						<select
							id="export-sheet-format"
							class="h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
							value={sheetFormat}
							onchange={changeSheetFormat}
						>
							{#each EXPORT_FORMATS as option (option.id)}
								<option value={option.id}>{option.label}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					{#if sheetLayout === "grid"}
						<div class="grid gap-1.5">
							<Label for="export-sheet-columns">Columns</Label>
							<Input
								id="export-sheet-columns"
								type="number"
								min={1}
								max={Math.max(1, editor.doc.frames.length)}
								bind:value={sheetColumns}
								class="tabular-nums"
							/>
						</div>
					{/if}

					<div class="grid gap-2">
						<div class="flex items-center justify-between">
							<span class="text-xs font-medium">Spacing</span>
							<span
								class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
							>
								{sheetSpacing}px
							</span>
						</div>
						<Slider type="single" min={0} max={32} step={1} bind:value={sheetSpacing} />
					</div>
				</div>

				<div class="grid gap-2">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium">Scale</span>
						<span
							class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
						>
							{sheetScale}×
						</span>
					</div>
					<Slider type="single" min={1} max={10} step={1} bind:value={sheetScale} />
				</div>

				<div class="grid gap-2">
					<span class="text-xs font-medium">Background</span>
					{@render backgroundPicker(
						sheetBackground,
						sheetFormat !== "jpeg",
						(next) => (sheetBackground = next),
					)}
					{#if sheetFormat === "jpeg"}
						<p class="text-[10px] text-muted-foreground">
							JPEG does not support transparency, so the background is always solid.
						</p>
					{/if}
				</div>

				{#if exportFormatSupportsIndexed(sheetFormat)}
					<label
						class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
						class:opacity-60={paletteEmpty}
					>
						<span class="grid gap-0.5">
							<span class="text-xs font-medium">Indexed palette</span>
							<span class="text-[10px] text-muted-foreground">
								{#if paletteEmpty}
									The active palette is empty. Add colors before exporting an
									indexed PNG.
								{:else}
									Write a palette PNG (color type 3) using “{paletteName}”.
									Frame rects and metadata are unchanged.
								{/if}
							</span>
						</span>
						<Switch
							checked={sheetIndexed}
							disabled={paletteEmpty}
							onCheckedChange={(checked) => {
								sheetIndexed = checked;
								if (checked) sheetGrayscale = false;
							}}
						/>
					</label>
				{/if}

				{#if exportFormatSupportsGrayscale(sheetFormat)}
					<label
						class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
					>
						<span class="grid gap-0.5">
							<span class="text-xs font-medium">8-bit grayscale</span>
							<span class="text-[10px] text-muted-foreground">
								Write a single-channel PNG sheet. Frame rects and metadata are
								unchanged.
							</span>
						</span>
						<Switch
							checked={sheetGrayscale}
							onCheckedChange={(checked) => {
								sheetGrayscale = checked;
								if (checked) sheetIndexed = false;
							}}
						/>
					</label>
				{/if}

				{#if sheetFormat !== "png"}
					<div class="grid gap-2">
						<div class="flex items-center justify-between">
							<span class="text-xs font-medium">Quality</span>
							<span
								class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
							>
								{sheetQuality}%
							</span>
						</div>
						<Slider type="single" min={1} max={100} step={1} bind:value={sheetQuality} />
					</div>
				{/if}

				<div class="grid gap-1.5">
					<Label for="export-sheet-metadata">Metadata</Label>
					<select
						id="export-sheet-metadata"
						class="h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
						value={sheetMetadataFormat}
						onchange={(event) =>
							(sheetMetadataFormat = (event.currentTarget as HTMLSelectElement)
								.value as SheetMetadataChoice)}
					>
						{#each SHEET_METADATA_FORMATS as option (option.id)}
							<option value={option.id}>{option.label}</option>
						{/each}
					</select>
					<p class="text-[10px] text-muted-foreground">
						{#if sheetMetadataFormat === "none"}
							Download only the sheet image. Metadata adds frame rects, trimmed
							bounds, pivot, durations, and tagged animations.
						{:else}
							Also downloads
							<span class="font-mono text-foreground/80"
								>{exportFileName(sheetFileName, "json")}</span
							>. Rectangles use output-sheet pixels.
						{/if}
					</p>
				</div>

				{#if sheetMetadataFormat !== "none"}
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="grid gap-1.5">
							<Label for="export-sheet-pivot-x">Pivot X (%)</Label>
							<Input
								id="export-sheet-pivot-x"
								type="number"
								min={0}
								max={100}
								step={1}
								bind:value={sheetPivotX}
								class="tabular-nums"
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="export-sheet-pivot-y">Pivot Y (%)</Label>
							<Input
								id="export-sheet-pivot-y"
								type="number"
								min={0}
								max={100}
								step={1}
								bind:value={sheetPivotY}
								class="tabular-nums"
							/>
						</div>
					</div>
				{/if}
			</div>
		{:else if activeTab === "video"}
			<div class="grid gap-4">
				<div class="grid gap-1.5">
					<Label for="export-video-name">File name</Label>
					<Input
						id="export-video-name"
						bind:value={videoFileName}
						maxlength={120}
						placeholder="project.gif"
						autocomplete="off"
					/>
				</div>

				<div class="grid gap-1.5">
					<Label for="export-video-format">Format</Label>
					<select
						id="export-video-format"
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

				{#if videoInfo.frameRate}
					<div class="grid gap-2">
						<div class="flex items-center justify-between">
							<span class="text-xs font-medium">Frame rate</span>
							<span
								class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
							>
								{Math.round(videoFps)} fps
							</span>
						</div>
						<Slider type="single" min={1} max={60} step={1} bind:value={videoFps} />
						<p class="text-[10px] text-muted-foreground">
							{#if videoFormat === "gif"}
								Frames with a custom duration use it; all other frames use this rate.
							{:else}
								AVI plays at a fixed frame rate; per-frame durations are ignored.
							{/if}
						</p>
					</div>
				{/if}

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
								{videoInfo.label} records in real time, so the animation plays at
								normal speed while exporting.
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
							{videoInfo.label} has no alpha channel, so transparency is flattened to
							the chosen background.
						</p>
					{/if}
				</div>
			</div>
		{:else}
			<div class="grid gap-4">
				<div class="grid gap-1.5">
					<Label for="export-icon-name">File name</Label>
					<Input
						id="export-icon-name"
						bind:value={iconFileName}
						maxlength={120}
						placeholder="favicon.ico"
						autocomplete="off"
					/>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-1.5">
						<Label for="export-icon-format">Format</Label>
						<select
							id="export-icon-format"
							class="h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
							value={iconFormat}
							onchange={changeIconFormat}
						>
							{#each ICON_FORMATS as option (option.id)}
								<option value={option.id}>{option.label}</option>
							{/each}
						</select>
					</div>

					<div class="grid gap-1.5">
						<Label for="export-icon-frame">Frame</Label>
						<select
							id="export-icon-frame"
							class="h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
							value={iconFrame}
							onchange={(event) =>
								(iconFrame = Number((event.currentTarget as HTMLSelectElement).value))}
						>
							{#each editor.doc.frames as _frame, index (index)}
								<option value={index}>Frame {index + 1}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="grid gap-2">
					<span class="text-xs font-medium">Background</span>
					{@render backgroundPicker(
						iconBackground,
						true,
						(next) => (iconBackground = next),
					)}
				</div>

				<p class="text-[10px] text-muted-foreground">
					{#if iconFormat === "ico"}
						Embeds 16, 32, 48, 64, 128, and 256 px sizes as PNG-compressed entries.
					{:else}
						Embeds 16, 32, 64, 128, 256, 512, and 1024 px sizes as PNG entries for
						macOS.
					{/if}
					The frame is centered and scaled to fit each square without distortion.
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
			<Button onclick={exportNow} disabled={exporting || Boolean(sizeError)}>
				{#if exporting}
					<LoaderCircle class="size-4 animate-spin" />
					Exporting…
				{:else}
					<Download class="size-4" />
					Export {EXPORT_TAB_LABELS[activeTab]}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
