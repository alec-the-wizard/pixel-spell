<script lang="ts">
	import { tick } from "svelte";
	import History from "@lucide/svelte/icons/history";
	import Redo2 from "@lucide/svelte/icons/redo-2";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	let list = $state<HTMLDivElement | undefined>();
	let rows = $derived(editor.historyRows);
	let undoable = $derived(editor.undoCount);
	let redoable = $derived(editor.redoCount);
	let position = $derived(editor.historyPosition);
	let total = $derived(editor.historyTotal);

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		const kb = bytes / 1024;
		if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
		const mb = kb / 1024;
		return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
	}

	function jump(target: number, current: boolean): void {
		if (current) return;
		editor.jumpToHistory(target);
	}

	$effect(() => {
		if (!open) return;
		// Re-scroll whenever the position changes, including after a jump.
		editor.undoCount;
		editor.redoCount;
		void tick().then(() => {
			if (!open) return;
			list
				?.querySelector<HTMLElement>('[data-history-current="true"]')
				?.scrollIntoView({ block: "nearest" });
		});
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<History class="size-4 text-muted-foreground" />
				History
			</Dialog.Title>
			<Dialog.Description>
				Every undoable step in “{editor.name}”, oldest first. Click an entry to jump
				to that state; making a new edit discards the redoable steps below it.
			</Dialog.Description>
		</Dialog.Header>

		<div
			bind:this={list}
			class="max-h-[min(52vh,26rem)] overflow-y-auto rounded-lg border bg-muted/20 p-1"
			role="listbox"
			aria-label="Undo history"
			tabindex="-1"
		>
			{#each rows as row (row.id)}
				<button
					type="button"
					role="option"
					aria-selected={row.current}
					data-history-current={row.current}
					class={cn(
						"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors outline-none",
						row.current
							? "bg-primary/15 text-foreground"
							: "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
						row.redoable && "opacity-60 hover:opacity-100",
					)}
					onclick={() => jump(row.position, row.current)}
					title={
						row.current
							? `Current state — ${row.label}`
							: `Jump to ${row.label} (position ${row.position})`
					}
				>
					<span
						class={cn(
							"w-6 shrink-0 text-right font-mono text-[10px] tabular-nums",
							row.current ? "text-primary" : "text-muted-foreground/70",
						)}
					>
						{row.position === 0 ? "•" : row.position}
					</span>
					<span class="min-w-0 flex-1 truncate font-medium">{row.label}</span>
					{#if row.detail}
						<span class="max-w-[45%] shrink-0 truncate text-[10px] text-muted-foreground">
							{row.detail}
						</span>
					{/if}
					{#if row.current}
						<span
							class="size-1.5 shrink-0 rounded-full bg-primary"
							aria-hidden="true"
						></span>
					{:else if row.redoable}
						<span
							class="shrink-0 rounded-sm border border-dashed border-border px-1 text-[9px] uppercase tracking-wide text-muted-foreground"
						>
							redo
						</span>
					{:else}
						<span class="size-1.5 shrink-0" aria-hidden="true"></span>
					{/if}
				</button>
			{/each}
		</div>

		<Dialog.Footer class="sm:justify-between">
			<div class="text-[10px] tabular-nums text-muted-foreground">
				<p class="font-medium text-foreground">Step {position} of {total}</p>
				<p>
					{undoable} undoable · {redoable} redoable
					{#if editor.historyBytes > 0}
						· ≈ {formatBytes(editor.historyBytes)}
					{/if}
				</p>
			</div>
			<div class="flex justify-end gap-2">
				<Button
					variant="outline"
					onclick={() => editor.undo()}
					disabled={!editor.canUndo}
					title="Undo the last step"
				>
					<Undo2 class="size-4" />
					Undo
				</Button>
				<Button
					variant="outline"
					onclick={() => editor.redo()}
					disabled={!editor.canRedo}
					title="Redo the next step"
				>
					<Redo2 class="size-4" />
					Redo
				</Button>
				<Button onclick={() => (open = false)}>Close</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
