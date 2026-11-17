import { compositeFrame, frameDurationMs } from "./doc.js";
import {
	animationFrameIndices,
	exportFrameImage,
	exportGifInWorker,
	validateExportSize,
	type ExportBackground,
	type VideoFormat,
} from "./export.js";
import { exportApng } from "./export-apng.js";
import { exportAnimatedWebp } from "./export-webp.js";
import { drawPixels } from "./render.js";
import type { PixelDoc } from "./types.js";

export interface VideoExportOptions {
	format: VideoFormat;
	scale: number;
	fps: number;
	loop: boolean;
	background: ExportBackground;
	/** Frame indices to export, in playback order; missing means all frames. */
	frames?: readonly number[];
	/** Lossy quality 0–100 for WebP, WebM/MP4, and the JPEG video containers. */
	quality: number;
	/** Cancels an in-progress export (used by the real-time video recorder). */
	signal?: AbortSignal;
}

const clampInt = (value: number, min: number, max: number) =>
	Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : min;

/** An error that distinguishes a user-initiated cancel from a real failure. */
function abortError(): Error {
	const error = new Error("Export cancelled");
	error.name = "AbortError";
	return error;
}

/**
 * Resolves after `ms` milliseconds, or rejects with an AbortError when the
 * signal fires first. Used to keep the real-time MediaRecorder loop
 * interruptible without leaving a hung `setTimeout` behind.
 */
const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError());
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onAbort = () => {
			if (timer !== undefined) clearTimeout(timer);
			reject(abortError());
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
	});

function ascii(value: string): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(value.length);
	for (let index = 0; index < value.length; index++) {
		bytes[index] = value.charCodeAt(index) & 0xff;
	}
	return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	let total = 0;
	for (const part of parts) total += part.length;
	const output = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

function u16le(value: number): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(2);
	new DataView(out.buffer).setUint16(0, value, true);
	return out;
}

function u32le(value: number): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, value >>> 0, true);
	return out;
}

function u16be(value: number): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(2);
	new DataView(out.buffer).setUint16(0, value);
	return out;
}

function u32be(value: number): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, value >>> 0);
	return out;
}

/** Video containers have no alpha channel, so transparency flattens to black. */
function videoBackground(background: ExportBackground): ExportBackground {
	return background === "transparent" ? "black" : background;
}

/**
 * Encodes every animation frame as a JPEG at the requested scale, flattening
 * transparency onto the chosen solid background.
 */
async function encodeJpegFrames(
	doc: PixelDoc,
	frameIndices: readonly number[],
	scale: number,
	background: ExportBackground,
	quality: number,
	signal?: AbortSignal,
): Promise<Uint8Array[]> {
	const frames: Uint8Array[] = [];
	for (const frameIndex of frameIndices) {
		if (signal?.aborted) throw abortError();
		const blob = await exportFrameImage(doc, {
			frame: frameIndex,
			scale,
			format: "jpeg",
			background: videoBackground(background),
			quality,
		});
		frames.push(new Uint8Array(await blob.arrayBuffer()));
	}
	return frames;
}

// --- AVI (MJPEG) -----------------------------------------------------------

function riffChunk(id: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const pad = payload.length % 2;
	const output = new Uint8Array(8 + payload.length + pad);
	const view = new DataView(output.buffer);
	output.set(ascii(id), 0);
	view.setUint32(4, payload.length, true);
	output.set(payload, 8);
	return output;
}

function riffList(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(12 + payload.length);
	const view = new DataView(output.buffer);
	output.set(ascii("LIST"), 0);
	view.setUint32(4, payload.length + 4, true);
	output.set(ascii(type), 8);
	output.set(payload, 12);
	return output;
}

function riffFile(type: string, children: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const body = concat(children);
	const output = new Uint8Array(12 + body.length);
	const view = new DataView(output.buffer);
	output.set(ascii("RIFF"), 0);
	view.setUint32(4, body.length + 4, true);
	output.set(ascii(type), 8);
	output.set(body, 12);
	return output;
}

