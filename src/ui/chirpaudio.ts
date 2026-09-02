/**
 * The merger, heard.
 *
 * A stellar-mass binary black hole sweeps from a few tens of hertz to a few
 * hundred in its last fraction of a second, which is - by a coincidence with no
 * deeper meaning than the mass of a dead star and the range of a human ear -
 * exactly the audio band. Nothing is transposed here. The oscillator is driven
 * at the gravitational-wave frequency the waveform actually has, at the rate it
 * actually has it, with an amplitude following the actual strain. What comes
 * out is a rising whoop and a thud, which is what LIGO's control room heard.
 *
 * Two voices, because a gravitational wave has two polarisations and the
 * quadrupole radiates at twice the orbital frequency: the fundamental carries
 * the wave, and a small admixture of the first overtone gives the merger the
 * edge it has in the real audio, where the higher multipoles come in as the
 * holes stop being point masses.
 *
 * Audio only starts on a keypress, which is both a browser requirement and the
 * right default: nothing here should make a noise nobody asked for.
 */

import { binaryState, type Binary } from '../physics/gwaves';

export class ChirpAudio {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private harm: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private harmGain: GainNode | null = null;
  private running = false;

  constructor(private binary: Binary) {}

  get on(): boolean { return this.running; }

  /** Must be called from a user gesture. */
  start(): boolean {
    if (this.running) return true;
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    try {
      this.ctx = new Ctor();
      const master = this.ctx.createGain();
      master.gain.value = 0.16;
      master.connect(this.ctx.destination);

      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(master);
      this.osc = this.ctx.createOscillator();
      this.osc.type = 'sine';
      this.osc.frequency.value = 40;
      this.osc.connect(this.gain);
      this.osc.start();

      this.harmGain = this.ctx.createGain();
      this.harmGain.gain.value = 0;
      this.harmGain.connect(master);
      this.harm = this.ctx.createOscillator();
      this.harm.type = 'sine';
      this.harm.frequency.value = 60;
      this.harm.connect(this.harmGain);
      this.harm.start();

      this.running = true;
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  stop(): void {
    try {
      this.osc?.stop();
      this.harm?.stop();
      this.ctx?.close();
    } catch { /* the context may already be gone */ }
    this.ctx = null;
    this.osc = null;
    this.harm = null;
    this.gain = null;
    this.harmGain = null;
    this.running = false;
  }

  /** @param t time relative to coalescence, seconds */
  update(t: number): void {
    if (!this.running || !this.ctx || !this.osc || !this.gain || !this.harm || !this.harmGain) return;
    const s = binaryState(this.binary, t);
    const now = this.ctx.currentTime;
    // A short ramp rather than a jump: the frequency is being sampled once a
    // frame and stepping it would put a click on every one of them.
    const glide = 0.05;
    const f = Math.min(Math.max(s.freqHz, 20), 2000);
    this.osc.frequency.setTargetAtTime(f, now, glide);
    this.harm.frequency.setTargetAtTime(Math.min(f * 1.5, 6000), now, glide);
    // Amplitude follows the strain, normalised against its value at the ISCO so
    // the loudness is the shape of the chirp rather than the distance.
    const a = Math.min(1, s.strain / (this.peak || 1));
    const env = Math.pow(a, 0.7);
    this.gain.gain.setTargetAtTime(env, now, glide);
    this.harmGain.gain.setTargetAtTime(
      env * (s.stage === 'inspiral' ? 0.06 : 0.34), now, glide,
    );
  }

  /** Reference strain, set once so the envelope has something to divide by. */
  private peak = 0;

  calibrate(iscoTime: number): void {
    this.peak = binaryState(this.binary, iscoTime).strain;
  }
}
