export class GameAudio {
  constructor() {
    this.context = null;
    this.nodes = new Set();
    this.sources = new Set();
    this.transients = new Set();
    this.paused = true;
    this.disposed = false;
    this.ready = false;
    this.outputLevel = 0;
    this.reducedEffects = false;
    this.lastUpdate = -Infinity;
    this.nextHeart = 0;
    this.nextBell = 0;
    this.suspendTimer = null;
  }

  keep(node) {
    this.nodes.add(node);
    return node;
  }

  gain(value = 0) {
    const node = this.keep(this.context.createGain());
    node.gain.value = value;
    return node;
  }

  oscillator(frequency, type = 'sine') {
    const source = this.keep(this.context.createOscillator());
    source.type = type;
    source.frequency.value = frequency;
    this.sources.add(source);
    return source;
  }

  noise(buffer, type, frequency, q = 0.5) {
    const source = this.keep(this.context.createBufferSource());
    source.buffer = buffer;
    source.loop = true;
    const filter = this.keep(this.context.createBiquadFilter());
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = this.gain();
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.bus);
    this.sources.add(source);
    source.start();
    return { source, filter, gain };
  }

  initialize() {
    const ctx = this.context;
    this.bus = this.gain(0.7);
    this.compressor = this.keep(ctx.createDynamicsCompressor());
    this.compressor.threshold.value = -19;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 8;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.22;
    this.master = this.gain(0);
    this.bus.connect(this.compressor);
    this.compressor.connect(this.master);
    this.master.connect(ctx.destination);
    const length = Math.ceil(ctx.sampleRate * 4);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    let seed = 918273;
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = (seed / 4294967296 * 2 - 1) * 0.65;
    }
    this.wind = this.noise(buffer, 'lowpass', 480);
    this.rain = this.noise(buffer, 'highpass', 1400);
    this.paper = this.noise(buffer, 'bandpass', 1150, 0.85);
    this.paperPan = this.keep(ctx.createStereoPanner());
    this.paper.gain.disconnect();
    this.paper.gain.connect(this.paperPan);
    this.paperPan.connect(this.bus);
    this.hum = this.oscillator(50, 'sine');
    this.humGain = this.gain();
    this.hum.connect(this.humGain);
    this.humGain.connect(this.bus);
    this.hum.start();
    this.dissonance = [this.oscillator(113), this.oscillator(119.4)];
    this.dissonanceGain = this.gain();
    this.dissonanceGain.connect(this.bus);
    for (const source of this.dissonance) {
      source.connect(this.dissonanceGain);
      source.start();
    }
    this.heart = this.oscillator(53);
    this.heartGain = this.gain();
    this.heart.connect(this.heartGain);
    this.heartGain.connect(this.bus);
    this.heart.start();
    this.nextHeart = ctx.currentTime + 0.7;
    this.ready = true;
  }

  async start() {
    if (this.disposed) return false;
    if (this.suspendTimer !== null) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    try {
      if (!this.context) {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) return false;
        this.context = new AudioContextClass({ latencyHint: 'interactive' });
        this.initialize();
      }
      if (!this.ready || this.context.state === 'closed') return false;
      this.paused = false;
      if (this.context.state !== 'running') await this.context.resume();
      if (this.disposed || this.paused) return false;
      this.lastUpdate = -Infinity;
      return this.context.state === 'running';
    } catch {
      this.paused = true;
      if (this.master && this.context.state !== 'closed') this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.025);
      return false;
    }
  }

  update(state, dt, settings = {}) {
    if (!this.ready || this.disposed || this.paused || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const volume = Number.isFinite(settings.volume) ? Math.max(0, Math.min(1, settings.volume)) : 0.65;
    this.outputLevel = settings.muted || state.status !== 'playing' ? 0 : volume * 0.55;
    this.reducedEffects = !!settings.reducedEffects;
    if (this.outputLevel !== this.lastLevel) {
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.outputLevel, now, this.outputLevel === 0 ? 0.025 : 0.22);
      this.lastLevel = this.outputLevel;
    }
    if (now - this.lastUpdate < 0.05) return;
    this.lastUpdate = now;
    const sanity = Math.max(0, Math.min(100, state.player.san)) / 100;
    const stress = 1 - sanity;
    const outdoor = state.scene === 'campus';
    const gentle = this.reducedEffects ? 0.45 : 1;
    const smooth = (param, value, time = 0.35) => {
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, time);
    };
    smooth(this.wind.gain.gain, outdoor ? 0.11 : 0.045);
    smooth(this.wind.filter.frequency, outdoor ? 520 : 310);
    smooth(this.rain.gain.gain, (outdoor ? 0.085 : 0.021) * gentle);
    smooth(this.humGain.gain, outdoor ? 0.005 : state.flags.power ? 0.017 : 0.009);
    smooth(this.dissonanceGain.gain, this.reducedEffects ? 0 : stress * stress * 0.023);
    smooth(this.dissonance[1].frequency, 119.4 + Math.sin(state.elapsed * 0.19) * stress * 0.8, 0.7);
    const enemy = state.enemy;
    const distance = enemy?.active ? Math.hypot(enemy.x - state.player.x, enemy.z - state.player.z, (enemy.y - state.player.y) * 2) : Infinity;
    const proximity = Math.max(0, 1 - distance / 10);
    const rustle = 0.55 + 0.45 * Math.sin(state.elapsed * 2.13 + Math.sin(state.elapsed * 0.77));
    smooth(this.paper.gain.gain, proximity * proximity * (0.035 + rustle * 0.065) * gentle, 0.18);
    if (enemy?.active && distance > 0) {
      const rightX = Math.cos(state.player.yaw);
      const rightZ = -Math.sin(state.player.yaw);
      const pan = ((enemy.x - state.player.x) * rightX + (enemy.z - state.player.z) * rightZ) / distance;
      smooth(this.paperPan.pan, Math.max(-0.7, Math.min(0.7, pan * 0.7)), 0.2);
    }
    if (this.outputLevel === 0 || this.reducedEffects) {
      smooth(this.heartGain.gain, 0, 0.04);
      this.nextHeart = now + 0.35;
    } else if (now >= this.nextHeart) {
      const intensity = 0.018 + stress * 0.032 + proximity * 0.022;
      const gain = this.heartGain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(0.00001, now);
      gain.linearRampToValueAtTime(intensity, now + 0.025);
      gain.exponentialRampToValueAtTime(0.00001, now + 0.13);
      gain.linearRampToValueAtTime(intensity * 0.65, now + 0.19);
      gain.exponentialRampToValueAtTime(0.00001, now + 0.32);
      this.nextHeart = now + 1.1 - stress * 0.38 - proximity * 0.17;
    }
  }

  bell() {
    if (!this.ready || this.disposed || this.paused || this.context.state !== 'running' || this.outputLevel === 0) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    if (now < this.nextBell) return;
    this.nextBell = now + 2.3;
    const strength = this.reducedEffects ? 0.028 : 0.045;
    for (const [offset, duration] of [[0.025, 0.19], [0.43, 0.19], [0.86, 0.92]]) {
      const start = now + offset;
      for (const [frequency, weight] of [[740, 1], [1131, 0.35], [1718, 0.15]]) {
        const source = ctx.createOscillator();
        const envelope = ctx.createGain();
        const sound = { source, envelope };
        this.transients.add(sound);
        source.type = 'sine';
        source.frequency.value = frequency;
        envelope.gain.setValueAtTime(0.00001, now);
        envelope.gain.setValueAtTime(0.00001, start);
        envelope.gain.linearRampToValueAtTime(strength * weight, start + 0.008);
        envelope.gain.exponentialRampToValueAtTime(0.00001, start + duration);
        source.connect(envelope);
        envelope.connect(this.bus);
        source.onended = () => {
          source.disconnect();
          envelope.disconnect();
          this.transients.delete(sound);
        };
        source.start(start);
        source.stop(start + duration + 0.03);
      }
    }
  }

  pause() {
    this.paused = true;
    if (!this.ready || this.disposed || this.context.state === 'closed') return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, 0.02);
    this.lastLevel = undefined;
    for (const sound of this.transients) {
      sound.envelope.gain.cancelScheduledValues(now);
      sound.envelope.gain.setTargetAtTime(0, now, 0.015);
      sound.source.stop(now + 0.06);
    }
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      if (this.paused && !this.disposed && this.context.state === 'running') this.context.suspend().catch(() => {});
    }, 90);
  }

  resume() {
    if (!this.context || !this.ready || this.disposed) return;
    this.start().catch(() => {});
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.paused = true;
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    const ctx = this.context;
    if (!ctx) return;
    if (this.master && ctx.state !== 'closed') {
      this.master.gain.cancelScheduledValues(ctx.currentTime);
      this.master.gain.setValueAtTime(0, ctx.currentTime);
    }
    for (const sound of this.transients) {
      sound.source.onended = null;
      sound.source.stop();
      sound.source.disconnect();
      sound.envelope.disconnect();
    }
    this.transients.clear();
    for (const source of this.sources) source.stop();
    for (const node of this.nodes) node.disconnect();
    this.sources.clear();
    this.nodes.clear();
    this.ready = false;
    if (ctx.state !== 'closed') ctx.close().catch(() => {});
  }
}
