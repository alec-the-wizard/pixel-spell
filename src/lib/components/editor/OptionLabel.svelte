<script lang="ts">
	import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
	import * as Tooltip from "$lib/components/ui/tooltip/index.js";

	let {
		label,
		help,
		side = "right",
	}: {
		label: string;
		help: string;
		side?: "top" | "right" | "bottom" | "left";
	} = $props();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				class="inline-flex cursor-help items-center gap-1 rounded-sm text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{label}
				<CircleQuestionMark
					class="size-3 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
			</button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content {side} sideOffset={8}>{help}</Tooltip.Content>
</Tooltip.Root>