export function buildAvi(
	frames: Uint8Array[],
	width: number,
	height: number,
	fps: number,
): Uint8Array<ArrayBuffer> {
	const rate = Math.max(1, Math.min(60, Math.round(fps) || 12));
	const frameCount = frames.length;
	const maxFrameSize = frames.reduce((max, frame) => Math.max(max, frame.length), 0);

	const avih = new Uint8Array(56);
	const avihView = new DataView(avih.buffer);
	avihView.setUint32(0, Math.round(1_000_000 / rate), true);
	avihView.setUint32(4, maxFrameSize * rate, true);
	avihView.setUint32(8, 0, true); // padding granularity
	avihView.setUint32(12, 0, true); // flags
	avihView.setUint32(16, frameCount, true);
	avihView.setUint32(20, 0, true); // initial frames
	avihView.setUint32(24, 1, true); // streams
	avihView.setUint32(28, maxFrameSize, true);
	avihView.setUint32(32, width, true);
	avihView.setUint32(36, height, true);

	const strh = new Uint8Array(56);
	const strhView = new DataView(strh.buffer);
	strh.set(ascii("vids"), 0);
	strh.set(ascii("MJPG"), 4);
	strhView.setUint32(8, 0, true); // flags
	strhView.setUint16(12, 0, true); // priority
	strhView.setUint16(14, 0, true); // language
	strhView.setUint32(16, 0, true); // initial frames
	strhView.setUint32(20, 1, true); // scale
	strhView.setUint32(24, rate, true); // rate
	strhView.setUint32(28, 0, true); // start
	strhView.setUint32(32, frameCount, true); // length
	strhView.setUint32(36, maxFrameSize, true); // suggested buffer
	strhView.setUint32(40, 0xffffffff, true); // quality (-1)
	strhView.setUint32(44, 0, true); // sample size
	strhView.setUint16(48, 0, true); // rcFrame.left
	strhView.setUint16(50, 0, true); // rcFrame.top
	strhView.setUint16(52, width, true); // rcFrame.right
	strhView.setUint16(54, height, true); // rcFrame.bottom

	const strf = new Uint8Array(40);
	const strfView = new DataView(strf.buffer);
	strfView.setUint32(0, 40, true); // biSize
	strfView.setInt32(4, width, true);
	strfView.setInt32(8, height, true);
	strfView.setUint16(12, 1, true); // planes
	strfView.setUint16(14, 24, true); // bit count
	strf.set(ascii("MJPG"), 16); // compression
	strfView.setUint32(20, maxFrameSize, true); // size image
	strfView.setUint32(24, 0, true);
	strfView.setUint32(28, 0, true);
	strfView.setUint32(32, 0, true);
	strfView.setUint32(36, 0, true);

	const hdrl = riffList("hdrl", concat([avih, riffList("strl", concat([strh, strf]))]));

	const moviChunks = frames.map((frame) => {
		const id = new Uint8Array([0x30, 0x30, 0x64, 0x63]); // "00dc"
		const pad = frame.length % 2;
		const chunk = new Uint8Array(8 + frame.length + pad);
		const view = new DataView(chunk.buffer);
		chunk.set(id, 0);
		view.setUint32(4, frame.length, true);
		chunk.set(frame, 8);
		return chunk;
	});
	const movi = riffList("movi", concat(moviChunks));

	return riffFile("AVI ", [hdrl, movi]);
}

// --- MOV (MJPEG) -----------------------------------------------------------

const UNITY_MATRIX = (() => {
	const matrix = new Uint8Array(36);
	const view = new DataView(matrix.buffer);
	view.setUint32(0, 0x00010000);
	view.setUint32(16, 0x00010000);
	view.setUint32(32, 0x40000000);
	return matrix;
})();

function movBox(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(8 + payload.length);
	const view = new DataView(output.buffer);
	view.setUint32(0, output.length);
	output.set(ascii(type), 4);
	output.set(payload, 8);
	return output;
}

