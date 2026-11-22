<script lang="ts">
	import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { keybindings } from "$lib/editor/keybindings.svelte.js";
	import { toolLayout } from "$lib/editor/tool-layout.svelte.js";
	import type { ToolId } from "$lib/editor/types.js";
	import ToolIcon from "./ToolIcon.svelte";

	let { open = $bindable(false) } = $props();

	const tools = $derived(toolLayout.tools);

	function shortcutLabel(id: string): string {
		return keybindings.primaryLabel(`tool.${id}`) || "Unbound";
	}

	function setEnabled(id: ToolId, enabled: boolean): void {
		toolLayout.setEnabled(id, enabled);
		editor.ensureEnabledTool();
	}

	function resetAll(): void {
		toolLayout.reset();
		editor.ensureEnabledTool();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Tools</Dialog.Title>
			<Dialog.Description>
				Choose which tools appear in the tool strip. Drag tools in the strip to reorder
				them.
			</Dialog.Description>
		</Dialog.Header>

		<div class="-mr-1 max-h-[52vh] overflow-x-hidden overflow-y-auto pr-1">
			{#each tools as tool (tool.id)}
				<label
					class="flex min-h-10 items-center gap-3 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/60"
				>
					<span
						class="grid size-7 shrink-0 place-items-center rounded-md border bg-muted/40 text-muted-foreground"
					>
						<ToolIcon tool={tool.id} class="size-4" />
					</span>
					<span class="min-w-0 flex-1 truncate text-sm">{tool.label}</span>
					<kbd
						class="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
					>
						{shortcutLabel(tool.id)}
					</kbd>
					<Switch
						checked={toolLayout.isEnabled(tool.id)}
						disabled={toolLayout.enabledCount <= 1 && toolLayout.isEnabled(tool.id)}
						onCheckedChange={(value) => setEnabled(tool.id, value)}
						aria-label={`Show ${tool.label} in the tool strip`}
					/>
				</label>
			{/each}
		</div>

		<Dialog.Footer class="justify-between sm:justify-between">
			<Button variant="outline" onclick={resetAll}>
				<RotateCcw class="size-3.5" />
				Restore defaults
			</Button>
			<Button onclick={() => (open = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
