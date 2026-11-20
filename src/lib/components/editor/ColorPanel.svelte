<script lang="ts">
	import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
	import Lock from "@lucide/svelte/icons/lock";
	import LockOpen from "@lucide/svelte/icons/lock-open";
	import Minus from "@lucide/svelte/icons/minus";
	import MouseLeft from "@lucide/svelte/icons/mouse-left";
	import MouseRight from "@lucide/svelte/icons/mouse-right";
	import PaletteIcon from "@lucide/svelte/icons/palette";
	import Pencil from "@lucide/svelte/icons/pencil";
	import Plus from "@lucide/svelte/icons/plus";
	import Settings2 from "@lucide/svelte/icons/settings-2";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import ColorCyclesDialog from "$lib/components/editor/ColorCyclesDialog.svelte";
	import ColorPickerDialog from "$lib/components/editor/ColorPickerDialog.svelte";
	import PaletteCoverageDialog from "$lib/components/editor/PaletteCoverageDialog.svelte";
	import PaletteLibraryDialog from "$lib/components/editor/PaletteLibraryDialog.svelte";
	import PaletteRampDialog from "$lib/components/editor/PaletteRampDialog.svelte";
	import {
		Button,
		buttonVariants,
	} from "$lib/components/ui/button/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import { Separator } from "$lib/components/ui/separator/index.js";
	import { colorWithAlpha } from "$lib/editor/color.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		MAX_PALETTE_COLORS,
		type PaletteSortMode,
	} from "$lib/editor/palette.js";
	import type { ColorSlot } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";

	const SORT_OPTIONS: { id: PaletteSortMode; label: string }[] = [
		{ id: "original", label: "Original order" },
		{ id: "hue", label: "Hue" },
		{ id: "saturation", label: "Saturation" },
		{ id: "lightness", label: "Lightness" },
	];

	let pickerOpen = $state(false);
	let pickerSlot = $state<ColorSlot>("primary");

	function openPicker(target: ColorSlot): void {
		pickerSlot = target;
		pickerOpen = true;
	}

	let primaryAlphaPercent = $derived(Math.round((editor.alpha / 255) * 100));

	function choosePaletteColor(color: string, target: ColorSlot): void {
		editor.setColor(target, color);
		editor.setColorAlpha(target, 255);
	}

	let activePalette = $derived(editor.activePalette);
	let paletteEditable = $derived(editor.paletteEditable);
	let paletteColorCount = $derived(activePalette.colors.length);
	let canAddPaletteColor = $derived(
		paletteEditable && paletteColorCount < MAX_PALETTE_COLORS,
	);
	let addPaletteColorTitle = $derived(
		!paletteEditable
			? activePalette.builtin
				? "The default palette cannot be modified"
				: "Unlock the palette to edit colors"
			: paletteColorCount >= MAX_PALETTE_COLORS
				? "Palette is full"
				: "Add primary color to palette",
	);
	let canRemovePaletteColor = $derived(paletteEditable && paletteColorCount > 0);
	let removePaletteColorTitle = $derived(
		!paletteEditable
			? activePalette.builtin
				? "The default palette cannot be modified"
				: "Unlock the palette to edit colors"
			: paletteColorCount === 0
				? "Palette is empty"
				: "Remove last color from palette",
	);

	let paletteLibraryOpen = $state(false);
	let paletteSortMode = $derived(activePalette.sortMode ?? "original");
	let hasPaletteDuplicates = $derived(
		new Set(activePalette.colors).size !== activePalette.colors.length,
	);
	let canSortPalette = $derived(paletteEditable && paletteColorCount > 1);
	let canDedupePalette = $derived(paletteEditable && hasPaletteDuplicates);

	let canGenerateRamp = $derived(
		paletteEditable && paletteColorCount < MAX_PALETTE_COLORS,
	);
	let generateRampTitle = $derived(
		activePalette.builtin
			? "The default palette is read-only"
			: editor.paletteLocked
				? "Unlock the palette to generate ramps"
				: paletteColorCount >= MAX_PALETTE_COLORS
					? "Palette is full"
					: "Generate a ramp of colors",
	);
	let generateRampLabel = $derived(
		activePalette.builtin
			? "Generate ramp… (read-only)"
			: editor.paletteLocked
				? "Generate ramp… (locked)"
				: paletteColorCount >= MAX_PALETTE_COLORS
					? "Generate ramp… (palette full)"
					: "Generate ramp…",
	);

	function onPaletteSortChange(value: string): void {
		editor.sortPalette(activePalette.id, value as PaletteSortMode);
	}

	let renamingPalette = $state(false);
	let renameDraft = $state("");
	let renameInput = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (!renamingPalette || !renameInput) return;
		renameInput.focus();
		renameInput.select();
	});

	function onPaletteSelect(event: Event): void {
		editor.selectPalette((event.currentTarget as HTMLSelectElement).value);
	}

	function startPaletteRename(): void {
		if (!paletteEditable) return;
		renameDraft = activePalette.name;
		renamingPalette = true;
	}

	function createPalette(): void {
		editor.createPalette();
		startPaletteRename();
	}

	function commitPaletteRename(): void {
		if (!renamingPalette) return;
		renamingPalette = false;
		editor.renamePalette(activePalette.id, renameDraft);
	}

	function cancelPaletteRename(): void {
		renamingPalette = false;
	}

	function deletePalette(): void {
		if (!paletteEditable) return;
		renamingPalette = false;
		editor.deletePalette(activePalette.id);
	}

	let paletteNotice = $state("");
	let paletteNoticeTimer: ReturnType<typeof setTimeout> | undefined;

	function removeUnusedPaletteColors(): void {
		const removed = editor.removeUnusedPaletteColors();
		paletteNotice =
			removed > 0
				? `Removed ${removed} unused ${removed === 1 ? "color" : "colors"}.`
				: "Every palette color is already used.";
		if (paletteNoticeTimer) clearTimeout(paletteNoticeTimer);
		paletteNoticeTimer = setTimeout(() => {
			paletteNotice = "";
			paletteNoticeTimer = undefined;
		}, 4000);
	}

	$effect(() => {
		return () => {
			if (paletteNoticeTimer) clearTimeout(paletteNoticeTimer);
		};
	});
