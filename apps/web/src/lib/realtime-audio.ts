export const REALTIME_SAMPLE_RATE = 24_000;

export type PcmPlayerFailureReason = "audio-buffer-overflow";

export type PcmPlayerEnqueueResult =
  | { ok: true }
  | { ok: false; reason: PcmPlayerFailureReason };

const MAX_BUFFERED_AUDIO_SECONDS = 10;
const JITTER_BUFFER_SECONDS = 0.06;

function decodedBase64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/** Decode a base64 PCM16 payload into an Int16Array of samples. */
function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
}

/** Convert a Float32 mic frame [-1,1] into little-endian PCM16 bytes. */
export function float32ToPcm16(input: Float32Array): ArrayBuffer {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm.buffer;
}

/** Gap-free sequential player for incoming PCM16 chunks. */
export class PcmPlayer {
  private ctx: AudioContext;
  private nextTime = 0;
  private closed = false;

  constructor() {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctx({ sampleRate: REALTIME_SAMPLE_RATE });
  }

  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  enqueue(b64: string): PcmPlayerEnqueueResult {
    const decodedBytes = decodedBase64ByteLength(b64);
    if (decodedBytes === 0) return { ok: true };

    const now = this.ctx.currentTime;
    const startTime =
      this.nextTime < now ? now + JITTER_BUFFER_SECONDS : this.nextTime;
    const duration = decodedBytes / 2 / this.ctx.sampleRate;
    const bufferedSeconds = Math.max(startTime - now, 0);

    if (bufferedSeconds + duration > MAX_BUFFERED_AUDIO_SECONDS) {
      return { ok: false, reason: "audio-buffer-overflow" };
    }

    const int16 = base64ToInt16(b64);
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 0x8000;
    const buffer = this.ctx.createBuffer(1, f32.length, this.ctx.sampleRate);
    buffer.copyToChannel(f32, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start(startTime);
    this.nextTime = startTime + buffer.duration;
    return { ok: true };
  }

  close(): void {
    if (this.closed || this.ctx.state === "closed") return;
    this.closed = true;
    void this.ctx.close().catch(() => undefined);
  }
}
