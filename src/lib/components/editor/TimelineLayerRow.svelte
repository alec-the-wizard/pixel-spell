<script lang="ts">
	import Ban from "@lucide/svelte/icons/ban";
	import Check from "@lucide/svelte/icons/check";
	import Eye from "@lucide/svelte/icons/eye";
	import EyeOff from "@lucide/svelte/icons/eye-off";
	import Lock from "@lucide/svelte/icons/lock";
	import LockOpen from "@lucide/svelte/icons/lock-open";
	import ScanEye from "@lucide/svelte/icons/scan-eye";
	import { tick } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		LAYER_COLOR_PRESETS,
		layerColorName,
		layerTint,
	} from "$lib/editor/layer-color.js";
	import type { Layer } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";
	import CelThumb from "./CelThumb.svelte";

	let {
		layer,
		firstFrame,
		lastFrame,
		onFrameContextMenu,
	}: {
		layer: Layer;
		firstFrame: number;
		lastFrame: number;
		onFrameContextMenu: (
			event: MouseEvent,
			frameIndex: number,
			layerId: string,
		) => void;
	} = $props();

	let isReference = $derived(layer.role === "reference");
	let activeRow = $derived(layer.id === editor.activeLayerId);
	let colorMenuOpen = $state(false);
	let editing = $state(false);
	let draft = $state("");
	let input = $state<HTMLInputElement | null>(null);

	let visibleFrames = $derived(
		lastFrame >= firstFrame
			? editor.doc.frames.slice(firstFrame, lastFrame + 1)
			: [],
	);
	let trailingFrames = $derived(
		Math.max(0, editor.doc.frames.length - 1 - lastFrame),
	);

	let headerBackground = $derived.by(() => {
		if (!layer.color) return undefined;
		return activeRow
			? layerTint(layer.color, 24, "var(--accent)")
			: layerTint(layer.color, 14);
	});

	/** Shading strength for a cel cell; stronger for the focused layer/frame. */
	function cellBackground(
		activeFrame: boolean,
		activeCel: boolean,
		selectedFrame: boolean,
	): string | undefined {
		if (!layer.color) return undefined;
		if (activeCel) return layerTint(layer.color, 24);
		if (activeRow || activeFrame) return layerTint(layer.color, 14);
		if (selectedFrame) return layerTint(layer.color, 12);
		return layerTint(layer.color, 7);
	}

	function chooseColor(color: string | null): void {
		editor.setLayerColor(layer.id, color);
		colorMenuOpen = false;
	}

	function startEditing(): void {
		editing = true;
		draft = layer.name;
		tick().then(() => {
			input?.focus();
			input?.select();
		});
	}

	function commit(): void {
		if (!editing) return;
		editor.renameLayer(layer.id, draft);
		editing = false;
	}

	function select(): void {
		editor.selectLayer(layer.id);
	}
</script>

