// whisper.cpp only reads plain 16-bit PCM WAV directly (no built-in
// decoder for compressed formats). Rather than requiring the user to
// convert files themselves (or bundling ffmpeg), this decodes whatever
// format the browser itself can play — WebView2/Chromium's media pipeline
// already handles OGG/Opus (WhatsApp voice notes), MP3, M4A/AAC, WebM,
// etc. — via the Web Audio API, then re-encodes the result as a mono
// 16kHz WAV file by hand. No ffmpeg, no extra native dependency.
const WHISPER_SAMPLE_RATE = 16000;

async function decodeAndResample(file: File, sampleRate: number): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    void audioCtx.close();
  }

  // Rendering through an OfflineAudioContext resamples to the target rate
  // and — since its destination has a single channel — downmixes any
  // stereo/multi-channel source using the Web Audio spec's standard
  // channel-mixing rules, without doing that math by hand here.
  const frameCount = Math.ceil(decoded.duration * sampleRate);
  const offlineCtx = new OfflineAudioContext(1, frameCount, sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

function floatTo16BitPCM(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function encodeWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const byteRate = sampleRate * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    view.setInt16(offset, samples[i], true);
  }
  return new Uint8Array(buffer);
}

/** Decodes any browser-playable audio file and re-encodes it as a mono
 * 16kHz PCM WAV — whisper.cpp's required input format. */
export async function toWavBytes(file: File): Promise<Uint8Array> {
  const mono = await decodeAndResample(file, WHISPER_SAMPLE_RATE);
  const pcm16 = floatTo16BitPCM(mono);
  return encodeWav(pcm16, WHISPER_SAMPLE_RATE);
}