</script>

<section class="shrink-0 border-t">
	<header class="flex h-11 items-center justify-between border-b px-4">
		<div class="flex items-center gap-2">
			<PaletteIcon class="size-4 text-muted-foreground" />
			<span class="text-xs font-medium">Color</span>
		</div>
		<span class="font-mono text-[10px] uppercase text-muted-foreground">
			{editor.primaryColor} · {primaryAlphaPercent}%
		</span>
	</header>

	<div class="space-y-4 p-4">
		<div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
			<button
				type="button"
				class="flex items-center justify-between gap-2 rounded-lg border p-1.5 text-left text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/60"
				onclick={() => openPicker("primary")}
				title="Edit primary color (left mouse)"
				aria-label="Edit primary color (left mouse)"
				aria-haspopup="dialog"
			>
				<span
					class="checkerboard relative size-8 shrink-0 overflow-hidden rounded-md ring-1 ring-border"
				>
					<span
						class="absolute inset-0"
						style={`background-color: ${colorWithAlpha(editor.primaryColor, editor.alpha / 255)}`}
					></span>
				</span>
				<MouseLeft class="size-8 shrink-0 opacity-70" aria-hidden="true" />
			</button>

			<Button
				variant="ghost"
				size="icon-xs"
				class="rounded-full text-muted-foreground"
				onclick={() => editor.swapColors()}
				title="Swap primary and secondary colors"
				aria-label="Swap primary and secondary colors"
			>
				<ArrowLeftRight class="size-3.5" />
			</Button>

			<button
				type="button"
				class="flex items-center justify-between gap-2 rounded-lg border p-1.5 text-left text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/60"
				onclick={() => openPicker("secondary")}
				title="Edit secondary color (right mouse)"
				aria-label="Edit secondary color (right mouse)"
				aria-haspopup="dialog"
			>
				<span
					class="checkerboard relative size-8 shrink-0 overflow-hidden rounded-md ring-1 ring-border"
				>
					<span
						class="absolute inset-0"
						style={`background-color: ${colorWithAlpha(editor.secondaryColor, editor.secondaryAlpha / 255)}`}
					></span>
				</span>
				<MouseRight class="size-8 shrink-0 opacity-70" aria-hidden="true" />
			</button>
		</div>

		<p class="text-[10px] text-muted-foreground">
			Click the primary or secondary swatch to open the color picker.
		</p>

		<div class="space-y-2 pt-1">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-1.5">
					<span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Palette
					</span>
					{#if editor.paletteLocked}
						<span
							class="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
						>
							<Lock class="size-2.5" />
							Locked
						</span>
					{/if}
				</div>
				<div class="flex items-center gap-0.5">
					<Button
						variant="ghost"
						size="icon-xs"
						class="text-muted-foreground"
						onclick={() => editor.addPaletteColor()}
						disabled={!canAddPaletteColor}
						title={addPaletteColorTitle}
						aria-label="Add primary color to palette"
					>
						<Plus class="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						class="text-muted-foreground"
						onclick={() => editor.removeLastPaletteColor()}
						disabled={!canRemovePaletteColor}
						title={removePaletteColorTitle}
						aria-label="Remove last color from palette"
					>
						<Minus class="size-3.5" />
					</Button>
					<Separator orientation="vertical" class="mx-1 h-4" />
					<Button
						variant="ghost"
						size="icon-xs"
						class="text-muted-foreground"
						onclick={createPalette}
						title="New palette"
						aria-label="New palette"
					>
						<PaletteIcon class="size-3.5" />
					</Button>
					<Separator orientation="vertical" class="mx-1 h-4" />
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							class={cn(
								buttonVariants({ variant: "ghost", size: "icon-xs" }),
								"text-muted-foreground",
							)}
							title="Palette tools"
							aria-label="Palette tools"
						>
							<Settings2 class="size-3.5" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="w-56" align="start">
							<DropdownMenu.Item
								disabled={!canGenerateRamp}
								title={canGenerateRamp
									? "Generate a ramp of colors"
									: generateRampTitle}
								onSelect={() => (editor.paletteRampOpen = true)}
							>
								{generateRampLabel}
							</DropdownMenu.Item>
							<DropdownMenu.Item
								onSelect={() => (editor.paletteCyclesOpen = true)}
							>
								Color cycles…
							</DropdownMenu.Item>
							<DropdownMenu.Item
								disabled={!paletteEditable}
								title={paletteEditable
									? "Remove colors that no frame or normal layer uses"
									: activePalette.builtin
										? "The default palette cannot be modified"
										: "Unlock the palette to edit colors"}
								onSelect={removeUnusedPaletteColors}
							>
								Remove unused colors
							</DropdownMenu.Item>
							<DropdownMenu.Item
								onSelect={() => (editor.paletteCoverageOpen = true)}
							>
								Coverage analysis…
							</DropdownMenu.Item>
							<DropdownMenu.Separator />
							<DropdownMenu.Label>Sort by</DropdownMenu.Label>
							<DropdownMenu.RadioGroup
								value={paletteSortMode}
								onValueChange={onPaletteSortChange}
							>
								{#each SORT_OPTIONS as option (option.id)}
									<DropdownMenu.RadioItem
										value={option.id}
										disabled={!canSortPalette}
										closeOnSelect
									>
										{option.label}
									</DropdownMenu.RadioItem>
								{/each}
							</DropdownMenu.RadioGroup>
							<DropdownMenu.Separator />
							<DropdownMenu.Item
								disabled={!canDedupePalette}
								title={canDedupePalette
									? "Remove duplicate colors"
									: "No duplicate colors"}
								onSelect={() => editor.dedupePalette(activePalette.id)}
							>
								Remove duplicates
							</DropdownMenu.Item>
							<DropdownMenu.Separator />
							<DropdownMenu.Item
								onSelect={() => (paletteLibraryOpen = true)}
							>
								Palette library…
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			</div>

			<div class="flex items-center gap-1.5">
				{#if renamingPalette}
					<input
						bind:this={renameInput}
						bind:value={renameDraft}
						type="text"
						class="h-7 min-w-0 flex-1 rounded-lg border bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
						maxlength={40}
						onblur={commitPaletteRename}
						onkeydown={(event) => {
							if (event.key === "Enter") event.currentTarget.blur();
							else if (event.key === "Escape") {
								event.preventDefault();
								cancelPaletteRename();
							}
						}}
						aria-label="Palette name"
					/>
				{:else}
					<select
						class="h-7 min-w-0 flex-1 cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
						value={editor.activePaletteId}
						onchange={onPaletteSelect}
						aria-label="Active palette"
					>
						{#each editor.palettes as palette (palette.id)}
							<option value={palette.id}>{palette.name}</option>
						{/each}
					</select>
				{/if}
				<Button
					variant={editor.paletteLocked ? "secondary" : "ghost"}
					size="icon-xs"
					class={cn(
						"shrink-0",
						!editor.paletteLocked && "text-muted-foreground",
					)}
					onclick={() => editor.togglePaletteLock()}
					title={editor.paletteLocked
						? "Palette locked — colors snap to the nearest swatch. Click to unlock."
						: "Lock the palette for indexed-style work"}
					aria-label={editor.paletteLocked ? "Unlock palette" : "Lock palette"}
					aria-pressed={editor.paletteLocked}
				>
					{#if editor.paletteLocked}
						<Lock class="size-3.5" />
					{:else}
						<LockOpen class="size-3.5" />
					{/if}
				</Button>
				<Button
					variant="ghost"
					size="icon-xs"
					class="shrink-0 text-muted-foreground"
					onclick={startPaletteRename}
					disabled={!paletteEditable}
					title={activePalette.builtin
						? "The default palette cannot be renamed"
						: paletteEditable
							? "Rename palette"
							: "Unlock the palette to rename it"}
					aria-label="Rename palette"
				>
					<Pencil class="size-3.5" />
				</Button>
				<Button
					variant="ghost"
					size="icon-xs"
					class="shrink-0 text-muted-foreground"
					onclick={deletePalette}
					disabled={!paletteEditable}
					title={activePalette.builtin
						? "The default palette cannot be deleted"
						: paletteEditable
							? "Delete palette"
							: "Unlock the palette to delete it"}
					aria-label="Delete palette"
				>
					<Trash2 class="size-3.5" />
				</Button>
			</div>

			<div class="max-h-44 overflow-y-auto p-1">
				{#if paletteNotice}
					<p class="px-2 pb-1 text-[10px] text-muted-foreground" aria-live="polite">
						{paletteNotice}
					</p>
				{/if}
				{#if paletteColorCount === 0}
					<p
						class="rounded-md border border-dashed px-2 py-3 text-center text-[10px] text-muted-foreground"
					>
						{#if editor.paletteLocked}
							This palette is locked and empty. Unlock it to add colors.
						{:else}
							No colors yet. Use + to add the primary color.
						{/if}
					</p>
				{:else}
					<div class="grid grid-cols-8 gap-1.5">
						{#each activePalette.colors as color, index}
							<div class="group relative aspect-square">
								<button
									type="button"
									class="relative size-full rounded-[5px] ring-1 ring-black/10 transition-transform group-hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									style={`background-color: ${color}`}
									title={`${color} — color ${index + 1}. Left click: primary, right click: secondary.`}
									aria-label={`Use color ${color}, color ${index + 1}`}
									onclick={() => choosePaletteColor(color, "primary")}
									oncontextmenu={(event) => {
										event.preventDefault();
										choosePaletteColor(color, "secondary");
									}}
								>
									{#if editor.primaryColor === color && editor.alpha === 255}
										<span
											class="pointer-events-none absolute left-0.5 top-0.5 size-1.5 rounded-full bg-background ring-1 ring-foreground"
										></span>
									{/if}
									{#if editor.secondaryColor === color && editor.secondaryAlpha === 255}
										<span
											class="pointer-events-none absolute bottom-0.5 right-0.5 size-1.5 rounded-full bg-background ring-1 ring-foreground"
										></span>
									{/if}
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<ColorPickerDialog bind:open={pickerOpen} slot={pickerSlot} />
	<PaletteLibraryDialog bind:open={paletteLibraryOpen} />
	<PaletteRampDialog bind:open={editor.paletteRampOpen} />
	<ColorCyclesDialog bind:open={editor.paletteCyclesOpen} />
	<PaletteCoverageDialog bind:open={editor.paletteCoverageOpen} />
</section>
