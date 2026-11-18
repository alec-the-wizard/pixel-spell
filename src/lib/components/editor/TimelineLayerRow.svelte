<script module lang="ts">
	/** Horizontal pixels added per nesting level in the layer column. */
	export const LAYER_INDENT = 12;
</script>

<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import Eye from "@lucide/svelte/icons/eye";
	import EyeOff from "@lucide/svelte/icons/eye-off";
	import Folder from "@lucide/svelte/icons/folder";
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import Lock from "@lucide/svelte/icons/lock";
	import LockOpen from "@lucide/svelte/icons/lock-open";
	import ScanEye from "@lucide/svelte/icons/scan-eye";
	import Scissors from "@lucide/svelte/icons/scissors";
	import { Button } from "$lib/components/ui/button/index.js";
	import { BLEND_MODE_LABELS } from "$lib/editor/blend.js";
	import { isGroupLayer } from "$lib/editor/doc.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { layerTint } from "$lib/editor/layer-color.js";
	import type { Layer } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";
	import CelThumb from "./CelThumb.svelte";

	let {
		layer,
		depth = 0,
		dragging = false,
		isDragSource = false,
		dropMode = null,
		firstFrame,
		lastFrame,
		onCelPointerDown,
		onCelPointerEnter,
		onCelContextMenu,
		onLayerContextMenu,
		onLayerProperties,
		onDragStart,
		onDragOver,
		onDrop,
		onDragEnd,
	}: {
		layer: Layer;
		depth?: number;
		dragging?: boolean;
		isDragSource?: boolean;
		dropMode?: "before" | "after" | "into" | null;
		firstFrame: number;
		lastFrame: number;
		onCelPointerDown: (
			event: PointerEvent,
			layerId: string,
			frameIndex: number,
		) => void;
		onCelPointerEnter: (layerId: string, frameIndex: number) => void;
		onCelContextMenu: (
			event: MouseEvent,
			layerId: string,
			frameIndex: number,
		) => void;
		onLayerContextMenu: (event: MouseEvent, layer: Layer) => void;
		onLayerProperties: (layer: Layer) => void;
		onDragStart?: (event: DragEvent) => void;
		onDragOver?: (mode: "before" | "after" | "into" | null) => void;
		onDrop?: (mode: "before" | "after" | "into") => void;
		onDragEnd?: () => void;
	} = $props();

	let isGroup = $derived(isGroupLayer(layer));
	let isReference = $derived(layer.role === "reference");
	let activeRow = $derived(layer.id === editor.activeLayerId);
	let selectedRow = $derived(editor.isLayerSelected(layer.id));

	let visibleFrames = $derived(
		lastFrame >= firstFrame
			? editor.doc.frames.slice(firstFrame, lastFrame + 1)
			: [],
	);
	let trailingFrames = $derived(
		Math.max(0, editor.doc.frames.length - 1 - lastFrame),
	);

	let headerBackground = $derived.by(() => {
		if (selectedRow || !layer.color) return undefined;
		return layerTint(layer.color, 16);
	});

	/** Row header use the same selection tint as selected cels. */
	let headerClass = $derived(
		selectedRow ? "bg-primary/15" : "bg-background",
	);

	/** One entry per nesting level, used to draw IDE-style indent guides. */
	let indentLevels = $derived(
		Array.from({ length: Math.max(0, depth) }, (_, level) => level),
	);

	let dropShadow = $derived(
		dropMode === "before"
			? "inset 0 2px 0 0 var(--primary)"
			: dropMode === "after"
				? "inset 0 -2px 0 0 var(--primary)"
				: dropMode === "into"
					? "inset 0 0 0 2px var(--primary)"
					: undefined,
	);
	let sourceDim = $derived(dragging && isDragSource);

	/** Layer color tint for cells that are not part of the selection. */
	function cellBackground(selected: boolean): string | undefined {
		if (selected || !layer.color) return undefined;
		return layerTint(layer.color, 9);
	}

	/** Row controls (visibility, lock, collapse) must not select the row. */
	function isControlTarget(event: Event): boolean {
		return !!(event.target as HTMLElement | null)?.closest(
			"[data-layer-control]",
		);
	}

	function handleHeaderClick(event: MouseEvent): void {
		if (isControlTarget(event)) return;
		if (event.shiftKey) {
			editor.extendLayerSelection(layer.id);
		} else if (event.ctrlKey || event.metaKey) {
			editor.toggleLayerSelection(layer.id);
		} else {
			editor.selectLayer(layer.id);
		}
	}

	function handleHeaderDoubleClick(event: MouseEvent): void {
		if (isControlTarget(event)) return;
		event.stopPropagation();
		onLayerProperties(layer);
	}

	function handleHeaderContextMenu(event: MouseEvent): void {
		event.preventDefault();
		onLayerContextMenu(event, layer);
	}

	function subtitle(): string {
		const parts = [`${Math.round(layer.opacity * 100)}%`];
		const mode = layer.blendMode ?? "normal";
		if (mode !== "normal") parts.push(BLEND_MODE_LABELS[mode]);
		if (layer.clipping) parts.push("Clipped");
		if (isGroup) parts.push("Group");
		else if (isReference) parts.push("Reference");
		return parts.join(" · ");
	}

	function dragMode(event: DragEvent): "before" | "after" | "into" {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const ratio =
			rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
		if (isGroup && ratio > 0.28 && ratio < 0.72) return "into";
		return ratio < 0.5 ? "before" : "after";
	}

	function handleDragOver(event: DragEvent): void {
		if (!dragging) return;
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = isDragSource ? "none" : "move";
		}
		onDragOver?.(isDragSource ? null : dragMode(event));
	}

	function handleDrop(event: DragEvent): void {
		if (!dragging || isDragSource) return;
		event.preventDefault();
		onDrop?.(dragMode(event));
	}
