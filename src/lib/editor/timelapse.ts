import { cloneDoc, compositeFrame, uid } from "./doc.js";
import type { Layer, PixelDoc } from "./types.js";

/**
 * The slice of an undo entry the timelapse builder needs. History entries
 * record the document state *before* their action, so replaying them backwards
 * from the current document yields each earlier state.
 */
export type TimelapseEntry =
	| { kind: "full"; doc: PixelDoc }
	| {
			kind: "cels";
			patches: readonly {
				layerId: string;
				frame: number;
				pixels: Uint32Array;
			}[];
	  };

/** A synthetic one-layer document with one frame per retained history state. */
export interface TimelapseBuild {
	/** Document ready for the video encoders; every frame is one history state. */
	doc: PixelDoc;
	/** The same composited states, exposed for the dialog preview. */
	frames: Uint32Array[];
	/** Number of recorded steps; `frames.length` is always `steps + 1`. */
	steps: number;
}

/** Restores `doc` to the state stored by one history entry, in place. */
function applyHistoryState(doc: PixelDoc, entry: TimelapseEntry): PixelDoc {
	if (entry.kind === "full") return cloneDoc(entry.doc);

	for (const patch of entry.patches) {
		const layer = doc.layers.find((item) => item.id === patch.layerId);
		const cel = layer?.cels[patch.frame];
		if (cel && cel.length === patch.pixels.length) cel.set(patch.pixels);
	}
	return doc;
}

/**
 * Rebuilds the retained history as a sequence of composited frames.
 *
 * History stores the state before each action, so we walk the undo stack
 * backwards from the current document: composite the current state, apply the
 * newest entry to reach the previous state, and repeat. The resulting frames
 * run oldest to newest. Reference layers are excluded by `compositeFrame`, and
 * the active animation frame is used for every state (clamped when an earlier
 * state has fewer frames).
 */
export function buildTimelapseDoc(
	current: PixelDoc,
	entries: readonly TimelapseEntry[],
	activeFrame: number,
): TimelapseBuild {
	const width = current.width;
	const height = current.height;
	const frameAt = (doc: PixelDoc): number =>
		Math.max(0, Math.min(doc.frames.length - 1, activeFrame));

	/**
	 * Canvas resizes are undoable full snapshots, so earlier states can have
	 * different dimensions. Normalize every state into the current canvas at
	 * the top-left so the synthetic document stays rectangular.
	 */
	const normalize = (doc: PixelDoc): Uint32Array => {
		const pixels = compositeFrame(doc, frameAt(doc));
		if (doc.width === width && doc.height === height) return pixels;
		const output = new Uint32Array(width * height);
		const copyWidth = Math.min(width, doc.width);
		const copyHeight = Math.min(height, doc.height);
		for (let y = 0; y < copyHeight; y++) {
			output.set(
				pixels.subarray(y * doc.width, y * doc.width + copyWidth),
				y * width,
			);
		}
		return output;
	};

	const states: Uint32Array[] = [];
	let working = cloneDoc(current);
	states.push(normalize(working));

	for (let index = entries.length - 1; index >= 0; index--) {
		working = applyHistoryState(working, entries[index]!);
		states.push(normalize(working));
	}
	states.reverse();

	const layer: Layer = {
		id: uid("layer"),
		name: "Timelapse",
		visible: true,
		locked: false,
		opacity: 1,
		cels: states,
	};

	const doc: PixelDoc = {
		width,
		height,
		fps: current.fps,
		frames: states.map(() => ({ id: uid("frame") })),
		layers: [layer],
		references: [],
		animationMode: "forward",
		animationLoop: true,
	};

	return { doc, frames: states, steps: entries.length };
}
