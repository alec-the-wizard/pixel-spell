/**
 * WebGL 2 custom-shader foundation.
 *
 * Pixel Spell keeps its deterministic pixel filters on the CPU, but arbitrary
 * per-pixel effects are a natural fit for a fragment shader. This module owns
 * the reusable GPU plumbing: an offscreen WebGL 2 canvas, program compilation
 * and caching, texture upload/readback, and user-facing compile errors.
 *
 * The contract is deliberately small so users can paste ordinary GLSL:
 *
 *   - The shader is a complete WebGL 2 / GLSL ES 3.00 fragment shader.
 *   - `u_image` is the source layer (nearest-filtered, straight RGBA).
 *   - `u_resolution` is the document size in pixels.
 *   - `u_time` is 0 for still filters (reserved for future animated previews).
 *   - `v_uv` runs 0..1 across the canvas; write the result to `outColor`.
 *
 * New built-in filters can reuse `renderShaderPixels` with a bundled source
 * string. Nothing here touches project files, history, or export formats.
 */

export const MAX_SHADER_SOURCE_LENGTH = 64_000;

export const DEFAULT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_time;

in vec2 v_uv;
out vec4 outColor;

void main() {
    vec4 color = texture(u_image, v_uv);

    // u_image        source layer
    // v_uv           0..1 canvas coordinates
    // u_resolution   canvas size in pixels
    // u_time         0 for still filters

    // Example: quantize every channel to four levels.
    // color.rgb = floor(color.rgb * 4.0 + 0.5) / 4.0;

    outColor = color;
}`;

export interface ShaderPreset {
	id: string;
	label: string;
	source: string;
}

const POSTERIZE_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_time;

in vec2 v_uv;
out vec4 outColor;

void main() {
    vec4 color = texture(u_image, v_uv);
    float levels = 4.0;
    color.rgb = floor(color.rgb * levels + 0.5) / levels;
    outColor = color;
}`;

const SCANLINE_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_time;

in vec2 v_uv;
out vec4 outColor;

void main() {
    vec4 color = texture(u_image, v_uv);
    float row = floor(v_uv.y * u_resolution.y);
    float line = mod(row, 2.0);
    color.rgb *= mix(1.0, 0.72, line);
    outColor = color;
}`;

const VIGNETTE_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_time;

in vec2 v_uv;
out vec4 outColor;

void main() {
    vec4 color = texture(u_image, v_uv);
    vec2 centered = v_uv - 0.5;
    float falloff = smoothstep(0.35, 0.75, length(centered));
    color.rgb *= 1.0 - falloff * 0.65;
    outColor = color;
}`;

/** Small bundled library so the editor has working starting points. */
export const SHADER_PRESETS: readonly ShaderPreset[] = [
	{ id: "pass-through", label: "Pass-through", source: DEFAULT_SHADER_SOURCE },
	{ id: "posterize", label: "Posterize", source: POSTERIZE_SHADER },
	{ id: "scanlines", label: "Scanlines", source: SCANLINE_SHADER },
	{ id: "vignette", label: "Vignette", source: VIGNETTE_SHADER },
];

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const QUAD_VERTICES = new Float32Array([
	-1, -1, 1, -1, -1, 1,
	-1, 1, 1, -1, 1, 1,
]);

interface CompiledShader {
	program: WebGLProgram;
	position: number;
	image: WebGLUniformLocation | null;
	resolution: WebGLUniformLocation | null;
	time: WebGLUniformLocation | null;
}

type CompileResult =
	| { shader: CompiledShader; error?: undefined }
	| { shader?: undefined; error: string };

interface Renderer {
	canvas: HTMLCanvasElement;
	gl: WebGL2RenderingContext;
	quad: WebGLBuffer;
	vertexShader: WebGLShader;
	sourceTexture: WebGLTexture;
	targetTexture: WebGLTexture;
	framebuffer: WebGLFramebuffer;
	width: number;
	height: number;
	maxTextureSize: number;
}

let renderer: Renderer | null = null;
let rendererUnavailable = false;
const compiledShaders = new Map<string, CompileResult>();
const MAX_COMPILED_SHADERS = 16;

const UNAVAILABLE_MESSAGE =
	"WebGL 2 is not available in this environment. Custom shaders need a browser or the desktop app with WebGL 2 enabled.";

