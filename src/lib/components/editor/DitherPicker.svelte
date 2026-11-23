<script lang="ts">
	import Library from "@lucide/svelte/icons/library";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Popover from "$lib/components/ui/popover/index.js";
	import {
		allDitherPatterns,
		ditherLibrary,
	} from "$lib/editor/dither-library.svelte.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import MaskThumb from "./MaskThumb.svelte";

	let open = $state(false);

	function selectPattern(id: string): void {
		editor.selectDitherPattern(id);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="flex w-full items-center gap-2.5 rounded-lg border bg-background px-2.5 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-label="Choose dither pattern"
			>
				<span class="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-muted/40">
					<MaskThumb
						mask={editor.activeDitherPattern.mask}
						tile
						box={32}
						revision={ditherLibrary.revision}
						class="size-8"
					/>
				</span>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-xs font-medium">
						{editor.activeDitherPattern.name}
					</span>
					<span class="block text-[10px] text-muted-foreground">
						{editor.activeDitherPattern.mask.width} × {editor.activeDitherPattern.mask.height} px
					</span>
				</span>
			</button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-[20rem]" align="start">
		<div class="space-y-2.5">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium">Dither patterns</span>
				<span class="text-[10px] text-muted-foreground">Tiled preview</span>
			</div>
			<div class="grid grid-cols-5 gap-1.5" role="listbox" aria-label="Dither patterns">
				{#each allDitherPatterns() as pattern (pattern.id)}
					<button
						type="button"
						class="grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted/30 p-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						class:border-primary={pattern.id === editor.activeDitherPattern.id}
						class:bg-accent={pattern.id === editor.activeDitherPattern.id}
						role="option"
						aria-selected={pattern.id === editor.activeDitherPattern.id}
						title={`${pattern.name} (${pattern.mask.width}×${pattern.mask.height})`}
						onclick={() => selectPattern(pattern.id)}
					>
						<MaskThumb
							mask={pattern.mask}
							tile
							box={36}
							revision={ditherLibrary.revision}
							class="size-full"
						/>
					</button>
				{/each}
			</div>
			<Button
				variant="outline"
				size="sm"
				class="w-full justify-start"
				onclick={() => {
					open = false;
					editor.openMaskLibrary("pattern");
				}}
			>
				<Library class="size-3.5" />
				Manage dither patterns…
			</Button>
		</div>
	</Popover.Content>
</Popover.Root>
