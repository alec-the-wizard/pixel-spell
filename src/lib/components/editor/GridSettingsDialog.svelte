<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		GRID_MAX_OFFSET,
		GRID_MAX_SIZE,
		GRID_MIN_SIZE,
		type GridMode,
		type HexGridOrientation,
	} from "$lib/editor/grid.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	const MODES: { id: GridMode; label: string }[] = [
		{ id: "square", label: "Square" },
		{ id: "isometric", label: "Isometric" },
		{ id: "hexagonal", label: "Hexagonal" },
	];

	const HEX_ORIENTATIONS: { id: HexGridOrientation; label: string }[] = [
		{ id: "pointy", label: "Pointy top" },
		{ id: "flat", label: "Flat top" },
	];

	const MODE_HINTS: Record<GridMode, string> = {
		square: "Independent horizontal and vertical cell sizes. Offset both axes.",
		isometric:
			"Diamond tiles with independent width and height. The classic 2:1 look uses height at half the width.",
		hexagonal:
			"Honeycomb tiles. Width and height stretch the hexagons and their spacing together.",
	};

	const SIZE_LABELS: Record<
		GridMode,
		{ width: string; height: string; widthHint: string; heightHint: string }
	> = {
		square: {
			width: "Cell width",
			height: "Cell height",
			widthHint: "Horizontal spacing between vertical lines, in document pixels.",
			heightHint: "Vertical spacing between horizontal lines, in document pixels.",
		},
		isometric: {
			width: "Tile width",
			height: "Tile height",
			widthHint: "Horizontal diamond width in document pixels.",
			heightHint: "Vertical diamond height in document pixels.",
		},
		hexagonal: {
			width: "Hex width",
			height: "Hex height",
			widthHint: "Horizontal hex size in document pixels.",
			heightHint: "Vertical hex size in document pixels.",
		},
	};

	let widthText = $state("");
	let heightText = $state("");
	let offsetXText = $state("");
	let offsetYText = $state("");
	let wasOpen = false;

	let sizeLabels = $derived(SIZE_LABELS[editor.gridMode]);

	function syncFromEditor(): void {
		widthText = String(editor.gridWidth);
		heightText = String(editor.gridHeight);
		offsetXText = String(editor.gridOffsetX);
		offsetYText = String(editor.gridOffsetY);
	}

	$effect(() => {
		if (open && !wasOpen) syncFromEditor();
		wasOpen = open;
	});

	function commit(
		text: string,
		setter: (value: number) => void,
	): void {
		if (text.trim() === "") return;
		const value = Number(text);
		if (!Number.isFinite(value)) return;
		setter(value);
	}

	function reset(): void {
		editor.resetGridSettings();
		syncFromEditor();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Grid settings</Dialog.Title>
			<Dialog.Description>
				The main grid and the pixel grid are independent. Changes apply live to
				the canvas.
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-3">
			<section class="rounded-lg border">
				<div class="flex items-start justify-between gap-4 border-b px-3 py-2.5">
					<div class="grid gap-0.5">
						<span class="text-sm font-medium">Grid</span>
						<span class="text-[10px] text-muted-foreground">
							Square, isometric, or hexagonal guide lines with a configurable
							origin.
						</span>
					</div>
					<Switch
						bind:checked={editor.showGrid}
						aria-label="Show main grid"
						class="mt-0.5"
					/>
				</div>

				<div
					class={cn(
						"grid gap-3 p-3 transition-opacity",
						!editor.showGrid && "opacity-60",
					)}
				>
					<div class="grid gap-1.5">
						<Label>Mode</Label>
						<div class="grid grid-cols-3 gap-1 rounded-lg border p-1">
							{#each MODES as option (option.id)}
								<button
									type="button"
									class={cn(
										"rounded-md px-2 py-1 text-[11px] transition-colors",
										editor.gridMode === option.id
											? "bg-accent text-foreground"
											: "text-muted-foreground hover:bg-accent/60",
									)}
									aria-pressed={editor.gridMode === option.id}
									onclick={() => (editor.gridMode = option.id)}
								>
									{option.label}
								</button>
							{/each}
						</div>
						<span class="text-[10px] text-muted-foreground">
							{MODE_HINTS[editor.gridMode]}
						</span>
					</div>

					<div class="grid grid-cols-2 gap-3">
						<div class="grid gap-1.5">
							<Label for="grid-width">{sizeLabels.width}</Label>
							<Input
								id="grid-width"
								type="number"
								min={GRID_MIN_SIZE}
								max={GRID_MAX_SIZE}
								step={1}
								value={widthText}
								oninput={(event) => {
									widthText = event.currentTarget.value;
									commit(widthText, (value) => editor.setGridWidth(value));
								}}
								onblur={() => (widthText = String(editor.gridWidth))}
								class="tabular-nums"
							/>
							<span class="text-[10px] text-muted-foreground">
								{sizeLabels.widthHint}
							</span>
						</div>
						<div class="grid gap-1.5">
							<Label for="grid-height">{sizeLabels.height}</Label>
							<Input
								id="grid-height"
								type="number"
								min={GRID_MIN_SIZE}
								max={GRID_MAX_SIZE}
								step={1}
								value={heightText}
								oninput={(event) => {
									heightText = event.currentTarget.value;
									commit(heightText, (value) => editor.setGridHeight(value));
								}}
								onblur={() => (heightText = String(editor.gridHeight))}
								class="tabular-nums"
							/>
							<span class="text-[10px] text-muted-foreground">
								{sizeLabels.heightHint}
							</span>
						</div>
					</div>

					{#if editor.gridMode === "hexagonal"}
						<div class="grid gap-1.5">
							<Label>Hex orientation</Label>
							<div class="grid grid-cols-2 gap-1 rounded-lg border p-1">
								{#each HEX_ORIENTATIONS as option (option.id)}
									<button
										type="button"
										class={cn(
											"rounded-md px-2 py-1 text-[11px] transition-colors",
											editor.gridHexOrientation === option.id
												? "bg-accent text-foreground"
												: "text-muted-foreground hover:bg-accent/60",
										)}
										aria-pressed={editor.gridHexOrientation === option.id}
										onclick={() => (editor.gridHexOrientation = option.id)}
									>
										{option.label}
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<div class="grid grid-cols-2 gap-3">
						<div class="grid gap-1.5">
							<Label for="grid-offset-x">Offset X</Label>
							<Input
								id="grid-offset-x"
								type="number"
								min={-GRID_MAX_OFFSET}
								max={GRID_MAX_OFFSET}
								step={1}
								value={offsetXText}
								oninput={(event) => {
									offsetXText = event.currentTarget.value;
									commit(offsetXText, (value) => editor.setGridOffsetX(value));
								}}
								onblur={() => (offsetXText = String(editor.gridOffsetX))}
								class="tabular-nums"
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="grid-offset-y">Offset Y</Label>
							<Input
								id="grid-offset-y"
								type="number"
								min={-GRID_MAX_OFFSET}
								max={GRID_MAX_OFFSET}
								step={1}
								value={offsetYText}
								oninput={(event) => {
									offsetYText = event.currentTarget.value;
									commit(offsetYText, (value) => editor.setGridOffsetY(value));
								}}
								onblur={() => (offsetYText = String(editor.gridOffsetY))}
								class="tabular-nums"
							/>
						</div>
					</div>
					<span class="text-[10px] text-muted-foreground">
						Offsets are in document pixels. Positive values move the grid right
						and down; negative values move it left and up.
					</span>
				</div>
			</section>

			<section class="rounded-lg border">
				<div class="flex items-start justify-between gap-4 px-3 py-2.5">
					<div class="grid gap-0.5">
						<span class="text-sm font-medium">Pixel grid</span>
						<span class="text-[10px] text-muted-foreground">
							Separates every document pixel. It is shown when each pixel is at
							least 6 screen pixels wide, and it does not depend on the main
							grid.
						</span>
					</div>
					<Switch
						bind:checked={editor.showPixelGrid}
						aria-label="Show pixel grid"
						class="mt-0.5"
					/>
				</div>
			</section>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={reset}>Reset defaults</Button>
			<Button onclick={() => (open = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
