/* global AudioWorkletProcessor, sampleRate, registerProcessor */
// Integrate source samples across 16 kHz output intervals, including block boundaries.
class BrainVoicePcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.remaining = this.ratio;
    this.sum = 0;
    this.samples = [];
    this.count = 0;
    this.done = false;
    this.port.onmessage = ({ data }) => {
      if (data === "finish") {
        this.done = true;
        this.flush();
        this.port.postMessage({ done: true });
      }
    };
  }
  flush() {
    if (!this.samples.length) return;
    const pcm = Int16Array.from(this.samples);
    this.samples = [];
    this.port.postMessage({ pcm }, [pcm.buffer]);
  }
  process(inputs) {
    if (this.done) return true;
    const channels = inputs[0];
    if (!channels?.[0]) return true;
    let square = 0;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      square += sample * sample;
      let available = 1;
      while (available > 1e-8 && this.count < 16000 * 120) {
        const weight = Math.min(available, this.remaining);
        this.sum += sample * weight;
        this.remaining -= weight;
        available -= weight;
        if (this.remaining < 1e-8) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.samples.push(Math.round(value * (value < 0 ? 32768 : 32767)));
          this.count++;
          this.sum = 0;
          this.remaining = this.ratio;
        }
      }
    }
    if (this.samples.length >= 1600) {
      this.port.postMessage({ level: Math.sqrt(square / channels[0].length) });
      this.flush();
    }
    return true;
  }
}
registerProcessor("brain-voice-pcm", BrainVoicePcm);
