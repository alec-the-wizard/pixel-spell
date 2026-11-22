<script lang="ts">
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Tooltip from "$lib/components/ui/tooltip/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { keybindings } from "$lib/editor/keybindings.svelte.js";
	import { toolLayout } from "$lib/editor/tool-layout.svelte.js";
	import { TOOL_BY_ID } from "$lib/editor/tools.js";
	import type { ToolId } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";
	import ToolIcon from "./ToolIcon.svelte";
	import ToolsDialog from "./ToolsDialog.svelte";

	/** Accent colors for the left (primary blue) and right (orange) tool slots. */
	const LEFT_SLOT_COLOR = "var(--primary)";
	const RIGHT_SLOT_COLOR = "#f97316";

	/**
	 * Neutral fill for the unassigned half of a selected split button. Dark gray
	 * in light mode and light gray in dark mode so it contrasts with the page.
	 */
	let neutralHalfColor = $derived(
		editor.theme === "dark" ? "#d4d4d8" : "#52525b",
	);

	let toolsDialogOpen = $state(false);
	let draggingId = $state<ToolId | null>(null);
	/** Insertion index among the visible tools while a drag is in progress. */
	let dropIndex = $state<number | null>(null);
	let toolsEl = $state<HTMLDivElement | null>(null);

	const tools = $derived(toolLayout.enabledTools);

	function shortcutLabel(id: string): string {
		return keybindings.primaryLabel(`tool.${id}`) || "Unbound";
	}

	function toolLabel(id: string): string {
		const base = `${TOOL_BY_ID[id as ToolId]?.label ?? id} (${shortcutLabel(id)})`;
		if (!editor.doubleToolEnabled) return base;
		const slots: string[] = [];
		if (editor.leftTool === id) slots.push("left mouse");
		if (editor.rightTool === id) slots.push("right mouse");
		return slots.length ? `${base} — ${slots.join(" / ")}` : base;
	}

	/** Number of visible tools whose midpoint sits above the pointer. */
	function insertionIndex(clientY: number): number {
		if (!toolsEl) return tools.length;
		const items = toolsEl.querySelectorAll<HTMLElement>("[data-tool-item]");
		let index = 0;
		for (const item of items) {
			const rect = item.getBoundingClientRect();
			if (clientY > rect.top + rect.height / 2) index++;
			else break;
		}
		return index;
	}

	function handleDragStart(event: DragEvent, id: ToolId): void {
		draggingId = id;
		dropIndex = null;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("text/plain", id);
		}
	}

	function handleDragOver(event: DragEvent): void {
		if (!draggingId) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
		dropIndex = insertionIndex(event.clientY);
	}

	function handleDrop(event: DragEvent): void {
		if (!draggingId) return;
		event.preventDefault();
		const index = dropIndex ?? insertionIndex(event.clientY);
		const next = tools[index];
		// Insert before the tool that currently occupies the gap, or at the end.
		const target = next ? toolLayout.order.indexOf(next.id) : toolLayout.order.length;
		toolLayout.moveTool(draggingId, target);
		handleDragEnd();
	}

	function handleDragEnd(): void {
		draggingId = null;
		dropIndex = null;
	}
</script>

<aside
	class="flex w-14 shrink-0 flex-col items-center border-r bg-muted/20 py-2"
	aria-label="Tools"
>
	<div
		bind:this={toolsEl}
		class="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto px-2 py-1"
		role="group"
		aria-label="Tool strip"
		ondragover={handleDragOver}
		ondrop={handleDrop}
	>
		{#each tools as tool, index (tool.id)}
			<div class="relative shrink-0" data-tool-item>
				{#if dropIndex === index}
					<span
						class="pointer-events-none absolute inset-x-0 -top-1 z-10 h-0.5 rounded-full bg-primary"
						aria-hidden="true"
					></span>
				{/if}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-lg"
								draggable="true"
								class={cn(
									"relative size-10 cursor-grab rounded-lg text-muted-foreground active:cursor-grabbing",
									!editor.doubleToolEnabled &&
										editor.tool === tool.id &&
										"bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground dark:hover:bg-primary/90 dark:hover:text-primary-foreground",
									draggingId === tool.id && "opacity-40",
								)}
								aria-label={toolLabel(tool.id)}
								aria-pressed={
									editor.doubleToolEnabled
										? editor.leftTool === tool.id || editor.rightTool === tool.id
										: editor.tool === tool.id
								}
								ondragstart={(event) => handleDragStart(event, tool.id)}
								ondragend={handleDragEnd}
								onclick={() =>
									editor.doubleToolEnabled
										? editor.setLeftTool(tool.id)
										: editor.setTool(tool.id)}
								oncontextmenu={(event) => {
									event.preventDefault();
									if (editor.doubleToolEnabled) editor.setRightTool(tool.id);
								}}
							>
								{#if editor.doubleToolEnabled &&
									(editor.leftTool === tool.id || editor.rightTool === tool.id)}
									<span
										class="pointer-events-none absolute inset-y-0 left-0 w-1/2 rounded-l-lg"
										style:background={editor.leftTool === tool.id
											? LEFT_SLOT_COLOR
											: neutralHalfColor}
										aria-hidden="true"
									></span>
									<span
										class="pointer-events-none absolute inset-y-0 right-0 w-1/2 rounded-r-lg"
										style:background={editor.rightTool === tool.id
											? RIGHT_SLOT_COLOR
											: neutralHalfColor}
										aria-hidden="true"
									></span>
								{/if}
								<ToolIcon
									tool={tool.id}
									class={cn(
										"relative size-[18px]",
										editor.doubleToolEnabled &&
											(editor.leftTool === tool.id || editor.rightTool === tool.id) &&
											"text-white dark:text-black",
									)}
								/>
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="right" sideOffset={10} class="px-2.5 py-1.5">
						<div class="flex items-center gap-2">
							<div class="grid gap-0.5">
								<span class="text-xs font-medium">{tool.label}</span>
								<span class="text-[11px] opacity-70">{tool.description}</span>
							</div>
							<kbd
								data-slot="kbd"
								class="ml-1 rounded border border-background/25 px-1 font-mono text-[10px] opacity-80"
							>
								{shortcutLabel(tool.id)}
							</kbd>
						</div>
					</Tooltip.Content>
				</Tooltip.Root>
				{#if index === tools.length - 1 && dropIndex === tools.length}
					<span
						class="pointer-events-none absolute inset-x-0 -bottom-1 z-10 h-0.5 rounded-full bg-primary"
						aria-hidden="true"
					></span>
				{/if}
			</div>
		{/each}
	</div>

	<div class="mt-1 w-full shrink-0 border-t px-2 pt-1">
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-lg"
						class="size-10 rounded-lg text-muted-foreground"
						aria-label="Show or hide tools"
						onclick={() => (toolsDialogOpen = true)}
					>
						<Ellipsis class="size-[18px]" />
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="right" sideOffset={10} class="px-2.5 py-1.5">
				<span class="text-xs font-medium">Show or hide tools</span>
			</Tooltip.Content>
		</Tooltip.Root>
	</div>
</aside>

<ToolsDialog bind:open={toolsDialogOpen} />
