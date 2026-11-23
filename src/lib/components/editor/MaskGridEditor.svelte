<script lang="ts">
	import { packColor } from "$lib/editor/color.js";
	import { plotLine } from "$lib/editor/draw.js";
	import type { PixelMask } from "$lib/editor/mask.js";

	let {
		mask,
		revision = 0,
		onpaint,
		readonly = false,
		color = "#e4e4e7",
		class: className = "",
	}: {
		mask: PixelMask;
		revision?: number;
		onpaint?: (x: number, y: number, value: number) => void;
		readonly?: boolean;
		color?: string;
		class?: string;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	let painting = false;
	let paintValue = 1;
	let lastCell: { x: number; y: number } | null = null;

	$effect(() => {
		const current = mask;
		const fill = color;
		revision;
		if (!canvas) return;
		const width = current.width;
		const height = current.height;
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) return;
		context.clearRect(0, 0, width, height);

		const packed = packColor(fill);
		for (let index = 0; index < current.data.length; index++) {
			if (!current.data[index]) continue;
			const x = index % width;
			const y = (index - x) / width;
			const unpacked = packed;
			context.fillStyle = `rgba(${unpacked & 0xff}, ${(unpacked >>> 8) & 0xff}, ${(unpacked >>> 16) & 0xff}, 1)`;
			context.fillRect(x, y, 1, 1);
		}
	});

	function cellFromEvent(event: PointerEvent): { x: number; y: number } | null {
		if (!canvas || mask.width <= 0 || mask.height <= 0) return null;
		const rect = canvas.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		const x = Math.floor(((event.clientX - rect.left) / rect.width) * mask.width);
		const y = Math.floor(((event.clientY - rect.top) / rect.height) * mask.height);
		return {
			x: Math.max(0, Math.min(mask.width - 1, x)),
			y: Math.max(0, Math.min(mask.height - 1, y)),
		};
	}

	function paintCell(x: number, y: number): void {
		onpaint?.(x, y, paintValue);
	}

	function handlePointerDown(event: PointerEvent): void {
		if (readonly || (event.button !== 0 && event.button !== 2)) return;
		const cell = cellFromEvent(event);
		if (!cell) return;
		event.preventDefault();
		paintValue = event.button === 2 ? 0 : 1;
		painting = true;
		lastCell = cell;
		paintCell(cell.x, cell.y);
		try {
			canvas?.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic pointer events in automated checks do not capture.
		}
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!painting || readonly) return;
		const cell = cellFromEvent(event);
		if (!cell) return;
		if (lastCell && (lastCell.x !== cell.x || lastCell.y !== cell.y)) {
			plotLine(lastCell.x, lastCell.y, cell.x, cell.y, (x, y) => paintCell(x, y));
		} else if (!lastCell) {
			paintCell(cell.x, cell.y);
		}
		lastCell = cell;
	}

	function handlePointerUp(event: PointerEvent): void {
		painting = false;
		lastCell = null;
		try {
			canvas?.releasePointerCapture(event.pointerId);
		} catch {
			// Ignore released or synthetic capture.
		}
	}
</script>

<div class={`checkerboard relative overflow-hidden rounded-lg border ${className}`}>
	<canvas
		bind:this={canvas}
		class="block w-full touch-none select-none"
		style:aspect-ratio={`${mask.width} / ${mask.height}`}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
		onpointerleave={(event) => {
			if (painting) handlePointerUp(event);
		}}
		oncontextmenu={(event) => event.preventDefault()}
		aria-label={readonly ? "Mask preview" : "Mask editor"}
	></canvas>
	<div
		class="pointer-events-none absolute inset-0"
		style={`background-image: linear-gradient(to right, var(--grid-line) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px); background-size: ${100 / mask.width}% ${100 / mask.height}%;`}
		aria-hidden="true"
	></div>
</div>
