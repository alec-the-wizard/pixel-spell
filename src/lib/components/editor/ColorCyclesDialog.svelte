<script lang="ts">
	import ArrowLeft from "@lucide/svelte/icons/arrow-left";
	import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
	import ArrowRight from "@lucide/svelte/icons/arrow-right";
	import Pause from "@lucide/svelte/icons/pause";
	import Play from "@lucide/svelte/icons/play";
	import Sparkles from "@lucide/svelte/icons/sparkles";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
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
		icon: typeof ArrowRight;
		title: string;
	}[] = [
		{
			id: "forward",
			label: "Forward",
			icon: ArrowRight,
			title: "Rotate the range toward the last color",
		},
		{
			id: "reverse",
			label: "Reverse",
			icon: ArrowLeft,
			title: "Rotate the range toward the first color",
		},
		{
			id: "ping-pong",
			label: "Ping-pong",
			icon: ArrowLeftRight,
			title: "Travel forward and back without repeating the endpoints",
		},
	];

	const PREVIEW_MAX_WIDTH = 320;
	const PREVIEW_MAX_HEIGHT = 160;

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
			feedback =
				"This phase is the original palette order. Choose another phase to bake.";
			return;
		}
		const count = editor.bakePaletteCycle(shift);
		feedback =
			count > 0
				? `Baked phase ${phase + 1} into the active frame.`
				: "Nothing to bake: no pixels use colors from the selected range.";
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
			feedback = `Generated ${count} frames after the active frame. They export with GIF and sprite-sheet export.`;
		} else {
			feedback = `Could not generate frames. Keep the project under ${MAX_PROJECT_FRAMES} frames.`;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>Color cycles</Dialog.Title>
			<Dialog.Description>
				Animate a range of palette colors, preview it here, then bake the effect
				into frames. Generated frames export as a normal GIF or sprite sheet.
				Cycling ranges are workspace-only and are not saved in project files.
			</Dialog.Description>
		</Dialog.Header>

		{#if !range}
			<p
				class="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground"
			>
				“{palette.name}” needs at least two colors to cycle. Add colors with
				the + button in the palette header, or choose another palette.
			</p>
		{:else}
			<div class="grid gap-4">
				<div class="grid gap-2">
					<div class="flex items-center justify-between">
						<Label for="cycle-start">Palette range</Label>
						<span class="text-[10px] tabular-nums text-muted-foreground">
							{rangeLength} colors · phase {phase + 1}/{period}
						</span>
					</div>
					<div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
						<select
							id="cycle-start"
							class="h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
							value={range.start}
							aria-label="First color in the cycle range"
							onchange={(event) =>
								changeRange(
									Number((event.currentTarget as HTMLSelectElement).value),
									range.end,
								)}
						>
							{#each palette.colors as color, index (index)}
								<option value={index}>{index + 1} · {color}</option>
							{/each}
						</select>
						<span class="text-[10px] text-muted-foreground">to</span>
						<select
							id="cycle-end"
							class="h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
							value={range.end}
							aria-label="Last color in the cycle range"
							onchange={(event) =>
								changeRange(
									range.start,
									Number((event.currentTarget as HTMLSelectElement).value),
								)}
						>
							{#each palette.colors as color, index (index)}
								<option value={index}>{index + 1} · {color}</option>
							{/each}
						</select>
					</div>
					<!-- The strip mirrors the canvas remap, so its colors rotate in place. -->
					<div class="flex h-7 overflow-hidden rounded-md ring-1 ring-border">
						{#each phaseColors as color, index (index)}
							<span
								class="flex-1"
								style:background={color}
								title={`Position ${range.start + index + 1}: ${color}`}
							></span>
						{/each}
					</div>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-1.5">
						<Label>Direction</Label>
						<div class="grid grid-cols-3 gap-1 rounded-lg border p-1">
							{#each DIRECTIONS as option (option.id)}
								{@const Icon = option.icon}
								<button
									type="button"
									class={cn(
										"flex items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors",
										direction === option.id
											? "bg-accent text-foreground"
											: "text-muted-foreground hover:bg-accent/60",
									)}
									title={option.title}
									aria-pressed={direction === option.id}
									onclick={() => editor.setPaletteCycleDirection(option.id)}
								>
									<Icon class="size-3" />
									{option.label}
								</button>
							{/each}
						</div>
					</div>

					<div class="grid gap-1.5">
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

				<div class="grid gap-2">
					<div class="flex items-center justify-between">
						<Label>Preview</Label>
						<div class="flex items-center gap-1">
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
						class="checkerboard grid min-h-24 place-items-center overflow-hidden rounded-lg p-2 ring-1 ring-border"
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
						<span>Phase {phase + 1} of {period}</span>
						<span class="font-mono tabular-nums">shift +{shift}</span>
					</div>
				</div>

				<div class="grid gap-2 rounded-lg border px-3 py-2.5">
					<div class="flex items-center justify-between gap-2">
						<span class="grid gap-0.5">
							<span class="text-xs font-medium">Bake the current phase</span>
							<span class="text-[10px] text-muted-foreground">
								Writes the selected colors into visible normal layers. Reference
								layers stay untouched.
							</span>
						</span>
						<Button variant="outline" size="sm" onclick={bake} disabled={!range}>
							Bake phase into this frame
						</Button>
					</div>
				</div>

				<div class="grid gap-3 rounded-lg border px-3 py-2.5">
					<div class="grid gap-0.5">
						<span class="text-xs font-medium">Generate cycle animation</span>
						<span class="text-[10px] text-muted-foreground">
							Inserts one full pass after the active frame, rotating every
							visible layer. The frames carry a duration and tag, so they play
							and export like normal animation.
						</span>
					</div>
					<div class="grid gap-2 sm:grid-cols-[8rem_1fr]">
						<div class="grid gap-1.5">
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
							<span class="text-[10px] text-muted-foreground">
								2–{Math.max(2, period)} steps
							</span>
						</div>
						<div class="grid gap-1.5">
							<Label for="cycle-tag">Tag</Label>
							<Input
								id="cycle-tag"
								value={tag}
								maxlength={40}
								placeholder="cycle"
								oninput={(event) => (tag = event.currentTarget.value)}
								class="h-8"
							/>
							<span class="text-[10px] text-muted-foreground">
								Each frame lasts {editor.paletteCycleMs} ms
							</span>
						</div>
					</div>
					<label
						class="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-2.5 py-2"
					>
						<span class="grid gap-0.5">
							<span class="text-xs font-medium">Set the loop range</span>
							<span class="text-[10px] text-muted-foreground">
								Restricts playback and GIF export to the new frames.
							</span>
						</span>
						<Switch bind:checked={loopNewFrames} />
					</label>
					<div class="flex items-center justify-between gap-2">
						<span class="text-[10px] text-muted-foreground">
							{remainingFrames} frame slots left
						</span>
						<Button size="sm" onclick={generate} disabled={!canGenerate}>
							<Sparkles class="size-3.5" />
							Generate {steps} frames
						</Button>
					</div>
				</div>

				{#if feedback}
					<p class="text-[11px] text-muted-foreground" aria-live="polite">
						{feedback}
					</p>
				{/if}
			</div>
		{/if}

		<Dialog.Footer>
			<Button onclick={() => (open = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
