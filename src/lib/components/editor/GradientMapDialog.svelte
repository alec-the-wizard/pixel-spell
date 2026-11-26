<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import CanvasTransformPreview from "$lib/components/editor/CanvasTransformPreview.svelte";
	import GradientMapEditor from "$lib/components/editor/GradientMapEditor.svelte";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		GRADIENT_MAP_SOURCES,
		defaultGradientStops,
		gradientMapPixels,
		type GradientMapSource,
		type GradientMapSpace,
	} from "$lib/editor/gradient-map.js";
	import type { EffectScope, GradientStop } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	let stops = $state<GradientStop[]>(defaultGradientStops());
	let space = $state<GradientMapSpace>("rgb");
	let source = $state<GradientMapSource>("luminance");
	let invert = $state(false);
	let scope = $state<EffectScope>("active-cel");
	let feedback = $state("");
	let wasOpen = false;

	let targets = $derived(editor.effectTargetLayers(scope));
	let canApply = $derived(targets.length > 0);
	let sourceHint = $derived(
		GRADIENT_MAP_SOURCES.find((option) => option.id === source)?.hint ?? "",
	);
	let targetMessage = $derived.by(() => {
		if (targets.length > 0) {
			const layers = targets.length === 1 ? "layer" : "layers";
			return `${targets.length} ${layers} · frame ${editor.activeFrame + 1}`;
		}
		return scope === "active-cel"
			? "The active cel cannot be edited. Unlock or show a paint layer, or apply to all visible layers."
			: "No visible, unlocked paint layers in this frame.";
	});

	function apply(): void {
		if (!canApply) return;
		const options = {
			stops,
			space,
			source,
			invert,
			mask: editor.selection,
		};
		const changed = editor.applyEffect(
			scope,
			(pixels) =>
				gradientMapPixels(pixels, editor.doc.width, editor.doc.height, options),
			"Gradient map",
		);
		if (changed > 0) {
			open = false;
			return;
		}
		feedback =
			"No pixels changed. Try another gradient, brightness source, or scope.";
	}

	let preview = $derived.by(() => {
		if (!open) return null;
		const options = {
			stops,
			space,
			source,
			invert,
			mask: editor.selection,
		};
		return editor.previewEffect(scope, (pixels) =>
			gradientMapPixels(pixels, editor.doc.width, editor.doc.height, options),
		);
	});

	$effect(() => {
		if (open && !wasOpen) {
			stops = defaultGradientStops();
			space = "rgb";
			source = "luminance";
			invert = false;
			scope = "active-cel";
			feedback = "";
		}
		wasOpen = open;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>Gradient map</Dialog.Title>
			<Dialog.Description>
				Replace every opaque pixel's color with the gradient color that matches
				its brightness. Alpha is preserved, so shapes, transparency, and soft
				edges stay intact.
			</Dialog.Description>
		</Dialog.Header>

		<CanvasTransformPreview
			pixels={preview}
			width={editor.doc.width}
			height={editor.doc.height}
			label="Gradient map preview"
		/>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="grid content-start gap-3">
				<GradientMapEditor bind:stops bind:space />

				<div class="grid gap-1.5">
					<Label>Brightness</Label>
					<div class="grid grid-cols-2 gap-1 rounded-lg border p-1">
						{#each GRADIENT_MAP_SOURCES as option (option.id)}
							<button
								type="button"
								class={cn(
									"rounded-md px-2 py-1 text-[11px] transition-colors",
									source === option.id
										? "bg-accent text-foreground"
										: "text-muted-foreground hover:bg-accent/60",
								)}
								title={option.hint}
								aria-pressed={source === option.id}
								onclick={() => (source = option.id)}
							>
								{option.label}
							</button>
						{/each}
					</div>
					<span class="text-[10px] text-muted-foreground">{sourceHint}</span>
				</div>

				<label
					class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
				>
					<span class="grid gap-0.5">
						<span class="text-xs font-medium">Invert brightness</span>
						<span class="text-[10px] text-muted-foreground">
							Use the low end of the gradient for bright pixels.
						</span>
					</span>
					<Switch bind:checked={invert} />
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
						Dark pixels take colors from the left side of the gradient; bright
						pixels take colors from the right.
					</span>
					<span>
						Hard stops are possible by placing two stops at the same position.
						Stops can cross while dragging; the gradient stays sorted.
					</span>
					<span>
						Only the active frame is affected. Hidden layers and locked layers
						are never modified.
					</span>
					<span>
						{#if editor.hasSelection}
							A selection is active, so only selected pixels are mapped.
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
			<Button onclick={apply} disabled={!canApply}>Apply gradient map</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
