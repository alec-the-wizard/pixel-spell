<script lang="ts">
	import Check from "@lucide/svelte/icons/check";
	import Pause from "@lucide/svelte/icons/pause";
	import Play from "@lucide/svelte/icons/play";
	import Sparkles from "@lucide/svelte/icons/sparkles";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { compositeFrameCached } from "$lib/editor/doc.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { MAX_PROJECT_FRAMES } from "$lib/editor/file.js";
	import {
		PALETTE_CYCLE_SPEEDS,
		buildPaletteCycleMap,
		paletteCycleColors,
		paletteCyclePeriod,
		paletteShiftForStep,
		remapPalettePixels,
		type PaletteCycleDirection,
	} from "$lib/editor/palette-cycle.js";
	import { drawScaled } from "$lib/editor/render.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	const DIRECTIONS: {
		id: PaletteCycleDirection;
		label: string;
		title: string;
	}[] = [
		{
			id: "forward",
			label: "Forward",
			title: "Rotate the range toward the last color",
		},
		{
			id: "reverse",
			label: "Reverse",
			title: "Rotate the range toward the first color",
		},
		{
			id: "ping-pong",
			label: "Ping-pong",
			title: "Travel forward and back without repeating the endpoints",
		},
	];

	const PREVIEW_MAX_WIDTH = 288;
	const PREVIEW_MAX_HEIGHT = 120;

	let phase = $state(0);
	let playing = $state(false);
	let previewCanvas = $state<HTMLCanvasElement>();
	let previewBuffer: Uint32Array | null = null;
	let stepsText = $state("2");
	let tag = $state("cycle");
	let loopNewFrames = $state(true);
	let feedback = $state("");
	let wasOpen = false;

	let palette = $derived(editor.activePalette);
	let range = $derived(editor.paletteCycleRange);
	let rangeLength = $derived(range ? range.end - range.start + 1 : 0);
	let period = $derived(
		paletteCyclePeriod(rangeLength, editor.paletteCycleDirection),
	);
	let shift = $derived(
		paletteShiftForStep(phase, rangeLength, editor.paletteCycleDirection),
	);
	let phaseColors = $derived(
		range ? paletteCycleColors(palette.colors, range, shift) : [],
	);
	let direction = $derived(editor.paletteCycleDirection);
	let previewSize = $derived.by(() => {
		const doc = editor.doc;
		const scale = Math.min(
			PREVIEW_MAX_WIDTH / Math.max(1, doc.width),
			PREVIEW_MAX_HEIGHT / Math.max(1, doc.height),
		);
		return {
			width: Math.max(1, Math.round(doc.width * scale)),
			height: Math.max(1, Math.round(doc.height * scale)),
		};
	});
	let steps = $derived.by(() => {
		const value = Math.round(Number(stepsText));
		const max = Math.max(2, period);
		if (!Number.isFinite(value)) return 2;
		return Math.max(2, Math.min(max, value));
	});
	let remainingFrames = $derived(MAX_PROJECT_FRAMES - editor.doc.frames.length);
	let canGenerate = $derived(!!range && remainingFrames >= steps);

	$effect(() => {
		if (open && !wasOpen) {
			phase = 0;
			playing = false;
			stepsText = String(Math.max(2, period));
			feedback = "";
		}
		wasOpen = open;
	});

	$effect(() => {
		if (open) return;
		playing = false;
		if (phase !== 0) phase = 0;
	});

	// A single timer per phase step. Reading `phase` in the effect body makes
	// every tick schedule the next one, while a pause or close clears it.
	$effect(() => {
		if (!open || !playing || period < 2) return;
		const speed = editor.paletteCycleMs;
		const current = phase;
		const id = setTimeout(() => {
			phase = (current + 1) % period;
		}, speed);
		return () => clearTimeout(id);
	});

	$effect(() => {
		const max = Math.max(0, period - 1);
		if (phase > max) phase = max;
	});

	$effect(() => {
		if (!open || !previewCanvas) return;
		const doc = editor.doc;
		const frame = editor.activeFrame;
		const revision = editor.revision;
		const colors = palette.colors;
		const cycleRange = range;
		const currentShift = shift;
		const size = previewSize;

		const id = requestAnimationFrame(() => {
			if (!previewCanvas) return;
			let pixels = compositeFrameCached(doc, frame, revision);
			const map = cycleRange
				? buildPaletteCycleMap(colors, cycleRange, currentShift)
				: null;
			if (map) {
				if (!previewBuffer || previewBuffer.length < pixels.length) {
					previewBuffer = new Uint32Array(pixels.length);
				}
				pixels = remapPalettePixels(pixels, map, previewBuffer);
			}
			previewCanvas.style.width = `${size.width}px`;
			previewCanvas.style.height = `${size.height}px`;
			drawScaled(
				previewCanvas,
				pixels,
				doc.width,
				doc.height,
				size.width,
				size.height,
			);
		});
		return () => cancelAnimationFrame(id);
	});

	function togglePlayback(): void {
		if (!range) return;
		playing = !playing;
	}

	function changeRange(start: number, end: number): void {
		editor.setPaletteCycleRange(start, end);
		if (phase >= period) phase = 0;
	}

	function onPhaseChange(value: number): void {
		playing = false;
		phase = Number.isFinite(value) ? Math.round(value) : 0;
	}

	function bake(): void {
		playing = false;
		if (shift === 0) {
			feedback = "Phase 1 is the original palette order.";
			return;
		}
		const count = editor.bakePaletteCycle(shift);
		feedback =
			count > 0
				? `Baked phase ${phase + 1} into this frame.`
				: "No pixels use colors from this range.";
	}

	function generate(): void {
		playing = false;
		const count = editor.generatePaletteCycleAnimation({
			steps,
			durationMs: editor.paletteCycleMs,
			tag,
			loop: loopNewFrames,
		});
		if (count > 0) {
			phase = 0;
			feedback = `Generated ${count} frames.`;
		} else {
			feedback = "Frame limit reached.";
		}
	}
