<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Tooltip from "$lib/components/ui/tooltip/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { keybindings } from "$lib/editor/keybindings.svelte.js";
	import { TOOLS } from "$lib/editor/tools.js";
	import { cn } from "$lib/utils.js";
	import ToolIcon from "./ToolIcon.svelte";

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

	function shortcutLabel(id: string): string {
		return keybindings.primaryLabel(`tool.${id}`) || "Unbound";
	}

	function toolLabel(id: string): string {
		const base = `${TOOLS.find((item) => item.id === id)?.label ?? id} (${shortcutLabel(id)})`;
		if (!editor.doubleToolEnabled) return base;
		const slots: string[] = [];
		if (editor.leftTool === id) slots.push("left mouse");
		if (editor.rightTool === id) slots.push("right mouse");
		return slots.length ? `${base} — ${slots.join(" / ")}` : base;
	}
</script>

<aside
	class="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r bg-muted/20 py-2"
	aria-label="Tools"
>
	{#each TOOLS as tool (tool.id)}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-lg"
						class={cn(
							"relative size-10 rounded-lg text-muted-foreground",
							!editor.doubleToolEnabled &&
								editor.tool === tool.id &&
								"bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground dark:hover:bg-primary/90 dark:hover:text-primary-foreground",
						)}
						aria-label={toolLabel(tool.id)}
						aria-pressed={
							editor.doubleToolEnabled
								? editor.leftTool === tool.id || editor.rightTool === tool.id
								: editor.tool === tool.id
						}
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
	{/each}
</aside>
