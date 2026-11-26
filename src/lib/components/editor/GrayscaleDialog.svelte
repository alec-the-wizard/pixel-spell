<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import CanvasTransformPreview from "$lib/components/editor/CanvasTransformPreview.svelte";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		GRAYSCALE_BIT_OPTIONS,
		grayscalePixels,
		normalizeGrayscaleBits,
		type GrayscaleBits,
	} from "$lib/editor/grayscale.js";
	import type { EffectScope } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	let bits = $state<GrayscaleBits>(8);
	let scope = $state<EffectScope>("active-cel");
	let feedback = $state("");
	let wasOpen = false;

	let targets = $derived(editor.effectTargetLayers(scope));
	let canApply = $derived(targets.length > 0);
	let levels = $derived(1 << bits);
	let targetMessage = $derived.by(() => {
		if (targets.length > 0) {
			const layers = targets.length === 1 ? "layer" : "layers";
			return `${targets.length} ${layers} · frame ${editor.activeFrame + 1}`;
		}
		return scope === "active-cel"
			? "The active cel cannot be edited. Unlock or show a paint layer, or apply to all visible layers."
			: "No visible, unlocked paint layers in this frame.";
	});

	function options() {
		return {
			bits,
			mask: editor.selection,
		};
	}

	let preview = $derived.by(() => {
		if (!open) return null;
		const current = options();
		return editor.previewEffect(scope, (pixels) =>
			grayscalePixels(pixels, editor.doc.width, editor.doc.height, current),
		);
	});

	$effect(() => {
		if (open && !wasOpen) {
			bits = 8;
			scope = "active-cel";
			feedback = "";
		}
		wasOpen = open;
	});

	function apply(): void {
		if (!canApply) return;
		const current = options();
		const changed = editor.applyEffect(
			scope,
			(pixels) =>
				grayscalePixels(pixels, editor.doc.width, editor.doc.height, current),
			"Grayscale",
		);
		if (changed > 0) {
			open = false;
			return;
		}
		feedback =
			"No pixels changed. The artwork may already be grayscale at this depth.";
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>Grayscale</Dialog.Title>
			<Dialog.Description>
				Convert the active frame to a quantized monochrome image. Luminance is
				weighted for human perception, transparency is preserved, and a selection
				limits the result.
			</Dialog.Description>
		</Dialog.Header>

		<CanvasTransformPreview
			pixels={preview}
			width={editor.doc.width}
			height={editor.doc.height}
			label="Grayscale preview"
		/>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="grid content-start gap-3">
				<div class="grid gap-1.5">
					<Label>Bit depth</Label>
					<div class="grid grid-cols-4 gap-1 rounded-lg border p-1">
						{#each GRAYSCALE_BIT_OPTIONS as option (option.id)}
							<button
								type="button"
								class={cn(
									"rounded-md px-1.5 py-1 text-[11px] transition-colors",
									bits === option.id
										? "bg-accent text-foreground"
										: "text-muted-foreground hover:bg-accent/60",
								)}
								aria-pressed={bits === option.id}
								onclick={() => (bits = normalizeGrayscaleBits(option.id))}
							>
								{option.label}
							</button>
						{/each}
					</div>
					<span class="text-[10px] text-muted-foreground">
						{levels} gray {levels === 1 ? "level" : "levels"} per color. 8-bit
						keeps smooth ramps; 1-bit reduces the frame to black and white.
					</span>
				</div>

				<div
					class="grid gap-1 rounded-lg border px-3 py-2.5 text-[10px] text-muted-foreground"
				>
					<span class="text-xs font-medium text-foreground">
						Perceptual luminance
					</span>
					<span>
						Each opaque pixel becomes 0.2126·R + 0.7152·G + 0.0722·B, then snaps
						to the nearest value on the chosen ramp.
					</span>
					<span>
						Alpha is written back unchanged, so soft edges and transparent areas
						survive the conversion.
					</span>
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
						Only the active frame is affected. Hidden layers and locked layers
						are never modified.
					</span>
					<span>
						{#if editor.hasSelection}
							A selection is active, so only selected pixels are converted.
						{:else}
							With no selection, the whole cel or layer set is processed.
						{/if}
					</span>
					<span>Applying is a single undoable step.</span>
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
			<Button onclick={apply} disabled={!canApply}>Apply grayscale</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
