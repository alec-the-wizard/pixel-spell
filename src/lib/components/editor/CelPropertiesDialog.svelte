<script lang="ts">
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";

	let {
		open = $bindable(false),
		target,
	}: {
		open?: boolean;
		target: { layerId: string; frameIndex: number } | null;
	} = $props();

	let opacity = $state(100);
	let zIndex = $state<string | number>("");
	let error = $state<string | null>(null);
	let wasOpen = false;

	let layerName = $derived(
		target
			? (editor.doc.layers.find((layer) => layer.id === target.layerId)?.name ??
				"Layer")
			: "Layer",
	);
	let frameNumber = $derived(target ? target.frameIndex + 1 : 0);
	/** z-index reordering only applies to flat (non-grouped) documents. */
	let hasGroups = $derived(editor.doc.layers.some((layer) => layer.isGroup));

	$effect(() => {
		if (open && !wasOpen && target) {
			const props = editor.getCelProps(target.layerId, target.frameIndex);
			opacity =
				props?.opacity !== undefined ? Math.round(props.opacity * 100) : 100;
			zIndex = props?.zIndex !== undefined ? props.zIndex : "";
			error = null;
		}
		wasOpen = open;
	});

	function resetOpacity(): void {
		opacity = 100;
	}

	function resetZIndex(): void {
		zIndex = "";
	}

	function apply(): void {
		if (!target) return;

		const rawZIndex = String(zIndex ?? "").trim();
		if (rawZIndex !== "") {
			const value = Number(rawZIndex);
			if (!Number.isFinite(value) || !Number.isInteger(value)) {
				error = "Z-index must be a whole number.";
				return;
			}
		}

		editor.setCelOpacity(
			target.layerId,
			target.frameIndex,
			opacity >= 100 ? null : opacity / 100,
		);
		editor.setCelZIndex(
			target.layerId,
			target.frameIndex,
			rawZIndex === "" ? null : Number(rawZIndex),
		);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Cel properties</Dialog.Title>
			<Dialog.Description>
				Set the opacity and stacking order for {layerName}, frame {frameNumber}.
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-4">
			<div class="grid gap-1.5">
				<div class="flex items-center justify-between">
					<Label for="cel-opacity">Opacity</Label>
					<span class="font-mono text-[10px] tabular-nums text-muted-foreground">
						{opacity}%
					</span>
				</div>
				<div class="flex items-center gap-2">
					<Slider
						id="cel-opacity"
						type="single"
						min={0}
						max={100}
						step={1}
						bind:value={opacity}
					/>
					<Button variant="outline" size="sm" onclick={resetOpacity}>
						Reset
					</Button>
				</div>
				<p class="text-[10px] text-muted-foreground">
					Multiplies the layer opacity for this cel only. 100% uses the layer
					opacity.
				</p>
			</div>

			<div class="grid gap-1.5">
				<Label for="cel-z-index">Z-index</Label>
				<div class="flex items-center gap-2">
					<Input
						id="cel-z-index"
						type="number"
						bind:value={zIndex}
						placeholder="Layer order"
						class="tabular-nums"
					/>
					<Button variant="outline" size="sm" onclick={resetZIndex}>
						Reset
					</Button>
				</div>
				<p class="text-[10px] text-muted-foreground">
					Stacks this cel above or below the other cels in the frame. Leave empty
					to use the normal layer order.
				</p>
				{#if hasGroups}
					<p class="flex items-start gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
						<TriangleAlert class="mt-px size-3 shrink-0" />
						Z-index only affects non-grouped projects. This project has layer
						groups, so a z-index here is saved but does not change the render
						order.
					</p>
				{/if}
			</div>

			{#if error}
				<p class="text-xs text-destructive">{error}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={apply}>Apply</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
