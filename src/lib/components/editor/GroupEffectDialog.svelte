<script lang="ts">
	import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
	import { Button } from "$lib/components/ui/button/index.js";
	import CanvasTransformPreview from "$lib/components/editor/CanvasTransformPreview.svelte";
	import GradientMapEditor from "$lib/components/editor/GradientMapEditor.svelte";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import {
		BAYER_MATRIX_OPTIONS,
		type BayerMatrixId,
	} from "$lib/editor/dither.js";
	import {
		DITHER_METHODS,
		DITHER_TARGETS,
		type DitherMethod,
		type DitherTarget,
	} from "$lib/editor/dither-filter.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		MAX_EFFECT_THICKNESS,
		MIN_EFFECT_THICKNESS,
		MAX_SHADOW_OFFSET,
	} from "$lib/editor/filters.js";
	import {
		GROUP_EFFECT_LABELS,
		groupEffectSummary,
	} from "$lib/editor/group-effects.js";
	import {
		GRADIENT_MAP_SOURCES,
		defaultGradientStops,
		normalizeGradientSource,
		normalizeGradientSpace,
		normalizeGradientStops,
		type GradientMapSource,
		type GradientMapSpace,
	} from "$lib/editor/gradient-map.js";
	import {
		GRAYSCALE_BIT_OPTIONS,
		normalizeGrayscaleBits,
		type GrayscaleBits,
	} from "$lib/editor/grayscale.js";
	import type {
		GradientStop,
		GroupEffect,
		GroupEffectOptions,
	} from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";

	let {
		open = $bindable(false),
		layerId = null,
		effectId = null,
	}: {
		open?: boolean;
		layerId?: string | null;
		effectId?: string | null;
	} = $props();

	const PLACEMENTS = [
		{ id: "outside", label: "Outside" },
		{ id: "inside", label: "Inside" },
	] as const;

	const GRAYSCALE_SEGMENTS = GRAYSCALE_BIT_OPTIONS.map((option) => ({
		id: String(option.id),
		label: option.label,
	}));

	const clampInt = (value: string, min: number, max: number, fallback: number) => {
		const number = Math.round(Number(value));
		if (!Number.isFinite(number)) return fallback;
		return Math.max(min, Math.min(max, number));
	};

	let group = $derived(
		editor.doc.layers.find((layer) => layer.id === layerId) ?? null,
	);
	let activeEffect = $derived(
		group?.effects?.find((entry) => entry.id === effectId) ?? null,
	);
	let kind = $derived(activeEffect?.kind ?? "outline");
	let title = $derived(`${GROUP_EFFECT_LABELS[kind]} effect`);

	let thicknessText = $state("1");
	let outlineColor = $state("#000000");
	let placement = $state<"outside" | "inside">("outside");
	let diagonals = $state(true);

	let offsetXText = $state("1");
	let offsetYText = $state("1");
	let spreadText = $state("0");
	let shadowColor = $state("#000000");
	let shadowOpacity = $state(50);

	let fromColor = $state("#000000");
	let toColor = $state("#ffffff");
	let toleranceText = $state("0");
	let preserveAlpha = $state(true);

	let method = $state<DitherMethod>("ordered");
	let matrix = $state<BayerMatrixId>("bayer4");
	let serpentine = $state(true);
	let target = $state<DitherTarget>("two-color");
	let lightColor = $state("#ffffff");
	let darkColor = $state("#000000");
	let ditherPalette = $state<string[]>([]);

	let gradientStops = $state<GradientStop[]>(defaultGradientStops());
	let gradientSpace = $state<GradientMapSpace>("rgb");
	let gradientSource = $state<GradientMapSource>("luminance");
	let gradientInvert = $state(false);

	let grayscaleBits = $state<GrayscaleBits>(8);

	let feedback = $state("");
	let loadedKey = "";

	let thickness = $derived(
		clampInt(thicknessText, MIN_EFFECT_THICKNESS, MAX_EFFECT_THICKNESS, 1),
	);
	let offsetX = $derived(
		clampInt(offsetXText, -MAX_SHADOW_OFFSET, MAX_SHADOW_OFFSET, 1),
	);
	let offsetY = $derived(
		clampInt(offsetYText, -MAX_SHADOW_OFFSET, MAX_SHADOW_OFFSET, 1),
	);
	let spread = $derived(clampInt(spreadText, 0, MAX_EFFECT_THICKNESS, 0));
	let tolerance = $derived(clampInt(toleranceText, 0, 100, 0));
	let paletteAvailable = $derived(ditherPalette.length >= 2);

	let bakeableLayers = $derived.by(() => {
		if (!group) return 0;
		const parents = new Map(
			editor.doc.layers.map((layer) => [layer.id, layer.parentId]),
		);
		let count = 0;
		for (const layer of editor.doc.layers) {
			if (layer.id === group.id || layer.isGroup || layer.role === "reference") {
				continue;
			}
			let parentId = layer.parentId;
			let depth = 0;
			let inside = false;
			while (parentId && depth < 64) {
				if (parentId === group.id) {
					inside = true;
					break;
				}
				parentId = parents.get(parentId);
				depth++;
			}
			if (inside && layer.visible && layer.opacity > 0) count++;
		}
		return count;
	});

	let preview = $derived.by(() => {
		if (!open || !activeEffect || !layerId || !effectId) return null;
		const draft: GroupEffect = {
			id: activeEffect.id,
			kind: activeEffect.kind,
			enabled: true,
			options: currentOptions(),
		};
		return editor.previewGroupEffect(layerId, effectId, draft);
	});

	$effect(() => {
		const targetEffect = activeEffect;
		if (!open) {
			loadedKey = "";
			return;
		}
		if (!targetEffect) {
			open = false;
			return;
		}
		const key = `${layerId}:${effectId}`;
		if (loadedKey === key) return;
		loadedKey = key;
		load(targetEffect);
	});

	function load(targetEffect: GroupEffect): void {
		const options = targetEffect.options;
		thicknessText = String(options.thickness ?? 1);
		outlineColor = options.color ?? "#000000";
		placement = options.placement === "inside" ? "inside" : "outside";
		diagonals = options.diagonals !== false;

		offsetXText = String(options.offsetX ?? 1);
		offsetYText = String(options.offsetY ?? 1);
		spreadText = String(options.spread ?? 0);
		shadowColor = options.color ?? "#000000";
		shadowOpacity = options.opacity ?? 50;

		fromColor = options.from ?? "#000000";
		toColor = options.to ?? "#ffffff";
		toleranceText = String(options.tolerance ?? 0);
		preserveAlpha = options.preserveAlpha !== false;

		method = options.method === "diffusion" ? "diffusion" : "ordered";
		matrix = options.matrix ?? "bayer4";
		serpentine = options.serpentine !== false;
		target = options.target === "palette" ? "palette" : "two-color";
		lightColor = options.lightColor ?? "#ffffff";
		darkColor = options.darkColor ?? "#000000";
		ditherPalette =
			options.palette && options.palette.length > 0
				? [...options.palette]
				: [...editor.activePalette.colors];

		gradientStops = normalizeGradientStops(options.gradient);
		gradientSpace = normalizeGradientSpace(options.gradientSpace);
		gradientSource = normalizeGradientSource(options.gradientSource);
		gradientInvert = options.gradientInvert === true;
		grayscaleBits = normalizeGrayscaleBits(options.bits);
		feedback = "";
	}

	function currentOptions(): GroupEffectOptions {
		switch (kind) {
			case "outline":
				return {
					thickness,
					color: outlineColor,
					placement,
					diagonals,
				};
			case "drop-shadow":
				return {
					offsetX,
					offsetY,
					spread,
					color: shadowColor,
					opacity: shadowOpacity,
				};
			case "color-replace":
				return {
					from: fromColor,
					to: toColor,
					tolerance,
					preserveAlpha,
				};
			case "dither":
				return {
					method,
					matrix,
					serpentine,
					target:
						target === "palette" && paletteAvailable
							? "palette"
							: "two-color",
					lightColor,
					darkColor,
					palette: ditherPalette,
				};
			case "gradient-map":
				return {
					gradient: gradientStops,
					gradientSpace,
					gradientSource,
					gradientInvert,
				};
			case "grayscale":
				return { bits: grayscaleBits };
		}
	}

	function normalizeNumbers(): void {
		thicknessText = String(thickness);
		offsetXText = String(offsetX);
		offsetYText = String(offsetY);
		spreadText = String(spread);
		toleranceText = String(tolerance);
	}

	function swapColors(): void {
		const next = fromColor;
		fromColor = toColor;
		toColor = next;
	}

	function changeSlider(
		value: number | number[],
		apply: (next: number) => void,
	): void {
		const next = Array.isArray(value) ? value[0] : value;
		if (next === undefined || !Number.isFinite(next)) return;
		apply(Math.max(0, Math.min(100, Math.round(next))));
	}

	function apply(): void {
		if (!activeEffect || !layerId) return;
		editor.updateGroupEffect(layerId, activeEffect.id, currentOptions());
		open = false;
	}

	function bake(): void {
		if (!activeEffect || !layerId) return;
		if (bakeableLayers === 0) {
			feedback =
				"Add a visible paint layer to the group before baking this effect.";
			return;
		}
		editor.bakeGroupEffect(layerId, activeEffect.id, currentOptions());
		open = false;
	}
