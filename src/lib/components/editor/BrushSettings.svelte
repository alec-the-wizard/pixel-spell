<script lang="ts">
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import BrushPicker from "./BrushPicker.svelte";

	let visible = $derived(
		editor.tool === "pencil" ||
			editor.tool === "eraser" ||
			editor.tool === "line" ||
			editor.tool === "curve" ||
			(editor.tool === "shape" && !editor.shapeFilled),
	);
</script>

{#if visible}
	<div class="space-y-3">
		<BrushPicker />

		<div class="space-y-2.5">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium">Brush size</span>
				<span
					class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
				>
					{editor.brushSize}px
				</span>
			</div>
			<Slider
				type="single"
				min={1}
				max={64}
				step={1}
				bind:value={editor.brushSize}
			/>
			<span class="block text-[10px] text-muted-foreground">
				Custom brushes keep their aspect ratio and scale nearest-neighbor.
			</span>
		</div>

		<div class="space-y-2.5">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium">Ink opacity</span>
				<span
					class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
				>
					{editor.brushOpacity}%
				</span>
			</div>
			<Slider
				type="single"
				min={1}
				max={100}
				step={1}
				bind:value={editor.brushOpacity}
			/>
		</div>
	</div>
{/if}