</script>

{#snippet colorPicker(
	selected: number,
	label: string,
	onPick: (index: number) => void,
)}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			class="flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
			aria-label={label}
		>
			<span class="truncate tabular-nums">
				{selected + 1} · {palette.colors[selected]}
			</span>
			<span
				class="size-3.5 shrink-0 rounded-[3px] ring-1 ring-black/10"
				style:background={palette.colors[selected]}
			></span>
		</DropdownMenu.Trigger>
		<DropdownMenu.Content class="max-h-72">
			{#each palette.colors as color, index (index)}
				<DropdownMenu.Item class="min-w-0" onSelect={() => onPick(index)}>
					<span class="w-3.5 shrink-0">
						{#if index === selected}
							<Check class="size-3.5" />
						{/if}
					</span>
					<span
						class={cn(
							"flex-1 truncate tabular-nums",
							index === selected && "font-medium",
						)}
					>
						{index + 1} · {color}
					</span>
					<span
						class="size-3.5 shrink-0 rounded-[3px] ring-1 ring-black/10"
						style:background={color}
					></span>
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>Color cycles</Dialog.Title>
			<Dialog.Description>
				Preview a palette range, then bake it or generate a timed animation.
				Settings are not saved with the project.
			</Dialog.Description>
		</Dialog.Header>

		{#if !range}
			<p
				class="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground"
			>
				“{palette.name}” needs at least two colors. Add colors with the + button
				in the palette header, or choose another palette.
			</p>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="grid content-start gap-3">
					<div class="grid gap-1.5">
						<div class="flex items-center justify-between gap-2">
							<Label for="cycle-start">Range</Label>
							<span class="text-[10px] tabular-nums text-muted-foreground">
								{rangeLength} colors · {period} phases
							</span>
						</div>
						<div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
							{@render colorPicker(
								range.start,
								"First color in the cycle range",
								(index) => changeRange(index, range.end),
							)}
							<span class="text-[10px] text-muted-foreground">to</span>
							{@render colorPicker(
								range.end,
								"Last color in the cycle range",
								(index) => changeRange(range.start, index),
							)}
						</div>
						<!-- The strip mirrors the canvas remap, so its colors rotate in place. -->
						<div class="flex h-6 overflow-hidden rounded-md ring-1 ring-border">
							{#each phaseColors as color, index (index)}
								<span
									class="flex-1"
									style:background={color}
									title={`Position ${range.start + index + 1}: ${color}`}
								></span>
							{/each}
						</div>
					</div>

					<div class="grid gap-1.5">
						<div class="grid grid-cols-[4.5rem_1fr] items-center gap-2">
							<Label>Direction</Label>
							<div class="grid grid-cols-3 gap-1 rounded-md border p-0.5">
								{#each DIRECTIONS as option (option.id)}
									<button
										type="button"
										class={cn(
											"rounded px-1 py-1 text-center text-[11px] transition-colors",
											direction === option.id
												? "bg-accent text-foreground"
												: "text-muted-foreground hover:bg-accent/60",
										)}
										title={option.title}
										aria-pressed={direction === option.id}
										onclick={() => editor.setPaletteCycleDirection(option.id)}
									>
										{option.label}
									</button>
								{/each}
							</div>
						</div>
						<div class="grid grid-cols-[4.5rem_1fr] items-center gap-2">
							<Label for="cycle-speed">Speed</Label>
							<select
								id="cycle-speed"
								class="h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
								value={editor.paletteCycleMs}
								onchange={(event) =>
									editor.setPaletteCycleMs(
										Number((event.currentTarget as HTMLSelectElement).value),
									)}
							>
								{#each PALETTE_CYCLE_SPEEDS as speed (speed)}
									<option value={speed}>{speed} ms per step</option>
								{/each}
							</select>
						</div>
					</div>

					<div class="grid gap-1.5">
						<div class="flex items-center justify-between">
							<Label>Preview</Label>
							<div class="flex items-center gap-2">
								<span class="text-[10px] tabular-nums text-muted-foreground">
									Phase {phase + 1}/{period}
								</span>
								<Button
									variant={playing ? "secondary" : "outline"}
									size="icon-xs"
									class="rounded-full"
									onclick={togglePlayback}
									title={playing ? "Pause the preview" : "Play the preview"}
									aria-label={playing ? "Pause the preview" : "Play the preview"}
									aria-pressed={playing}
								>
									{#if playing}
										<Pause class="size-3.5" />
									{:else}
										<Play class="size-3.5" />
									{/if}
								</Button>
							</div>
						</div>
						<div
							class="checkerboard grid place-items-center overflow-hidden rounded-lg p-2 ring-1 ring-border"
						>
							<canvas
								bind:this={previewCanvas}
								class="max-w-full"
								aria-label="Color cycling preview"
							></canvas>
						</div>
						<Slider
							type="single"
							min={0}
							max={Math.max(0, period - 1)}
							step={1}
							value={phase}
							onValueChange={onPhaseChange}
							aria-label="Cycle phase"
						/>
						<div class="flex items-center justify-between text-[10px] text-muted-foreground">
							<span>Shift +{shift}</span>
							<span>{editor.paletteCycleMs} ms per step</span>
						</div>
					</div>
				</div>

				<div class="grid content-start gap-3">
					<div class="flex items-center justify-between gap-2 rounded-lg border p-3">
						<span class="grid gap-0.5">
							<span class="text-xs font-medium">Bake phase</span>
							<span class="text-[10px] text-muted-foreground">
								Writes the shown colors into visible layers.
							</span>
						</span>
						<Button variant="outline" size="sm" onclick={bake}>
							Bake into frame
						</Button>
					</div>

					<div class="grid gap-2.5 rounded-lg border p-3">
						<div class="flex items-center justify-between gap-2">
							<span class="text-xs font-medium">Generate animation</span>
							<span class="text-[10px] text-muted-foreground">One cycle pass</span>
						</div>
						<div class="grid grid-cols-[5.5rem_1fr] gap-2">
							<div class="grid gap-1">
								<Label for="cycle-steps">Frames</Label>
								<Input
									id="cycle-steps"
									type="number"
									min={2}
									max={Math.max(2, period)}
									step={1}
									value={stepsText}
									oninput={(event) => (stepsText = event.currentTarget.value)}
									onblur={() => (stepsText = String(steps))}
									class="h-8 tabular-nums"
								/>
							</div>
							<div class="grid gap-1">
								<Label for="cycle-tag">Tag</Label>
								<Input
									id="cycle-tag"
									value={tag}
									maxlength={40}
									placeholder="cycle"
									oninput={(event) => (tag = event.currentTarget.value)}
									class="h-8"
								/>
							</div>
						</div>
						<div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
							<label class="flex items-center gap-2 text-[11px]">
								<Switch bind:checked={loopNewFrames} />
								Set loop range
							</label>
							<span class="text-[10px] text-muted-foreground">
								2–{Math.max(2, period)} steps · {remainingFrames} slots left
							</span>
						</div>
						<Button class="w-full" size="sm" onclick={generate} disabled={!canGenerate}>
							<Sparkles class="size-3.5" />
							Generate {steps} frames
						</Button>
						<p class="text-[10px] text-muted-foreground">
							Each frame lasts {editor.paletteCycleMs} ms and exports with GIF and
							sprite sheets.
						</p>
					</div>

					{#if feedback}
						<p class="text-[11px] text-muted-foreground" aria-live="polite">
							{feedback}
						</p>
					{/if}
				</div>
			</div>
		{/if}

		<Dialog.Footer>
			<Button onclick={() => (open = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
