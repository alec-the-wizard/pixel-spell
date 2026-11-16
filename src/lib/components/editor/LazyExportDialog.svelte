<script lang="ts">
	import type { Component } from "svelte";

	let { open = $bindable(false) } = $props();

	let Dialog = $state<Component | null>(null);
	let loading = false;

	function load(): void {
		if (Dialog || loading) return;
		loading = true;
		void import("./ExportDialog.svelte").then((mod) => {
			Dialog = mod.default;
			loading = false;
		});
	}

	// Load the dialog (and the export encoders it pulls in) lazily on first
	// open, so the initial editor shell does not pay for them.
	$effect(() => {
		if (open) load();
	});
</script>

{#if Dialog}
	<Dialog bind:open={open} />
{/if}