export function buildMov(
	frames: Uint8Array[],
	width: number,
	height: number,
	durationsMs: number[],
): Uint8Array<ArrayBuffer> {
	const timescale = 1000;
	const frameCount = frames.length;
	const totalDuration = durationsMs.reduce((sum, value) => sum + value, 0);

	const ftyp = movBox("ftyp", concat([ascii("qt  "), u32be(0x00000200), ascii("qt  ")]));

	const mvhd = movBox(
		"mvhd",
		concat([
			u32be(0),
			u32be(0),
			u32be(0),
			u32be(timescale),
			u32be(totalDuration),
			u32be(0x00010000),
			u16be(0x0100),
			u16be(0),
			u32be(0),
			u32be(0),
			UNITY_MATRIX,
			new Uint8Array(24),
			u32be(2),
		]),
	);

	const tkhd = movBox(
		"tkhd",
		concat([
			u32be(0x00000003),
			u32be(0),
			u32be(0),
			u32be(1),
			u32be(0),
			u32be(totalDuration),
			u32be(0),
			u32be(0),
			u16be(0),
			u16be(0),
			u16be(0),
			u16be(0),
			UNITY_MATRIX,
			u32be(width << 16),
			u32be(height << 16),
		]),
	);

	const mdhd = movBox(
		"mdhd",
		concat([
			u32be(0),
			u32be(0),
			u32be(0),
			u32be(timescale),
			u32be(totalDuration),
			u16be(0x55c4),
			u16be(0),
		]),
	);

	const hdlr = movBox(
		"hdlr",
		concat([
			u32be(0),
			u32be(0),
			ascii("vide"),
			new Uint8Array(12),
			ascii("Pixel Spell"),
			new Uint8Array([0]),
		]),
	);

	const vmhd = movBox("vmhd", concat([u32be(1), u16be(0), new Uint8Array(6)]));

	const dref = movBox("dref", concat([u32be(0), u32be(1), movBox("url ", u32be(1))]));
	const dinf = movBox("dinf", dref);

	const jpegEntry = movBox(
		"jpeg",
		concat([
			new Uint8Array(6),
			u16be(1),
			u16be(0),
			u16be(0),
			new Uint8Array(12),
			u16be(width),
			u16be(height),
			u32be(0x00480000),
			u32be(0x00480000),
			u32be(0),
			u16be(1),
			new Uint8Array(32),
			u16be(0x0018),
			u16be(0xffff),
		]),
	);
	const stsd = movBox("stsd", concat([u32be(0), u32be(1), jpegEntry]));

	const sttsEntries: Uint8Array[] = [];
	let runStart = 0;
	while (runStart < durationsMs.length) {
		let runEnd = runStart;
		while (runEnd < durationsMs.length && durationsMs[runEnd] === durationsMs[runStart]) {
			runEnd++;
		}
		sttsEntries.push(concat([u32be(runEnd - runStart), u32be(durationsMs[runStart]!)]));
		runStart = runEnd;
	}
	const stts = movBox(
		"stts",
		concat([u32be(0), u32be(sttsEntries.length), ...sttsEntries]),
	);

	const stsc = movBox("stsc", concat([u32be(0), u32be(1), u32be(1), u32be(1), u32be(1)]));

	const stsz = movBox(
		"stsz",
		concat([u32be(0), u32be(0), u32be(frameCount), ...frames.map((frame) => u32be(frame.length))]),
	);

	const stcoPayloadSize = 8 + 4 * frameCount;
	const stcoPlaceholder = movBox("stco", new Uint8Array(stcoPayloadSize));

	const buildMoov = (stco: Uint8Array): Uint8Array => {
		const stbl = movBox("stbl", concat([stsd, stts, stsc, stsz, stco]));
		const minf = movBox("minf", concat([vmhd, dinf, stbl]));
		const mdia = movBox("mdia", concat([mdhd, hdlr, minf]));
		const trak = movBox("trak", concat([tkhd, mdia]));
		return movBox("moov", concat([mvhd, trak]));
	};

	const moovPlaceholder = buildMoov(stcoPlaceholder);
	const mdatStart = ftyp.length + moovPlaceholder.length;

	const offsets: Uint8Array[] = [];
	let offset = mdatStart + 8;
	for (const frame of frames) {
		offsets.push(u32be(offset));
		offset += frame.length;
	}
	const stco = movBox("stco", concat([u32be(0), u32be(frameCount), ...offsets]));

	const moov = buildMoov(stco);
	const mdat = movBox("mdat", concat(frames));

	return concat([ftyp, moov, mdat]);
}

// --- MKV (MJPEG) -----------------------------------------------------------

const EBML_ID = [0x1a, 0x45, 0xdf, 0xa3];
const SEGMENT_ID = [0x18, 0x53, 0x80, 0x67];
const INFO_ID = [0x15, 0x49, 0xa9, 0x66];
const TRACKS_ID = [0x16, 0x54, 0xae, 0x6b];
const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];

function ebmlSize(value: number): Uint8Array<ArrayBuffer> {
	let length = 1;
	while (length < 8 && value >= 2 ** (7 * length)) length++;
	const output = new Uint8Array(length);
	let remaining = value >>> 0;
	for (let index = length - 1; index >= 0; index--) {
		output[index] = remaining & 0xff;
		remaining = Math.floor(remaining / 256);
	}
	output[0] |= 0x80 >> (length - 1);
	return output;
}

function ebmlUint(value: number): Uint8Array<ArrayBuffer> {
	const bytes: number[] = [];
	let remaining = value >>> 0;
	do {
		bytes.unshift(remaining & 0xff);
		remaining = Math.floor(remaining / 256);
	} while (remaining > 0);
	return new Uint8Array(bytes);
}

function ebmlFloat(value: number): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(8);
	new DataView(output.buffer).setFloat64(0, value);
	return output;
}

function ebmlElement(id: number[], data: Uint8Array): Uint8Array<ArrayBuffer> {
	return concat([new Uint8Array(id), ebmlSize(data.length), data]);
}

