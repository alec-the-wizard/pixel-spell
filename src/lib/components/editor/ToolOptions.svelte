<script lang="ts">
	import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
	import Circle from "@lucide/svelte/icons/circle";
	import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
	import Slash from "@lucide/svelte/icons/slash";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import * as Tooltip from "$lib/components/ui/tooltip/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { TOOL_BY_ID, usesPixelPerfect } from "$lib/editor/tools.js";
	import type { GradientDither } from "$lib/editor/types.js";
	import ShapePicker from "./ShapePicker.svelte";
	import ToolIcon from "./ToolIcon.svelte";

	const DITHER_OPTIONS: { id: GradientDither; label: string }[] = [
		{ id: "none", label: "None" },
		{ id: "bayer2", label: "Bayer 2x2" },
		{ id: "bayer4", label: "Bayer 4x4" },
		{ id: "bayer8", label: "Bayer 8x8" },
	];

	/** Accent colors for the left (blue) and right (orange) tool slots. */
	const LEFT_SLOT_COLOR = "#3b82f6";
	const RIGHT_SLOT_COLOR = "#f97316";

	let tool = $derived(TOOL_BY_ID[editor.tool]);
	let isShape = $derived(editor.tool === "shape");
	let showSize = $derived(
		editor.tool === "pencil" ||
			editor.tool === "eraser" ||
			editor.tool === "line" ||
			editor.tool === "curve" ||
			(isShape && !editor.shapeFilled),
	);
	let showPixelPerfect = $derived(
		usesPixelPerfect(editor.tool) && !(isShape && editor.shapeFilled),
	);
</script>

