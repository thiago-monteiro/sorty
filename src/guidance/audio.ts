/** PCM WAV at 16 kHz mono, supported directly by whisper.cpp without codecs. */
export function encodeWav(
  samples: Float32Array,
  sourceRate: number,
): ArrayBuffer {
  if (!Number.isFinite(sourceRate) || sourceRate < 8000 || !samples.length)
    throw new Error("Invalid audio");
  const rate = 16000,
    length = Math.max(1, Math.round((samples.length * rate) / sourceRate));
  const buffer = new ArrayBuffer(44 + length * 2),
    view = new DataView(buffer);
  const word = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  word(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  word(8, "WAVE");
  word(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, "data");
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const from = Math.floor((i * sourceRate) / rate),
      to = Math.min(
        samples.length,
        Math.max(from + 1, Math.floor(((i + 1) * sourceRate) / rate)),
      );
    let sum = 0;
    for (let j = from; j < to; j++) sum += samples[j];
    const value = Math.max(-1, Math.min(1, sum / (to - from)));
    view.setInt16(
      44 + i * 2,
      Math.round(value * (value < 0 ? 32768 : 32767)),
      true,
    );
  }
  return buffer;
}

/** Energy endpointing: retain a short lead-in and submit only speech-sized segments. */
export class UtteranceSegmenter {
  private lead: Float32Array[] = [];
  private parts: Float32Array[] = [];
  private duration = 0;
  private voiced = 0;
  private silence = 0;
  reset() {
    this.lead = [];
    this.parts = [];
    this.duration = 0;
    this.voiced = 0;
    this.silence = 0;
  }
  push(chunk: Float32Array, rate: number): Float32Array | null {
    let energy = 0;
    for (const x of chunk) energy += x * x;
    const speaking = Math.sqrt(energy / chunk.length) > 0.012;
    const seconds = chunk.length / rate;
    if (!this.parts.length && !speaking) {
      this.lead.push(chunk.slice());
      if (this.lead.length > 4) this.lead.shift();
      return null;
    }
    if (!this.parts.length) this.parts = this.lead.splice(0);
    this.parts.push(chunk.slice());
    this.duration += seconds;
    if (speaking) {
      this.voiced += seconds;
      this.silence = 0;
    } else this.silence += seconds;
    if (this.duration < 12 && this.silence < 0.8) return null;
    const parts = this.parts,
      good = this.voiced >= 0.25;
    this.reset();
    if (!good) return null;
    const result = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      result.set(p, offset);
      offset += p.length;
    }
    return result;
  }
}
