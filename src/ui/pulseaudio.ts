/**
 * A pulsar, heard.
 *
 * The first pulsar was found on a chart recorder in 1967 as a scruff of ink
 * that repeated every 1.337 seconds, and the reason it was briefly labelled
 * LGM-1 is that nothing natural was known to keep time that well. What comes
 * out of a radio telescope pointed at one, put through a loudspeaker, is not a
 * metaphor for the star: it is the star's rotation, at its own rate.
 *
 * Nothing here is transposed. The period is the period. A pulsar turning once
 * every one and a third seconds is a slow knock; the Crab at thirty times a
 * second is a buzz right at the bottom of hearing; and a recycled millisecond
 * pulsar at six hundred and forty-two turns a second is a clear musical
 * note - E above middle C, near enough - because at that rate the individual
 * pulses stop being events and become a pitch. That crossing is the whole point
 * of listening to them, and it happens at exactly the rate the ear stops
 * counting and starts hearing, around twenty turns a second.
 *
 * The mechanism is a single looped buffer holding one turn of the star. Looping
 * gives exact timing at any rate - no scheduler has to keep up with six hundred
 * events a second - and the sample rate does the rest. The buffer is filled
 * with band-limited noise under a pulse-shaped envelope, because the emission
 * really is broadband noise: a pulsar's *timing* is extraordinarily regular and
 * its individual pulses are not alike at all.
 */

export class PulseAudio {
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private running = false;
  private builtFor = -1;

  get on(): boolean { return this.running; }

  /**
   * Start, or retune to a new star. Must be called from a user gesture.
   *
   * @param periodS  the star's rotation period, seconds
   * @param dutyCycle  what fraction of a turn the beam is pointing this way
   */
  start(periodS: number, dutyCycle: number): boolean {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    try {
      if (!this.ctx) {
        this.ctx = new Ctor();
        this.gain = this.ctx.createGain();
        this.gain.gain.value = 0;
        this.gain.connect(this.ctx.destination);
      }
      this.retune(periodS, dutyCycle);
      this.running = true;
      // A short fade in, because a looped buffer starting at full level puts a
      // click on the front of it.
      this.gain?.gain.setTargetAtTime(0.17, this.ctx.currentTime, 0.06);
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  /** Build one turn of the star and loop it. */
  retune(periodS: number, dutyCycle: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // Rebuilding on every frame would be pointless and audible; a couple of
    // per cent of drift is inaudible and a pulsar's period barely changes.
    if (this.builtFor > 0 && Math.abs(periodS / this.builtFor - 1) < 0.02) return;
    this.builtFor = periodS;

    const rate = ctx.sampleRate;
    // Very fast pulsars need several turns per buffer or the loop point itself
    // becomes an audible tone of its own.
    const turns = periodS < 0.02 ? Math.ceil(0.05 / periodS) : 1;
    const n = Math.max(64, Math.round(rate * periodS * turns));
    const buf = ctx.createBuffer(1, n, rate);
    const d = buf.getChannelData(0);

    const width = Math.max(0.02, Math.min(0.45, dutyCycle));
    // A one-pole low pass over white noise: the emission is broadband, but a
    // radio receiver has a band, and unfiltered white noise is a hiss rather
    // than the rasp a pulsar actually makes.
    let last = 0;
    for (let i = 0; i < n; i++) {
      const phase = ((i / n) * turns) % 1;
      // Two peaks, because most pulse profiles have two: the sightline cuts a
      // chord across a hollow cone and crosses its wall twice.
      const d1 = Math.min(Math.abs(phase - 0.42), 1 - Math.abs(phase - 0.42));
      const d2 = Math.min(Math.abs(phase - 0.58), 1 - Math.abs(phase - 0.58));
      const env = Math.exp(-((d1 / (width * 0.42)) ** 2))
        + 0.62 * Math.exp(-((d2 / (width * 0.34)) ** 2));
      const white = Math.random() * 2 - 1;
      last = last * 0.62 + white * 0.38;
      d[i] = last * env * 0.9;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    if (this.gain) src.connect(this.gain);
    src.start();
    // Swap: the old source is stopped after the new one is running, so there
    // is no gap between them.
    const old = this.src;
    this.src = src;
    try { old?.stop(ctx.currentTime + 0.02); } catch { /* already stopped */ }
  }

  stop(): void {
    try {
      this.src?.stop();
      this.ctx?.close();
    } catch { /* the context may already be gone */ }
    this.ctx = null;
    this.src = null;
    this.gain = null;
    this.running = false;
    this.builtFor = -1;
  }
}
