<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		DEFAULT_SHADER_SOURCE,
		SHADER_PRESETS,
	} from "$lib/editor/shader.js";
	import { cn } from "$lib/utils.js";

	let {
		source = $bindable(DEFAULT_SHADER_SOURCE),
		error = null,
		id = "custom-shader-source",
		minHeight = "18rem",
	}: {
		source?: string;
		error?: string | null;
		id?: string;
		minHeight?: string;
	} = $props();

	let textarea = $state<HTMLTextAreaElement>();

	function insertIndent(event: KeyboardEvent): void {
		if (event.key !== "Tab") return;
		event.preventDefault();
		const target = textarea;
		if (!target) return;
		const start = target.selectionStart;
		const end = target.selectionEnd;
		source = `${source.slice(0, start)}  ${source.slice(end)}`;
		requestAnimationFrame(() => {
			target.selectionStart = start + 2;
			target.selectionEnd = start + 2;
		});
	}
</script>

<div class="grid gap-2">
	<div class="flex flex-wrap items-center gap-1.5">
		<span class="text-[11px] font-medium text-muted-foreground">Presets</span>
		{#each SHADER_PRESETS as preset (preset.id)}
			<Button
				variant="outline"
				size="xs"
				onclick={() => (source = preset.source)}
				title={`Load the ${preset.label.toLowerCase()} shader`}
			>
				{preset.label}
			</Button>
		{/each}
		<span class="flex-1"></span>
		<Button
			variant="ghost"
			size="xs"
			onclick={() => (source = DEFAULT_SHADER_SOURCE)}
			title="Restore the default pass-through shader"
		>
			Reset
		</Button>
	</div>

	<textarea
		bind:this={textarea}
		{id}
		bind:value={source}
		spellcheck="false"
		autocomplete="off"
		autocapitalize="off"
		aria-label="GLSL fragment shader source"
		aria-invalid={error ? "true" : undefined}
		class={cn(
			"w-full resize-y rounded-md border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none transition-shadow",
			"focus-visible:ring-2 focus-visible:ring-ring",
			error && "border-destructive/60",
		)}
		style:min-height={minHeight}
		onkeydown={insertIndent}
	></textarea>

	{#if error}
		<div
			role="alert"
			class="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-[11px] leading-relaxed text-destructive"
		>
			{error}
		</div>
	{:else}
		<p class="text-[10px] text-muted-foreground">
			WebGL 2 · GLSL ES 3.00. Uniforms: <code>u_image</code>,
			<code>u_resolution</code>, <code>u_time</code>. Write the result to
			<code>outColor</code>.
		</p>
	{/if}
</div>
