<script lang="ts">
	import Plus from "@lucide/svelte/icons/plus";
	import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import {
		GRADIENT_MAP_SPACES,
		MAX_GRADIENT_STOPS,
		MIN_GRADIENT_STOPS,
		defaultGradientStops,
		gradientCss,
		normalizeGradientStops,
		sampleGradientHex,
		type GradientMapSpace,
	} from "$lib/editor/gradient-map.js";
	import type { GradientStop } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";

	let {
		stops = $bindable<GradientStop[]>(defaultGradientStops()),
		space = $bindable<GradientMapSpace>("rgb"),
	}: {
		stops?: GradientStop[];
		space?: GradientMapSpace;
	} = $props();

	let sorted = $derived(normalizeGradientStops(stops));
	let css = $derived(gradientCss(stops, space));
	let canAdd = $derived(stops.length < MAX_GRADIENT_STOPS);
	let canRemove = $derived(stops.length > MIN_GRADIENT_STOPS);
	let spaceHint = $derived(
		GRADIENT_MAP_SPACES.find((option) => option.id === space)?.hint ?? "",
	);

	function updateStop(
		index: number,
		patch: Partial<GradientStop>,
	): void {
		stops = stops.map((stop, current) =>
			current === index ? { ...stop, ...patch } : stop,
		);
	}

	function setPosition(index: number, percent: number): void {
		if (!Number.isFinite(percent)) return;
		updateStop(index, {
			position: Math.max(0, Math.min(1, percent / 100)),
		});
	}

	function addStop(): void {
		if (!canAdd) return;
		// Split the widest gap so adding a stop does not visibly change the
		// current gradient until its color or position is edited.
		const ordered = sorted;
		let bestStart = 0;
		let bestEnd = 1;
		let bestSpan = -1;
		if (ordered[0]!.position > 0) {
			bestSpan = ordered[0]!.position;
			bestStart = 0;
			bestEnd = ordered[0]!.position;
		}
		for (let index = 0; index < ordered.length - 1; index++) {
			const span = ordered[index + 1]!.position - ordered[index]!.position;
			if (span > bestSpan) {
				bestSpan = span;
				bestStart = ordered[index]!.position;
				bestEnd = ordered[index + 1]!.position;
			}
		}
		const last = ordered[ordered.length - 1]!.position;
		if (1 - last > bestSpan) {
			bestStart = last;
			bestEnd = 1;
		}
		const position = (bestStart + bestEnd) / 2;
		stops = [
			...stops,
			{
				position,
				color: sampleGradientHex(ordered, position, space),
			},
		];
	}

	function removeStop(index: number): void {
		if (!canRemove) return;
		stops = stops.filter((_, current) => current !== index);
	}

	function reset(): void {
		stops = defaultGradientStops();
	}
</script>

<div class="grid gap-2">
	<div class="flex items-center justify-between gap-2">
		<Label>Gradient</Label>
		<div class="flex items-center gap-0.5">
			<span class="mr-1 text-[10px] tabular-nums text-muted-foreground">
				{stops.length} stops
			</span>
			<Button
				variant="ghost"
				size="icon-xs"
				onclick={reset}
				title="Reset to the default gradient"
				aria-label="Reset gradient"
			>
				<RotateCcw class="size-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				onclick={addStop}
				disabled={!canAdd}
				title={canAdd ? "Add a stop in the widest gap" : "Stop limit reached"}
				aria-label="Add gradient stop"
			>
				<Plus class="size-3.5" />
			</Button>
		</div>
	</div>

	<div class="relative">
		<div
			class="h-9 rounded-md ring-1 ring-border"
			style:background={css}
			aria-label="Gradient preview"
			role="img"
		></div>
		<div class="pointer-events-none absolute inset-0">
			{#each sorted as stop, index (index)}
				<span
					class="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px] shadow-sm ring-1 ring-background"
					style:left={`${stop.position * 100}%`}
					style:background={stop.color}
				></span>
			{/each}
		</div>
	</div>

	<div class="grid max-h-44 gap-1.5 overflow-y-auto pr-1">
		{#each stops as stop, index (index)}
			<div class="flex items-center gap-2">
				<label
					class="relative block size-7 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
					title={`Stop ${index + 1} color`}
				>
					<span class="absolute inset-0" style:background={stop.color}></span>
					<input
						type="color"
						value={stop.color}
						oninput={(event) =>
							updateStop(index, { color: event.currentTarget.value })}
						class="absolute inset-0 size-full cursor-pointer opacity-0"
						aria-label={`Stop ${index + 1} color`}
					/>
				</label>
				<span
					class="w-16 shrink-0 font-mono text-[10px] uppercase text-muted-foreground"
				>
					{stop.color}
				</span>
				<input
					type="range"
					min="0"
					max="100"
					step="1"
					value={Math.round(stop.position * 100)}
					oninput={(event) =>
						setPosition(index, Number(event.currentTarget.value))}
					class="h-1 min-w-0 flex-1 cursor-pointer accent-primary"
					aria-label={`Stop ${index + 1} position`}
				/>
				<span class="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
					{Math.round(stop.position * 100)}%
				</span>
				<Button
					variant="ghost"
					size="icon-xs"
					onclick={() => removeStop(index)}
					disabled={!canRemove}
					title={canRemove ? "Remove this stop" : "A gradient needs two stops"}
					aria-label={`Remove stop ${index + 1}`}
					class="text-muted-foreground"
				>
					<Trash2 class="size-3.5" />
				</Button>
			</div>
		{/each}
	</div>

	<div class="grid gap-1.5">
		<Label>Blend</Label>
		<div class="grid grid-cols-2 gap-1 rounded-lg border p-1">
			{#each GRADIENT_MAP_SPACES as option (option.id)}
				<button
					type="button"
					class={cn(
						"rounded-md px-2 py-1 text-[11px] transition-colors",
						space === option.id
							? "bg-accent text-foreground"
							: "text-muted-foreground hover:bg-accent/60",
					)}
					title={option.hint}
					aria-pressed={space === option.id}
					onclick={() => (space = option.id)}
				>
					{option.label}
				</button>
			{/each}
		</div>
		<span class="text-[10px] text-muted-foreground">{spaceHint}</span>
	</div>
</div>
