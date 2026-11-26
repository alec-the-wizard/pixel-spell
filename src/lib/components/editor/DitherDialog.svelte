<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import CanvasTransformPreview from "$lib/components/editor/CanvasTransformPreview.svelte";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { packColor } from "$lib/editor/color.js";
	import {
		BAYER_MATRIX_OPTIONS,
		type BayerMatrixId,
	} from "$lib/editor/dither.js";
	import {
		DITHER_METHODS,
		DITHER_TARGETS,
		ditherPixels,
		type DitherMethod,
		type DitherTarget,
	} from "$lib/editor/dither-filter.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import type { EffectScope } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	let method = $state<DitherMethod>("ordered");
	let matrix = $state<BayerMatrixId>("bayer4");
	let target = $state<DitherTarget>("two-color");
	let lightColor = $state(editor.secondaryColor);
	let darkColor = $state(editor.primaryColor);
	let serpentine = $state(true);
	let scope = $state<EffectScope>("active-cel");
	let feedback = $state("");
	let wasOpen = false;

	let paletteColors = $derived(
		editor.activePalette.colors.map((color) => packColor(color)),
	);
	let paletteAvailable = $derived(paletteColors.length >= 2);
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

	function options() {
		return {
			method,
			matrix,
			diffusion: "floyd-steinberg" as const,
			serpentine,
			target: target === "palette" && paletteAvailable ? target : ("two-color" as const),
			lightColor: packColor(lightColor),
			darkColor: packColor(darkColor),
			palette: paletteColors,
			mask: editor.selection,
		};
	}

	let preview = $derived.by(() => {
		if (!open) return null;
		const current = options();
		return editor.previewEffect(scope, (pixels) =>
			ditherPixels(pixels, editor.doc.width, editor.doc.height, current),
		);
	});

	$effect(() => {
		if (open && !wasOpen) {
			method = "ordered";
			matrix = "bayer4";
			target = "two-color";
			lightColor = editor.secondaryColor;
			darkColor = editor.primaryColor;
			serpentine = true;
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
				ditherPixels(pixels, editor.doc.width, editor.doc.height, current),
			"Dither",
		);
		if (changed > 0) {
			open = false;
			return;
		}
		feedback =
			"No pixels changed. Try a different method, matrix, target, or scope.";
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>Dither</Dialog.Title>
			<Dialog.Description>
				Convert the active frame to a two-color or palette-limited image with
				ordered or Floyd–Steinberg dithering. Transparent pixels stay transparent,
				and a selection limits the result.
			</Dialog.Description>
		</Dialog.Header>

		<CanvasTransformPreview
			pixels={preview}
			width={editor.doc.width}
			height={editor.doc.height}
			label="Dither preview"
		/>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="grid content-start gap-3">
				<div class="grid gap-1.5">
					<Label>Method</Label>
					<div class="grid grid-cols-2 gap-1 rounded-lg border p-1">
						{#each DITHER_METHODS as option (option.id)}
							<button
								type="button"
								class={cn(
									"rounded-md px-2 py-1 text-[11px] transition-colors",
									method === option.id
										? "bg-accent text-foreground"
										: "text-muted-foreground hover:bg-accent/60",
								)}
								aria-pressed={method === option.id}
								onclick={() => (method = option.id)}
							>
								{option.label}
							</button>
						{/each}
					</div>
				</div>

				{#if method === "ordered"}
					<div class="grid gap-1.5">
						<Label>Ordered matrix</Label>
						<div class="grid grid-cols-3 gap-1 rounded-lg border p-1">
							{#each BAYER_MATRIX_OPTIONS as option (option.id)}
								<button
									type="button"
									class={cn(
										"rounded-md px-1.5 py-1 text-[10px] transition-colors",
										matrix === option.id
											? "bg-accent text-foreground"
											: "text-muted-foreground hover:bg-accent/60",
									)}
									aria-pressed={matrix === option.id}
									onclick={() => (matrix = option.id)}
								>
									{option.label}
								</button>
							{/each}
						</div>
					</div>
				{:else}
					<label
						class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
					>
						<span class="grid gap-0.5">
							<span class="text-xs font-medium">Serpentine scan</span>
							<span class="text-[10px] text-muted-foreground">
								Alternate row direction to break up directional artifacts.
							</span>
						</span>
						<Switch bind:checked={serpentine} />
					</label>
					<p class="text-[10px] leading-relaxed text-muted-foreground">
						Floyd–Steinberg diffuses quantization error into neighboring pixels.
					</p>
				{/if}

				<div class="grid gap-1.5">
					<Label>Target</Label>
					<div class="grid grid-cols-2 gap-1 rounded-lg border p-1">
						{#each DITHER_TARGETS as option (option.id)}
							<button
								type="button"
								disabled={option.id === "palette" && !paletteAvailable}
								class={cn(
									"rounded-md px-2 py-1 text-[11px] transition-colors disabled:opacity-40",
									target === option.id
										? "bg-accent text-foreground"
										: "text-muted-foreground hover:bg-accent/60",
								)}
								aria-pressed={target === option.id}
								onclick={() => (target = option.id)}
							>
								{option.label}
							</button>
						{/each}
					</div>
					<span class="text-[10px] text-muted-foreground">
						{#if target === "palette"}
							{paletteColors.length} colors in the active palette.
						{:else}
							The two swatches below define the output colors.
						{/if}
					</span>
				</div>

				{#if target === "two-color"}
					<div class="grid grid-cols-2 gap-3">
						<div class="grid gap-1.5">
							<Label for="dither-light">Light</Label>
							<div class="flex items-center gap-2">
								<label
									class="relative block size-8 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
									title="Choose dither light color"
								>
									<span class="absolute inset-0" style:background={lightColor}></span>
									<input
										id="dither-light"
										type="color"
										bind:value={lightColor}
										class="absolute inset-0 size-full cursor-pointer opacity-0"
										aria-label="Dither light color"
									/>
								</label>
								<span class="font-mono text-[11px] uppercase text-muted-foreground">
									{lightColor}
								</span>
							</div>
						</div>
						<div class="grid gap-1.5">
							<Label for="dither-dark">Dark</Label>
							<div class="flex items-center gap-2">
								<label
									class="relative block size-8 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
									title="Choose dither dark color"
								>
									<span class="absolute inset-0" style:background={darkColor}></span>
									<input
										id="dither-dark"
										type="color"
										bind:value={darkColor}
										class="absolute inset-0 size-full cursor-pointer opacity-0"
										aria-label="Dither dark color"
									/>
								</label>
								<span class="font-mono text-[11px] uppercase text-muted-foreground">
									{darkColor}
								</span>
							</div>
						</div>
					</div>
				{/if}
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
							A selection is active, so only selected pixels are dithered.
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
			<Button onclick={apply} disabled={!canApply}>Apply dither</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
