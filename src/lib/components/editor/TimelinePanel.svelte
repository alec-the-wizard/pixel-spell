<script lang="ts">
	import ArrowLeft from "@lucide/svelte/icons/arrow-left";
	import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
	import ArrowRight from "@lucide/svelte/icons/arrow-right";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronUp from "@lucide/svelte/icons/chevron-up";
	import ClipboardCopy from "@lucide/svelte/icons/clipboard-copy";
	import ClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
	import Copy from "@lucide/svelte/icons/copy";
	import Eye from "@lucide/svelte/icons/eye";
	import EyeOff from "@lucide/svelte/icons/eye-off";
	import Film from "@lucide/svelte/icons/film";
	import FolderInput from "@lucide/svelte/icons/folder-input";
	import FolderOutput from "@lucide/svelte/icons/folder-output";
	import FolderPlus from "@lucide/svelte/icons/folder-plus";
	import Ghost from "@lucide/svelte/icons/ghost";
	import IndentDecrease from "@lucide/svelte/icons/indent-decrease";
	import IndentIncrease from "@lucide/svelte/icons/indent-increase";
	import Lock from "@lucide/svelte/icons/lock";
	import LockOpen from "@lucide/svelte/icons/lock-open";
	import Pause from "@lucide/svelte/icons/pause";
	import Play from "@lucide/svelte/icons/play";
	import Plus from "@lucide/svelte/icons/plus";
	import Repeat from "@lucide/svelte/icons/repeat";
	import RepeatOff from "@lucide/svelte/icons/repeat-off";
	import ScanEye from "@lucide/svelte/icons/scan-eye";
	import Settings2 from "@lucide/svelte/icons/settings-2";
	import SkipBack from "@lucide/svelte/icons/skip-back";
	import SkipForward from "@lucide/svelte/icons/skip-forward";
	import Tag from "@lucide/svelte/icons/tag";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import { untrack } from "svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Separator } from "$lib/components/ui/separator/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import { normalizeAnimationMode } from "$lib/editor/doc.js";
	import type { Layer } from "$lib/editor/types.js";
	import {
		IMAGE_IMPORT_ACCEPT,
		analyzeImportFile,
	} from "$lib/editor/import.js";
	import { cn } from "$lib/utils.js";
	import DuplicateFramesDialog from "./DuplicateFramesDialog.svelte";
	import FramePropertiesDialog from "./FramePropertiesDialog.svelte";
	import LayerPropertiesDialog from "./LayerPropertiesDialog.svelte";
	import TimelineLayerRow from "./TimelineLayerRow.svelte";

	let opacity = $state(100);
	let referenceInput = $state<HTMLInputElement>();
	let referenceLoading = $state(false);

	let framePropertiesOpen = $state(false);
	let layerPropertiesOpen = $state(false);
	let duplicateFramesOpen = $state(false);

	let contextMenu = $state<
		| { kind: "frame"; x: number; y: number; frameIndex: number }
		| { kind: "layer"; x: number; y: number; layerId: string }
		| {
				kind: "cel";
				x: number;
				y: number;
				layerId: string;
				frameIndex: number;
		  }
		| null
	>(null);

	/** Cel where a left-button block selection started, if any. */
	let celDrag = $state<{ layerId: string; frameIndex: number } | null>(null);

	let draggingFrames = $state(false);
	let dragOverIndex = $state<number | null>(null);
	let dragOverSide = $state<"before" | "after">("before");

	let draggingLayerId = $state<string | null>(null);
	let dropIndicator = $state<{
		targetId: string;
		mode: "before" | "after" | "into";
	} | null>(null);

	/** Ids of the dragged layer's subtree, used to reject invalid drop targets. */
	let dragSourceIds = $derived.by(() => {
		if (!draggingLayerId) return null;
		return editor.layerSubtreeIds(draggingLayerId);
	});

	const MENU_ITEM_CLASS =
		"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-40";
	const MENU_DANGER_CLASS =
		"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-destructive outline-none hover:bg-destructive/10 focus-visible:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40";

	const ONION_TINT_PRESETS = [
		{ id: "red-green", label: "Red / green", previous: "#ef4444", next: "#22c55e" },
		{ id: "amber-blue", label: "Amber / blue", previous: "#f59e0b", next: "#3b82f6" },
		{ id: "violet-teal", label: "Violet / teal", previous: "#8b5cf6", next: "#14b8a6" },
		{ id: "grayscale", label: "Grayscale", previous: "#71717a", next: "#a1a1aa" },
	];

	const ANIMATION_MODE_OPTIONS = [
		{ id: "forward", label: "Forward" },
		{ id: "backward", label: "Backward" },
		{ id: "ping-pong", label: "Ping-pong" },
	] as const;

	let animationModeLabel = $derived(
		ANIMATION_MODE_OPTIONS.find((option) => option.id === editor.animationMode)
			?.label ?? "Forward",
	);

	let tagGroups = $derived.by(() => {
		const frames = editor.doc.frames;
		const groups: { start: number; end: number; tag: string }[] = [];
		let start = 0;
		while (start < frames.length) {
			const tag = frames[start]!.tag ?? "";
			let end = start;
			while (end + 1 < frames.length && (frames[end + 1]!.tag ?? "") === tag) {
				end++;
			}
			groups.push({ start, end, tag });
			start = end + 1;
		}
		return groups;
	});

	// Timeline virtualization: only the layer rows and frame columns that are
	// actually visible (plus a little overscan) are rendered. The sticky header
	// and layer column remain, and spacer cells preserve the scroll extents.
	const LAYER_COLUMN_WIDTH = 240; // w-60
	const FRAME_COLUMN_WIDTH = 56; // w-14
	const LAYER_ROW_HEIGHT = 48; // h-12
	const OVERSCAN = 4;

	let scrollElement = $state<HTMLDivElement | null>(null);
	let scrollLeft = $state(0);
	let scrollTop = $state(0);
	// Start "unbounded" so the first paint renders everything; the effect below
	// measures the real viewport and virtualizes from then on.
	let viewportWidth = $state(10_000);
	let viewportHeight = $state(10_000);

	let firstFrame = $derived(
		Math.max(
			0,
			Math.floor(scrollLeft / FRAME_COLUMN_WIDTH) - OVERSCAN,
		),
	);
	let lastFrame = $derived(
		Math.min(
			editor.doc.frames.length - 1,
			Math.max(
				firstFrame,
				Math.ceil(
					(scrollLeft + viewportWidth - LAYER_COLUMN_WIDTH) /
						FRAME_COLUMN_WIDTH,
				) +
					OVERSCAN -
					1,
			),
		),
	);
	let visibleFrames = $derived(
		lastFrame >= firstFrame
			? editor.doc.frames.slice(firstFrame, lastFrame + 1)
			: [],
	);
	let leadingFrameCols = $derived(firstFrame);
	let trailingFrameCols = $derived(
		Math.max(0, editor.doc.frames.length - 1 - lastFrame),
	);

	/** Layers in display (top-to-bottom) order, as the table renders them. */
	let displayLayers = $derived(editor.timelineLayers);

	let firstLayer = $derived(
		Math.max(0, Math.floor(scrollTop / LAYER_ROW_HEIGHT) - OVERSCAN),
	);
	let lastLayer = $derived(
		Math.min(
			displayLayers.length - 1,
			Math.max(
				firstLayer,
				Math.ceil((scrollTop + viewportHeight) / LAYER_ROW_HEIGHT) +
					OVERSCAN -
					1,
			),
		),
	);
	let visibleLayers = $derived(
		lastLayer >= firstLayer
			? displayLayers.slice(firstLayer, lastLayer + 1)
			: [],
	);
	let leadingLayerRows = $derived(firstLayer);
	let trailingLayerRows = $derived(
		Math.max(0, displayLayers.length - 1 - lastLayer),
	);

	let windowedTagGroups = $derived.by(() => {
		const first = firstFrame;
		const last = lastFrame;
		const groups: {
			start: number;
			end: number;
			colSpan: number;
			tag: string;
			labeled: boolean;
		}[] = [];
		if (last < first) return groups;
		for (const group of tagGroups) {
			if (group.end < first || group.start > last) continue;
			const visibleStart = Math.max(group.start, first);
			const visibleEnd = Math.min(group.end, last);
			groups.push({
				start: group.start,
				end: group.end,
				colSpan: visibleEnd - visibleStart + 1,
				tag: group.tag,
				labeled: group.start >= first,
			});
		}
		return groups;
	});

	function updateScroll(): void {
		const element = scrollElement;
		if (!element) return;
		scrollLeft = element.scrollLeft;
		scrollTop = element.scrollTop;
	}

	$effect(() => {
		const element = scrollElement;
		if (!element) return;
		viewportWidth = element.clientWidth;
		viewportHeight = element.clientHeight;
		scrollLeft = element.scrollLeft;
		scrollTop = element.scrollTop;
		const observer = new ResizeObserver(() => {
			viewportWidth = element.clientWidth;
			viewportHeight = element.clientHeight;
		});
		observer.observe(element);
		return () => observer.disconnect();
	});

	let contextTitle = $derived.by(() => {
		if (!contextMenu) return "";
		if (contextMenu.kind === "layer") {
			return `Layer · ${editor.activeLayer.name}`;
		}
		const indices = editor.selectedFrameIndices;
		const frameLabel =
			indices.length <= 1
				? `Frame ${contextMenu.frameIndex + 1}`
				: `Frames ${indices[0]! + 1}–${indices[indices.length - 1]! + 1} · ${indices.length} selected`;
		if (contextMenu.kind === "cel") {
			return `${editor.activeLayer.name} · ${frameLabel}`;
		}
		return frameLabel;
	});

	async function addReferenceLayer(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;

		referenceLoading = true;
		try {
			const result = await analyzeImportFile(file);
			if (result.reference) {
				const image = {
					name: result.reference.name,
					width: result.reference.pixelWidth,
					height: result.reference.pixelHeight,
					pixels: result.reference.pixels,
				};
				// Replacing the current cel makes it easy to build a per-frame
				// reference sequence without creating a layer per image.
				if (!editor.setReferenceLayerImage(image)) {
					editor.importReferenceLayer(image, { allFrames: true });
				}
			} else {
				window.alert(
					result.error ?? "This file can't be used as a reference layer.",
				);
			}
			if (result.project) URL.revokeObjectURL(result.project.previewUrl);
		} catch {
			window.alert("This image could not be read.");
		} finally {
			referenceLoading = false;
		}
	}

	$effect(() => {
		opacity = Math.round(editor.activeLayer.opacity * 100);
	});

	function changeOpacity(value: number): void {
		editor.setLayerOpacity(editor.activeLayerId, value / 100);
	}

	$effect(() => {
		if (!editor.playing) return;
		if (editor.doc.frames.length <= 1) return;

		// Track everything that defines the playback sequence so changing the
		// selection, mode, loop setting, or timing restarts it.
		editor.doc.fps;
		editor.doc.animationMode;
		editor.doc.animationLoop;
		editor.frameSelection;
		editor.doc.frames.map((frame) => frame.duration ?? 0).join(",");

		untrack(() => editor.preparePlayback());

		let timer: number | undefined;
		const tick = (): void => {
			const frame = editor.nextPlaybackFrame();
			if (frame === null) {
				editor.stopPlayback();
				return;
			}
			editor.selectFrame(frame, { preserveSelection: true });
			timer = window.setTimeout(
				tick,
				Math.max(10, editor.frameDurationAt(frame)),
			);
		};
		timer = window.setTimeout(
			tick,
			Math.max(
				10,
				untrack(() => editor.frameDurationAt(editor.activeFrame)),
			),
		);

		return () => {
			if (timer !== undefined) window.clearTimeout(timer);
		};
	});

	function handleFrameClick(event: MouseEvent, index: number): void {
		if (event.shiftKey) {
			editor.selectFrame(index, { extend: true });
		} else if (event.ctrlKey || event.metaKey) {
			editor.toggleFrameSelection(index);
		} else {
			editor.selectFrame(index);
		}
	}

	/** Positions a fixed context menu without letting it leave the viewport. */
	function menuCoordinates(event: MouseEvent): { x: number; y: number } {
		const width = 224;
		const height = 480;
		return {
			x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
			y: Math.max(8, Math.min(event.clientY, window.innerHeight - height)),
		};
	}

	function openFrameContextMenu(event: MouseEvent, index: number): void {
		event.preventDefault();
		contextMenu = {
			kind: "frame",
			...menuCoordinates(event),
			frameIndex: index,
		};
	}

	function handleHeaderContextMenu(event: MouseEvent, index: number): void {
		if (editor.isFrameSelected(index)) {
			editor.selectFrame(index, { preserveSelection: true });
		} else {
			editor.selectFrame(index);
		}
		openFrameContextMenu(event, index);
	}

	function handleTagContextMenu(
		event: MouseEvent,
		start: number,
		end: number,
	): void {
		editor.selectFrameRange(start, end);
		openFrameContextMenu(event, start);
	}

	function handleCelPointerDown(
		event: PointerEvent,
		layerId: string,
		frameIndex: number,
	): void {
		if (event.button !== 0) return;
		if (event.shiftKey) {
			editor.extendCelSelection(layerId, frameIndex);
			return;
		}
		if (event.ctrlKey || event.metaKey) {
			editor.toggleCelSelection(layerId, frameIndex);
			return;
		}
		celDrag = { layerId, frameIndex };
		editor.selectCel(layerId, frameIndex);
		// Prevent native text/image selection while dragging across cels.
		event.preventDefault();
	}

	function handleCelPointerEnter(layerId: string, frameIndex: number): void {
		if (!celDrag) return;
		if (celDrag.layerId === layerId && celDrag.frameIndex === frameIndex) return;
		editor.selectCelRange(
			celDrag.layerId,
			celDrag.frameIndex,
			layerId,
			frameIndex,
		);
	}

	function endCelDrag(): void {
		celDrag = null;
	}

	function handleCelContextMenu(
		event: MouseEvent,
		layerId: string,
		frameIndex: number,
	): void {
		event.preventDefault();
		if (editor.isLayerSelected(layerId)) {
			editor.selectLayer(layerId, { preserveSelection: true });
		} else {
			editor.selectLayer(layerId);
		}
		if (editor.isFrameSelected(frameIndex)) {
			editor.selectFrame(frameIndex, { preserveSelection: true });
		} else {
			editor.selectFrame(frameIndex);
		}
		contextMenu = {
			kind: "cel",
			...menuCoordinates(event),
			layerId,
			frameIndex,
		};
	}

	function handleLayerContextMenu(event: MouseEvent, layer: Layer): void {
		event.preventDefault();
		if (editor.isLayerSelected(layer.id)) {
			editor.selectLayer(layer.id, { preserveSelection: true });
		} else {
			editor.selectLayer(layer.id);
		}
		contextMenu = {
			kind: "layer",
			...menuCoordinates(event),
			layerId: layer.id,
		};
	}

	function openLayerProperties(layer: Layer): void {
		editor.selectLayer(layer.id);
		layerPropertiesOpen = true;
	}

	function closeContextMenu(): void {
		contextMenu = null;
	}

	function runMenuAction(action: () => void): void {
		action();
		contextMenu = null;
	}

	function handleWindowPointerDown(event: PointerEvent): void {
		if (!contextMenu) return;
		const target = event.target;
		if (target instanceof Element && target.closest("[data-timeline-menu]")) return;
		contextMenu = null;
	}

	function handleWindowKeydown(event: KeyboardEvent): void {
		if (!contextMenu || event.key !== "Escape") return;
		event.stopImmediatePropagation();
		contextMenu = null;
	}

	function beginFrameDrag(event: DragEvent, index: number): void {
		if (!editor.isFrameSelected(index)) editor.selectFrame(index);
		draggingFrames = true;
		dragOverIndex = null;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("text/plain", String(index));
		}
	}

	function updateFrameDrag(event: DragEvent, index: number): void {
		if (!draggingFrames) return;
		event.preventDefault();
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		dragOverIndex = index;
		dragOverSide =
			event.clientX < rect.left + rect.width / 2 ? "before" : "after";
		if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
	}

	function finishFrameDrag(event: DragEvent, index: number): void {
		if (!draggingFrames) return;
		event.preventDefault();
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const side = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
		editor.moveFramesTo(index + (side === "after" ? 1 : 0));
		draggingFrames = false;
		dragOverIndex = null;
	}

	function endFrameDrag(): void {
		draggingFrames = false;
		dragOverIndex = null;
	}

	function beginLayerDrag(event: DragEvent, layer: Layer): void {
		editor.selectLayer(layer.id);
		draggingLayerId = layer.id;
		dropIndicator = null;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("text/plain", layer.id);
		}
	}

	function updateLayerDrop(layer: Layer, mode: "before" | "after" | "into" | null): void {
		dropIndicator =
			mode === null ? null : { targetId: layer.id, mode };
	}

	function finishLayerDrop(layer: Layer, mode: "before" | "after" | "into"): void {
		const dragged = draggingLayerId;
		draggingLayerId = null;
		dropIndicator = null;
		if (!dragged || dragged === layer.id) return;
		if (mode === "into") {
			editor.moveLayerTo(dragged, { kind: "into", groupId: layer.id });
		} else {
			editor.moveLayerTo(dragged, { kind: mode, refId: layer.id });
		}
	}

	function endLayerDrag(): void {
		draggingLayerId = null;
		dropIndicator = null;
	}

	function tagHue(tag: string): number {
		let hash = 0;
		for (let index = 0; index < tag.length; index++) {
			hash = (hash * 31 + tag.charCodeAt(index)) % 360;
		}
		return hash;
	}

	function tagBackground(tag: string): string {
		return `color-mix(in oklab, hsl(${tagHue(tag)} 70% 55%) 16%, var(--background))`;
	}

	function tagDot(tag: string): string {
		return `hsl(${tagHue(tag)} 65% 55%)`;
	}

	function onionPresetId(): string {
		const preset = ONION_TINT_PRESETS.find(
			(option) =>
				option.previous === editor.onionTintPrevious &&
				option.next === editor.onionTintNext,
		);
		return preset?.id ?? "custom";
	}

	function applyOnionPreset(id: string): void {
		const preset = ONION_TINT_PRESETS.find((option) => option.id === id);
		if (!preset) return;
		editor.setOnionTint("previous", preset.previous);
		editor.setOnionTint("next", preset.next);
	}
