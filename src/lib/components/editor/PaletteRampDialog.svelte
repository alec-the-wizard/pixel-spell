<script lang="ts">
	import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { MAX_PALETTE_COLORS } from "$lib/editor/palette.js";
	import {
		MAX_RAMP_STEPS,
		MIN_RAMP_STEPS,
		generatePaletteRamp,
		type RampSpace,
	} from "$lib/editor/palette-ramp.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	const SPACES: { id: RampSpace; label: string; hint: string }[] = [
		{ id: "rgb", label: "RGB", hint: "Classic sRGB channel blend" },
		{ id: "hsv", label: "HSV", hint: "Shortest hue arc" },
		{ id: "oklab", label: "OKLab", hint: "Perceptually even steps" },
	];

	let startColor = $state(editor.primaryColor);
	let endColor = $state(editor.secondaryColor);
	let stepsText = $state("6");
	let space = $state<RampSpace>("rgb");
	let lockAfter = $state(false);
	let wasOpen = false;

	let steps = $derived.by(() => {
		const value = Math.round(Number(stepsText));
		if (!Number.isFinite(value)) return MIN_RAMP_STEPS;
		return Math.max(MIN_RAMP_STEPS, Math.min(MAX_RAMP_STEPS, value));
	});
	let ramp = $derived(generatePaletteRamp(startColor, endColor, steps, space));
	let palette = $derived(editor.activePalette);
	let capacity = $derived(
		Math.max(0, MAX_PALETTE_COLORS - palette.colors.length),
	);
	let additions = $derived.by(() => {
		const seen = new Set(palette.colors);
		const result: string[] = [];
		for (const color of ramp) {
			if (seen.has(color)) continue;
			seen.add(color);
			result.push(color);
		}
		return result;
	});
	let addedColors = $derived(additions.slice(0, capacity));
	let canApply = $derived(editor.paletteEditable && addedColors.length > 0);
	let stepCount = $derived(ramp.length);
	let full = $derived(capacity === 0);
	let unavailableMessage = $derived.by(() => {
		if (palette.builtin) {
			return "The Default palette is read-only. Select or create a palette to generate ramps.";
		}
		if (editor.paletteLocked) {
			return "The palette is locked. Unlock it to generate ramps.";
		}
		if (full) return "This palette is full.";
		return "";
	});

	$effect(() => {
		if (open && !wasOpen) {
			const range = editor.paletteSelectionRange;
			if (range && range.count === 2) {
				startColor = palette.colors[range.start] ?? editor.primaryColor;
				endColor = palette.colors[range.end] ?? editor.secondaryColor;
			} else {
				startColor = editor.primaryColor;
				endColor = editor.secondaryColor;
			}
			stepsText = "6";
			space = "rgb";
			lockAfter = false;
		}
		wasOpen = open;
	});

	function swapEndpoints(): void {
		const next = startColor;
		startColor = endColor;
		endColor = next;
	}

	function normalizeStepText(): void {
		stepsText = String(steps);
	}

	function apply(): void {
		if (!canApply) return;
		editor.addPaletteRamp(addedColors, lockAfter);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Generate palette ramp</Dialog.Title>
			<Dialog.Description>
				Add a gradient of colors to the active palette. Every generated color is
				appended in ramp order.
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-4">
			<div class="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
				<div class="grid gap-1.5">
					<Label for="ramp-start">From</Label>
					<div class="flex items-center gap-2">
						<label
							class="relative block size-9 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
							title="Choose ramp start color"
						>
							<span class="absolute inset-0" style:background={startColor}></span>
							<input
								id="ramp-start"
								type="color"
								bind:value={startColor}
								class="absolute inset-0 size-full cursor-pointer opacity-0"
								aria-label="Ramp start color"
							/>
						</label>
						<span class="truncate font-mono text-[11px] uppercase text-muted-foreground">
							{startColor}
						</span>
					</div>
				</div>

				<Button
					variant="ghost"
					size="icon-xs"
					class="mb-1 rounded-full text-muted-foreground"
					onclick={swapEndpoints}
					title="Swap ramp endpoints"
					aria-label="Swap ramp endpoints"
				>
					<ArrowLeftRight class="size-3.5" />
				</Button>

				<div class="grid gap-1.5">
					<Label for="ramp-end">To</Label>
					<div class="flex items-center gap-2">
						<label
							class="relative block size-9 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
							title="Choose ramp end color"
						>
							<span class="absolute inset-0" style:background={endColor}></span>
							<input
								id="ramp-end"
								type="color"
								bind:value={endColor}
								class="absolute inset-0 size-full cursor-pointer opacity-0"
								aria-label="Ramp end color"
							/>
						</label>
						<span class="truncate font-mono text-[11px] uppercase text-muted-foreground">
							{endColor}
						</span>
					</div>
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-[7rem_1fr]">
				<div class="grid gap-1.5">
					<Label for="ramp-steps">Steps</Label>
					<Input
						id="ramp-steps"
						type="number"
						min={MIN_RAMP_STEPS}
						max={MAX_RAMP_STEPS}
						step={1}
						value={stepsText}
						oninput={(event) => (stepsText = event.currentTarget.value)}
						onblur={normalizeStepText}
						class="tabular-nums"
					/>
					<span class="text-[10px] text-muted-foreground">
						{MIN_RAMP_STEPS}–{MAX_RAMP_STEPS} colors, endpoints included
					</span>
				</div>

				<div class="grid gap-1.5">
					<Label>Blend</Label>
					<div class="grid grid-cols-3 gap-1 rounded-lg border p-1">
						{#each SPACES as option (option.id)}
							<button
								type="button"
								class={cn(
									"rounded-md px-2 py-1 text-[11px] transition-colors",
									space === option.id
										? "bg-accent text-foreground"
										: "text-muted-foreground hover:bg-accent/60",
								)}
								title={option.hint}
								aria-pressed={space === option.id}
								onclick={() => (space = option.id)}
							>
								{option.label}
							</button>
						{/each}
					</div>
					<span class="text-[10px] text-muted-foreground">
						{SPACES.find((option) => option.id === space)?.hint}
					</span>
				</div>
			</div>

			<div class="grid gap-1.5">
				<div class="flex items-center justify-between">
					<Label>Preview</Label>
					<span class="text-[10px] tabular-nums text-muted-foreground">
						{stepCount} colors
					</span>
				</div>
				<div class="grid grid-cols-8 gap-1" aria-label="Ramp preview">
					{#each ramp as color, index (index)}
						<span
							class="aspect-square rounded-[4px] ring-1 ring-black/10"
							style:background={color}
							title={`${color} — step ${index + 1}`}
						></span>
					{/each}
				</div>
			</div>

			<label class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
				<span class="grid gap-0.5">
					<span class="text-xs font-medium">Lock palette after generating</span>
					<span class="text-[10px] text-muted-foreground">
						Keeps the ramp fixed for indexed-style work.
					</span>
				</span>
				<Switch bind:checked={lockAfter} />
			</label>

			<div class="grid gap-1 text-[10px] text-muted-foreground">
				{#if unavailableMessage}
					<p class="text-destructive">{unavailableMessage}</p>
				{:else if additions.length === 0}
					<p>
						The ramp colors are already in “{palette.name}”.
					</p>
				{:else}
					<p>
						Adds {addedColors.length}
						{addedColors.length === 1 ? "new color" : "new colors"} to
						“{palette.name}”. Duplicates are skipped, and the palette switches
						to its add/import order.
					</p>
					{#if additions.length > addedColors.length}
						<p>
							{additions.length - addedColors.length} colors do not fit within
							the {MAX_PALETTE_COLORS}-color limit.
						</p>
					{/if}
				{/if}
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={apply} disabled={!canApply}>
				Add {addedColors.length}
				{addedColors.length === 1 ? "color" : "colors"}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
