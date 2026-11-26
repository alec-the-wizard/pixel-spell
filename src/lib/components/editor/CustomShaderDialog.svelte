<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import CanvasTransformPreview from "$lib/components/editor/CanvasTransformPreview.svelte";
	import ShaderEditor from "$lib/components/editor/ShaderEditor.svelte";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { editor } from "$lib/editor/editor.svelte.js";
	import {
		DEFAULT_SHADER_SOURCE,
		renderShaderPixels,
		validateShaderSource,
	} from "$lib/editor/shader.js";
	import type { EffectScope } from "$lib/editor/types.js";
	import { cn } from "$lib/utils.js";

	let { open = $bindable(false) } = $props();

	let source = $state(DEFAULT_SHADER_SOURCE);
	let scope = $state<EffectScope>("active-cel");
	let feedback = $state("");
	let wasOpen = false;

	let shaderError = $derived(validateShaderSource(source));
	let targets = $derived(editor.effectTargetLayers(scope));
	let canApply = $derived(targets.length > 0 && !shaderError);
	let targetMessage = $derived.by(() => {
		if (targets.length > 0) {
			const layers = targets.length === 1 ? "layer" : "layers";
			return `${targets.length} ${layers} · frame ${editor.activeFrame + 1}`;
		}
		return scope === "active-cel"
			? "The active cel cannot be edited. Unlock or show a paint layer, or apply to all visible layers."
			: "No visible, unlocked paint layers in this frame.";
	});

	function transform(pixels: Uint32Array): Uint32Array {
		const result = renderShaderPixels(
			pixels,
			editor.doc.width,
			editor.doc.height,
			source,
			0,
			editor.selection,
		);
		return result.pixels ?? pixels;
	}

	let preview = $derived.by(() => {
		if (!open) return null;
		if (shaderError) return editor.previewEffect(scope, (pixels) => pixels);
		return editor.previewEffect(scope, transform);
	});

	$effect(() => {
		if (open && !wasOpen) {
			source = DEFAULT_SHADER_SOURCE;
			scope = "active-cel";
			feedback = "";
		}
		wasOpen = open;
	});

	function apply(): void {
		if (!canApply) return;
		const changed = editor.applyEffect(scope, transform, "Custom shader");
		if (changed > 0) {
			open = false;
			return;
		}
		feedback =
			"No pixels changed. The shader output matched the input; edit the GLSL and try again.";
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>Custom shader</Dialog.Title>
			<Dialog.Description>
				Run your own GLSL fragment shader over the active frame. Compile errors
				appear under the code before anything is applied.
			</Dialog.Description>
		</Dialog.Header>

		<CanvasTransformPreview
			pixels={preview}
			width={editor.doc.width}
			height={editor.doc.height}
			label="Custom shader preview"
		/>

		<div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
			<div class="grid content-start gap-2">
				<Label for="custom-shader-source">GLSL source</Label>
				<ShaderEditor bind:source error={shaderError} />
			</div>

			<div class="grid content-start gap-3">
				<div class="grid gap-1.5">
					<Label>Apply to</Label>
					<div class="grid grid-cols-2 gap-1 rounded-lg border p-1">
						<button
							type="button"
							class={cn(
								"rounded-md px-2 py-1 text-[11px] transition-colors",
								scope === "active-cel"
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/60",
							)}
							aria-pressed={scope === "active-cel"}
							onclick={() => (scope = "active-cel")}
						>
							Active cel
						</button>
						<button
							type="button"
							class={cn(
								"rounded-md px-2 py-1 text-[11px] transition-colors",
								scope === "visible-layers"
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/60",
							)}
							aria-pressed={scope === "visible-layers"}
							onclick={() => (scope = "visible-layers")}
						>
							All visible layers
						</button>
					</div>
					<span
						class={cn(
							"text-[10px]",
							canApply ? "text-muted-foreground" : "text-destructive",
						)}
					>
						{targetMessage}
					</span>
				</div>

				<div
					class="grid gap-1 rounded-lg border px-3 py-2.5 text-[10px] text-muted-foreground"
				>
					<span class="text-xs font-medium text-foreground">How it works</span>
					<span>
						The shader runs on the GPU once per target cel, with the cel uploaded
						as <code>u_image</code>. Only the active frame is affected, and
						reference, hidden, and locked layers are skipped.
					</span>
					<span>
						{#if editor.hasSelection}
							A selection is active, so only selected pixels can change.
						{:else}
							With no selection the whole cel is passed through the shader.
						{/if}
					</span>
					<span>
						Shaders are sandboxed by WebGL and cannot read files or the DOM.
						Applying is one undoable step.
					</span>
				</div>

				{#if feedback}
					<p class="text-[11px] text-muted-foreground" aria-live="polite">
						{feedback}
					</p>
				{/if}
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button
				onclick={apply}
				disabled={!canApply}
				title={shaderError
					? "Fix the shader errors before applying."
					: "Run the shader and write the result into the target cels."}
			>
				Apply shader
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
