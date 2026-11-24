<script lang="ts">
	import type { Component } from "svelte";

	let { open = $bindable(false) } = $props();

	let Dialog = $state<Component | null>(null);
	let loading = false;

	function load(): void {
		if (Dialog || loading) return;
		loading = true;
		void import("./TimelapseDialog.svelte").then((mod) => {
			Dialog = mod.default;
			loading = false;
		});
	}

	// Load the dialog and the video encoders only when it is first opened.
	$effect(() => {
		if (open) load();
	});
</script>

{#if Dialog}
	<Dialog bind:open={open} />
{/if}
