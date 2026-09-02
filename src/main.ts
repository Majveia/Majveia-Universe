/**
 * Bootstrap.
 *
 * Everything of consequence lives in App; this file exists to start it and to
 * expose a handle for the screenshot harness and the browser console.
 */

import { App } from './app';

const app = new App(new URLSearchParams(location.search));

Object.assign(window as unknown as Record<string, unknown>, {
  majveia: {
    app,
    get ready() { return !!(app as unknown as { stage: unknown }).stage; },
    engine: app.engine,
    controls: app.controls,
    setEpoch(a: number) { (app as unknown as { epochA: number }).epochA = a; },
    get travelling() { return app.travelling; },
    descend() { app.descend(false); },
    ascend() { app.ascend(); },
    travel(id: string, ctx: Record<string, number>) {
      app.travel({ id: id as never, ctx, label: id });
    },
  },
});

app.start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[majveia] failed to start', err);
});
