let context: AudioContext | undefined;
let lastRustle = -Infinity;
export function canRustle(now: number, last: number) {
  return now - last >= 400;
}
export function paperRustle() {
  if (!canRustle(Date.now(), lastRustle)) return;
  lastRustle = Date.now();
  context ??= new AudioContext();
  void context.resume();
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * 0.12),
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2500;
  filter.Q.value = 2500 / 1400;
  const gain = context.createGain();
  const now = context.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.115);
  noise.connect(filter).connect(gain).connect(context.destination);
  noise.start(now);
  noise.stop(now + 0.12);
  noise.onended = () => {
    noise.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}
