<script lang="ts">
	import { packColor } from "$lib/editor/color.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { drawThumbnail } from "$lib/editor/render.js";
	import type { PixelMask } from "$lib/editor/mask.js";

	let {
		mask,
		tile = false,
		color,
		box = 40,
		revision = 0,
		class: className = "",
	}: {
		mask: PixelMask;
		tile?: boolean;
		color?: string;
		box?: number;
		revision?: number;
		class?: string;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	let thumbColor = $derived(
		color ?? (editor.theme === "dark" ? "#d4d4d8" : "#3f3f46"),
	);

	$effect(() => {
		const currentMask = mask;
		const tiled = tile;
		const fill = thumbColor;
		box;
		revision;
		if (!canvas) return;

		const tiles = tiled ? 2 : 1;
		const width = currentMask.width * tiles;
		const height = currentMask.height * tiles;
		const pixels = new Uint32Array(width * height);
		const packed = packColor(fill);
		for (let ty = 0; ty < tiles; ty++) {
			for (let tx = 0; tx < tiles; tx++) {
				for (let y = 0; y < currentMask.height; y++) {
					for (let x = 0; x < currentMask.width; x++) {
						if (!currentMask.data[y * currentMask.width + x]) continue;
						const targetX = tx * currentMask.width + x;
						const targetY = ty * currentMask.height + y;
						pixels[targetY * width + targetX] = packed;
					}
				}
			}
		}
		drawThumbnail(canvas, pixels, width, height, box);
	});
</script>

<canvas
	bind:this={canvas}
	class={`block ${className}`}
	aria-hidden="true"
></canvas>