</script>

<section class="flex h-full min-h-0 flex-col bg-background">
	<header class="flex h-11 shrink-0 items-center gap-1.5 border-b px-3">
		<Film class="size-4 text-muted-foreground" />
		<span class="text-xs font-medium">Timeline</span>
		<Badge
			variant="secondary"
			class="h-5 px-1.5 text-[10px] tabular-nums"
			title={`${editor.doc.layers.length} layers, ${editor.frameCount} frames`}
		>
			{editor.doc.layers.length} × {editor.frameCount}
		</Badge>
		{#if editor.selectedFrameCount > 1}
			<Badge
				variant="outline"
				class="h-5 px-1.5 text-[10px] tabular-nums"
				title={`${editor.selectedFrameCount} frames selected`}
			>
				{editor.selectedFrameCount} frames
			</Badge>
		{/if}
		{#if editor.selectedLayerCount > 1}
			<Badge
				variant="outline"
				class="h-5 px-1.5 text-[10px] tabular-nums"
				title={`${editor.selectedLayerCount} layers selected`}
			>
				{editor.selectedLayerCount} layers
			</Badge>
		{/if}
		{#if editor.referenceLayerCount > 0}
			<Badge
				variant="outline"
				class="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground"
				title={`${editor.referenceLayerCount} reference layers`}
			>
				<ScanEye class="size-3" />
				{editor.referenceLayerCount}
			</Badge>
		{/if}

		<Separator orientation="vertical" class="mx-1.5 h-5" />
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.addLayer()}
			title="Add layer"
			aria-label="Add layer"
		>
			<Plus class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.addGroup()}
			title="New group"
			aria-label="New group"
		>
			<FolderPlus class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => referenceInput?.click()}
			disabled={referenceLoading}
			title="Add or replace reference layer from image"
			aria-label="Add or replace reference layer from image"
		>
			<ScanEye class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.duplicateLayer()}
			title="Duplicate layer"
			aria-label="Duplicate layer"
		>
			<Copy class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.groupActiveLayer()}
			title="Group active layer"
			aria-label="Group active layer"
		>
			<FolderInput class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.ungroupLayer()}
			disabled={!editor.activeLayer.isGroup}
			title="Ungroup"
			aria-label="Ungroup"
		>
			<FolderOutput class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.moveLayerUp()}
			title="Move layer up"
			aria-label="Move layer up"
		>
			<ChevronUp class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.moveLayerDown()}
			title="Move layer down"
			aria-label="Move layer down"
		>
			<ChevronDown class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.indentActiveLayer()}
			title="Move into group above"
			aria-label="Move into group above"
		>
			<IndentIncrease class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.outdentActiveLayer()}
			disabled={!editor.activeLayer.parentId}
			title="Move out of group"
			aria-label="Move out of group"
		>
			<IndentDecrease class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground hover:text-destructive"
			onclick={() => editor.deleteLayer()}
			disabled={!editor.canDeleteLayer}
			title="Delete layer"
			aria-label="Delete layer"
		>
			<Trash2 class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => (layerPropertiesOpen = true)}
			title="Layer properties"
			aria-label="Layer properties"
		>
			<Settings2 class="size-3.5" />
		</Button>

		<Separator orientation="vertical" class="mx-1.5 h-5" />
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.addFrame()}
			title="Add frame"
			aria-label="Add frame"
		>
			<Plus class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.duplicateFrames(0, 0)}
			title="Duplicate selected frames"
			aria-label="Duplicate selected frames"
		>
			<Copy class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.copyFrames()}
			title="Copy selected frames"
			aria-label="Copy selected frames"
		>
			<ClipboardCopy class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.pasteFrames()}
			disabled={!editor.hasFrameClipboard}
			title="Paste frames after selection"
			aria-label="Paste frames"
		>
			<ClipboardPaste class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground hover:text-destructive"
			onclick={() => editor.deleteSelectedFrames()}
			disabled={
				editor.frameCount <= 1 ||
				editor.selectedFrameCount >= editor.frameCount
			}
			title="Delete selected frames"
			aria-label="Delete selected frames"
		>
			<Trash2 class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => (framePropertiesOpen = true)}
			title="Frame properties"
			aria-label="Frame properties"
		>
			<Settings2 class="size-3.5" />
		</Button>

		<Separator orientation="vertical" class="mx-1.5 h-5" />
		<Button
			variant={editor.onionEnabled ? "secondary" : "ghost"}
			size="icon-xs"
			class="text-muted-foreground"
			onclick={() => editor.toggleOnion()}
			title="Toggle onion skin (O)"
			aria-label="Toggle onion skin"
			aria-pressed={editor.onionEnabled}
		>
			<Ghost class="size-3.5" />
		</Button>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
				aria-label="Onion skin settings"
				title="Onion skin settings"
			>
				<ChevronDown class="size-3.5" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content class="w-60" align="start">
				<DropdownMenu.Label>Onion skin</DropdownMenu.Label>
				<DropdownMenu.CheckboxItem bind:checked={editor.onionEnabled}>
					Enabled
					<DropdownMenu.Shortcut>O</DropdownMenu.Shortcut>
				</DropdownMenu.CheckboxItem>
				<DropdownMenu.CheckboxItem bind:checked={editor.onionShowPrevious}>
					Show previous frames
				</DropdownMenu.CheckboxItem>
				<DropdownMenu.CheckboxItem bind:checked={editor.onionShowNext}>
					Show next frames
				</DropdownMenu.CheckboxItem>
				<DropdownMenu.Separator />
				<DropdownMenu.Label>Range</DropdownMenu.Label>
				<DropdownMenu.RadioGroup
					value={String(editor.onionRange)}
					onValueChange={(value) => editor.setOnionRange(Number(value))}
				>
					{#each [1, 2, 3] as range (range)}
						<DropdownMenu.RadioItem value={String(range)} closeOnSelect>
							±{range} {range === 1 ? "frame" : "frames"}
						</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
				<DropdownMenu.Label>Opacity</DropdownMenu.Label>
				<DropdownMenu.RadioGroup
					value={String(Math.round(editor.onionOpacity * 100))}
					onValueChange={(value) =>
						editor.setOnionOpacity(Number(value) / 100)}
				>
					{#each [15, 30, 50] as percent (percent)}
						<DropdownMenu.RadioItem value={String(percent)} closeOnSelect>
							{percent}%
						</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
				<DropdownMenu.Label>Tint</DropdownMenu.Label>
				<DropdownMenu.RadioGroup
					value={onionPresetId()}
					onValueChange={applyOnionPreset}
				>
					{#each ONION_TINT_PRESETS as preset (preset.id)}
						<DropdownMenu.RadioItem value={preset.id} closeOnSelect>
							<span class="flex items-center gap-1.5">
								<span
									class="size-2 rounded-full"
									style:background={preset.previous}
								></span>
								<span
									class="size-2 rounded-full"
									style:background={preset.next}
								></span>
								{preset.label}
							</span>
						</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		<div class="ml-auto flex items-center gap-0.5">
			<Button
				variant="ghost"
				size="icon-xs"
				class="text-muted-foreground"
				onclick={() => editor.previousFrame()}
				title="Previous frame"
				aria-label="Previous frame"
			>
				<SkipBack class="size-3.5" />
			</Button>
			<Button
				variant={editor.playing ? "secondary" : "ghost"}
				size="icon-xs"
				class="text-muted-foreground"
				onclick={() => editor.togglePlayback()}
				title={editor.playing ? "Pause" : "Play"}
				aria-label={editor.playing ? "Pause animation" : "Play animation"}
			>
				{#if editor.playing}
					<Pause class="size-3.5" />
				{:else}
					<Play class="size-3.5" />
				{/if}
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				class="text-muted-foreground"
				onclick={() => editor.nextFrame()}
				title="Next frame"
				aria-label="Next frame"
			>
				<SkipForward class="size-3.5" />
			</Button>

			<div class="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground">
				<Input
					type="number"
					min={1}
					max={60}
					value={editor.doc.fps}
					onchange={(event) => editor.setFps(Number(event.currentTarget.value))}
					aria-label="Frames per second"
					title="Fallback frames per second for frames without a custom duration"
					class="h-6 w-12 px-1 text-center font-mono text-[11px]"
				/>
				<span>fps</span>
			</div>

			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="ml-0.5 flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					aria-label={`Animation mode: ${animationModeLabel}`}
					title={`Animation mode: ${animationModeLabel}`}
				>
					{#if editor.animationMode === "forward"}
						<ArrowRight class="size-3.5" />
					{:else if editor.animationMode === "backward"}
						<ArrowLeft class="size-3.5" />
					{:else}
						<ArrowLeftRight class="size-3.5" />
					{/if}
					<span class="hidden sm:inline">{animationModeLabel}</span>
					<ChevronDown class="size-3" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="w-48" align="start">
					<DropdownMenu.Label>Animation mode</DropdownMenu.Label>
					<DropdownMenu.RadioGroup
						value={editor.animationMode}
						onValueChange={(value) =>
							editor.setAnimationMode(normalizeAnimationMode(value))}
					>
						{#each ANIMATION_MODE_OPTIONS as option (option.id)}
							<DropdownMenu.RadioItem value={option.id} closeOnSelect>
								{option.label}
							</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<Button
				variant={editor.animationLoop ? "secondary" : "ghost"}
				size="icon-xs"
				class="text-muted-foreground"
				onclick={() => editor.setAnimationLoop(!editor.animationLoop)}
				title={editor.animationLoop
					? "Loop animation: on"
					: "Loop animation: off"}
				aria-label={editor.animationLoop
					? "Disable animation looping"
					: "Enable animation looping"}
				aria-pressed={editor.animationLoop}
			>
				{#if editor.animationLoop}
					<Repeat class="size-3.5" />
				{:else}
					<RepeatOff class="size-3.5" />
				{/if}
			</Button>
		</div>
	</header>

	<input
		bind:this={referenceInput}
		type="file"
		accept={IMAGE_IMPORT_ACCEPT}
		class="hidden"
		onchange={addReferenceLayer}
	/>

	<div
		bind:this={scrollElement}
		class="min-h-0 flex-1 overflow-auto"
		onscroll={updateScroll}
	>
		<table class="w-full border-separate border-spacing-0">
			<caption class="sr-only">Timeline: layers as rows, animation frames as columns</caption>
			<thead>
				<tr>
					<th
						scope="col"
						class="sticky left-0 top-0 z-40 h-6 w-60 min-w-60 max-w-60 border-b border-r bg-background px-3 text-left align-middle"
					>
						<span class="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
							<Tag class="size-2.5" />
							Tags
						</span>
					</th>

					{#if leadingFrameCols > 0}
						<th
							colspan={leadingFrameCols}
							class="sticky top-0 z-20 h-6 border-b border-r bg-background"
						></th>
					{/if}

					{#each windowedTagGroups as group (group.start)}
						<th
							colspan={group.colSpan}
							scope="colgroup"
							class={cn(
								"sticky top-0 z-20 h-6 border-b border-r p-0 text-left align-middle",
								group.tag && "border-border/60",
							)}
							style:background={group.tag
								? tagBackground(group.tag)
								: "var(--background)"}
						>
							{#if group.tag && group.labeled}
								<button
									type="button"
									class="flex h-6 w-full min-w-0 items-center gap-1 px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
									onclick={() => editor.selectFrameRange(group.start, group.end)}
									oncontextmenu={(event) =>
										handleTagContextMenu(event, group.start, group.end)}
									ondblclick={() => {
										editor.selectFrameRange(group.start, group.end);
										framePropertiesOpen = true;
									}}
									title={`${group.tag} · frames ${group.start + 1}–${group.end + 1}. Click to select, double-click to edit.`}
								>
									<span
										class="size-1.5 shrink-0 rounded-full"
										style:background={tagDot(group.tag)}
									></span>
									<span class="truncate text-[9px] font-medium text-foreground/80">
										{group.tag}
									</span>
								</button>
							{/if}
						</th>
					{/each}

					{#if trailingFrameCols > 0}
						<th
							colspan={trailingFrameCols}
							class="sticky top-0 z-20 h-6 border-b bg-background"
						></th>
					{/if}

					<th
						colspan="2"
						class="sticky top-0 z-20 h-6 border-b bg-background"
					></th>
				</tr>

				<tr>
					<th
						scope="col"
						class="sticky left-0 top-6 z-30 h-8 w-60 min-w-60 max-w-60 border-b border-r bg-background px-3 text-left align-middle"
					>
						<span
							class="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
						>
							Layers
						</span>
					</th>

					{#if leadingFrameCols > 0}
						<th
							colspan={leadingFrameCols}
							class="sticky top-6 z-20 h-8 border-b border-r bg-background"
						></th>
					{/if}

					{#each visibleFrames as frame, offset (frame.id)}
						{@const index = firstFrame + offset}
						{@const selected = editor.isFrameSelected(index)}
						<th
							scope="col"
							class="sticky top-6 z-20 h-8 w-14 min-w-14 border-b border-r bg-background p-0 align-middle"
						>
							<button
								type="button"
								class={cn(
									"relative flex h-8 w-full flex-col items-center justify-center gap-0.5 font-mono text-[10px] leading-none text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
									selected || index === editor.activeFrame
										? "bg-primary/15 hover:bg-primary/25"
										: "hover:bg-accent hover:text-foreground",
								)}
								draggable="true"
								onclick={(event) => handleFrameClick(event, index)}
								ondblclick={() => (framePropertiesOpen = true)}
								oncontextmenu={(event) => handleHeaderContextMenu(event, index)}
								ondragstart={(event) => beginFrameDrag(event, index)}
								ondragover={(event) => updateFrameDrag(event, index)}
								ondrop={(event) => finishFrameDrag(event, index)}
								ondragend={endFrameDrag}
								aria-label={`Select frame ${index + 1}${frame.tag ? `, ${frame.tag}` : ""}`}
								aria-pressed={index === editor.activeFrame}
								title={`Frame ${index + 1} · ${Math.round(editor.frameDurationAt(index))} ms (${frame.duration !== undefined ? "frame properties" : "project FPS"})${frame.tag ? ` · ${frame.tag}` : ""}. Double-click for properties.`}
							>
								<span class="flex items-center gap-1">
									{index + 1}
									{#if index === editor.activeFrame && editor.playing}
										<span class="size-1 rounded-full bg-primary"></span>
									{/if}
								</span>
								<span
									class={cn(
										"text-[7px] font-normal whitespace-nowrap",
										frame.duration !== undefined ? "opacity-95" : "opacity-60",
									)}
								>
									{frame.duration !== undefined
										? `[ ${Math.round(editor.frameDurationAt(index))}ms ]`
										: `${Math.round(editor.frameDurationAt(index))}ms`}
								</span>
								{#if dragOverIndex === index}
									<span
										class={cn(
											"pointer-events-none absolute inset-y-0 w-0.5 bg-primary",
											dragOverSide === "before" ? "left-0" : "right-0",
										)}
										aria-hidden="true"
									></span>
								{/if}
							</button>
						</th>
					{/each}

					{#if trailingFrameCols > 0}
						<th
							colspan={trailingFrameCols}
							class="sticky top-6 z-20 h-8 border-b bg-background"
						></th>
					{/if}

					<th
						scope="col"
						class="sticky top-6 z-20 h-8 w-10 min-w-10 border-b bg-background p-0 align-middle"
					>
						<Button
							variant="ghost"
							size="icon-xs"
							class="mx-auto flex size-7 text-muted-foreground"
							onclick={() => editor.addFrame()}
							title="Add frame"
							aria-label="Add frame"
						>
							<Plus class="size-3.5" />
						</Button>
					</th>
					<th scope="col" class="sticky top-6 z-20 h-8 border-b bg-background"></th>
				</tr>
			</thead>
			<tbody>
				{#if leadingLayerRows > 0}
					<tr>
						<td
							colspan={editor.doc.frames.length + 3}
							class="border-b p-0"
							style:height={`${leadingLayerRows * LAYER_ROW_HEIGHT}px`}
						></td>
					</tr>
				{/if}
				{#each visibleLayers as row (row.layer.id)}
					{@const isSource = dragSourceIds?.has(row.layer.id) ?? false}
					<TimelineLayerRow
						layer={row.layer}
						depth={row.depth}
						last={row.last}
						dragging={draggingLayerId !== null}
						isDragSource={isSource}
						dropMode={dropIndicator?.targetId === row.layer.id
							? dropIndicator.mode
							: null}
						firstFrame={firstFrame}
						lastFrame={lastFrame}
						onCelPointerDown={handleCelPointerDown}
						onCelPointerEnter={handleCelPointerEnter}
						onCelContextMenu={handleCelContextMenu}
						onLayerContextMenu={handleLayerContextMenu}
						onLayerProperties={openLayerProperties}
						onDragStart={(event) => beginLayerDrag(event, row.layer)}
						onDragOver={(mode) => updateLayerDrop(row.layer, mode)}
						onDrop={(mode) => finishLayerDrop(row.layer, mode)}
						onDragEnd={endLayerDrag}
					/>
				{/each}
				{#if trailingLayerRows > 0}
					<tr>
						<td
							colspan={editor.doc.frames.length + 3}
							class="p-0"
							style:height={`${trailingLayerRows * LAYER_ROW_HEIGHT}px`}
						></td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>

	<footer class="flex h-10 shrink-0 items-center gap-3 border-t px-3">
		<span class="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
			Opacity
		</span>
		<Slider
			type="single"
			min={0}
			max={100}
			step={1}
			bind:value={opacity}
			onValueChange={changeOpacity}
			class="max-w-64 flex-1"
		/>
		<span class="w-9 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
			{Math.round(editor.activeLayer.opacity * 100)}%
		</span>
	</footer>
</section>

{#snippet layerMenuActions()}
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() => runMenuAction(() => (layerPropertiesOpen = true))}
	>
		<Settings2 class="size-3.5 text-muted-foreground" />
		Layer properties…
	</button>
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() =>
			runMenuAction(() => editor.toggleLayerVisibility(editor.activeLayerId))}
	>
		{#if editor.activeLayer.visible}
			<EyeOff class="size-3.5 text-muted-foreground" />
			Hide layer
		{:else}
			<Eye class="size-3.5 text-muted-foreground" />
			Show layer
		{/if}
	</button>
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		disabled={editor.activeLayer.role === "reference"}
		onclick={() =>
			runMenuAction(() => editor.toggleLayerLock(editor.activeLayerId))}
	>
		{#if editor.activeLayer.locked}
			<LockOpen class="size-3.5 text-muted-foreground" />
			Unlock layer
		{:else}
			<Lock class="size-3.5 text-muted-foreground" />
			Lock layer
		{/if}
	</button>

	<div class="my-1 h-px bg-border"></div>

	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() => runMenuAction(() => editor.duplicateLayer())}
	>
		<Copy class="size-3.5 text-muted-foreground" />
		Duplicate layer
	</button>
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() => runMenuAction(() => editor.groupActiveLayer())}
	>
		<FolderInput class="size-3.5 text-muted-foreground" />
		Group layer
	</button>
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() => runMenuAction(() => editor.moveLayerUp())}
	>
		<ChevronUp class="size-3.5 text-muted-foreground" />
		Move layer up
	</button>
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() => runMenuAction(() => editor.moveLayerDown())}
	>
		<ChevronDown class="size-3.5 text-muted-foreground" />
		Move layer down
	</button>
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() => runMenuAction(() => editor.indentActiveLayer())}
	>
		<IndentIncrease class="size-3.5 text-muted-foreground" />
		Move into group above
	</button>
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		disabled={!editor.activeLayer.parentId}
		onclick={() => runMenuAction(() => editor.outdentActiveLayer())}
	>
		<IndentDecrease class="size-3.5 text-muted-foreground" />
		Move out of group
	</button>

	<div class="my-1 h-px bg-border"></div>

	<button
		type="button"
		role="menuitem"
		class={MENU_DANGER_CLASS}
		disabled={!editor.canDeleteLayer}
		onclick={() => runMenuAction(() => editor.deleteLayer())}
	>
		<Trash2 class="size-3.5" />
		Delete layer
	</button>
{/snippet}

{#snippet frameMenuActions()}
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() => runMenuAction(() => editor.copyFrames())}
	>
		<ClipboardCopy class="size-3.5 text-muted-foreground" />
		Copy frames
	</button>
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() => runMenuAction(() => editor.pasteFrames())}
		disabled={!editor.hasFrameClipboard}
	>
		<ClipboardPaste class="size-3.5 text-muted-foreground" />
		Paste frames
	</button>
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() => runMenuAction(() => (duplicateFramesOpen = true))}
	>
		<Copy class="size-3.5 text-muted-foreground" />
		Duplicate frames…
	</button>
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() => runMenuAction(() => (framePropertiesOpen = true))}
	>
		<Settings2 class="size-3.5 text-muted-foreground" />
		Frame properties…
	</button>

	<div class="my-1 h-px bg-border"></div>

	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() => runMenuAction(() => editor.moveSelectedFrames(-1))}
	>
		<ArrowLeft class="size-3.5 text-muted-foreground" />
		Move frames left
	</button>
	<button
		type="button"
		role="menuitem"
		class={MENU_ITEM_CLASS}
		onclick={() => runMenuAction(() => editor.moveSelectedFrames(1))}
	>
		<ArrowRight class="size-3.5 text-muted-foreground" />
		Move frames right
	</button>

	<div class="my-1 h-px bg-border"></div>

	<button
		type="button"
		role="menuitem"
		class={MENU_DANGER_CLASS}
		onclick={() => runMenuAction(() => editor.deleteSelectedFrames())}
		disabled={
			editor.frameCount <= 1 ||
			editor.selectedFrameCount >= editor.frameCount
		}
	>
		<Trash2 class="size-3.5" />
		Delete frames
	</button>
{/snippet}

{#if contextMenu}
	<div
		data-timeline-menu
		class="fixed z-50 max-h-[calc(100svh-1rem)] w-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
		role="menu"
		aria-label="Timeline actions"
		style:left={`${contextMenu.x}px`}
		style:top={`${contextMenu.y}px`}
	>
		<div class="px-2 py-1 text-[10px] font-medium text-muted-foreground">
			{contextTitle}
		</div>
		{#if contextMenu.kind === "layer"}
			{@render layerMenuActions()}
		{:else if contextMenu.kind === "frame"}
			{@render frameMenuActions()}
		{:else}
			{@render layerMenuActions()}
			<div class="my-1 h-px bg-border"></div>
			{@render frameMenuActions()}
		{/if}
	</div>
{/if}

<FramePropertiesDialog bind:open={framePropertiesOpen} />
<LayerPropertiesDialog bind:open={layerPropertiesOpen} />
<DuplicateFramesDialog bind:open={duplicateFramesOpen} />

<svelte:window
	onpointerdown={handleWindowPointerDown}
	onpointerup={endCelDrag}
	onpointercancel={endCelDrag}
	onkeydown={handleWindowKeydown}
/>
