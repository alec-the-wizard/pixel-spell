<script lang="ts">
	import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
	import { Button } from "$lib/components/ui/button/index.js";
	import CanvasTransformPreview from "$lib/components/editor/CanvasTransformPreview.svelte";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { packColor } from "$lib/editor/color.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		countColorReplacement,
		replaceColorPixels,
	} from "$lib/editor/filters.js";
	import type { EffectScope } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	let fromColor = $state(editor.primaryColor);
	let toColor = $state(editor.secondaryColor);
	let toleranceText = $state("0");
	let preserveAlpha = $state(true);
	let scope = $state<EffectScope>("active-cel");
	let feedback = $state("");
	let wasOpen = false;

	let tolerance = $derived.by(() => {
		const value = Math.round(Number(toleranceText));
		if (!Number.isFinite(value)) return 0;
		return Math.max(0, Math.min(100, value));
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
	let matchCount = $derived.by(() => {
		if (!open) return 0;
		const mask = editor.selection;
		const options = {
			from: packColor(fromColor),
			to: packColor(toColor),
			tolerance,
			preserveAlpha,
			mask,
		};
		let total = 0;
		for (const layer of targets) {
			const cel = layer.cels[editor.activeFrame];
			if (cel) {
				total += countColorReplacement(
					cel,
					editor.doc.width,
					editor.doc.height,
					options,
				);
			}
		}
		return total;
	});
	let preview = $derived.by(() => {
		if (!open) return null;
		const mask = editor.selection;
		const options = {
			from: packColor(fromColor),
			to: packColor(toColor),
			tolerance,
			preserveAlpha,
			mask,
		};
		return editor.previewEffect(scope, (pixels) =>
			replaceColorPixels(pixels, editor.doc.width, editor.doc.height, options),
		);
	});

	$effect(() => {
		if (open && !wasOpen) {
			fromColor = editor.primaryColor;
			toColor = editor.secondaryColor;
			toleranceText = "0";
			preserveAlpha = true;
			scope = "active-cel";
			feedback = "";
		}
		wasOpen = open;
	});

	function swapColors(): void {
		const next = fromColor;
		fromColor = toColor;
		toColor = next;
	}

	function normalizeTolerance(): void {
		toleranceText = String(tolerance);
	}

	function changeTolerance(value: number): void {
		if (!Number.isFinite(value)) return;
		toleranceText = String(Math.max(0, Math.min(100, Math.round(value))));
	}

	function apply(): void {
		if (!canApply) return;
		const mask = editor.selection;
		const options = {
			from: packColor(fromColor),
			to: packColor(toColor),
			tolerance,
			preserveAlpha,
			mask,
		};
		const changed = editor.applyEffect(
			scope,
			(pixels) =>
				replaceColorPixels(
					pixels,
					editor.doc.width,
					editor.doc.height,
					options,
				),
			"Color replace",
		);
		if (changed > 0) {
			open = false;
			return;
		}
		feedback =
			"No pixels changed. Widen the tolerance, pick a color that is used, or choose a different scope.";
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>Color replace</Dialog.Title>
			<Dialog.Description>
				Swap one color for another across the active frame. A tolerance widens
				the match to nearby shades, and pixel alpha can be preserved.
			</Dialog.Description>
		</Dialog.Header>

		<CanvasTransformPreview
			pixels={preview}
			width={editor.doc.width}
			height={editor.doc.height}
			label="Color replace preview"
		/>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="grid content-start gap-3">
				<div class="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
					<div class="grid gap-1.5">
						<Label for="replace-from">Replace</Label>
						<div class="flex items-center gap-2">
							<label
								class="relative block size-8 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
								title="Choose the color to replace"
							>
								<span class="absolute inset-0" style:background={fromColor}></span>
								<input
									id="replace-from"
									type="color"
									bind:value={fromColor}
									class="absolute inset-0 size-full cursor-pointer opacity-0"
									aria-label="Color to replace"
								/>
							</label>
							<span class="truncate font-mono text-[11px] uppercase text-muted-foreground">
								{fromColor}
							</span>
						</div>
					</div>

					<Button
						variant="ghost"
						size="icon-xs"
						class="mb-1 rounded-full text-muted-foreground"
						onclick={swapColors}
						title="Swap the replaced and replacement colors"
						aria-label="Swap colors"
					>
						<ArrowLeftRight class="size-3.5" />
					</Button>

					<div class="grid gap-1.5">
						<Label for="replace-to">With</Label>
						<div class="flex items-center gap-2">
							<label
								class="relative block size-8 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
								title="Choose the replacement color"
							>
								<span class="absolute inset-0" style:background={toColor}></span>
								<input
									id="replace-to"
									type="color"
									bind:value={toColor}
									class="absolute inset-0 size-full cursor-pointer opacity-0"
									aria-label="Replacement color"
								/>
							</label>
							<span class="truncate font-mono text-[11px] uppercase text-muted-foreground">
								{toColor}
							</span>
						</div>
					</div>
				</div>

				<div class="grid gap-1.5">
					<div class="flex items-center justify-between gap-2">
						<Label>Tolerance</Label>
						<span class="text-[10px] tabular-nums text-muted-foreground">
							{tolerance}%
						</span>
					</div>
					<Slider
						id="replace-tolerance"
						type="single"
						min={0}
						max={100}
						step={1}
						value={tolerance}
						onValueChange={changeTolerance}
						aria-label="Color match tolerance"
					/>
					<div class="flex items-center gap-2">
						<Input
							type="number"
							min={0}
							max={100}
							step={1}
							value={toleranceText}
							oninput={(event) => (toleranceText = event.currentTarget.value)}
							onblur={normalizeTolerance}
							class="h-8 w-20 tabular-nums"
							aria-label="Color match tolerance percent"
						/>
						<span class="text-[10px] text-muted-foreground">
							0% matches exactly; higher values also replace nearby shades.
						</span>
					</div>
				</div>

				<label
					class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
				>
					<span class="grid gap-0.5">
						<span class="text-xs font-medium">Preserve alpha</span>
						<span class="text-[10px] text-muted-foreground">
							Keep soft pixel edges instead of making every match opaque.
						</span>
					</span>
					<Switch bind:checked={preserveAlpha} />
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

				<div class="grid gap-1 rounded-lg border px-3 py-2.5">
					<span class="text-xs font-medium">Matching pixels</span>
					<span class="text-[10px] tabular-nums text-muted-foreground">
						{matchCount} {matchCount === 1 ? "pixel" : "pixels"} will be
						rewritten.
					</span>
					<span class="text-[10px] text-muted-foreground">
						{#if editor.hasSelection}
							A selection is active, so only selected pixels are replaced.
						{:else}
							No selection, so the whole cel is scanned.
						{/if}
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
			<Button onclick={apply} disabled={!canApply}>Replace pixels</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
