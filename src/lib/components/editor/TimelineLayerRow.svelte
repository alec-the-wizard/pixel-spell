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
	import { tick } from "svelte";
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
		last = false,
		dragging = false,
		isDragSource = false,
		dropMode = null,
		firstFrame,
		lastFrame,
		onFrameContextMenu,
		onDragStart,
		onDragOver,
		onDrop,
		onDragEnd,
	}: {
		layer: Layer;
		depth?: number;
		last?: boolean;
		dragging?: boolean;
		isDragSource?: boolean;
		dropMode?: "before" | "after" | "into" | null;
		firstFrame: number;
		lastFrame: number;
		onFrameContextMenu: (
			event: MouseEvent,
			frameIndex: number,
			layerId: string,
		) => void;
		onDragStart?: (event: DragEvent) => void;
		onDragOver?: (mode: "before" | "after" | "into" | null) => void;
		onDrop?: (mode: "before" | "after" | "into") => void;
		onDragEnd?: () => void;
	} = $props();

	let isGroup = $derived(isGroupLayer(layer));
	let isReference = $derived(layer.role === "reference");
	let activeRow = $derived(layer.id === editor.activeLayerId);
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
			? layerTint(layer.color, 26, "var(--accent)")
			: layerTint(layer.color, 16);
	});

	/** Tree connector glyphs for child layers: ancestors "│", then "├" or "└". */
	let treeGuide = $derived(
		"│".repeat(Math.max(0, depth - 1)) + (last ? "└" : "├"),
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

	/** Shading strength for a cel cell; stronger for the focused layer/frame. */
	function cellBackground(
		activeFrame: boolean,
		activeCel: boolean,
		selectedFrame: boolean,
	): string | undefined {
		if (!layer.color) return undefined;
		if (activeCel) return layerTint(layer.color, 26);
		if (activeRow || activeFrame) return layerTint(layer.color, 16);
		if (selectedFrame) return layerTint(layer.color, 13);
		return layerTint(layer.color, 9);
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

	function subtitle(): string {
		const parts = [`${Math.round(layer.opacity * 100)}%`];
		const mode = layer.blendMode ?? "normal";
		if (mode !== "normal") parts.push(BLEND_MODE_LABELS[mode]);
		if (layer.clipping) parts.push("Clipped");
		if (isGroup) parts.push("Group");
		else if (isReference) parts.push("Reference");
		else parts.push(layer.visible ? "Visible" : "Hidden");
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

{#if isGroup}
	<tr
		class={cn(sourceDim && "opacity-40")}
		ondragover={handleDragOver}
		ondrop={handleDrop}
	>
		<th
			scope="row"
			class={cn(
				"sticky left-0 z-10 h-12 w-60 min-w-60 max-w-60 border-b border-r p-0 text-left align-middle",
				!layer.color && (activeRow ? "bg-accent" : "bg-background"),
			)}
			style:background={headerBackground}
			style:box-shadow={dropShadow}
			draggable="true"
			ondragstart={(event) => onDragStart?.(event)}
			ondragend={() => onDragEnd?.()}
		>
			<div
				class="flex h-12 items-center gap-0.5"
				style:padding-left={`${depth * 12 + 4}px`}
			>
				<Button
					variant="ghost"
					size="icon-xs"
					class="size-6 shrink-0 text-muted-foreground"
					title={layer.collapsed ? "Expand group" : "Collapse group"}
					aria-label={layer.collapsed ? "Expand group" : "Collapse group"}
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
					onclick={() => editor.toggleLayerVisibility(layer.id)}
				>
					{#if layer.visible}
						<Eye class="size-3.5" />
					{:else}
						<EyeOff class="size-3.5" />
					{/if}
				</Button>

				<div class="min-w-0 flex-1 pr-2">
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
							<span class="block truncate text-xs font-medium">
								{layer.name}
							</span>
							<span class="block truncate text-[10px] text-muted-foreground">
								{subtitle()}
							</span>
						</button>
					{/if}
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
				"sticky left-0 z-10 h-12 w-60 min-w-60 max-w-60 border-b border-r p-0 text-left align-middle",
				!layer.color && (activeRow ? "bg-accent" : "bg-background"),
			)}
			style:background={headerBackground}
			style:box-shadow={dropShadow}
			draggable="true"
			ondragstart={(event) => onDragStart?.(event)}
			ondragend={() => onDragEnd?.()}
		>
			<div class="flex h-12 items-center gap-1.5 pr-2">
				{#if depth > 0}
					<span
						class="shrink-0 select-none whitespace-pre font-mono text-[11px] leading-none text-muted-foreground/60"
						aria-hidden="true"
						title="Part of a group"
					>
						{treeGuide}
					</span>
				{/if}

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

				{#if layer.clipping}
					<Scissors
						class="size-3.5 shrink-0 text-primary"
						aria-label="Clips to layer below"
					/>
				{/if}

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
								{subtitle()}
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
				style:background={layer.color ? layerTint(layer.color, 9) : undefined}
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