</script>

{#snippet segmented(
	options: readonly { id: string; label: string }[],
	value: string,
	select: (id: string) => void,
	columns: string,
)}
	<div class={cn("grid gap-1 rounded-lg border p-1", columns)}>
		{#each options as option (option.id)}
			<button
				type="button"
				class={cn(
					"rounded-md px-2 py-1 text-[11px] transition-colors",
					value === option.id
						? "bg-accent text-foreground"
						: "text-muted-foreground hover:bg-accent/60",
				)}
				aria-pressed={value === option.id}
				onclick={() => select(option.id)}
			>
				{option.label}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet colorPicker(
	id: string,
	label: string,
	value: string,
	set: (next: string) => void,
)}
	<div class="grid gap-1.5">
		<Label for={id}>{label}</Label>
		<div class="flex items-center gap-2">
			<label
				class="relative block size-8 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
				title={`Choose ${label.toLowerCase()}`}
			>
				<span class="absolute inset-0" style:background={value}></span>
				<input
					{id}
					type="color"
					{value}
					oninput={(event) => set(event.currentTarget.value)}
					class="absolute inset-0 size-full cursor-pointer opacity-0"
					aria-label={label}
				/>
			</label>
			<span class="truncate font-mono text-[11px] uppercase text-muted-foreground">
				{value}
			</span>
		</div>
	</div>
{/snippet}

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>
				This non-destructive block runs on the group's combined pixels. Edit
				its settings here; the artwork stays untouched until you bake it.
			</Dialog.Description>
		</Dialog.Header>

		<CanvasTransformPreview
			pixels={preview}
			width={editor.doc.width}
			height={editor.doc.height}
			label={`${title} preview`}
		/>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="grid content-start gap-3">
				{#if kind === "outline"}
					<div class="grid gap-1.5">
						<div class="flex items-center justify-between gap-2">
							<Label for="group-effect-thickness">Thickness</Label>
							<span class="text-[10px] tabular-nums text-muted-foreground">
								{thickness} px
							</span>
						</div>
						<Input
							id="group-effect-thickness"
							type="number"
							min={MIN_EFFECT_THICKNESS}
							max={MAX_EFFECT_THICKNESS}
							step={1}
							value={thicknessText}
							oninput={(event) => (thicknessText = event.currentTarget.value)}
							onblur={normalizeNumbers}
							class="tabular-nums"
						/>
						<span class="text-[10px] text-muted-foreground">
							{MIN_EFFECT_THICKNESS}–{MAX_EFFECT_THICKNESS} pixels, measured
							from the group's silhouette.
						</span>
					</div>

					<div class="grid gap-1.5">
						<Label>Placement</Label>
						{@render segmented(
							PLACEMENTS,
							placement,
							(id) => (placement = id as "outside" | "inside"),
							"grid-cols-2",
						)}
					</div>

					{@render colorPicker(
						"group-effect-outline-color",
						"Color",
						outlineColor,
						(next) => (outlineColor = next),
					)}

					<label
						class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
					>
						<span class="grid gap-0.5">
							<span class="text-xs font-medium">Diagonal corners</span>
							<span class="text-[10px] text-muted-foreground">
								Include diagonal neighbors for a softer edge.
							</span>
						</span>
						<Switch bind:checked={diagonals} />
					</label>
				{:else if kind === "drop-shadow"}
					<div class="grid gap-1.5">
						<Label>Offset</Label>
						<div class="grid grid-cols-2 gap-2">
							<div class="grid gap-1">
								<Label
									for="group-effect-offset-x"
									class="text-[10px] font-normal text-muted-foreground"
								>
									X
								</Label>
								<Input
									id="group-effect-offset-x"
									type="number"
									min={-MAX_SHADOW_OFFSET}
									max={MAX_SHADOW_OFFSET}
									step={1}
									value={offsetXText}
									oninput={(event) => (offsetXText = event.currentTarget.value)}
									onblur={normalizeNumbers}
									class="tabular-nums"
								/>
							</div>
							<div class="grid gap-1">
								<Label
									for="group-effect-offset-y"
									class="text-[10px] font-normal text-muted-foreground"
								>
									Y
								</Label>
								<Input
									id="group-effect-offset-y"
									type="number"
									min={-MAX_SHADOW_OFFSET}
									max={MAX_SHADOW_OFFSET}
									step={1}
									value={offsetYText}
									oninput={(event) => (offsetYText = event.currentTarget.value)}
									onblur={normalizeNumbers}
									class="tabular-nums"
								/>
							</div>
						</div>
						<span class="text-[10px] text-muted-foreground">
							Positive X moves right, positive Y moves down.
						</span>
					</div>

					<div class="grid gap-1.5">
						<div class="flex items-center justify-between gap-2">
							<Label for="group-effect-spread">Spread</Label>
							<span class="text-[10px] tabular-nums text-muted-foreground">
								{spread} px
							</span>
						</div>
						<Input
							id="group-effect-spread"
							type="number"
							min={0}
							max={MAX_EFFECT_THICKNESS}
							step={1}
							value={spreadText}
							oninput={(event) => (spreadText = event.currentTarget.value)}
							onblur={normalizeNumbers}
							class="tabular-nums"
						/>
					</div>

					{@render colorPicker(
						"group-effect-shadow-color",
						"Color",
						shadowColor,
						(next) => (shadowColor = next),
					)}

					<div class="grid gap-1.5">
						<div class="flex items-center justify-between gap-2">
							<Label>Opacity</Label>
							<span class="text-[10px] tabular-nums text-muted-foreground">
								{shadowOpacity}%
							</span>
						</div>
						<Slider
							id="group-effect-shadow-opacity"
							type="single"
							min={0}
							max={100}
							step={1}
							value={shadowOpacity}
							onValueChange={(value) =>
								changeSlider(value, (next) => (shadowOpacity = next))}
							aria-label="Shadow opacity"
						/>
					</div>
				{:else if kind === "color-replace"}
					<div class="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
						{@render colorPicker(
							"group-effect-from",
							"Replace",
							fromColor,
							(next) => (fromColor = next),
						)}
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
						{@render colorPicker(
							"group-effect-to",
							"With",
							toColor,
							(next) => (toColor = next),
						)}
					</div>

					<div class="grid gap-1.5">
						<div class="flex items-center justify-between gap-2">
							<Label>Tolerance</Label>
							<span class="text-[10px] tabular-nums text-muted-foreground">
								{tolerance}%
							</span>
						</div>
						<Slider
							type="single"
							min={0}
							max={100}
							step={1}
							value={tolerance}
							onValueChange={(value) =>
								changeSlider(value, (next) => (toleranceText = String(next)))}
							aria-label="Color match tolerance"
						/>
						<span class="text-[10px] text-muted-foreground">
							0% matches exactly; higher values also replace nearby shades.
						</span>
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
				{:else if kind === "dither"}
					<div class="grid gap-1.5">
						<Label>Method</Label>
						{@render segmented(
							DITHER_METHODS,
							method,
							(id) => (method = id as DitherMethod),
							"grid-cols-2",
						)}
					</div>

					{#if method === "ordered"}
						<div class="grid gap-1.5">
							<Label>Ordered matrix</Label>
							{@render segmented(
								BAYER_MATRIX_OPTIONS,
								matrix,
								(id) => (matrix = id as BayerMatrixId),
								"grid-cols-3",
							)}
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
					{/if}

					<div class="grid gap-1.5">
						<Label>Target</Label>
						{@render segmented(
							DITHER_TARGETS,
							target,
							(id) => (target = id as DitherTarget),
							"grid-cols-2",
						)}
						<span class="text-[10px] text-muted-foreground">
							{#if target === "palette"}
								{paletteAvailable
									? `${ditherPalette.length} colors captured from the active palette.`
									: "The captured palette has fewer than two colors; two-color mode is used."}
							{:else}
								The two swatches below define the output colors.
							{/if}
						</span>
					</div>

					{#if target === "two-color" || !paletteAvailable}
						<div class="grid grid-cols-2 gap-3">
							{@render colorPicker(
								"group-effect-dither-light",
								"Light",
								lightColor,
								(next) => (lightColor = next),
							)}
							{@render colorPicker(
								"group-effect-dither-dark",
								"Dark",
								darkColor,
								(next) => (darkColor = next),
							)}
						</div>
					{/if}
				{:else if kind === "gradient-map"}
					<GradientMapEditor bind:stops={gradientStops} bind:space={gradientSpace} />

					<div class="grid gap-1.5">
						<Label>Brightness</Label>
						{@render segmented(
							GRADIENT_MAP_SOURCES,
							gradientSource,
							(id) => (gradientSource = id as GradientMapSource),
							"grid-cols-2",
						)}
						<span class="text-[10px] text-muted-foreground">
							{GRADIENT_MAP_SOURCES.find(
								(option) => option.id === gradientSource,
							)?.hint ?? ""}
						</span>
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
						<Switch bind:checked={gradientInvert} />
					</label>
				{:else}
					<div class="grid gap-1.5">
						<Label>Bit depth</Label>
						{@render segmented(
							GRAYSCALE_SEGMENTS,
							String(grayscaleBits),
							(id) => (grayscaleBits = normalizeGrayscaleBits(id)),
							"grid-cols-4",
						)}
						<span class="text-[10px] text-muted-foreground">
							{1 << grayscaleBits} gray levels. Lower depths posterize the group
							into a hard monochrome ramp.
						</span>
					</div>

					<div
						class="grid gap-1 rounded-lg border px-3 py-2.5 text-[10px] text-muted-foreground"
					>
						<span class="text-xs font-medium text-foreground">
							Perceptual luminance
						</span>
						<span>
							Each pixel becomes 0.2126·R + 0.7152·G + 0.0722·B, then snaps to
							the nearest ramp value. Alpha and transparency are preserved.
						</span>
					</div>
				{/if}
			</div>

			<div class="grid content-start gap-3">
				<div
					class="grid gap-1 rounded-lg border px-3 py-2.5 text-[10px] text-muted-foreground"
				>
					<span class="text-xs font-medium text-foreground">How it works</span>
					<span>
						Blocks run left-to-right on the group's composite. Inner groups
						apply their stacks before outer groups.
					</span>
					<span>
						Disabled blocks stay in place but are skipped. Removing a block
						discards its settings immediately.
					</span>
					<span>
						Baking writes this effect into every visible paint layer inside the
						group, across all frames, then removes the block. It is one undoable
						step.
					</span>
				</div>

				<div class="grid gap-1 rounded-lg border px-3 py-2.5 text-[10px]">
					<span class="text-xs font-medium">Current summary</span>
					<span class="text-muted-foreground">
						{groupEffectSummary({
							id: activeEffect?.id ?? "",
							kind,
							enabled: true,
							options: currentOptions(),
						})}
					</span>
					<span class="text-muted-foreground">
						{bakeableLayers} visible paint {bakeableLayers === 1 ? "layer" : "layers"}
						inside this group.
					</span>
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
			<Button
				variant="outline"
				onclick={bake}
				disabled={bakeableLayers === 0}
				title="Write this effect into the group's layers and remove the block."
			>
				Bake effect
			</Button>
			<Button onclick={apply}>Apply changes</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
