export type ToolId =
	| "pan"
	| "zoom"
	| "magic-wand"
	| "shape-select"
	| "lasso"
	| "select-color"
	| "pencil"
	| "spray"
	| "eraser"
	| "line"
	| "curve"
	| "shape"
	| "fill"
	| "gradient"
	| "eyedropper"
	| "blur"
	| "jumble";

/** Raster shapes available to the shape and shape-selection tools. */
export type ShapeKind = "rectangle" | "ellipse" | "star" | "heart";

/** Gradient direction shapes. */
export type GradientShape = "linear" | "radial";

/** Bayer matrices available to the gradient tool. */
export type GradientDither = "none" | "bayer2" | "bayer4" | "bayer8";

/** Which cels an effect modifies: the active cel or every visible layer. */
export type EffectScope = "active-cel" | "visible-layers";

/** Initial canvas fill chosen when a project is created. */
export type BackgroundKind = "transparent" | "white" | "black";

/** Which mouse button a color is assigned to. */
export type ColorSlot = "primary" | "secondary";

export type MirrorKind = "x" | "y" | "diagonal-down" | "diagonal-up";

export interface MirrorAxis {
	kind: MirrorKind;
	/** Axis position in canvas boundary coordinates. */
	position: number;
}

/** Rotational symmetry that duplicates each painted point around a center. */
export interface RadialSymmetry {
	/** Number of rotational copies, including the original point (2–16). */
	count: number;
	/** Rotation origin in document pixel coordinates. */
	centerX: number;
	centerY: number;
}

export interface Frame {
	id: string;
	/** Custom display duration in milliseconds; missing uses the document fps. */
	duration?: number;
	/** Optional tag. Contiguous frames with the same tag form a tag range. */
	tag?: string;
}

/** Reference layers are visible in the viewport but are never exported. */
export type LayerRole = "reference";

/** Non-destructive effects that can be attached to a group node. */
export type GroupEffectKind =
	| "outline"
	| "drop-shadow"
	| "color-replace"
	| "dither"
	| "gradient-map";

/** One color stop in a gradient map; position is 0..1. */
export interface GradientStop {
	position: number;
	color: string;
}

/**
 * Options for one group effect. Fields are only meaningful for the matching
 * `GroupEffect.kind`; the rest keep their defaults.
 */
export interface GroupEffectOptions {
	// Outline
	thickness?: number;
	color?: string;
	placement?: "outside" | "inside";
	diagonals?: boolean;
	// Drop shadow
	offsetX?: number;
	offsetY?: number;
	spread?: number;
	opacity?: number;
	// Color replace
	from?: string;
	to?: string;
	tolerance?: number;
	preserveAlpha?: boolean;
	// Dither
	method?: "ordered" | "diffusion";
	matrix?: "bayer2" | "bayer4" | "bayer8";
	serpentine?: boolean;
	target?: "two-color" | "palette";
	lightColor?: string;
	darkColor?: string;
	/** Palette snapshot used by palette-target dithering. */
	palette?: string[];
	// Gradient map
	/** Multi-stop gradient, sorted from the darkest to the brightest input. */
	gradient?: GradientStop[];
	gradientSpace?: "rgb" | "oklab";
	gradientSource?: "luminance" | "average";
	gradientInvert?: boolean;
}

/**
 * One effect block on a group. Effects run left-to-right on the group's
 * composited contents; nested groups run before their ancestors.
 */
export interface GroupEffect {
	id: string;
	kind: GroupEffectKind;
	enabled: boolean;
	options: GroupEffectOptions;
}

/** How a layer (or group) blends with the content already composited below it. */
export type BlendMode =
	| "normal"
	| "multiply"
	| "screen"
	| "overlay"
	| "darken"
	| "lighten"
	| "color-dodge"
	| "color-burn"
	| "hard-light"
	| "soft-light"
	| "difference"
	| "exclusion"
	| "add"
	| "subtract";

export interface Layer {
	id: string;
	name: string;
	visible: boolean;
	locked: boolean;
	/** 0..1 */
	opacity: number;
	/** One pixel buffer per animation frame. Empty for group nodes. */
	cels: Uint32Array[];
	/** Missing means a normal paint layer. */
	role?: LayerRole;
	/** Optional timeline identity tint, stored as a normalized `#rrggbb` hex. */
	color?: string;
	/** True when this node is a group container rather than a paint layer. */
	isGroup?: boolean;
	/** Parent group id; missing means a top-level node. */
	parentId?: string;
	/** Blend mode applied when this node composites onto the content below. */
	blendMode?: BlendMode;
	/** Clips this node's pixels to the composited content below it. */
	clipping?: boolean;
	/** Timeline-only collapse state for groups. */
	collapsed?: boolean;
	/** Continuous layers auto-link newly added cels to the active frame. */
	continuous?: boolean;
	/** Non-destructive effect stack for a group node (missing means none). */
	effects?: GroupEffect[];
}

/** Per-cel presentation properties (opacity and stacking order). */
export interface CelProps {
	/** 0..1 opacity multiplier, layered on top of the layer opacity. */
	opacity?: number;
	/** Stacking order within a frame; higher composites later (on top). */
	zIndex?: number;
}

/**
 * An image on the project-level reference board. Unlike a reference layer,
 * this is independent of layers and frames and can sit outside the canvas.
 */
export interface ReferenceImage {
	id: string;
	name: string;
	/** Original compressed source bytes (PNG/JPEG/WebP/SVG/…). */
	bytes: Uint8Array;
	mime: string;
	/** Natural source dimensions. */
	imageWidth: number;
	imageHeight: number;
	/** Display bounds in document pixels. */
	x: number;
	y: number;
	width: number;
	height: number;
	/** Rotation in degrees around the image center. */
	rotation: number;
	/** 0..1 */
	opacity: number;
	visible: boolean;
	locked: boolean;
}

/** Order the animation is played in. */
export type AnimationMode = "forward" | "backward" | "ping-pong";

export interface PixelDoc {
	width: number;
	height: number;
	fps: number;
	frames: Frame[];
	/** Ordered bottom-to-top. */
	layers: Layer[];
	/** Project-level reference board images. */
	references: ReferenceImage[];
	/** Playback order; missing means forward. */
	animationMode?: AnimationMode;
	/** Whether playback repeats; missing means true. */
	animationLoop?: boolean;
	/** Per-cel properties keyed by `${layerId}:${frameId}`. */
	celProps?: Record<string, CelProps>;
}

export interface ProjectTab {
	id: string;
	name: string;
	dirty: boolean;
	modified: boolean;
}

export interface Point {
	x: number;
	y: number;
}

export interface ViewportSize {
	w: number;
	h: number;
}
