<script lang="ts">
	import Ban from "@lucide/svelte/icons/ban";
	import Check from "@lucide/svelte/icons/check";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Scissors from "@lucide/svelte/icons/scissors";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { BLEND_MODE_LABELS, BLEND_MODES } from "$lib/editor/blend.js";
	import { isGroupLayer } from "$lib/editor/doc.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		LAYER_COLOR_PRESETS,
		layerColorName,
	} from "$lib/editor/layer-color.js";
	import type { BlendMode } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	let name = $state("");
	let opacity = $state(100);
	let color = $state<string | null>(null);
	let blendMode = $state<BlendMode>("normal");
	let clipping = $state(false);
	let wasOpen = false;

	let layer = $derived(editor.activeLayer);
	let isGroup = $derived(isGroupLayer(editor.activeLayer));

	let blendLabel = $derived(BLEND_MODE_LABELS[blendMode] ?? "Normal");

	$effect(() => {
		if (open && !wasOpen) {
			name = editor.activeLayer.name;
			opacity = Math.round(editor.activeLayer.opacity * 100);
			color = editor.activeLayer.color ?? null;
			blendMode = editor.activeLayer.blendMode ?? "normal";
			clipping = editor.activeLayer.clipping === true;
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
		if (opacity !== Math.round(active.opacity * 100)) {
			editor.setLayerOpacity(active.id, opacity / 100);
		}
		editor.setLayerColor(active.id, color);
		editor.setLayerBlendMode(active.id, blendMode);
		if (clipping !== (active.clipping === true)) {
			editor.toggleLayerClipping(active.id);
		}
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{isGroup ? "Group properties" : "Layer properties"}</Dialog.Title>
			<Dialog.Description>
				Set the name, opacity, blend mode, and timeline identity color for {layer.name}.
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

			<div class="grid gap-1.5">
				<div class="flex items-center justify-between">
					<Label for="layer-opacity">Opacity</Label>
					<span class="font-mono text-[10px] tabular-nums text-muted-foreground">
						{opacity}%
					</span>
				</div>
				<Slider
					id="layer-opacity"
					type="single"
					min={0}
					max={100}
					step={1}
					bind:value={opacity}
				/>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div class="grid gap-1.5">
					<Label>Blend mode</Label>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							class="flex h-8 items-center justify-between gap-1 rounded-md border px-2 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
						>
							<span class="truncate">{blendLabel}</span>
							<ChevronDown class="size-3.5 text-muted-foreground" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="max-h-72 w-44 overflow-y-auto">
							<DropdownMenu.Label>Blend mode</DropdownMenu.Label>
							<DropdownMenu.RadioGroup
								value={blendMode}
								onValueChange={(value) => (blendMode = value as BlendMode)}
							>
								{#each BLEND_MODES as mode (mode)}
									<DropdownMenu.RadioItem value={mode} closeOnSelect>
										{BLEND_MODE_LABELS[mode]}
									</DropdownMenu.RadioItem>
								{/each}
							</DropdownMenu.RadioGroup>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>

				<div class="grid content-between gap-1.5">
					<Label>Clipping</Label>
					<label
						class="flex h-8 cursor-pointer items-center gap-2 rounded-md text-xs text-muted-foreground"
						title="Clip this layer to the composited content below it"
					>
						<Scissors class="size-3.5" />
						Clip to below
						<Switch
							class="ml-auto"
							checked={clipping}
							onCheckedChange={(value) => (clipping = value)}
						/>
					</label>
				</div>
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
					The color shades this {isGroup ? "group's" : "layer's"} header and
					timeline track. It is never exported.
				</p>
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={apply}>Apply</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
