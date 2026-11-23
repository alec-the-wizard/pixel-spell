<script lang="ts">
	import ImagePlus from "@lucide/svelte/icons/image-plus";
	import Library from "@lucide/svelte/icons/library";
	import SquareDashedMousePointer from "@lucide/svelte/icons/square-dashed-mouse-pointer";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Popover from "$lib/components/ui/popover/index.js";
	import { brushPreviewMask } from "$lib/editor/brush.js";
	import { allBrushes, brushLibrary } from "$lib/editor/brush-library.svelte.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import MaskThumb from "./MaskThumb.svelte";

	let open = $state(false);

	function selectBrush(id: string): void {
		editor.selectBrush(id);
		open = false;
	}

	function newFromSelection(): void {
		const preset = editor.createBrushFromSelection();
		open = false;
		if (preset) editor.openMaskLibrary("brush", preset.id);
	}

	function manage(): void {
		open = false;
		editor.openMaskLibrary("brush");
	}
</script>

<div class="space-y-2.5">
	<span class="text-xs font-medium">Brush</span>
	<Popover.Root bind:open>
		<Popover.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					class="flex w-full items-center gap-2.5 rounded-lg border bg-background px-2.5 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					aria-label="Choose brush"
				>
					<span class="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-muted/40">
						<MaskThumb
							mask={brushPreviewMask(editor.activeBrush, 16)}
							box={32}
							revision={brushLibrary.revision}
							class="size-8"
						/>
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-xs font-medium">
							{editor.activeBrush.name}
						</span>
						<span class="block text-[10px] text-muted-foreground">
							{editor.activeBrushMask.width} × {editor.activeBrushMask.height} px
						</span>
					</span>
					<span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
						{editor.brushSize}px
					</span>
				</button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-[19rem]" align="start">
			<div class="space-y-2.5">
				<div class="flex items-center justify-between">
					<span class="text-xs font-medium">Brushes</span>
					<span class="text-[10px] text-muted-foreground">
						Click to select
					</span>
				</div>
				<div class="grid grid-cols-5 gap-1.5" role="listbox" aria-label="Brushes">
					{#each allBrushes() as brush (brush.id)}
						<button
							type="button"
							class="group grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted/30 p-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							class:border-primary={brush.id === editor.activeBrush.id}
							class:bg-accent={brush.id === editor.activeBrush.id}
							role="option"
							aria-selected={brush.id === editor.activeBrush.id}
							title={`${brush.name}${brush.builtin ? " (built-in)" : ""}`}
							onclick={() => selectBrush(brush.id)}
						>
							<MaskThumb
								mask={brushPreviewMask(brush, 16)}
								box={40}
								revision={brushLibrary.revision}
								class="size-full"
							/>
						</button>
					{/each}
				</div>
				<div class="grid gap-1.5">
					<Button
						variant="outline"
						size="sm"
						class="justify-start"
						disabled={!editor.hasSelection}
						title={editor.hasSelection
							? "Create a brush from the current selection"
							: "Make a selection first"}
						onclick={newFromSelection}
					>
						<SquareDashedMousePointer class="size-3.5" />
						New brush from selection
					</Button>
					<Button variant="outline" size="sm" class="justify-start" onclick={manage}>
						<Library class="size-3.5" />
						Manage brushes & patterns…
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="justify-start text-muted-foreground"
						onclick={() => {
							open = false;
							editor.openMaskLibrary("brush");
						}}
					>
						<ImagePlus class="size-3.5" />
						Import image or edit masks…
					</Button>
				</div>
			</div>
		</Popover.Content>
	</Popover.Root>
</div>
