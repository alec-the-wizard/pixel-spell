<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { usesDither } from "$lib/editor/tools.js";
	import { cn } from "$lib/utils.js";
	import DitherPicker from "./DitherPicker.svelte";

	let visible = $derived(usesDither(editor.tool));
	let enabled = $derived(editor.ditherEnabledFor(editor.tool));
</script>

{#if visible}
	<div class="space-y-2.5">
		<div class="flex items-center justify-between gap-3">
			<span class="grid gap-0.5">
				<span class="text-xs font-medium">Dither ink</span>
				<span class="text-[10px] text-muted-foreground">
					{editor.tool === "fill"
						? "Paint only the selected pattern's pixels inside the filled region."
						: "Paint only the selected pattern's pixels. Combine it with a custom brush for pattern stamps."}
				</span>
			</span>
			<Switch
				checked={enabled}
				onCheckedChange={(checked) => editor.setDitherEnabled(editor.tool, checked)}
				aria-label="Dither ink"
			/>
		</div>

		{#if enabled}
			<DitherPicker />

			{#if editor.tool !== "fill"}
				<div class="grid gap-1.5">
					<span class="text-[10px] font-medium text-muted-foreground">Pattern alignment</span>
					<div class="grid grid-cols-2 gap-1 rounded-lg border p-1">
						<button
							type="button"
							class={cn(
								"rounded-md px-2 py-1 text-[11px] transition-colors",
								editor.ditherAlign === "canvas"
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/60",
							)}
							aria-pressed={editor.ditherAlign === "canvas"}
							onclick={() => (editor.ditherAlign = "canvas")}
						>
							Canvas
						</button>
						<button
							type="button"
							class={cn(
								"rounded-md px-2 py-1 text-[11px] transition-colors",
								editor.ditherAlign === "brush"
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/60",
							)}
							aria-pressed={editor.ditherAlign === "brush"}
							onclick={() => (editor.ditherAlign = "brush")}
						>
							Brush
						</button>
					</div>
					<span class="text-[10px] text-muted-foreground">
						Canvas keeps the pattern fixed to the artwork. Brush moves the phase with each stamp.
					</span>
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-2">
				<label class="grid gap-1">
					<span class="text-[10px] font-medium text-muted-foreground">Offset X</span>
					<Input
						type="number"
						step={1}
						value={editor.ditherOffsetX}
						oninput={(event) =>
							editor.setDitherOffset(
								Number(event.currentTarget.value),
								editor.ditherOffsetY,
							)}
					/>
				</label>
				<label class="grid gap-1">
					<span class="text-[10px] font-medium text-muted-foreground">Offset Y</span>
					<Input
						type="number"
						step={1}
						value={editor.ditherOffsetY}
						oninput={(event) =>
							editor.setDitherOffset(
								editor.ditherOffsetX,
								Number(event.currentTarget.value),
							)}
					/>
				</label>
			</div>

			<Button
				variant="ghost"
				size="sm"
				class="w-full justify-start text-muted-foreground"
				onclick={() => editor.openMaskLibrary("pattern")}
			>
				Edit dither patterns…
			</Button>
		{/if}
	</div>
{/if}
