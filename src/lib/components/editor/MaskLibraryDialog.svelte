<script lang="ts">
	import ImagePlus from "@lucide/svelte/icons/image-plus";
	import Plus from "@lucide/svelte/icons/plus";
	import SquareDashedMousePointer from "@lucide/svelte/icons/square-dashed-mouse-pointer";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { brushMaskFor } from "$lib/editor/brush.js";
	import {
		addCustomBrush,
		allBrushes,
		brushLibrary,
		deleteCustomBrush,
		duplicateCustomBrush,
		findBrush,
		isBuiltinBrush,
		updateCustomBrush,
	} from "$lib/editor/brush-library.svelte.js";
	import { checkerDitherPattern } from "$lib/editor/dither.js";
	import {
		addCustomDitherPattern,
		allDitherPatterns,
		deleteCustomDitherPattern,
		ditherLibrary,
		duplicateDitherPattern,
		findDitherPattern,
		updateCustomDitherPattern,
	} from "$lib/editor/dither-library.svelte.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		IMAGE_IMPORT_ACCEPT,
		MAX_IMPORT_FILE_BYTES,
		analyzeImportFile,
		importNameFromFile,
	} from "$lib/editor/import.js";
	import {
		MAX_BRUSH_MASK_SIZE,
		MAX_DITHER_PATTERN_SIZE,
		clearMask,
		cloneMask,
		createMask,
		fillMask,
		flipMaskHorizontal,
		flipMaskVertical,
		invertMask,
		maskDensity,
		maskFromPixels,
		maskFromSelection,
		resizeMaskCanvas,
		rotateMaskClockwise,
		scaleMaskToLongest,
		type PixelMask,
	} from "$lib/editor/mask.js";
	import { cn } from "$lib/utils.js";
	import MaskGridEditor from "./MaskGridEditor.svelte";
	import MaskThumb from "./MaskThumb.svelte";

	let { open = $bindable(false) } = $props();

	type Tab = "brush" | "pattern";
	interface Draft {
		tab: Tab;
		sourceId: string | null;
		name: string;
		mask: PixelMask;
		defaultSize: number;
		defaultOpacity: number;
	}

	let tab = $state<Tab>("brush");
	let selectedId = $state("");
	let search = $state("");
	let draft = $state<Draft | null>(null);
	let draftRevision = $state(0);
	let widthText = $state("8");
	let heightText = $state("8");
	let importInput = $state<HTMLInputElement>();
	let importing = $state(false);
	let error = $state("");
	let wasOpen = false;

	let brushes = $derived(allBrushes());
	let patterns = $derived(allDitherPatterns());
	let activeItems = $derived(tab === "brush" ? brushes : patterns);
	let filteredItems = $derived.by(() => {
		const query = search.trim().toLowerCase();
		if (!query) return activeItems;
		return activeItems.filter((item) => item.name.toLowerCase().includes(query));
	});
	let selectedBrush = $derived(findBrush(selectedId));
	let selectedPattern = $derived(findDitherPattern(selectedId));
	let selectedItem = $derived(
		tab === "brush" ? selectedBrush : selectedPattern,
	);
	let canDelete = $derived(
		tab === "brush"
			? !!selectedBrush && !isBuiltinBrush(selectedBrush.id)
			: !!selectedPattern && !selectedPattern.builtin,
	);
	let previewMask = $derived.by(() => {
		if (selectedBrush) return brushMaskFor(selectedBrush, 24);
		if (selectedPattern) return selectedPattern.mask;
		return null;
	});
	let draftDensity = $derived.by(() => {
		draftRevision;
		return draft ? maskDensity(draft.mask) : 0;
	});
	let draftPreviewMask = $derived.by(() => {
		draftRevision;
		if (!draft) return null;
		if (draft.tab === "pattern") return draft.mask;
		return brushMaskFor(
			{
				id: "draft",
				name: draft.name,
				builtin: false,
				mask: draft.mask,
				defaultSize: draft.defaultSize,
				defaultOpacity: draft.defaultOpacity,
			},
			Math.min(32, Math.max(8, draft.defaultSize)),
		);
	});

	function refreshSelection(): void {
		const active =
			tab === "brush"
				? findBrush(editor.activeBrush.id)
				: findDitherPattern(editor.activeDitherPattern.id);
		selectedId = active?.id ?? activeItems[0]?.id ?? "";
	}

	function switchTab(next: Tab): void {
		if (tab === next) return;
		tab = next;
		editor.maskLibraryTab = next;
		draft = null;
		search = "";
		error = "";
		refreshSelection();
	}

	function beginEditBrush(id: string): void {
		const brush = findBrush(id);
		if (!brush) return;
		if (brush.builtin) {
			const bakedSize = Math.max(8, brush.defaultSize);
			draft = {
				tab: "brush",
				sourceId: null,
				name: `${brush.name} copy`,
				mask: brushMaskFor(brush, bakedSize),
				defaultSize: bakedSize,
				defaultOpacity: brush.defaultOpacity,
			};
		} else {
			draft = {
				tab: "brush",
				sourceId: brush.id,
				name: brush.name,
				mask: brush.mask ? cloneMask(brush.mask) : brushMaskFor(brush, 16),
				defaultSize: brush.defaultSize,
				defaultOpacity: brush.defaultOpacity,
			};
		}
		draftRevision++;
		widthText = String(draft.mask.width);
		heightText = String(draft.mask.height);
		error = "";
	}

	function beginEditPattern(id: string): void {
		const pattern = findDitherPattern(id);
		if (!pattern) return;
		if (pattern.builtin) {
			draft = {
				tab: "pattern",
				sourceId: null,
				name: `${pattern.name} copy`,
				mask: cloneMask(pattern.mask),
				defaultSize: 1,
				defaultOpacity: 100,
			};
		} else {
			draft = {
				tab: "pattern",
				sourceId: pattern.id,
				name: pattern.name,
				mask: cloneMask(pattern.mask),
				defaultSize: 1,
				defaultOpacity: 100,
			};
		}
		draftRevision++;
		widthText = String(draft.mask.width);
		heightText = String(draft.mask.height);
		error = "";
	}

	function beginEdit(id: string): void {
		if (tab === "brush") beginEditBrush(id);
		else beginEditPattern(id);
	}

	function beginNew(): void {
		error = "";
		if (tab === "brush") {
			const mask = createMask(8, 8);
			mask.data[4 * 8 + 4] = 1;
			draft = {
				tab: "brush",
				sourceId: null,
				name: `Brush ${brushLibrary.custom.length + 1}`,
				mask,
				defaultSize: 8,
				defaultOpacity: 100,
			};
		} else {
			draft = {
				tab: "pattern",
				sourceId: null,
				name: `Pattern ${ditherLibrary.custom.length + 1}`,
				mask: checkerDitherPattern(4),
				defaultSize: 1,
				defaultOpacity: 100,
			};
		}
		draftRevision++;
		widthText = String(draft.mask.width);
		heightText = String(draft.mask.height);
	}

	function beginFromSelection(): void {
		const selection = editor.selection;
		if (!selection) return;
		const result = maskFromSelection(selection, editor.doc.width, editor.doc.height);
		if (!result) return;
		const mask =
			Math.max(result.mask.width, result.mask.height) > MAX_BRUSH_MASK_SIZE
				? scaleMaskToLongest(result.mask, MAX_BRUSH_MASK_SIZE)
				: result.mask;
		draft = {
			tab: "brush",
			sourceId: null,
			name: `Selection brush ${brushLibrary.custom.length + 1}`,
			mask,
			defaultSize: Math.max(mask.width, mask.height),
			defaultOpacity: 100,
		};
		draftRevision++;
		widthText = String(draft.mask.width);
		heightText = String(draft.mask.height);
		error = "";
	}

	function paintDraft(x: number, y: number, value: number): void {
		if (!draft) return;
		if (x < 0 || x >= draft.mask.width || y < 0 || y >= draft.mask.height) return;
		draft.mask.data[y * draft.mask.width + x] = value ? 1 : 0;
		draftRevision++;
	}

	function mutateDraft(action: (mask: PixelMask) => void): void {
		if (!draft) return;
		action(draft.mask);
		draftRevision++;
	}

	function resizeDraft(): void {
		if (!draft) return;
		const max =
			draft.tab === "brush" ? MAX_BRUSH_MASK_SIZE : MAX_DITHER_PATTERN_SIZE;
		const width = Math.max(1, Math.min(max, Math.round(Number(widthText) || 1)));
		const height = Math.max(
			1,
			Math.min(max, Math.round(Number(heightText) || 1)),
		);
		draft.mask = resizeMaskCanvas(draft.mask, width, height, max);
		widthText = String(draft.mask.width);
		heightText = String(draft.mask.height);
		draftRevision++;
	}

	function saveDraft(): void {
		if (!draft) return;
		const name = draft.name.trim() || (draft.tab === "brush" ? "Custom brush" : "Custom pattern");
		if (draft.tab === "brush") {
			if (draft.sourceId) {
				updateCustomBrush(draft.sourceId, {
					name,
					mask: draft.mask,
					defaultSize: draft.defaultSize,
					defaultOpacity: draft.defaultOpacity,
				});
				editor.selectBrush(draft.sourceId);
				selectedId = draft.sourceId;
			} else {
				const added = addCustomBrush({
					id: `brush-${Date.now().toString(36)}`,
					name,
					builtin: false,
					mask: draft.mask,
					defaultSize: draft.defaultSize,
					defaultOpacity: draft.defaultOpacity,
				});
				if (!added) {
					error = "The brush library is full. Delete a brush first.";
					return;
				}
				editor.selectBrush(added.id);
				selectedId = added.id;
			}
		} else {
			if (draft.sourceId) {
				updateCustomDitherPattern(draft.sourceId, {
					name,
					mask: draft.mask,
				});
				editor.selectDitherPattern(draft.sourceId);
				selectedId = draft.sourceId;
			} else {
				const added = addCustomDitherPattern({
					id: `pattern-${Date.now().toString(36)}`,
					name,
					builtin: false,
					mask: draft.mask,
				});
				if (!added) {
					error = "The pattern library is full. Delete a pattern first.";
					return;
				}
				editor.selectDitherPattern(added.id);
				selectedId = added.id;
			}
		}
		draft = null;
		error = "";
	}

	function cancelDraft(): void {
		draft = null;
		error = "";
		refreshSelection();
	}

	function useSelected(): void {
		if (tab === "brush" && selectedBrush) editor.selectBrush(selectedBrush.id);
		if (tab === "pattern" && selectedPattern) {
			editor.selectDitherPattern(selectedPattern.id);
		}
		open = false;
	}

	function duplicateSelected(): void {
		if (tab === "brush" && selectedBrush) {
			const copy = duplicateCustomBrush(selectedBrush.id);
			if (copy) {
				selectedId = copy.id;
				beginEditBrush(copy.id);
			}
		} else if (tab === "pattern" && selectedPattern) {
			const copy = duplicateDitherPattern(selectedPattern.id);
			if (copy) {
				selectedId = copy.id;
				beginEditPattern(copy.id);
			}
		}
	}

	function deleteSelected(): void {
		if (!canDelete) return;
		if (tab === "brush") deleteCustomBrush(selectedId);
		else deleteCustomDitherPattern(selectedId);
		refreshSelection();
	}

	function openImportPicker(): void {
		importInput?.click();
	}

	async function onImportFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		if (file.size > MAX_IMPORT_FILE_BYTES) {
			error = "That image is too large to import as a brush.";
			return;
		}
		importing = true;
		error = "";
		try {
			const analysis = await analyzeImportFile(file);
			try {
				const reference = analysis.reference;
				const project = analysis.project;
				if (reference) {
					const mask = maskFromPixels(
						reference.pixels,
						reference.pixelWidth,
						reference.pixelHeight,
						MAX_BRUSH_MASK_SIZE,
					);
					draft = {
						tab: "brush",
						sourceId: null,
						name: importNameFromFile(file.name),
						mask,
						defaultSize: Math.max(mask.width, mask.height),
						defaultOpacity: 100,
					};
					draftRevision++;
					widthText = String(mask.width);
					heightText = String(mask.height);
				} else if (project) {
					const mask = maskFromPixels(
						project.pixels,
						project.width,
						project.height,
						MAX_BRUSH_MASK_SIZE,
					);
					draft = {
						tab: "brush",
						sourceId: null,
						name: importNameFromFile(file.name),
						mask,
						defaultSize: Math.max(mask.width, mask.height),
						defaultOpacity: 100,
					};
					draftRevision++;
					widthText = String(mask.width);
					heightText = String(mask.height);
				} else {
					error = analysis.error ?? "That file is not a supported image.";
				}
			} finally {
				if (analysis.project?.previewUrl) {
					URL.revokeObjectURL(analysis.project.previewUrl);
				}
			}
		} catch {
			error = "The image could not be read.";
		} finally {
			importing = false;
		}
	}

	$effect(() => {
		if (open && !wasOpen) {
			tab = editor.maskLibraryTab;
			draft = null;
			search = "";
			error = "";
			refreshSelection();
			const editId = editor.maskLibraryEditId;
			editor.maskLibraryEditId = null;
			if (editId) {
				if (tab === "brush") beginEditBrush(editId);
				else beginEditPattern(editId);
			}
		}
		wasOpen = open;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-4xl">
		<Dialog.Header>
			<Dialog.Title>Brushes & dither patterns</Dialog.Title>
			<Dialog.Description>
				Custom brushes are monochrome masks painted with the current color.
				Dither patterns tile across the canvas and can be used as live ink or as
				pattern brushes.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex items-center justify-between gap-2">
			<div class="grid grid-cols-2 gap-1 rounded-lg border p-1">
				<button
					type="button"
					class={cn(
						"rounded-md px-3 py-1 text-[11px] transition-colors",
						tab === "brush"
							? "bg-accent text-foreground"
							: "text-muted-foreground hover:bg-accent/60",
					)}
					aria-pressed={tab === "brush"}
					onclick={() => switchTab("brush")}
				>
					Brushes
				</button>
				<button
					type="button"
					class={cn(
						"rounded-md px-3 py-1 text-[11px] transition-colors",
						tab === "pattern"
							? "bg-accent text-foreground"
							: "text-muted-foreground hover:bg-accent/60",
					)}
					aria-pressed={tab === "pattern"}
					onclick={() => switchTab("pattern")}
				>
					Dither patterns
				</button>
			</div>
			<Input
				class="max-w-52"
				placeholder="Search…"
				aria-label="Search brushes and patterns"
				bind:value={search}
			/>
		</div>

		{#if draft}
			<div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
				<div class="grid content-start gap-3">
					<div class="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-end gap-2">
						<label class="grid gap-1">
							<Label for="mask-name">Name</Label>
							<Input id="mask-name" bind:value={draft.name} />
						</label>
						<label class="grid gap-1">
							<span class="text-[10px] font-medium text-muted-foreground">Width</span>
							<Input
								type="number"
								min={1}
								max={draft.tab === "brush"
									? MAX_BRUSH_MASK_SIZE
									: MAX_DITHER_PATTERN_SIZE}
								value={widthText}
								oninput={(event) => (widthText = event.currentTarget.value)}
								onblur={resizeDraft}
							/>
						</label>
						<label class="grid gap-1">
							<span class="text-[10px] font-medium text-muted-foreground">Height</span>
							<Input
								type="number"
								min={1}
								max={draft.tab === "brush"
									? MAX_BRUSH_MASK_SIZE
									: MAX_DITHER_PATTERN_SIZE}
								value={heightText}
								oninput={(event) => (heightText = event.currentTarget.value)}
								onblur={resizeDraft}
							/>
						</label>
					</div>

					<MaskGridEditor
						mask={draft.mask}
						revision={draftRevision}
						onpaint={paintDraft}
						color={editor.primaryColor}
						class="w-full max-w-sm"
					/>

					<div class="flex flex-wrap gap-1.5">
						<Button
							variant="outline"
							size="sm"
							onclick={() => mutateDraft((mask) => fillMask(mask))}
						>
							Fill
						</Button>
						<Button
							variant="outline"
							size="sm"
							onclick={() => mutateDraft((mask) => clearMask(mask))}
						>
							Clear
						</Button>
						<Button
							variant="outline"
							size="sm"
							onclick={() => mutateDraft((mask) => invertMask(mask))}
						>
							Invert
						</Button>
						<Button
							variant="outline"
							size="sm"
							onclick={() => mutateDraft((mask) => flipMaskHorizontal(mask))}
						>
							Flip H
						</Button>
						<Button
							variant="outline"
							size="sm"
							onclick={() => mutateDraft((mask) => flipMaskVertical(mask))}
						>
							Flip V
						</Button>
						<Button
							variant="outline"
							size="sm"
							onclick={() =>
								mutateDraft((mask) => {
									const rotated = rotateMaskClockwise(mask);
									mask.width = rotated.width;
									mask.height = rotated.height;
									mask.data = rotated.data;
									widthText = String(mask.width);
									heightText = String(mask.height);
								})}
						>
							Rotate
						</Button>
					</div>
				</div>

				<div class="grid content-start gap-3">
					<div class="grid gap-1.5">
						<span class="text-xs font-medium">Preview</span>
						<div class="grid aspect-square place-items-center rounded-lg border bg-muted/20 p-3">
							<MaskThumb
								mask={draftPreviewMask ?? draft.mask}
								tile={draft.tab === "pattern"}
								box={96}
								revision={draftRevision}
								class="size-full max-h-48"
							/>
						</div>
						<span class="text-[10px] text-muted-foreground">
							{draft.mask.width} × {draft.mask.height} px ·
							{Math.round(draftDensity * 100)}% coverage
						</span>
					</div>

					{#if draft.tab === "brush"}
						<div class="space-y-2.5">
							<div class="flex items-center justify-between">
								<span class="text-xs font-medium">Default size</span>
								<span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
									{Math.round(draft.defaultSize)}px
								</span>
							</div>
							<Slider
								type="single"
								min={1}
								max={MAX_BRUSH_MASK_SIZE}
								step={1}
								bind:value={draft.defaultSize}
							/>
							<div class="flex items-center justify-between">
								<span class="text-xs font-medium">Default opacity</span>
								<span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
									{Math.round(draft.defaultOpacity)}%
								</span>
							</div>
							<Slider
								type="single"
								min={1}
								max={100}
								step={1}
								bind:value={draft.defaultOpacity}
							/>
						</div>
					{:else}
						<p class="text-[10px] leading-relaxed text-muted-foreground">
							Patterns repeat in both directions. Use a non-repeating edge if you
							want a deliberate seam.
						</p>
					{/if}

					{#if error}
						<p class="text-[11px] text-destructive" aria-live="polite">{error}</p>
					{/if}

					<div class="grid gap-1.5">
						<Button onclick={saveDraft}>Save {draft.tab === "brush" ? "brush" : "pattern"}</Button>
						<Button variant="outline" onclick={cancelDraft}>Cancel edit</Button>
					</div>
				</div>
			</div>
		{:else}
			<div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
				<div class="grid content-start gap-3">
					<div class="grid max-h-[24rem] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
						{#each filteredItems as item (item.id)}
							<button
								type="button"
								class={cn(
									"group grid gap-1 rounded-lg border bg-muted/20 p-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									selectedId === item.id && "border-primary bg-accent",
								)}
								aria-pressed={selectedId === item.id}
								onclick={() => (selectedId = item.id)}
								ondblclick={() => beginEdit(item.id)}
							>
								<span class="grid aspect-square place-items-center overflow-hidden rounded-md bg-background/40 p-1">
									<MaskThumb
										mask={tab === "brush"
											? brushMaskFor(
													findBrush(item.id) ?? editor.activeBrush,
													16,
												)
											: findDitherPattern(item.id)?.mask ?? editor.activeDitherPattern.mask}
										tile={tab === "pattern"}
										box={48}
										revision={tab === "brush" ? brushLibrary.revision : ditherLibrary.revision}
										class="size-full"
									/>
								</span>
								<span class="truncate text-[10px] font-medium">{item.name}</span>
								<span class="text-[9px] text-muted-foreground">
									{item.builtin ? "Built-in" : "Custom"}
								</span>
							</button>
						{/each}
					</div>

					<div class="flex flex-wrap gap-1.5">
						<Button variant="outline" size="sm" onclick={beginNew}>
							<Plus class="size-3.5" />
							New mask
						</Button>
						{#if tab === "brush"}
							<Button
								variant="outline"
								size="sm"
								disabled={!editor.hasSelection}
								onclick={beginFromSelection}
							>
								<SquareDashedMousePointer class="size-3.5" />
								From selection
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={importing}
								onclick={openImportPicker}
							>
								<ImagePlus class="size-3.5" />
								{importing ? "Importing…" : "Import image"}
							</Button>
						{/if}
					</div>
					<p class="text-[10px] leading-relaxed text-muted-foreground">
						Double-click an item to edit it. Built-ins are duplicated into an
						editable copy. Masks are saved in this browser.
					</p>
					{#if error}
						<p class="text-[11px] text-destructive" aria-live="polite">{error}</p>
					{/if}
				</div>

				<div class="grid content-start gap-3">
					{#if selectedItem && previewMask}
						<div class="grid gap-1.5">
							<span class="text-xs font-medium">Selected</span>
							<div class="grid aspect-square place-items-center rounded-lg border bg-muted/20 p-3">
								<MaskThumb
									mask={previewMask}
									tile={tab === "pattern"}
									box={96}
									revision={tab === "brush" ? brushLibrary.revision : ditherLibrary.revision}
									class="size-full max-h-40"
								/>
							</div>
							<span class="text-xs font-medium">{selectedItem.name}</span>
							<span class="text-[10px] text-muted-foreground">
								{selectedItem.builtin ? "Built-in · " : "Custom · "}
								{tab === "brush"
									? `${(selectedBrush?.mask?.width ?? brushMaskFor(selectedBrush!, 16).width)} × ${(selectedBrush?.mask?.height ?? brushMaskFor(selectedBrush!, 16).height)} px`
									: `${selectedPattern?.mask.width} × ${selectedPattern?.mask.height} px`}
							</span>
							<span class="text-[10px] text-muted-foreground">
								{tab === "brush"
									? `${Math.round(maskDensity(previewMask) * 100)}% coverage`
									: `${Math.round(maskDensity(selectedPattern?.mask ?? previewMask) * 100)}% coverage`}
							</span>
						</div>
						<div class="grid gap-1.5">
							<Button onclick={useSelected}>Use</Button>
							<Button variant="outline" onclick={() => beginEdit(selectedItem.id)}>
								{selectedItem.builtin ? "Duplicate & edit" : "Edit mask"}
							</Button>
							<Button variant="outline" onclick={duplicateSelected}>Duplicate</Button>
							<Button
								variant="destructive"
								disabled={!canDelete}
								onclick={deleteSelected}
							>
								<Trash2 class="size-3.5" />
								Delete
							</Button>
						</div>
					{:else}
						<p class="text-[11px] text-muted-foreground">No item selected.</p>
					{/if}
				</div>
			</div>
		{/if}

		<input
			bind:this={importInput}
			type="file"
			accept={IMAGE_IMPORT_ACCEPT}
			class="hidden"
			onchange={onImportFile}
		/>
	</Dialog.Content>
</Dialog.Root>