<tr>
	<th
		scope="row"
		class={cn(
			"sticky left-0 z-10 h-12 w-60 min-w-60 max-w-60 border-b border-r p-0 text-left align-middle",
			!layer.color && (activeRow ? "bg-accent" : "bg-background"),
		)}
		style:background={headerBackground}
	>
		<div class="flex h-12 items-center gap-1.5 px-2">
			<Button
				variant="ghost"
				size="icon-xs"
				class={cn(
					"size-7 shrink-0",
					layer.visible ? "text-foreground" : "text-muted-foreground/50",
				)}
				title={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
				aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
				onclick={() => editor.toggleLayerVisibility(layer.id)}
			>
				{#if layer.visible}
					<Eye class="size-3.5" />
				{:else}
					<EyeOff class="size-3.5" />
				{/if}
			</Button>

			<Button
				variant="ghost"
				size="icon-xs"
				class={cn(
					"size-7 shrink-0",
					layer.locked ? "text-foreground" : "text-muted-foreground",
				)}
				title={isReference
					? "Reference layers are always locked"
					: layer.locked
						? `Unlock ${layer.name}`
						: `Lock ${layer.name}`}
				aria-label={isReference
					? "Reference layers are always locked"
					: layer.locked
						? `Unlock ${layer.name}`
						: `Lock ${layer.name}`}
				aria-pressed={layer.locked}
				disabled={isReference}
				onclick={() => editor.toggleLayerLock(layer.id)}
			>
				{#if layer.locked}
					<Lock class="size-3.5" />
				{:else}
					<LockOpen class="size-3.5" />
				{/if}
			</Button>

			<DropdownMenu.Root bind:open={colorMenuOpen}>
				<DropdownMenu.Trigger
					class={cn(
						"grid size-6 shrink-0 place-items-center rounded-full outline-none transition-colors hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-ring",
						!layer.color && "text-muted-foreground/60",
					)}
					title={layer.color
						? `Layer color: ${layerColorName(layer.color)}`
						: "Set layer color"}
					aria-label={layer.color
						? `Set layer color for ${layer.name} (currently ${layerColorName(layer.color)})`
						: `Set layer color for ${layer.name}`}
				>
					{#if layer.color}
						<span
							class="size-3.5 rounded-full border border-black/20 shadow-sm dark:border-white/25"
							style:background={layer.color}
						></span>
					{:else}
						<span
							class="size-3.5 rounded-full border border-dashed border-muted-foreground/60"
						></span>
					{/if}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="w-52 p-2" align="start">
					<DropdownMenu.Label class="px-1">Layer color</DropdownMenu.Label>
					<div class="mt-1 grid grid-cols-6 gap-1">
						{#each LAYER_COLOR_PRESETS as preset (preset.value)}
							<button
								type="button"
								class={cn(
									"size-6 rounded-md border border-black/10 transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring dark:border-white/10",
									layer.color === preset.value &&
										"ring-2 ring-ring ring-offset-1 ring-offset-popover",
								)}
								style:background={preset.value}
								title={preset.name}
								aria-label={`${preset.name} layer color`}
								aria-pressed={layer.color === preset.value}
								onclick={() => chooseColor(preset.value)}
							></button>
						{/each}
					</div>
					<div class="mt-2 flex items-center gap-1 border-t pt-2">
						<DropdownMenu.Item
							class="h-7 gap-1.5 px-1.5 text-xs"
							disabled={!layer.color}
							onSelect={() => chooseColor(null)}
						>
							{#if layer.color}
								<Ban class="size-3.5" />
							{:else}
								<Check class="size-3.5" />
							{/if}
							No color
						</DropdownMenu.Item>
						<label
							class="ml-auto flex h-7 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
							title="Pick a custom layer color"
						>
							<input
								type="color"
								class="size-5 cursor-pointer rounded border bg-transparent p-0"
								value={layer.color ?? "#8b8b8b"}
								aria-label="Custom layer color"
								onchange={(event) =>
									editor.setLayerColor(
										layer.id,
										event.currentTarget.value,
									)}
							/>
							Custom
						</label>
					</div>
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<div class="min-w-0 flex-1">
				{#if editing}
					<input
						bind:this={input}
						bind:value={draft}
						class="h-6 w-full rounded border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
						onblur={commit}
						onkeydown={(event) => {
							if (event.key === "Enter") event.currentTarget.blur();
							if (event.key === "Escape") {
								draft = layer.name;
								editing = false;
							}
						}}
					/>
				{:else}
					<button
						type="button"
						class="block w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onclick={select}
						ondblclick={(event) => {
							event.stopPropagation();
							startEditing();
						}}
						aria-pressed={layer.id === editor.activeLayerId}
						title="Double-click to rename"
					>
						<span class="flex min-w-0 items-center gap-1">
							{#if isReference}
								<ScanEye class="size-3 shrink-0 text-primary" />
							{/if}
							<span class="truncate text-xs font-medium">{layer.name}</span>
						</span>
						<span class="block truncate text-[10px] text-muted-foreground">
							{Math.round(layer.opacity * 100)}% · {layer.visible ? "Visible" : "Hidden"}
							{#if isReference}
								· Reference
							{/if}
						</span>
					</button>
				{/if}
			</div>
		</div>
	</th>

	{#if firstFrame > 0}
		<td
			colspan={firstFrame}
			class="h-12 border-b"
			style:background={layer.color ? layerTint(layer.color, 7) : undefined}
		></td>
	{/if}

	{#each visibleFrames as frame, offset (frame.id)}
		{@const index = firstFrame + offset}
		{@const activeFrame = index === editor.activeFrame}
		{@const activeCel = activeRow && activeFrame}
		{@const selectedFrame = editor.isFrameSelected(index)}

		<td
			class={cn(
				"h-12 w-14 min-w-14 border-b border-r p-1 text-center align-middle",
				(activeRow || activeFrame) && "bg-accent/40",
				selectedFrame && !activeFrame && "bg-primary/10",
				activeCel && "bg-accent/60",
			)}
			style:background={cellBackground(activeFrame, activeCel, selectedFrame)}
		>
			<button
				type="button"
				class={cn(
					"checkerboard relative inline-block size-10 overflow-hidden rounded-md border transition-all",
					activeCel
						? "border-primary ring-2 ring-primary/40"
						: selectedFrame
							? "border-primary/50"
							: "border-border/60 hover:border-muted-foreground/40",
				)}
				onclick={(event) => {
					editor.selectLayer(layer.id);
					if (event.shiftKey) {
						editor.selectFrame(index, { extend: true });
					} else if (event.ctrlKey || event.metaKey) {
						editor.toggleFrameSelection(index);
					} else {
						editor.selectFrame(index);
					}
				}}
				oncontextmenu={(event) => {
					event.preventDefault();
					editor.selectLayer(layer.id);
					if (editor.isFrameSelected(index)) {
						editor.selectFrame(index, { preserveSelection: true });
					} else {
						editor.selectFrame(index);
					}
					onFrameContextMenu(event, index, layer.id);
				}}
				aria-label={`${layer.name}, frame ${index + 1}`}
				aria-pressed={activeCel}
				title={`${layer.name} · frame ${index + 1}${frame.tag ? ` · ${frame.tag}` : ""} · ${Math.round(editor.frameDurationAt(index))} ms`}
			>
				<CelThumb {layer} frame={index} />
			</button>
		</td>
	{/each}

	{#if trailingFrames > 0}
		<td
			colspan={trailingFrames}
			class="h-12 border-b"
			style:background={layer.color ? layerTint(layer.color, 7) : undefined}
		></td>
	{/if}

	<td
		class="h-12 w-10 min-w-10 border-b"
		style:background={layer.color ? layerTint(layer.color, 7) : undefined}
	></td>
	<td
		class="h-12 border-b"
		style:background={layer.color ? layerTint(layer.color, 7) : undefined}
	></td>
</tr>
