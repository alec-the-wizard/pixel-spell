<script lang="ts">
	import type { Component } from "svelte";

	let { open = $bindable(false), file = null }: {
		open?: boolean;
		file?: File | null;
	} = $props();

	let Dialog = $state<Component | null>(null);
	let loading = false;

	function load(): void {
		if (Dialog || loading) return;
		loading = true;
		void import("./ImportDialog.svelte").then((mod) => {
			Dialog = mod.default;
			loading = false;
		});
	}

	$effect(() => {
		if (open) load();
	});
</script>

{#if Dialog}
	<Dialog bind:open={open} {file} />
{/if}