function nextCompileError(log: string | null): string {
	const lines = (log ?? "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return "The shader could not be compiled.";
	return lines
		.map((line) => {
			const match = line.match(/^ERROR:\s*\d+:(\d+):\s*(.*)$/i);
			return match ? `Line ${match[1]}: ${match[2]}` : line;
		})
		.join("\n");
}

/** Checks the WebGL 2 version directive before handing source to the driver. */
export function shaderVersionError(source: string): string | null {
	const trimmed = source.trim();
	if (!trimmed) return "Add some GLSL code before compiling.";
	if (source.length > MAX_SHADER_SOURCE_LENGTH) {
		return `The shader is too long. Keep it under ${MAX_SHADER_SOURCE_LENGTH.toLocaleString()} characters.`;
	}
	const hasVersion = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*#version\s+300\s+es\b/.test(
		source,
	);
	if (!hasVersion) {
		return "Start the shader with `#version 300 es` (WebGL 2 / GLSL ES 3.00).";
	}
	return null;
}

function createRenderer(): Renderer | null {
	if (renderer) return renderer;
	if (rendererUnavailable) return null;
	if (typeof document === "undefined") {
		rendererUnavailable = true;
		return null;
	}

	const canvas = document.createElement("canvas");
	const gl = canvas.getContext("webgl2", {
		alpha: true,
		antialias: false,
		depth: false,
		stencil: false,
		premultipliedAlpha: false,
		preserveDrawingBuffer: false,
	});
	if (!gl) {
		rendererUnavailable = true;
		return null;
	}

	const vertexShader = gl.createShader(gl.VERTEX_SHADER);
	const quad = gl.createBuffer();
	const sourceTexture = gl.createTexture();
	const targetTexture = gl.createTexture();
	const framebuffer = gl.createFramebuffer();
	if (!vertexShader || !quad || !sourceTexture || !targetTexture || !framebuffer) {
		rendererUnavailable = true;
		return null;
	}

	gl.shaderSource(vertexShader, VERTEX_SHADER_SOURCE);
	gl.compileShader(vertexShader);
	if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
		rendererUnavailable = true;
		return null;
	}

	gl.bindBuffer(gl.ARRAY_BUFFER, quad);
	gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);

	for (const texture of [sourceTexture, targetTexture]) {
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA8,
			1,
			1,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			null,
		);
	}

	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(
		gl.FRAMEBUFFER,
		gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D,
		targetTexture,
		0,
	);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	const next: Renderer = {
		canvas,
		gl,
		quad,
		vertexShader,
		sourceTexture,
		targetTexture,
		framebuffer,
		width: 0,
		height: 0,
		maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
	};

	canvas.addEventListener(
		"webglcontextlost",
		(event) => {
			event.preventDefault();
			compiledShaders.clear();
			renderer = null;
			rendererUnavailable = false;
		},
		{ once: true },
	);

	renderer = next;
	return next;
}

function compile(gl: WebGL2RenderingContext, source: string): CompileResult {
	const versionError = shaderVersionError(source);
	if (versionError) return { error: versionError };

	let cached = compiledShaders.get(source);
	if (cached) return cached;

	const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
	if (!fragmentShader) return { error: "The GPU could not allocate a shader." };

	gl.shaderSource(fragmentShader, source);
	gl.compileShader(fragmentShader);
	if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
		const error = nextCompileError(gl.getShaderInfoLog(fragmentShader));
		gl.deleteShader(fragmentShader);
		cached = { error };
		compiledShaders.set(source, cached);
		pruneCompiledShaders();
		return cached;
	}

	const program = gl.createProgram();
	if (!program) {
		gl.deleteShader(fragmentShader);
		return { error: "The GPU could not allocate a shader program." };
	}
	gl.attachShader(program, renderer!.vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const error = nextCompileError(gl.getProgramInfoLog(program));
		gl.deleteProgram(program);
		cached = { error };
		compiledShaders.set(source, cached);
		pruneCompiledShaders();
		return cached;
	}

	cached = {
		shader: {
			program,
			position: gl.getAttribLocation(program, "a_position"),
			image: gl.getUniformLocation(program, "u_image"),
			resolution: gl.getUniformLocation(program, "u_resolution"),
			time: gl.getUniformLocation(program, "u_time"),
		},
	};
	compiledShaders.set(source, cached);
	pruneCompiledShaders();
	return cached;
}

