/**
 * Shared low-level PNG primitives for the dedicated encoders (grayscale and
 * indexed). The browser canvas API only writes RGBA PNGs, so the formats that
 * need a custom color type build their own chunks and zlib stream here.
 */

export const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index++) {
		let value = index;
		for (let bit = 0; bit < 8; bit++) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (let index = 0; index < bytes.length; index++) {
		crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
	let a = 1;
	let b = 0;
	for (let index = 0; index < bytes.length; index++) {
		a = (a + bytes[index]!) % 65521;
		b = (b + a) % 65521;
	}
	return ((b << 16) | a) >>> 0;
}

/** Writes a big-endian 32-bit value, as PNG chunks require. */
export function writeUint32(
	target: Uint8Array,
	offset: number,
	value: number,
): void {
	target[offset] = (value >>> 24) & 0xff;
	target[offset + 1] = (value >>> 16) & 0xff;
	target[offset + 2] = (value >>> 8) & 0xff;
	target[offset + 3] = value & 0xff;
}

/** Wraps one PNG chunk (length, type, data, CRC). */
export function pngChunk(
	type: string,
	data: Uint8Array,
): Uint8Array<ArrayBuffer> {
	const chunk = new Uint8Array(12 + data.length);
	writeUint32(chunk, 0, data.length);
	for (let index = 0; index < 4; index++) {
		chunk[4 + index] = type.charCodeAt(index) & 0xff;
	}
	chunk.set(data, 8);
	const crc = crc32(chunk.subarray(4, 8 + data.length));
	writeUint32(chunk, 8 + data.length, crc);
	return chunk;
}

/** zlib with uncompressed (stored) blocks; used when CompressionStream fails. */
function storedZlib(data: Uint8Array): Uint8Array<ArrayBuffer> {
	const blockCount = Math.max(1, Math.ceil(data.length / 65535));
	const output = new Uint8Array(2 + blockCount * 5 + data.length + 4);
	let offset = 0;
	output[offset++] = 0x78;
	output[offset++] = 0x01;

	for (let block = 0; block < blockCount; block++) {
		const start = block * 65535;
		const length = Math.min(65535, data.length - start);
		const final = block === blockCount - 1;
		output[offset++] = final ? 1 : 0;
		output[offset++] = length & 0xff;
		output[offset++] = (length >>> 8) & 0xff;
		const inverse = ~length & 0xffff;
		output[offset++] = inverse & 0xff;
		output[offset++] = (inverse >>> 8) & 0xff;
		output.set(data.subarray(start, start + length), offset);
		offset += length;
	}

	writeUint32(output, offset, adler32(data));
	return output;
}

/** Compresses PNG scanline data with zlib, falling back to stored blocks. */
export async function deflate(
	data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
	if (typeof CompressionStream !== "undefined") {
		try {
			const copy = new Uint8Array(data.length);
			copy.set(data);
			const stream = new Blob([copy])
				.stream()
				.pipeThrough(new CompressionStream("deflate"));
			const buffer = await new Response(stream).arrayBuffer();
			return new Uint8Array(buffer);
		} catch {
			// Fall through to the dependency-free encoder.
		}
	}
	return storedZlib(data);
}

/** Concatenates PNG chunks after the signature. */
export function assemblePng(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const output = new Uint8Array(total);
	let cursor = 0;
	for (const chunk of chunks) {
		output.set(chunk, cursor);
		cursor += chunk.length;
	}
	return output;
}
