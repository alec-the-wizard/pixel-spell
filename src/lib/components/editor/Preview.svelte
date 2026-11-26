<script lang="ts">
	import Contrast from "@lucide/svelte/icons/contrast";
	import ScanEye from "@lucide/svelte/icons/scan-eye";
	import X from "@lucide/svelte/icons/x";
	import ZoomIn from "@lucide/svelte/icons/zoom-in";
	import ZoomOut from "@lucide/svelte/icons/zoom-out";
	import { compositeFrameCachedIncremental } from "$lib/editor/doc.js";
	import {
		PREVIEW_ZOOM_MAX,
		PREVIEW_ZOOM_MIN,
		editor,
	} from "$lib/editor/editor.svelte.js";
	import { grayscalePixels } from "$lib/editor/grayscale.js";
	import { drawPixels } from "$lib/editor/render.js";
	import { cn } from "$lib/utils.js";

	let canvas = $state<HTMLCanvasElement>();

	let previewWidth = $derived(editor.doc.width * editor.previewZoom);
	let previewHeight = $derived(editor.doc.height * editor.previewZoom);

	function changeZoom(delta: number): void {
		editor.previewZoom = Math.max(
			PREVIEW_ZOOM_MIN,
			Math.min(PREVIEW_ZOOM_MAX, editor.previewZoom + delta),
		);
	}

	$effect(() => {
		if (!editor.showPreview) return;
		const doc = editor.doc;
		const frame = editor.activeFrame;
		editor.revision;
		const grayscale = editor.previewGrayscale;
		const width = doc.width;
		const height = doc.height;

		if (!canvas) return;
		const id = requestAnimationFrame(() => {
			if (!canvas || !editor.showPreview) return;
			const source = compositeFrameCachedIncremental(
				doc,
				frame,
				editor.structureRevision,
				editor.layerAppearanceRevision,
				editor.activeLayerId,
			);
			const pixels = grayscale
				? grayscalePixels(source, width, height, { bits: 8 })
				: source;
			drawPixels(canvas, pixels, width, height);
		});
		return () => cancelAnimationFrame(id);
	});
</script>

{#if editor.showPreview}
	<div
		class="absolute right-3 top-3 z-10 max-w-[calc(100%_-_1.5rem)] overflow-hidden rounded-lg border bg-background/95 shadow-lg backdrop-blur"
	>
		<div class="flex h-8 items-center justify-between gap-4 border-b px-2.5">
			<span class="text-[11px] font-medium">Preview</span>
			<button
				type="button"
				class="-mr-1 grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				onclick={() => (editor.showPreview = false)}
				title="Close preview"
				aria-label="Close preview"
			>
				<X class="size-3.5" />
			</button>
		</div>
		<div
			class="grid max-h-72 min-h-16 min-w-24 max-w-full place-items-center overflow-auto p-2"
		>
			<div
				class="checkerboard shrink-0 ring-1 ring-border/70"
				style:width={`${previewWidth}px`}
				style:height={`${previewHeight}px`}
			>
				<canvas
					bind:this={canvas}
					class="block"
					style:width={`${previewWidth}px`}
					style:height={`${previewHeight}px`}
					style="image-rendering: pixelated"
					aria-label={`Preview at ${editor.previewZoom}× zoom`}
				></canvas>
			</div>
		</div>
		<div class="flex h-8 items-center justify-between gap-2 border-t px-2">
			<button
				type="button"
				class={cn(
					"flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] transition-colors",
					editor.previewGrayscale
						? "bg-accent text-foreground"
						: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
				)}
				aria-pressed={editor.previewGrayscale}
				onclick={() => (editor.previewGrayscale = !editor.previewGrayscale)}
				title="Preview the active frame in 8-bit grayscale"
			>
				<Contrast class="size-3.5" />
				Grayscale
			</button>
			<div class="flex items-center gap-0.5">
				<button
					type="button"
					class="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
					onclick={() => changeZoom(-1)}
					disabled={editor.previewZoom <= PREVIEW_ZOOM_MIN}
					title="Zoom preview out"
					aria-label="Zoom preview out"
				>
					<ZoomOut class="size-3.5" />
				</button>
				<span class="w-7 text-center text-[10px] tabular-nums text-muted-foreground">
					{editor.previewZoom}×
				</span>
				<button
					type="button"
					class="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
					onclick={() => changeZoom(1)}
					disabled={editor.previewZoom >= PREVIEW_ZOOM_MAX}
					title="Zoom preview in"
					aria-label="Zoom preview in"
				>
					<ZoomIn class="size-3.5" />
				</button>
			</div>
		</div>
	</div>
{:else}
	<button
		type="button"
		class="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
		onclick={() => (editor.showPreview = true)}
		title="Show preview"
		aria-label="Show preview"
	>
		<ScanEye class="size-4" />
	</button>
{/if}
