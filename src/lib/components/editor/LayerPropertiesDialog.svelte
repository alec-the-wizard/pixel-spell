<script lang="ts">
	import Ban from "@lucide/svelte/icons/ban";
	import Check from "@lucide/svelte/icons/check";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		LAYER_COLOR_PRESETS,
		layerColorName,
	} from "$lib/editor/layer-color.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	let name = $state("");
	let color = $state<string | null>(null);
	let wasOpen = false;

	let layer = $derived(editor.activeLayer);

	$effect(() => {
		if (open && !wasOpen) {
			name = editor.activeLayer.name;
			color = editor.activeLayer.color ?? null;
		}
		wasOpen = open;
	});

	function choose(next: string | null): void {
		color = next;
	}

	function apply(): void {
		const active = editor.activeLayer;
		const trimmed = name.trim();
		if (trimmed && trimmed !== active.name) {
			editor.renameLayer(active.id, trimmed);
		}
		editor.setLayerColor(active.id, color);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Layer properties</Dialog.Title>
			<Dialog.Description>
				Set the name and timeline identity color for {layer.name}.
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-4">
			<div class="grid gap-1.5">
				<Label for="layer-name">Name</Label>
				<Input
					id="layer-name"
					bind:value={name}
					maxlength={60}
					autocomplete="off"
				/>
			</div>

			<div class="grid gap-2">
				<div class="flex items-center justify-between">
					<Label>Color</Label>
					<span class="text-[10px] text-muted-foreground">
						{color ? layerColorName(color) : "No color"}
					</span>
				</div>

				<div class="grid grid-cols-6 gap-1.5">
					{#each LAYER_COLOR_PRESETS as preset (preset.value)}
						<button
							type="button"
							class={cn(
								"flex aspect-square items-center justify-center rounded-md border border-black/10 outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring dark:border-white/10",
								color === preset.value &&
									"ring-2 ring-ring ring-offset-2 ring-offset-background",
							)}
							style:background={preset.value}
							title={preset.name}
							aria-label={`${preset.name} layer color`}
							aria-pressed={color === preset.value}
							onclick={() => choose(preset.value)}
						>
							{#if color === preset.value}
								<Check class="size-3.5 text-black/70" />
							{/if}
						</button>
					{/each}
				</div>

				<div class="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={!color}
						onclick={() => choose(null)}
					>
						<Ban class="size-3.5" />
						No color
					</Button>
					<label
						class="ml-auto flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						title="Pick a custom layer color"
					>
						<input
							type="color"
							class="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
							value={color ?? "#8b8b8b"}
							aria-label="Custom layer color"
							onchange={(event) => choose(event.currentTarget.value)}
						/>
						Custom
					</label>
				</div>

				<p class="text-[10px] text-muted-foreground">
					The color shades this layer's header and timeline track. It is never
					exported.
				</p>
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={apply}>Apply</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
