<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import CanvasTransformPreview from "$lib/components/editor/CanvasTransformPreview.svelte";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { packColor } from "$lib/editor/color.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		MAX_EFFECT_THICKNESS,
		MAX_SHADOW_OFFSET,
		dropShadowPixels,
	} from "$lib/editor/filters.js";
	import type { EffectScope } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	let offsetXText = $state("1");
	let offsetYText = $state("1");
	let spreadText = $state("0");
	let color = $state("#000000");
	let opacity = $state(50);
	let scope = $state<EffectScope>("active-cel");
	let feedback = $state("");
	let wasOpen = false;

	let offsetX = $derived.by(() => {
		const value = Math.round(Number(offsetXText));
		if (!Number.isFinite(value)) return 1;
		return Math.max(-MAX_SHADOW_OFFSET, Math.min(MAX_SHADOW_OFFSET, value));
	});
	let offsetY = $derived.by(() => {
		const value = Math.round(Number(offsetYText));
		if (!Number.isFinite(value)) return 1;
		return Math.max(-MAX_SHADOW_OFFSET, Math.min(MAX_SHADOW_OFFSET, value));
	});
	let spread = $derived.by(() => {
		const value = Math.round(Number(spreadText));
		if (!Number.isFinite(value)) return 0;
		return Math.max(0, Math.min(MAX_EFFECT_THICKNESS, value));
	});
	let shadowColor = $derived(
		packColor(color, Math.round((opacity / 100) * 255)),
	);
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
	let zeroOffset = $derived(offsetX === 0 && offsetY === 0 && spread === 0);
	let preview = $derived.by(() => {
		if (!open) return null;
		const mask = editor.selection;
		const options = {
			offsetX,
			offsetY,
			spread,
			color: shadowColor,
			mask,
		};
		return editor.previewEffect(scope, (pixels) =>
			dropShadowPixels(pixels, editor.doc.width, editor.doc.height, options),
		);
	});

	$effect(() => {
		if (open && !wasOpen) {
			offsetXText = "1";
			offsetYText = "1";
			spreadText = "0";
			color = "#000000";
			opacity = 50;
			scope = "active-cel";
			feedback = "";
		}
		wasOpen = open;
	});

	function normalizeOffsets(): void {
		offsetXText = String(offsetX);
		offsetYText = String(offsetY);
		spreadText = String(spread);
	}

	function changeOpacity(value: number | number[]): void {
		const next = Array.isArray(value) ? value[0] : value;
		if (next === undefined || !Number.isFinite(next)) return;
		opacity = Math.max(0, Math.min(100, Math.round(next)));
	}

	function apply(): void {
		if (!canApply) return;
		const mask = editor.selection;
		const options = {
			offsetX,
			offsetY,
			spread,
			color: shadowColor,
			mask,
		};
		const changed = editor.applyEffect(scope, (pixels) =>
			dropShadowPixels(pixels, editor.doc.width, editor.doc.height, options),
		);
		if (changed > 0) {
			open = false;
			return;
		}
		feedback =
			"No pixels changed. Move the offset away from zero, add spread, or choose a different scope.";
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>Drop shadow</Dialog.Title>
			<Dialog.Description>
				Place a flat copy of the silhouette behind the artwork. The shadow only
				fills transparent pixels, so the sprite itself stays untouched.
			</Dialog.Description>
		</Dialog.Header>

		<CanvasTransformPreview
			pixels={preview}
			width={editor.doc.width}
			height={editor.doc.height}
			label="Drop shadow preview"
		/>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="grid content-start gap-3">
				<div class="grid gap-1.5">
					<Label>Offset</Label>
					<div class="grid grid-cols-2 gap-2">
						<div class="grid gap-1">
							<Label for="shadow-offset-x" class="text-[10px] font-normal text-muted-foreground">
								X
							</Label>
							<Input
								id="shadow-offset-x"
								type="number"
								min={-MAX_SHADOW_OFFSET}
								max={MAX_SHADOW_OFFSET}
								step={1}
								value={offsetXText}
								oninput={(event) => (offsetXText = event.currentTarget.value)}
								onblur={normalizeOffsets}
								class="tabular-nums"
							/>
						</div>
						<div class="grid gap-1">
							<Label for="shadow-offset-y" class="text-[10px] font-normal text-muted-foreground">
								Y
							</Label>
							<Input
								id="shadow-offset-y"
								type="number"
								min={-MAX_SHADOW_OFFSET}
								max={MAX_SHADOW_OFFSET}
								step={1}
								value={offsetYText}
								oninput={(event) => (offsetYText = event.currentTarget.value)}
								onblur={normalizeOffsets}
								class="tabular-nums"
							/>
						</div>
					</div>
					<span class="text-[10px] text-muted-foreground">
						Positive X moves right, positive Y moves down. Range ±
						{MAX_SHADOW_OFFSET} px.
					</span>
				</div>

				<div class="grid gap-1.5">
					<div class="flex items-center justify-between gap-2">
						<Label for="shadow-spread">Spread</Label>
						<span class="text-[10px] tabular-nums text-muted-foreground">
							{spread} px
						</span>
					</div>
					<Input
						id="shadow-spread"
						type="number"
						min={0}
						max={MAX_EFFECT_THICKNESS}
						step={1}
						value={spreadText}
						oninput={(event) => (spreadText = event.currentTarget.value)}
						onblur={normalizeOffsets}
						class="tabular-nums"
					/>
					<span class="text-[10px] text-muted-foreground">
						Thickens the shadow before it is offset.
					</span>
				</div>

				<div class="grid gap-1.5">
					<Label for="shadow-color">Color</Label>
					<div class="flex items-center gap-2">
						<label
							class="relative block size-8 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
							title="Choose shadow color"
						>
							<span class="absolute inset-0" style:background={color}></span>
							<input
								id="shadow-color"
								type="color"
								bind:value={color}
								class="absolute inset-0 size-full cursor-pointer opacity-0"
								aria-label="Shadow color"
							/>
						</label>
						<span class="font-mono text-[11px] uppercase text-muted-foreground">
							{color}
						</span>
					</div>
				</div>

				<div class="grid gap-1.5">
					<div class="flex items-center justify-between gap-2">
						<Label>Opacity</Label>
						<span class="text-[10px] tabular-nums text-muted-foreground">
							{opacity}%
						</span>
					</div>
					<Slider
						id="shadow-opacity"
						type="single"
						min={0}
						max={100}
						step={1}
						value={opacity}
						onValueChange={changeOpacity}
						aria-label="Shadow opacity"
					/>
				</div>
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
							A selection is active, so the shadow is clipped to the selected
							pixels.
						{:else}
							With no selection, the shadow may fall anywhere inside the canvas.
						{/if}
					</span>
					<span>Applying the effect is a single undoable step.</span>
				</div>

				{#if zeroOffset}
					<p class="text-[11px] text-muted-foreground">
						Offset and spread are both zero, so the shadow would sit directly
						behind the sprite and stay invisible.
					</p>
				{/if}
				{#if feedback}
					<p class="text-[11px] text-muted-foreground" aria-live="polite">
						{feedback}
					</p>
				{/if}
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={apply} disabled={!canApply}>Apply shadow</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
