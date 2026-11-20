<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import {
		colorWithAlpha,
		hexToRgb,
		hsvToRgb,
		normalizeHex,
		rgbToHex,
		rgbToHsv,
		type Rgb,
	} from "$lib/editor/color.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import type { ColorSlot } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";

	let {
		open = $bindable(false),
		slot = "primary",
	}: { open?: boolean; slot?: ColorSlot } = $props();

	const HUE_TRACK =
		"linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)";

	const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
	const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
	const hexOf = (color: Rgb) => rgbToHex(color.r, color.g, color.b);

	let svArea: HTMLDivElement | undefined;
	let draggingSv = false;

	let hue = $state(0);
	let saturation = $state(0);
	let value = $state(0);
	let syncedHex = "";

	let hexDraft = $state("");
	let hexFocused = $state(false);
	let mode = $state<"rgb" | "hsv">("rgb");

	let activeHex = $derived(
		slot === "primary" ? editor.primaryColor : editor.secondaryColor,
	);
	let activeAlpha = $derived(
		slot === "primary" ? editor.alpha : editor.secondaryAlpha,
	);
	let alphaPercent = $derived(Math.round((activeAlpha / 255) * 100));
	let rgb = $derived(hexToRgb(activeHex));
	let palette = $derived(editor.activePalette);
	let slotLabel = $derived(slot === "primary" ? "Primary" : "Secondary");
	let mouseLabel = $derived(slot === "primary" ? "left mouse" : "right mouse");

	let rgbRows = $derived([
		{
			id: "r",
			label: "R",
			value: rgb.r,
			max: 255,
			track: `linear-gradient(to right, rgb(0 ${rgb.g} ${rgb.b}), rgb(255 ${rgb.g} ${rgb.b}))`,
			apply: (next: number) => commitRgb("r", next),
		},
		{
			id: "g",
			label: "G",
			value: rgb.g,
			max: 255,
			track: `linear-gradient(to right, rgb(${rgb.r} 0 ${rgb.b}), rgb(${rgb.r} 255 ${rgb.b}))`,
			apply: (next: number) => commitRgb("g", next),
		},
		{
			id: "b",
			label: "B",
			value: rgb.b,
			max: 255,
			track: `linear-gradient(to right, rgb(${rgb.r} ${rgb.g} 0), rgb(${rgb.r} ${rgb.g} 255))`,
			apply: (next: number) => commitRgb("b", next),
		},
	]);

	let hsvRows = $derived([
		{
			id: "h",
			label: "H",
			value: Math.round(hue),
			max: 359,
			track: HUE_TRACK,
			apply: (next: number) => applyHsv(next, saturation, value),
		},
		{
			id: "s",
			label: "S",
			value: Math.round(saturation * 100),
			max: 100,
			track: `linear-gradient(to right, ${hexOf(hsvToRgb(hue, 0, value))}, ${hexOf(hsvToRgb(hue, 1, value))})`,
			apply: (next: number) => applyHsv(hue, clamp01(next / 100), value),
		},
		{
			id: "v",
			label: "V",
			value: Math.round(value * 100),
			max: 100,
			track: `linear-gradient(to right, #000000, ${hexOf(hsvToRgb(hue, saturation, 1))})`,
			apply: (next: number) => applyHsv(hue, saturation, clamp01(next / 100)),
		},
	]);

	let channels = $derived(mode === "rgb" ? rgbRows : hsvRows);

	$effect(() => {
		if (!open || activeHex === syncedHex) return;
		const hsv = rgbToHsv(hexToRgb(activeHex));
		if (hsv.s > 0) hue = Math.round(hsv.h);
		saturation = hsv.s;
		value = hsv.v;
		syncedHex = activeHex;
	});

	$effect(() => {
		if (!hexFocused) hexDraft = activeHex;
	});

	function setActiveHex(next: string): boolean {
		const normalized = normalizeHex(next);
		if (!normalized) return false;
		editor.setColor(slot, normalized);
		const hsv = rgbToHsv(hexToRgb(normalized));
		if (hsv.s > 0) hue = Math.round(hsv.h);
		saturation = hsv.s;
		value = hsv.v;
		syncedHex = normalized;
		return true;
	}

	function applyHsv(nextHue = hue, nextSaturation = saturation, nextValue = value): void {
		const h = ((nextHue % 360) + 360) % 360;
		const s = clamp01(nextSaturation);
		const v = clamp01(nextValue);
		const color = hsvToRgb(h, s, v);
		const next = hexOf(color);

		hue = h;
		saturation = s;
		value = v;
		syncedHex = next;
		editor.setColor(slot, next);
	}

	function commitRgb(channel: "r" | "g" | "b", next: number): void {
		if (!Number.isFinite(next)) return;
		const updated = { ...rgb, [channel]: clampByte(next) };
		setActiveHex(rgbToHex(updated.r, updated.g, updated.b));
	}

	function onHexInput(event: Event): void {
		hexDraft = (event.currentTarget as HTMLInputElement).value;
		setActiveHex(hexDraft);
	}

	function commitHex(): void {
		if (setActiveHex(hexDraft)) editor.snapColorToPalette(slot);
		hexDraft = activeHex;
		hexFocused = false;
	}

	function onHueInput(event: Event): void {
		applyHsv(Number((event.currentTarget as HTMLInputElement).value), saturation, value);
	}

	function onAlphaInput(event: Event): void {
		editor.setColorAlpha(slot, Number((event.currentTarget as HTMLInputElement).value));
	}

	function commitAlphaPercent(event: Event): void {
		const percent = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(percent)) return;
		editor.setColorAlpha(
			slot,
			Math.round((Math.max(0, Math.min(100, percent)) / 100) * 255),
		);
	}

	function updateFromPointer(event: PointerEvent): void {
		if (!svArea) return;
		const rect = svArea.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		const s = clamp01((event.clientX - rect.left) / rect.width);
		const v = 1 - clamp01((event.clientY - rect.top) / rect.height);
		applyHsv(hue, s, v);
	}

	function onSvPointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		draggingSv = true;
		try {
			svArea?.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic pointer events may not own a capture target.
		}
		updateFromPointer(event);
	}

	function onSvPointerMove(event: PointerEvent): void {
		if (!draggingSv) return;
		updateFromPointer(event);
	}

	function onSvPointerUp(event: PointerEvent): void {
		draggingSv = false;
		if (svArea?.hasPointerCapture(event.pointerId)) {
			svArea.releasePointerCapture(event.pointerId);
		}
		// Palette lock snaps only when the picker is released, so dragging
		// remains smooth and still previews intermediate colors.
		editor.snapColorToPalette(slot);
	}

	function onSvKeydown(event: KeyboardEvent): void {
		const step = event.shiftKey ? 0.1 : 0.02;
		if (event.key === "ArrowLeft") applyHsv(hue, saturation - step, value);
		else if (event.key === "ArrowRight") applyHsv(hue, saturation + step, value);
		else if (event.key === "ArrowUp") applyHsv(hue, saturation, value + step);
		else if (event.key === "ArrowDown") applyHsv(hue, saturation, value - step);
		else return;
		event.preventDefault();
	}

	function choosePaletteColor(color: string): void {
		setActiveHex(color);
		editor.setColorAlpha(slot, 255);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{slotLabel} color</Dialog.Title>
			<Dialog.Description>
				Choose the {slotLabel.toLowerCase()} color ({mouseLabel}) with the picker,
				channel sliders, or a palette swatch. Changes apply immediately.
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-4">
			<div class="flex items-end gap-3">
				<div
					class="checkerboard relative size-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-border"
					aria-hidden="true"
				>
					<span
						class="absolute inset-0"
						style={`background-color: ${colorWithAlpha(activeHex, activeAlpha / 255)}`}
					></span>
				</div>
				<div class="grid flex-1 gap-1.5">
					<Label for="color-hex">Hex</Label>
					<Input
						id="color-hex"
						value={hexDraft}
						oninput={onHexInput}
						onfocus={() => (hexFocused = true)}
						onblur={commitHex}
						onkeydown={(event) => {
							if (event.key === "Enter") event.currentTarget.blur();
						}}
						maxlength={7}
						spellcheck={false}
						aria-label={`${slotLabel} hex color`}
						class="h-8 px-2 font-mono text-xs uppercase"
					/>
				</div>
				<div class="grid gap-1.5">
					<Label for="color-alpha">Alpha</Label>
					<Input
						id="color-alpha"
						type="number"
						min={0}
						max={100}
						step={1}
						value={alphaPercent}
						onchange={commitAlphaPercent}
						aria-label={`${slotLabel} alpha percent`}
						class="h-8 w-20 px-2 text-right font-mono text-xs tabular-nums"
					/>
				</div>
			</div>

			<div class="space-y-2">
				<div
					bind:this={svArea}
					role="slider"
					tabindex="0"
					aria-label={`${slotLabel} saturation and brightness`}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(value * 100)}
					aria-valuetext={`Saturation ${Math.round(saturation * 100)}%, brightness ${Math.round(value * 100)}%`}
					class="relative h-40 w-full touch-none overflow-hidden rounded-lg ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onpointerdown={onSvPointerDown}
					onpointermove={onSvPointerMove}
					onpointerup={onSvPointerUp}
					onpointercancel={onSvPointerUp}
					onkeydown={onSvKeydown}
				>
					<span
						class="absolute inset-0"
						style={`background-color: hsl(${hue} 100% 50%)`}
					></span>
					<span class="absolute inset-0 bg-linear-to-r from-white to-transparent"></span>
					<span class="absolute inset-0 bg-linear-to-t from-black to-transparent"></span>
					<span
						class="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
						style={`left: ${saturation * 100}%; top: ${(1 - value) * 100}%;`}
					></span>
				</div>

				<input
					type="range"
					min={0}
					max={359}
					step={1}
					value={Math.round(hue)}
					oninput={onHueInput}
					onchange={() => editor.snapColorToPalette(slot)}
					class="color-range"
					style={`background: ${HUE_TRACK}`}
					aria-label={`${slotLabel} hue`}
				/>

				<div
					class="checkerboard relative h-3 overflow-hidden rounded-full ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
				>
					<span
						class="absolute inset-0"
						style={`background: linear-gradient(to right, ${colorWithAlpha(activeHex, 0)}, ${colorWithAlpha(activeHex, 1)})`}
					></span>
					<input
						type="range"
						min={0}
						max={255}
						step={1}
						value={activeAlpha}
						oninput={onAlphaInput}
						class="color-range absolute inset-0 h-full w-full bg-transparent"
						aria-label={`${slotLabel} alpha`}
					/>
				</div>
			</div>

			<div class="space-y-2">
				<div class="flex items-center justify-between">
					<span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Channels
					</span>
					<div class="flex items-center gap-0.5 rounded-lg border p-0.5">
						{#each ["rgb", "hsv"] as option (option)}
							<button
								type="button"
								class={cn(
									"rounded-md px-2 py-0.5 text-[10px] font-medium uppercase transition-colors",
									mode === option
										? "bg-accent text-foreground"
										: "text-muted-foreground hover:bg-accent/60",
								)}
								onclick={() => (mode = option as "rgb" | "hsv")}
								aria-pressed={mode === option}
							>
								{option}
							</button>
						{/each}
					</div>
				</div>

				<div class="space-y-1.5">
					{#each channels as channel (channel.id)}
						<div class="flex items-center gap-2">
							<span class="w-3 shrink-0 text-[10px] font-medium text-muted-foreground">
								{channel.label}
							</span>
							<input
								type="range"
								min={0}
								max={channel.max}
								step={1}
								value={channel.value}
								oninput={(event) =>
									channel.apply(Number(event.currentTarget.value))}
								onchange={() => editor.snapColorToPalette(slot)}
								class="color-range min-w-0 flex-1"
								style={`background: ${channel.track}`}
								aria-label={`${slotLabel} ${channel.label}`}
							/>
							<Input
								type="number"
								min={0}
								max={channel.max}
								step={1}
								value={channel.value}
								onchange={(event) =>
									channel.apply(Number(event.currentTarget.value))}
								aria-label={`${slotLabel} ${channel.label} value`}
								class="h-7 w-16 shrink-0 px-1.5 text-right font-mono text-[11px] tabular-nums"
							/>
						</div>
					{/each}
				</div>
			</div>

			<div class="space-y-1.5">
				<div class="flex items-center justify-between">
					<span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Palette
					</span>
					<span class="truncate pl-2 text-[10px] text-muted-foreground">
						{palette.name}
					</span>
				</div>
				<div class="max-h-28 overflow-y-auto p-1">
					{#if palette.colors.length === 0}
						<p
							class="rounded-md border border-dashed px-2 py-2 text-center text-[10px] text-muted-foreground"
						>
							This palette has no colors.
						</p>
					{:else}
						<div class="grid grid-cols-12 gap-1">
							{#each palette.colors as color, index}
								<button
									type="button"
									class="relative aspect-square rounded-[4px] ring-1 ring-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									style={`background-color: ${color}`}
									title={`${color} — color ${index + 1}`}
									aria-label={`Use palette color ${color}, color ${index + 1}`}
									onclick={() => choosePaletteColor(color)}
								>
									{#if activeHex === color && activeAlpha === 255}
										<span
											class="pointer-events-none absolute inset-0 rounded-[4px] ring-2 ring-foreground"
										></span>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>

		<Dialog.Footer>
			{#if editor.paletteLocked}
				<span class="mr-auto text-[10px] text-muted-foreground">
					Palette lock snaps picks to the nearest swatch.
				</span>
			{/if}
			<Button onclick={() => (open = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