{#snippet deselectAction()}
	{#if editor.hasSelection}
		<Button
			variant="outline"
			size="sm"
			class="w-full"
			onclick={() => editor.clearSelection()}
		>
			Deselect
		</Button>
	{/if}
{/snippet}

{#snippet optionLabel(label: string, help: string)}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					class="inline-flex cursor-help items-center gap-1 rounded-sm text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{label}
					<CircleQuestionMark
						class="size-3 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="right" sideOffset={8}>{help}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<section class="relative flex min-h-0 flex-1 basis-0 flex-col">
	<header class="flex h-11 shrink-0 items-center gap-2.5 border-b px-4">
		<div class="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
			<ToolIcon tool={editor.tool} class="size-4" />
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5">
				<span class="truncate text-xs font-medium">{tool.label}</span>
				<kbd
					class="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground"
				>
					{tool.shortcut}
				</kbd>
			</div>
			<p class="truncate text-[10px] text-muted-foreground">{tool.description}</p>
		</div>
		{#if editor.doubleToolEnabled}
			<Button
				variant="ghost"
				size="icon-xs"
				class="shrink-0 text-muted-foreground"
				onclick={() => editor.showOtherToolOptions()}
				title="Show the other mouse button's tool options"
				aria-label="Show the other mouse button's tool options"
			>
				<ArrowLeftRight class="size-3.5" />
			</Button>
		{/if}
	</header>

	{#if editor.doubleToolEnabled}
		<div
			class="pointer-events-none absolute left-0 right-0 top-[2.75rem] z-10 h-0.5"
			style:background={editor.activeToolSlot === "left"
				? LEFT_SLOT_COLOR
				: RIGHT_SLOT_COLOR}
			aria-hidden="true"
		></div>
	{/if}

	<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
		<div class="space-y-5">
			{#if editor.tool === "pan"}
				<p class="text-[10px] leading-relaxed text-muted-foreground">
					Drag anywhere on the canvas to pan. The pan tool works even when the active layer is
					locked or hidden.
				</p>
			{:else if editor.tool === "zoom"}
				{#if editor.doubleToolEnabled}
					<div class="space-y-2.5">
						<span class="text-xs font-medium">Zoom direction</span>
						<div class="grid grid-cols-2 gap-1.5" role="group" aria-label="Zoom direction">
							<Button
								variant={editor.zoomDirection === 1 ? "secondary" : "outline"}
								size="sm"
								onclick={() => (editor.zoomDirection = 1)}
								aria-pressed={editor.zoomDirection === 1}
							>
								Zoom in
							</Button>
							<Button
								variant={editor.zoomDirection === -1 ? "secondary" : "outline"}
								size="sm"
								onclick={() => (editor.zoomDirection = -1)}
								aria-pressed={editor.zoomDirection === -1}
							>
								Zoom out
							</Button>
						</div>
						<p class="text-[10px] leading-relaxed text-muted-foreground">
							Click with the assigned mouse button to zoom in the chosen direction.
						</p>
					</div>
				{:else}
					<p class="text-[10px] leading-relaxed text-muted-foreground">
						Left-click to zoom in and right-click to zoom out. Zooming stays focused on the
						point under the pointer.
					</p>
				{/if}
			{:else if editor.tool === "magic-wand"}
				<div
					class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
				>
					{@render optionLabel(
						"Diagonal connections",
						"Include pixels that touch at a corner as part of the same area.",
					)}
					<Switch
						bind:checked={editor.magicWandDiagonal}
						aria-label="Diagonal connections"
					/>
				</div>
				{@render deselectAction()}
			{:else if editor.tool === "shape-select"}
				<div class="space-y-2.5">
					<span class="text-xs font-medium">Selection shape</span>
					<ShapePicker bind:value={editor.selectionShape} />
				</div>
				<p class="text-[10px] leading-relaxed text-muted-foreground">
					Drag to select a {editor.selectionShape}. Drag inside an existing selection to move
					its pixels.
				</p>
				{@render deselectAction()}
			{:else if editor.tool === "lasso"}
				<div class="rounded-lg border border-dashed bg-muted/30 p-3">
					<p class="text-[10px] leading-relaxed text-muted-foreground">
						Drag to draw freehand, or click to place polygon points — mix both freely. Finish by
						returning to the start point or right-clicking to close with a straight line.
					</p>
				</div>
				{@render deselectAction()}
			{:else if editor.tool === "select-color"}
				<p class="text-[10px] leading-relaxed text-muted-foreground">
					Selects every pixel on the active layer that exactly matches the clicked color.
				</p>
				{@render deselectAction()}
			{:else if editor.tool === "eyedropper"}
				<div
					class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
				>
					{@render optionLabel(
						"Sample all layers",
						"Pick from the flattened image instead of the active layer.",
					)}
					<Switch
						bind:checked={editor.sampleAllLayers}
						aria-label="Sample all layers"
					/>
				</div>
				{#if editor.doubleToolEnabled}
					<div class="space-y-2.5">
						<span class="text-xs font-medium">Pick target</span>
						<div class="grid grid-cols-2 gap-1.5" role="group" aria-label="Eyedropper target">
							<Button
								variant={editor.eyedropperTarget === "primary" ? "secondary" : "outline"}
								size="sm"
								onclick={() => (editor.eyedropperTarget = "primary")}
								aria-pressed={editor.eyedropperTarget === "primary"}
							>
								Primary
							</Button>
							<Button
								variant={editor.eyedropperTarget === "secondary" ? "secondary" : "outline"}
								size="sm"
								onclick={() => (editor.eyedropperTarget = "secondary")}
								aria-pressed={editor.eyedropperTarget === "secondary"}
							>
								Secondary
							</Button>
						</div>
					</div>
				{/if}
			{:else if editor.tool === "spray"}
				<div class="space-y-2.5">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium">Spray radius</span>
						<span
							class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
						>
							{editor.sprayRadius}px
						</span>
					</div>
					<Slider type="single" min={1} max={32} step={1} bind:value={editor.sprayRadius} />
				</div>

				<div class="space-y-2.5">
					<div class="flex items-center justify-between">
						{@render optionLabel(
							"Pixel speed",
							"Hold the pointer still to keep scattering pixels across the round area.",
						)}
						<span
							class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
						>
							{editor.sprayRate} px/s
						</span>
					</div>
					<Slider type="single" min={1} max={200} step={1} bind:value={editor.sprayRate} />
				</div>
			{:else if editor.tool === "blur"}
				<div class="space-y-2.5">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium">Area radius</span>
						<span
							class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
						>
							{editor.blurRadius}px
						</span>
					</div>
					<Slider type="single" min={1} max={32} step={1} bind:value={editor.blurRadius} />
				</div>

				<div class="space-y-2.5">
					<div class="flex items-center justify-between">
						{@render optionLabel(
							"Blur power",
							"Pass over an area repeatedly to soften it further.",
						)}
						<span
							class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
						>
							{editor.blurPower}%
						</span>
					</div>
					<Slider type="single" min={1} max={100} step={1} bind:value={editor.blurPower} />
				</div>
			{:else if editor.tool === "jumble"}
				<div class="space-y-2.5">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium">Area radius</span>
						<span
							class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
						>
							{editor.jumbleRadius}px
						</span>
					</div>
					<Slider type="single" min={1} max={32} step={1} bind:value={editor.jumbleRadius} />
				</div>

				<div class="space-y-2.5">
					<div class="flex items-center justify-between">
						{@render optionLabel(
							"Scramble power",
							"Higher values swap more pixels inside the round area on every pass.",
						)}
						<span
							class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
						>
							{editor.jumblePower}%
						</span>
					</div>
					<Slider type="single" min={1} max={100} step={1} bind:value={editor.jumblePower} />
				</div>
			{:else if editor.tool === "fill"}
				<div class="space-y-2.5">
					<div class="flex items-center justify-between">
						{@render optionLabel(
							"Tolerance",
							"Higher values fill more colors that are close to the clicked pixel.",
						)}
						<span
							class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
						>
							{editor.fillTolerance}%
						</span>
					</div>
					<Slider type="single" min={0} max={100} step={1} bind:value={editor.fillTolerance} />
				</div>

				<div
					class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
				>
					{@render optionLabel(
						"Contiguous",
						"Only fill the connected region around the click.",
					)}
					<Switch bind:checked={editor.fillContiguous} aria-label="Contiguous" />
				</div>
			{:else if editor.tool === "gradient"}
				<div class="space-y-2.5">
					<div class="flex items-center justify-between">
						{@render optionLabel(
							"Tolerance",
							"Higher values include more colors close to the clicked pixel.",
						)}
						<span
							class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
						>
							{editor.gradientTolerance}%
						</span>
					</div>
					<Slider type="single" min={0} max={100} step={1} bind:value={editor.gradientTolerance} />
				</div>

				<div
					class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
				>
					{@render optionLabel(
						"Contiguous",
						"Only apply the gradient to the connected region around the click.",
					)}
					<Switch bind:checked={editor.gradientContiguous} aria-label="Contiguous" />
				</div>

				<div class="space-y-2.5">
					<span class="text-xs font-medium">Shape</span>
					<div class="grid grid-cols-2 gap-1.5" role="group" aria-label="Gradient shape">
						<Button
							variant={editor.gradientShape === "linear" ? "secondary" : "outline"}
							size="sm"
							class="h-auto flex-col gap-1 py-2"
							onclick={() => (editor.gradientShape = "linear")}
							aria-pressed={editor.gradientShape === "linear"}
						>
							<Slash class="size-4" />
							<span class="text-[10px]">Linear</span>
						</Button>
						<Button
							variant={editor.gradientShape === "radial" ? "secondary" : "outline"}
							size="sm"
							class="h-auto flex-col gap-1 py-2"
							onclick={() => (editor.gradientShape = "radial")}
							aria-pressed={editor.gradientShape === "radial"}
						>
							<Circle class="size-4" />
							<span class="text-[10px]">Radial</span>
						</Button>
					</div>
				</div>

				<div class="space-y-2.5">
					{@render optionLabel(
						"Dithering",
						"Bayer patterns create a two-color dithered transition; None blends the colors smoothly.",
					)}
					<div class="grid grid-cols-2 gap-1.5" role="group" aria-label="Dithering">
						{#each DITHER_OPTIONS as option (option.id)}
							<Button
								variant={editor.gradientDither === option.id ? "secondary" : "outline"}
								size="sm"
								onclick={() => (editor.gradientDither = option.id)}
								aria-pressed={editor.gradientDither === option.id}
							>
								{option.label}
							</Button>
						{/each}
					</div>
				</div>
			{:else}
				{#if isShape}
					<div class="space-y-2.5">
						<span class="text-xs font-medium">Shape</span>
						<ShapePicker bind:value={editor.shapeKind} />
					</div>
				{/if}

				{#if showSize}
					<div class="space-y-2.5">
						<div class="flex items-center justify-between">
							<span class="text-xs font-medium">
								{isShape ? "Outline size" : "Brush size"}
							</span>
							<span
								class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
							>
								{editor.brushSize}px
							</span>
						</div>
						<Slider type="single" min={1} max={8} step={1} bind:value={editor.brushSize} />
					</div>
				{/if}

				{#if isShape}
					<div
						class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
					>
						{@render optionLabel(
							"Filled shape",
							"Fill the interior instead of drawing an outline.",
						)}
						<Switch bind:checked={editor.shapeFilled} aria-label="Filled shape" />
					</div>
				{/if}

				{#if showPixelPerfect}
					<div
						class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
					>
						{@render optionLabel(
							"Pixel perfect",
							"Remove extra corner pixels from stair-stepped edges.",
						)}
						<Switch
							checked={editor.pixelPerfectFor(editor.tool)}
							onCheckedChange={(checked) =>
								editor.setPixelPerfect(editor.tool, checked)}
							aria-label="Pixel perfect"
						/>
					</div>
				{/if}

				{#if editor.tool === "curve"}
					<div class="rounded-lg border border-dashed bg-muted/30 p-3">
						<p class="text-[10px] leading-relaxed text-muted-foreground">
							Drag to draw the base line, then click twice to bend the curve.
						</p>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</section>

