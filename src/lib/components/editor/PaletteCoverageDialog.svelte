<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	let palette = $derived(editor.activePalette);
	let analysis = $derived.by(() => {
		// Recompute after pixel edits and palette changes while the dialog is open.
		editor.revision;
		return editor.analyzePaletteCoverage(palette.colors);
	});

	let maxUsage = $derived(
		Math.max(1, ...analysis.entries.map((entry) => entry.count)),
	);
	let coveragePercent = $derived(
		analysis.paintedPixels > 0 ? Math.round(analysis.coverage * 100) : 0,
	);
	let hueGaps = $derived(
		analysis.hueBins.filter((bin) => bin.count === 0).length,
	);
	let canPrune = $derived(editor.paletteEditable && analysis.unusedColors > 0);
	let readOnlyNotice = $derived(
		editor.paletteLocked
			? "The palette is locked. Unlock it to remove unused colors."
			: palette.builtin
				? "The Default palette is read-only. Create an editable palette to prune colors."
				: "",
	);

	const hue = (index: number) => Math.round((index * 360) / analysis.hueBins.length);
	const valueShade = (bin: { start: number; end: number }) =>
		Math.round(((bin.start + bin.end) / 2) * 100);

	function removeUnused(): void {
		if (!canPrune) return;
		editor.removeUnusedPaletteColors();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>Palette coverage</Dialog.Title>
			<Dialog.Description>
				Usage of “{palette.name}” across every frame and normal layer. Reference layers
				are ignored.
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-4">
			<div class="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
				<div class="bg-popover px-2.5 py-1.5">
					<p class="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
						Used
					</p>
					<p class="text-sm font-semibold tabular-nums">
						{analysis.usedColors}<span class="text-[10px] font-normal text-muted-foreground"
							> / {analysis.paletteSize}</span
						>
					</p>
				</div>
				<div class="bg-popover px-2.5 py-1.5">
					<p class="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
						Unused
					</p>
					<p
						class={cn(
							"text-sm font-semibold tabular-nums",
							analysis.unusedColors > 0 && "text-primary",
						)}
					>
						{analysis.unusedColors}
					</p>
				</div>
				<div class="bg-popover px-2.5 py-1.5">
					<p class="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
						Coverage
					</p>
					<p class="text-sm font-semibold tabular-nums">{coveragePercent}%</p>
				</div>
				<div class="bg-popover px-2.5 py-1.5">
					<p class="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
						Painted pixels
					</p>
					<p class="text-sm font-semibold tabular-nums">
						{analysis.paintedPixels.toLocaleString()}
					</p>
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-[1.15fr_1fr]">
				<div class="grid min-w-0 content-start gap-1.5">
					<div class="flex items-baseline justify-between gap-2">
						<span class="text-xs font-medium">Palette usage</span>
						<span class="truncate text-[10px] tabular-nums text-muted-foreground">
							{analysis.matchedPixels.toLocaleString()} /
							{analysis.paintedPixels.toLocaleString()} px on palette
						</span>
					</div>
					{#if analysis.paintedPixels === 0}
						<p
							class="rounded-lg border border-dashed px-3 py-6 text-center text-[10px] text-muted-foreground"
						>
							Nothing is painted yet. Draw on a normal layer to see how the palette
							is used.
						</p>
					{:else}
						<ul class="max-h-64 space-y-0.5 overflow-y-auto pr-1">
							{#each analysis.entries as entry (entry.color)}
								<li
									class="flex items-center gap-2"
									title={`${entry.color} — ${entry.count.toLocaleString()} px`}
								>
									<span
										class={cn(
											"size-3.5 shrink-0 rounded-[3px] ring-1 ring-black/10",
											entry.count === 0 && "opacity-40",
										)}
										style:background={entry.color}
									></span>
									<span
										class={cn(
											"w-14 shrink-0 font-mono text-[10px] uppercase",
											entry.count === 0
												? "text-muted-foreground"
												: "text-foreground",
										)}
									>
										{entry.color}
									</span>
									<div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
										<div
											class="h-full rounded-full bg-primary"
											style:width={`${(entry.count / maxUsage) * 100}%`}
										></div>
									</div>
									<span
										class={cn(
											"w-14 shrink-0 text-right text-[10px] tabular-nums",
											entry.count === 0
												? "text-muted-foreground"
												: "text-foreground",
										)}
									>
										{entry.count === 0
											? "unused"
											: entry.count.toLocaleString()}
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<div class="grid min-w-0 content-start gap-4">
					<div class="grid gap-1">
						<div class="flex items-baseline justify-between gap-2">
							<span class="text-xs font-medium">Hue coverage</span>
							<span
								class={cn(
									"text-[10px] tabular-nums text-muted-foreground",
									hueGaps > 0 && "text-primary",
								)}
							>
								{hueGaps} {hueGaps === 1 ? "gap" : "gaps"} · {analysis.neutralColors}
								neutral
							</span>
						</div>
						<div class="grid grid-cols-12 gap-0.5" aria-label="Palette colors per hue range">
							{#each analysis.hueBins as bin, index (index)}
								<div
									class={cn(
										"flex h-9 items-center justify-center rounded-md text-white",
										bin.count === 0 &&
											"border border-dashed border-border text-muted-foreground",
									)}
									style:background={bin.count === 0
										? "transparent"
										: `linear-gradient(to bottom, hsl(${hue(index)} 75% 58%), hsl(${hue(index)} 75% 34%))`}
									title={`${bin.start}°–${bin.end}°: ${bin.count} ${bin.count === 1 ? "color" : "colors"}`}
								>
									<span class="text-[10px] font-medium tabular-nums">{bin.count}</span>
								</div>
							{/each}
						</div>
						<div
							class="h-1 rounded-full"
							style="background: linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)"
						></div>
					</div>

					<div class="grid gap-1">
						<div class="flex items-baseline justify-between gap-2">
							<span class="text-xs font-medium">Brightness coverage</span>
							<span class="text-[10px] text-muted-foreground">palette colors</span>
						</div>
						<div class="grid grid-cols-8 gap-0.5" aria-label="Palette colors per brightness range">
							{#each analysis.valueBins as bin (bin.start)}
								<div
									class={cn(
										"flex h-9 items-center justify-center rounded-md",
										bin.count === 0
											? "border border-dashed border-border text-muted-foreground"
											: "text-white/90 ring-1 ring-border",
									)}
									style:background={bin.count === 0
										? "transparent"
										: `hsl(0 0% ${valueShade(bin)}%)`}
									title={`${Math.round(bin.start * 100)}%–${Math.round(bin.end * 100)}% brightness: ${bin.count} ${bin.count === 1 ? "color" : "colors"}`}
								>
									<span
										class={cn(
											"text-[10px] font-medium tabular-nums",
											bin.count > 0 && valueShade(bin) > 55
												? "text-black/80"
												: "text-white/90",
										)}
									>
										{bin.count}
									</span>
								</div>
							{/each}
						</div>
						<div
							class="h-1 rounded-full bg-linear-to-r from-black via-neutral-500 to-white"
						></div>
					</div>
				</div>
			</div>

			<div class="grid gap-1.5">
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-xs font-medium">Off-palette colors</span>
					<span class="text-[10px] tabular-nums text-muted-foreground">
						{analysis.offPaletteCount.toLocaleString()} found ·
						{analysis.offPalettePixels.toLocaleString()} px
					</span>
				</div>
				{#if analysis.offPaletteCount === 0}
					<p class="text-[10px] text-muted-foreground">
						Every painted pixel uses a color from the palette.
					</p>
				{:else}
					<div class="flex max-h-20 flex-wrap gap-1 overflow-y-auto" aria-label="Off-palette colors">
						{#each analysis.offPalette as entry (entry.color)}
							<span
								class="inline-flex items-center gap-1 rounded-md border px-1.5 py-1"
								title={`${entry.color} — ${entry.count.toLocaleString()} px`}
							>
								<span
									class="size-3 shrink-0 rounded-[2px] ring-1 ring-black/10"
									style:background={entry.color}
								></span>
								<span class="text-[9px] tabular-nums text-muted-foreground">
									{entry.count.toLocaleString()}
								</span>
							</span>
						{/each}
						{#if analysis.offPaletteCount > analysis.offPalette.length}
							<span class="self-center px-1 text-[9px] text-muted-foreground">
								+{(analysis.offPaletteCount - analysis.offPalette.length).toLocaleString()} more
							</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<Dialog.Footer class="sm:justify-between">
			<p class="max-w-80 text-[10px] text-muted-foreground">
				{#if readOnlyNotice}
					{readOnlyNotice}
				{:else if analysis.unusedColors > 0}
					{analysis.unusedColors} palette
					{analysis.unusedColors === 1 ? "color is" : "colors are"} not used by any
					frame or normal layer.
				{:else if analysis.paletteSize > 0}
					Every palette color is used.
				{/if}
			</p>
			<div class="flex justify-end gap-2">
				<Button
					variant="outline"
					onclick={removeUnused}
					disabled={!canPrune}
					title={canPrune
						? "Remove palette colors that no frame or normal layer uses"
						: readOnlyNotice || "No unused colors to remove"}
				>
					Remove unused
				</Button>
				<Button onclick={() => (open = false)}>Close</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
