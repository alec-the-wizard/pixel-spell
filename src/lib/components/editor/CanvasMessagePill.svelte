<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "$lib/utils.js";

	/**
	 * Canvas message pill
	 *
	 * Reusable floating status message for the canvas viewport. Place it in an
	 * absolutely positioned wrapper (for example bottom-center of the stage) and
	 * pass action buttons or extra status text through the `children` snippet.
	 *
	 * The default `info` tone adds the blue accent border used by transient
	 * viewport modes such as color cycling previews.
	 */
	let {
		class: className = "",
		label,
		tone = "info",
		children,
	}: {
		class?: string;
		label: string;
		tone?: "info" | "neutral";
		children?: Snippet;
	} = $props();
</script>

<div
	class={cn(
		"pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border bg-background/95 pl-2.5 pr-1 text-[11px] shadow-sm backdrop-blur",
		tone === "info" ? "border-sky-500/70" : "border-border",
		className,
	)}
	role="status"
>
	<span
		class={cn(
			"size-1.5 shrink-0 rounded-full",
			tone === "info" ? "bg-sky-500" : "bg-muted-foreground",
		)}
		aria-hidden="true"
	></span>
	<span class="pr-0.5 font-medium">{label}</span>
	{@render children?.()}
</div>