function simpleBlock(
	track: number,
	timestamp: number,
	keyframe: boolean,
	frame: Uint8Array,
): Uint8Array<ArrayBuffer> {
	const timestampBytes = new Uint8Array(2);
	new DataView(timestampBytes.buffer).setInt16(0, Math.max(-32768, Math.min(32767, timestamp)));
	return concat([
		ebmlSize(track),
		timestampBytes,
		new Uint8Array([keyframe ? 0x80 : 0x00]),
		frame,
	]);
}

export function buildMkv(
	frames: Uint8Array[],
	width: number,
	height: number,
	durationsMs: number[],
): Uint8Array<ArrayBuffer> {
	const totalDuration = durationsMs.reduce((sum, value) => sum + value, 0);

	const ebml = ebmlElement(
		EBML_ID,
		concat([
			ebmlElement([0x42, 0x86], ebmlUint(1)),
			ebmlElement([0x42, 0xf7], ebmlUint(1)),
			ebmlElement([0x42, 0xf2], ebmlUint(4)),
			ebmlElement([0x42, 0xf3], ebmlUint(8)),
			ebmlElement([0x42, 0x82], ascii("matroska")),
			ebmlElement([0x42, 0x87], ebmlUint(4)),
			ebmlElement([0x42, 0x85], ebmlUint(2)),
		]),
	);

	const info = ebmlElement(
		INFO_ID,
		concat([
			ebmlElement([0x2a, 0xd7, 0xb1], ebmlUint(1_000_000)),
			ebmlElement([0x4d, 0x80], ascii("Pixel Spell")),
			ebmlElement([0x57, 0x41], ascii("Pixel Spell")),
			ebmlElement([0x44, 0x89], ebmlFloat(totalDuration)),
		]),
	);

	const trackEntry = ebmlElement(
		[0xae],
		concat([
			ebmlElement([0xd7], ebmlUint(1)),
			ebmlElement([0x73, 0xc5], ebmlUint(1)),
			ebmlElement([0x83], ebmlUint(1)),
			ebmlElement([0x9c], ebmlUint(0)),
			ebmlElement([0x86], ascii("V_MJPEG")),
			ebmlElement(
				[0xe0],
				concat([
					ebmlElement([0xb0], ebmlUint(width)),
					ebmlElement([0xba], ebmlUint(height)),
				]),
			),
		]),
	);
	const tracks = ebmlElement(TRACKS_ID, trackEntry);

	const clusters: Uint8Array[] = [];
	let blocks: Uint8Array[] = [];
	let clusterTimestamp = 0;
	let cumulative = 0;
	const flush = (): void => {
		if (blocks.length === 0) return;
		clusters.push(
			ebmlElement(
				CLUSTER_ID,
				concat([ebmlElement([0xe7], ebmlUint(clusterTimestamp)), ...blocks]),
			),
		);
		blocks = [];
	};

	for (let index = 0; index < frames.length; index++) {
		if (cumulative - clusterTimestamp > 32767) {
			flush();
			clusterTimestamp = cumulative;
		}
		blocks.push(
			ebmlElement(
				[0xa3],
				simpleBlock(1, cumulative - clusterTimestamp, true, frames[index]!),
			),
		);
		cumulative += durationsMs[index]!;
	}
	flush();

	const segment = ebmlElement(SEGMENT_ID, concat([info, tracks, ...clusters]));
	return concat([ebml, segment]);
}

// --- MediaRecorder (WebM / MP4) --------------------------------------------

function pickMimeType(candidates: string[]): string | null {
	if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return null;
	for (const candidate of candidates) {
		if (MediaRecorder.isTypeSupported(candidate)) return candidate;
	}
	return null;
}

function drawVideoFrame(
	canvas: HTMLCanvasElement,
	source: HTMLCanvasElement,
	doc: PixelDoc,
	frameIndex: number,
	scale: number,
	background: ExportBackground,
): void {
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas 2D is not available");

	const solid = videoBackground(background);
	if (solid !== "transparent") {
		context.fillStyle = solid === "white" ? "#ffffff" : "#000000";
		context.fillRect(0, 0, canvas.width, canvas.height);
	}

	drawPixels(source, compositeFrame(doc, frameIndex), doc.width, doc.height);
	context.imageSmoothingEnabled = false;
	context.drawImage(source, 0, 0, doc.width * scale, doc.height * scale);
}