</script>

{#snippet indentGuides()}
	{#if indentLevels.length > 0}
		<span class="pointer-events-none absolute inset-0" aria-hidden="true">
			{#each indentLevels as level (level)}
				<span
					class="absolute inset-y-2.5 w-px rounded-full bg-muted-foreground/30"
					style:left={`${10 + level * LAYER_INDENT}px`}
				></span>
			{/each}
		</span>
	{/if}
{/snippet}

{#if isGroup}
	<tr
		class={cn(sourceDim && "opacity-40")}
		ondragover={handleDragOver}
		ondrop={handleDrop}
	>
		<th
			scope="row"
			class={cn(
				"sticky left-0 z-10 h-12 w-[var(--layer-col-width)] min-w-[var(--layer-col-width)] max-w-[var(--layer-col-width)] border-b border-r p-0 text-left align-middle",
				!layer.color && headerClass,
			)}
			style:background={headerBackground}
			style:box-shadow={dropShadow}
			draggable="true"
			ondragstart={(event) => onDragStart?.(event)}
			ondragend={() => onDragEnd?.()}
			onclick={handleHeaderClick}
			ondblclick={handleHeaderDoubleClick}
			oncontextmenu={handleHeaderContextMenu}
		>
			<div
				class="relative flex h-12 items-center gap-0.5"
				style:padding-left={`${4 + depth * LAYER_INDENT}px`}
			>
				{@render indentGuides()}
				<Button
					variant="ghost"
					size="icon-xs"
					class="size-6 shrink-0 text-muted-foreground"
					title={layer.collapsed ? "Expand group" : "Collapse group"}
					aria-label={layer.collapsed ? "Expand group" : "Collapse group"}
					data-layer-control
					onclick={() => editor.toggleGroupCollapsed(layer.id)}
				>
					{#if layer.collapsed}
						<ChevronRight class="size-3.5" />
					{:else}
						<ChevronDown class="size-3.5" />
					{/if}
				</Button>
				<span class="shrink-0 text-muted-foreground">
					{#if layer.collapsed}
						<Folder class="size-3.5" />
					{:else}
						<FolderOpen class="size-3.5" />
					{/if}
				</span>
				<Button
					variant="ghost"
					size="icon-xs"
					class={cn(
						"size-7 shrink-0",
						layer.visible ? "text-foreground" : "text-muted-foreground/50",
					)}
					title={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
					aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
					data-layer-control
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
					title={layer.locked ? "Unlock group" : "Lock group"}
					aria-label={layer.locked ? "Unlock group" : "Lock group"}
					aria-pressed={layer.locked}
					data-layer-control
					onclick={() => editor.toggleLayerLock(layer.id)}
				>
					{#if layer.locked}
						<Lock class="size-3.5" />
					{:else}
						<LockOpen class="size-3.5" />
					{/if}
				</Button>

				<div class="min-w-0 flex-1 pr-2">
					<span class="block truncate text-xs font-medium">
						{layer.name}
					</span>
					<span class="block truncate text-[10px] text-muted-foreground">
						{subtitle()}
					</span>
				</div>
			</div>
		</th>
		<td
			colspan={editor.doc.frames.length + 2}
			class="h-12 border-b"
			style:background={layer.color ? layerTint(layer.color, 9) : undefined}
		></td>
	</tr>
{:else}
	<tr
		class={cn(sourceDim && "opacity-40")}
		ondragover={handleDragOver}
		ondrop={handleDrop}
	>
		<th
			scope="row"
			class={cn(
				"sticky left-0 z-10 h-12 w-[var(--layer-col-width)] min-w-[var(--layer-col-width)] max-w-[var(--layer-col-width)] border-b border-r p-0 text-left align-middle",
				!layer.color && headerClass,
			)}
			style:background={headerBackground}
			style:box-shadow={dropShadow}
			draggable="true"
			ondragstart={(event) => onDragStart?.(event)}
			ondragend={() => onDragEnd?.()}
			onclick={handleHeaderClick}
			ondblclick={handleHeaderDoubleClick}
			oncontextmenu={handleHeaderContextMenu}
		>
			<div
				class="relative flex h-12 items-center gap-1.5 pr-2"
				style:padding-left={`${4 + depth * LAYER_INDENT}px`}
			>
				{@render indentGuides()}

				<Button
					variant="ghost"
					size="icon-xs"
					class={cn(
						"size-7 shrink-0",
						layer.visible ? "text-foreground" : "text-muted-foreground/50",
					)}
					title={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
					aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
					data-layer-control
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
					data-layer-control
					onclick={() => editor.toggleLayerLock(layer.id)}
				>
					{#if layer.locked}
						<Lock class="size-3.5" />
					{:else}
						<LockOpen class="size-3.5" />
					{/if}
				</Button>

				{#if layer.clipping}
					<Scissors
						class="size-3.5 shrink-0 text-primary"
						aria-label="Clips to layer below"
					/>
				{/if}

				<div class="min-w-0 flex-1">
					<span class="flex min-w-0 items-center gap-1">
						{#if isReference}
							<ScanEye class="size-3 shrink-0 text-primary" />
						{/if}
						<span class="truncate text-xs font-medium">{layer.name}</span>
					</span>
					<span class="block truncate text-[10px] text-muted-foreground">
						{subtitle()}
					</span>
				</div>
			</div>
		</th>

		{#if firstFrame > 0}
			<td
				colspan={firstFrame}
				class="h-12 border-b"
				style:background={layer.color ? layerTint(layer.color, 9) : undefined}
			></td>
		{/if}

		{#each visibleFrames as frame, offset (frame.id)}
			{@const index = firstFrame + offset}
			{@const activeFrame = index === editor.activeFrame}
			{@const activeCel = activeRow && activeFrame}
			{@const selectedFrame = editor.isFrameSelected(index)}
			{@const selectedCel = selectedRow || selectedFrame}

			<td
				class={cn(
					"h-12 w-14 min-w-14 border-b border-r p-1 text-center align-middle",
					selectedCel && "bg-primary/15",
				)}
				style:background={cellBackground(selectedCel)}
				onpointerenter={() => onCelPointerEnter(layer.id, index)}
			>
				<button
					type="button"
					class={cn(
						"checkerboard relative inline-block size-10 select-none overflow-hidden rounded-md transition-colors",
						activeCel
							? "border-2 border-primary"
							: "border border-border/60 hover:border-muted-foreground/40",
					)}
					onpointerdown={(event) => onCelPointerDown(event, layer.id, index)}
					onclick={(event) => {
						// Mouse selection happens on pointerdown so dragging a block
						// works; keep keyboard activation working.
						if (event.detail === 0) editor.selectCel(layer.id, index);
					}}
					oncontextmenu={(event) => onCelContextMenu(event, layer.id, index)}
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
				style:background={layer.color ? layerTint(layer.color, 9) : undefined}
			></td>
		{/if}

		<td
			class="h-12 w-10 min-w-10 border-b"
			style:background={layer.color ? layerTint(layer.color, 9) : undefined}
		></td>
		<td
			class="h-12 border-b"
			style:background={layer.color ? layerTint(layer.color, 9) : undefined}
		></td>
	</tr>
{/if}
