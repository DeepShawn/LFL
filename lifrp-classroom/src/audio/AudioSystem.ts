export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: AudioBufferSourceNode | null = null;
  speech = false;
  sound = true;
  private lastStep = 0;
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = .14;
      this.master.connect(this.context.destination);
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 3, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < data.length; i++) { previous = .985 * previous + (Math.random() * 2 - 1) * .015; data[i] = previous; }
      this.ambience = this.context.createBufferSource();
      this.ambience.buffer = buffer;
      this.ambience.loop = true;
      this.ambience.connect(this.master);
      this.ambience.start();
    }
    if (this.sound) await this.context.resume();
  }
  setSound(enabled: boolean) { this.sound = enabled; if (this.master) this.master.gain.value = enabled ? .14 : 0; }
  pause() { void this.context?.suspend(); if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  resume() { if (this.sound) void this.context?.resume(); }
  cue(kind: 'step' | 'success' | 'warning' | 'danger' | 'quiet') {
    if (!this.context || !this.master || !this.sound || kind === 'quiet') return;
    if (kind === 'step' && performance.now() - this.lastStep < 400) return;
    this.lastStep = performance.now();
    const time = this.context.currentTime;
    const oscillator = this.context.createOscillator(), gain = this.context.createGain();
    oscillator.type = kind === 'success' ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(kind === 'success' ? 440 : kind === 'danger' ? 67 : kind === 'step' ? 85 : 180, time);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'success' ? 660 : 35, time + .25);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(.25, time + .015);
    gain.gain.exponentialRampToValueAtTime(.001, time + .32);
    oscillator.connect(gain); gain.connect(this.master);
    oscillator.start(time); oscillator.stop(time + .33);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  say(text: string, role: 'teacher' | 'student' | 'narrator' = 'narrator') {
    if (!this.speech || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices().filter(voice => /^zh/i.test(voice.lang));
    const selected = voices[role === 'teacher' ? 0 : role === 'student' ? Math.min(1, voices.length - 1) : Math.min(2, voices.length - 1)];
    if (selected) utterance.voice = selected;
    utterance.lang = 'zh-CN';
    utterance.rate = role === 'teacher' ? .9 : 1;
    utterance.pitch = role === 'teacher' ? .72 : role === 'student' ? 1.12 : .96;
    utterance.volume = .65;
    speechSynthesis.speak(utterance);
  }
}