async function encodeMediaVideo(
	doc: PixelDoc,
	frameIndices: readonly number[],
	scale: number,
	background: ExportBackground,
	quality: number,
	candidates: string[],
	signal?: AbortSignal,
): Promise<Blob> {
	const mimeType = pickMimeType(candidates);
	if (!mimeType) {
		throw new Error(
			"This browser cannot record the requested video format. Try WebM or MP4 in a Chromium browser.",
		);
	}

	if (signal?.aborted) throw abortError();

	const width = doc.width * scale;
	const height = doc.height * scale;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	canvas.style.position = "fixed";
	canvas.style.left = "-10000px";
	canvas.style.top = "0";
	document.body.appendChild(canvas);

	// A single scratch surface avoids allocating a canvas per recorded frame.
	const source = document.createElement("canvas");
	let recorder: MediaRecorder | null = null;
	let stream: MediaStream | null = null;

	try {
		stream = canvas.captureStream(30);
		const videoBitsPerSecond = Math.round(
			500_000 * (0.25 + (Math.max(0, Math.min(100, quality)) / 100) * 7.75),
		);
		recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
		const rec = recorder;
		const chunks: BlobPart[] = [];
		rec.ondataavailable = (event) => {
			if (event.data && event.data.size > 0) chunks.push(event.data);
		};
		const stopped = new Promise<void>((resolve) => {
			rec.onstop = () => resolve();
		});

		drawVideoFrame(canvas, source, doc, frameIndices[0]!, scale, background);
		rec.start(100);

		for (let index = 0; index < frameIndices.length; index++) {
			if (signal?.aborted) throw abortError();
			drawVideoFrame(canvas, source, doc, frameIndices[index]!, scale, background);
			await sleep(
				Math.max(10, frameDurationMs(doc, frameIndices[index]!)),
				signal,
			);
		}

		// Keep the final frame visible long enough to be captured.
		await sleep(80, signal);
		rec.stop();
		await stopped;

		return new Blob(chunks, { type: mimeType });
	} finally {
		// Guarantee teardown even if a frame draw throws mid-recording, so a
		// live recorder and its capture stream are never leaked.
		if (recorder && recorder.state !== "inactive") recorder.stop();
		stream?.getTracks().forEach((track) => track.stop());
		canvas.remove();
	}
}

// --- Dispatcher ------------------------------------------------------------

/** Exports the document as the requested animation or video format. */
export async function exportVideo(
	doc: PixelDoc,
	options: VideoExportOptions,
): Promise<Blob> {
	const scale = clampInt(options.scale, 1, 10);
	const frameIndices = animationFrameIndices(doc, options.frames);
	const width = doc.width * scale;
	const height = doc.height * scale;
	const sizeError = validateExportSize(width, height, frameIndices.length, true);
	if (sizeError) throw new Error(sizeError);
	if (options.signal?.aborted) throw abortError();

	switch (options.format) {
		case "gif":
			return exportGifInWorker(doc, {
				scale,
				fps: options.fps,
				loop: options.loop,
				background: options.background,
				frames: options.frames,
			});
		case "apng":
			return exportApng(doc, {
				scale,
				loop: options.loop,
				background: options.background,
				frames: options.frames,
			});
		case "webp":
			return exportAnimatedWebp(doc, {
				scale,
				loop: options.loop,
				background: options.background,
				quality: options.quality,
				frames: options.frames,
			});
		case "webm":
			return encodeMediaVideo(
				doc,
				frameIndices,
				scale,
				options.background,
				options.quality,
				["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
				options.signal,
			);
		case "mp4":
			return encodeMediaVideo(
				doc,
				frameIndices,
				scale,
				options.background,
				options.quality,
				["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/mp4;codecs=avc1"],
				options.signal,
			);
		case "mov": {
			const frames = await encodeJpegFrames(
				doc,
				frameIndices,
				scale,
				options.background,
				options.quality,
				options.signal,
			);
			const durations = frameIndices.map((index) => frameDurationMs(doc, index));
			return new Blob([buildMov(frames, width, height, durations)], {
				type: "video/quicktime",
			});
		}
		case "avi": {
			const frames = await encodeJpegFrames(
				doc,
				frameIndices,
				scale,
				options.background,
				options.quality,
				options.signal,
			);
			return new Blob([buildAvi(frames, width, height, options.fps)], {
				type: "video/x-msvideo",
			});
		}
		case "mkv": {
			const frames = await encodeJpegFrames(
				doc,
				frameIndices,
				scale,
				options.background,
				options.quality,
				options.signal,
			);
			const durations = frameIndices.map((index) => frameDurationMs(doc, index));
			return new Blob([buildMkv(frames, width, height, durations)], {
				type: "video/x-matroska",
			});
		}
	}

	throw new Error(`Unsupported video format: ${options.format}`);
}
