/// <reference lib="webworker" />
/**
 * Off-thread universe generation.
 *
 * Building a 128^3 realisation means three inverse FFTs over two million
 * complex numbers plus a 3x3 eigendecomposition per particle. That is several
 * seconds of arithmetic, so it runs here and streams progress back; the main
 * thread keeps rendering the loading sequence at full frame rate throughout.
 */

import { generateCosmicWeb } from './zeldovich';
import type { Cosmology } from './lcdm';

interface Req {
  n: number;
  boxMpc: number;
  seed: number;
  cosmology: Cosmology;
  smoothCells?: number;
}

self.onmessage = (ev: MessageEvent<Req>) => {
  const t0 = performance.now();
  try {
    const field = generateCosmicWeb(ev.data, (fraction, label) => {
      (self as unknown as Worker).postMessage({ type: 'progress', fraction, label });
    });
    (self as unknown as Worker).postMessage(
      { type: 'done', field, ms: performance.now() - t0 },
      [field.q.buffer, field.psi.buffer, field.lambda.buffer],
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: 'error', message: err instanceof Error ? err.message : String(err),
    });
  }
};
