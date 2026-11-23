<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import CanvasTransformPreview from "$lib/components/editor/CanvasTransformPreview.svelte";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { packColor } from "$lib/editor/color.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		MAX_EFFECT_THICKNESS,
		MIN_EFFECT_THICKNESS,
		outlinePixels,
		type OutlinePlacement,
	} from "$lib/editor/filters.js";
	import type { EffectScope } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	const PLACEMENTS: {
		id: OutlinePlacement;
		label: string;
		hint: string;
	}[] = [
		{
			id: "outside",
			label: "Outside",
			hint: "Grow new pixels around the sprite silhouette.",
		},
		{
			id: "inside",
			label: "Inside",
			hint: "Recolor the sprite's own edge pixels.",
		},
	];

	let thicknessText = $state("1");
	let color = $state(editor.primaryColor);
	let placement = $state<OutlinePlacement>("outside");
	let diagonals = $state(true);
	let scope = $state<EffectScope>("active-cel");
	let feedback = $state("");
	let wasOpen = false;

	let thickness = $derived.by(() => {
		const value = Math.round(Number(thicknessText));
		if (!Number.isFinite(value)) return MIN_EFFECT_THICKNESS;
		return Math.max(
			MIN_EFFECT_THICKNESS,
			Math.min(MAX_EFFECT_THICKNESS, value),
		);
	});
	let targets = $derived(editor.effectTargetLayers(scope));
	let canApply = $derived(targets.length > 0);
	let targetMessage = $derived.by(() => {
		if (targets.length > 0) {
			const layers = targets.length === 1 ? "layer" : "layers";
			return `${targets.length} ${layers} · frame ${editor.activeFrame + 1}`;
		}
		return scope === "active-cel"
			? "The active cel cannot be edited. Unlock or show a paint layer, or apply to all visible layers."
			: "No visible, unlocked paint layers in this frame.";
	});
	let preview = $derived.by(() => {
		if (!open) return null;
		const mask = editor.selection;
		const options = {
			thickness,
			color: packColor(color),
			placement,
			diagonals,
			mask,
		};
		return editor.previewEffect(scope, (pixels) =>
			outlinePixels(pixels, editor.doc.width, editor.doc.height, options),
		);
	});

	$effect(() => {
		if (open && !wasOpen) {
			thicknessText = "1";
			color = editor.primaryColor;
			placement = "outside";
			diagonals = true;
			scope = "active-cel";
			feedback = "";
		}
		wasOpen = open;
	});

	function normalizeThickness(): void {
		thicknessText = String(thickness);
	}

	function apply(): void {
		if (!canApply) return;
		const mask = editor.selection;
		const options = {
			thickness,
			color: packColor(color),
			placement,
			diagonals,
			mask,
		};
		const changed = editor.applyEffect(scope, (pixels) =>
			outlinePixels(pixels, editor.doc.width, editor.doc.height, options),
		);
		if (changed > 0) {
			open = false;
			return;
		}
		feedback =
			"No pixels changed. Try a thicker outline, the other placement, or a different scope.";
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>Outline</Dialog.Title>
			<Dialog.Description>
				Grow a hard pixel border around the artwork. The preview updates as you
				change the width, placement, and color.
			</Dialog.Description>
		</Dialog.Header>

		<CanvasTransformPreview
			pixels={preview}
			width={editor.doc.width}
			height={editor.doc.height}
			label="Outline preview"
		/>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="grid content-start gap-3">
				<div class="grid gap-1.5">
					<div class="flex items-center justify-between gap-2">
						<Label for="outline-thickness">Thickness</Label>
						<span class="text-[10px] tabular-nums text-muted-foreground">
							{thickness} px
						</span>
					</div>
					<Input
						id="outline-thickness"
						type="number"
						min={MIN_EFFECT_THICKNESS}
						max={MAX_EFFECT_THICKNESS}
						step={1}
						value={thicknessText}
						oninput={(event) => (thicknessText = event.currentTarget.value)}
						onblur={normalizeThickness}
						class="tabular-nums"
					/>
					<span class="text-[10px] text-muted-foreground">
						{MIN_EFFECT_THICKNESS}–{MAX_EFFECT_THICKNESS} pixels, measured from
						the sprite edge.
					</span>
				</div>

				<div class="grid gap-1.5">
					<Label>Placement</Label>
					<div class="grid grid-cols-2 gap-1 rounded-lg border p-1">
						{#each PLACEMENTS as option (option.id)}
							<button
								type="button"
								class={cn(
									"rounded-md px-2 py-1 text-[11px] transition-colors",
									placement === option.id
										? "bg-accent text-foreground"
										: "text-muted-foreground hover:bg-accent/60",
								)}
								title={option.hint}
								aria-pressed={placement === option.id}
								onclick={() => (placement = option.id)}
							>
								{option.label}
							</button>
						{/each}
					</div>
					<span class="text-[10px] text-muted-foreground">
						{PLACEMENTS.find((option) => option.id === placement)?.hint}
					</span>
				</div>

				<div class="grid gap-1.5">
					<Label for="outline-color">Color</Label>
					<div class="flex items-center gap-2">
						<label
							class="relative block size-8 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
							title="Choose outline color"
						>
							<span class="absolute inset-0" style:background={color}></span>
							<input
								id="outline-color"
								type="color"
								bind:value={color}
								class="absolute inset-0 size-full cursor-pointer opacity-0"
								aria-label="Outline color"
							/>
						</label>
						<span class="font-mono text-[11px] uppercase text-muted-foreground">
							{color}
						</span>
					</div>
				</div>

				<label
					class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
				>
					<span class="grid gap-0.5">
						<span class="text-xs font-medium">Diagonal corners</span>
						<span class="text-[10px] text-muted-foreground">
							Include diagonal neighbors for a softer, rounded edge.
						</span>
					</span>
					<Switch bind:checked={diagonals} />
				</label>
			</div>

			<div class="grid content-start gap-3">
				<div class="grid gap-1.5">
					<Label>Apply to</Label>
					<div class="grid grid-cols-2 gap-1 rounded-lg border p-1">
						<button
							type="button"
							class={cn(
								"rounded-md px-2 py-1 text-[11px] transition-colors",
								scope === "active-cel"
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/60",
							)}
							aria-pressed={scope === "active-cel"}
							onclick={() => (scope = "active-cel")}
						>
							Active cel
						</button>
						<button
							type="button"
							class={cn(
								"rounded-md px-2 py-1 text-[11px] transition-colors",
								scope === "visible-layers"
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/60",
							)}
							aria-pressed={scope === "visible-layers"}
							onclick={() => (scope = "visible-layers")}
						>
							All visible layers
						</button>
					</div>
					<span
						class={cn(
							"text-[10px]",
							canApply ? "text-muted-foreground" : "text-destructive",
						)}
					>
						{targetMessage}
					</span>
				</div>

				<div
					class="grid gap-1 rounded-lg border px-3 py-2.5 text-[10px] text-muted-foreground"
				>
					<span class="text-xs font-medium text-foreground">How it works</span>
					<span>
						Only the active frame is affected. Reference layers, hidden layers,
						and locked layers are never modified.
					</span>
					<span>
						{#if editor.hasSelection}
							A selection is active, so only selected pixels can receive the
							outline.
						{:else}
							With no selection, the outline can use transparent pixels anywhere
							on the canvas.
						{/if}
					</span>
					<span>Applying the effect is a single undoable step.</span>
				</div>

				{#if feedback}
					<p class="text-[11px] text-muted-foreground" aria-live="polite">
						{feedback}
					</p>
				{/if}
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={apply} disabled={!canApply}>Apply outline</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
