import { encodeMapPixels } from "./map-encoding.js";

// Deliver each completed map before encoding the next, so a large batch
// cannot hold the first useful result behind every subsequent one.
let queue: Promise<void> = Promise.resolve();
self.onmessage = ({ data: { id, pixels, width, height, cap } }) => {
  queue = queue.then(async () => {
    try {
      self.postMessage({ id, planes: await encodeMapPixels(pixels, width, height, cap) });
    } catch (error) {
      self.postMessage({ id, error: String(error) });
    }
  });
};
