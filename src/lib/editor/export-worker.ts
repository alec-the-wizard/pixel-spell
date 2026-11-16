import { exportGifBytes } from "./export.js";
import type { GifExportOptions } from "./export.js";
import type { PixelDoc } from "./types.js";

interface GifRequest {
	doc: PixelDoc;
	options: GifExportOptions;
}

self.onmessage = (event: MessageEvent<GifRequest>) => {
	const { doc, options } = event.data;
	try {
		const bytes = exportGifBytes(doc, options);
		self.postMessage({ bytes }, { transfer: [bytes.buffer] });
	} catch (error) {
		self.postMessage({
			error: error instanceof Error ? error.message : String(error),
		});
	}
};