function pruneCompiledShaders(): void {
	while (compiledShaders.size > MAX_COMPILED_SHADERS) {
		const oldest = compiledShaders.keys().next().value;
		if (oldest === undefined) return;
		const entry = compiledShaders.get(oldest);
		if (entry?.shader && renderer) {
			renderer.gl.deleteProgram(entry.shader.program);
		}
		compiledShaders.delete(oldest);
	}
}

/**
 * Compiles and links a shader without rendering. Returns `null` when it is
 * valid, or a human-readable error with GLSL line numbers.
 */
export function validateShaderSource(source: string): string | null {
	const local = createRenderer();
	if (!local) return UNAVAILABLE_MESSAGE;
	const result = compile(local.gl, source);
	return result.error ?? null;
}

export interface ShaderRenderResult {
	pixels?: Uint32Array;
	error?: string;
}

/**
 * Runs a fragment shader over one packed RGBA buffer. On any error the caller
 * should keep the original pixels; the message is safe to show to the user.
 * An optional selection mask limits which output pixels are written.
 */
export function renderShaderPixels(
	pixels: Uint32Array,
	width: number,
	height: number,
	source: string,
	time = 0,
	mask: Uint8Array | null = null,
): ShaderRenderResult {
	if (width <= 0 || height <= 0) {
		return { error: "The canvas has no drawable pixels." };
	}
	const local = createRenderer();
	if (!local) return { error: UNAVAILABLE_MESSAGE };
	const gl = local.gl;
	if (gl.isContextLost()) {
		renderer = null;
		compiledShaders.clear();
		return { error: "The WebGL context was lost. Try applying again." };
	}

	const compiled = compile(gl, source);
	if (!compiled.shader) {
		return { error: compiled.error ?? "The shader could not be compiled." };
	}
	const shader = compiled.shader;

	if (width > local.maxTextureSize || height > local.maxTextureSize) {
		return {
			error: `The canvas is larger than this GPU's ${local.maxTextureSize}px texture limit.`,
		};
	}

	if (local.width !== width || local.height !== height) {
		local.canvas.width = width;
		local.canvas.height = height;
		local.width = width;
		local.height = height;

		gl.bindTexture(gl.TEXTURE_2D, local.targetTexture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA8,
			width,
			height,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			null,
		);
		gl.bindFramebuffer(gl.FRAMEBUFFER, local.framebuffer);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			local.targetTexture,
			0,
		);
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		if (status !== gl.FRAMEBUFFER_COMPLETE) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			return {
				error: `The GPU could not allocate a ${width}×${height} render target.`,
			};
		}
	}

	// Drain any error left by an earlier failure so the check below is useful.
	while (gl.getError() !== gl.NO_ERROR) {
		// no-op
	}

	const bytes = new Uint8Array(
		pixels.buffer as ArrayBuffer,
		pixels.byteOffset,
		pixels.byteLength,
	);

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, local.sourceTexture);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA8,
		width,
		height,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		bytes,
	);

	gl.bindFramebuffer(gl.FRAMEBUFFER, local.framebuffer);
	gl.viewport(0, 0, width, height);
	gl.disable(gl.BLEND);
	gl.useProgram(shader.program);
	gl.uniform1i(shader.image, 0);
	gl.uniform2f(shader.resolution, width, height);
	gl.uniform1f(shader.time, time);
	gl.bindBuffer(gl.ARRAY_BUFFER, local.quad);
	gl.enableVertexAttribArray(shader.position);
	gl.vertexAttribPointer(shader.position, 2, gl.FLOAT, false, 0, 0);
	gl.drawArrays(gl.TRIANGLES, 0, QUAD_VERTICES.length / 2);

	const output = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, output);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	const error = gl.getError();
	if (error !== gl.NO_ERROR) {
		return { error: `WebGL reported an error while drawing (code ${error}).` };
	}

	const result = new Uint32Array(width * height);
	new Uint8Array(result.buffer).set(output);
	if (mask && mask.length >= result.length) {
		for (let index = 0; index < result.length; index++) {
			if (!mask[index]) result[index] = pixels[index]!;
		}
	}
	return { pixels: result };
}
