// 极简合成音效（WebAudio，无任何素材文件）。
// 移植到 QQ 小游戏时把这里换成 qq.createInnerAudioContext() 即可，其余代码不依赖声音。
const Sound = {
  ctx: null,
  ensure() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      } catch (e) { /* 无音频环境就静默 */ }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type, gain, delay, slideTo) {
    if (!this.ctx) return;
    delay = delay || 0;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },
  tap() { this.tone(1500, 0.05, 'square', 0.03); },
  unscrew() {
    for (let i = 0; i < 3; i++) this.tone(850 + i * 260, 0.035, 'square', 0.03, i * 0.07);
  },
  pop() { this.tone(420, 0.16, 'sine', 0.14, 0, 950); },
  blocked() { this.tone(150, 0.14, 'triangle', 0.1); },
  thud() { this.tone(95, 0.16, 'sine', 0.16, 0, 55); },
  boxPop() { this.tone(660, 0.12, 'sine', 0.12); this.tone(880, 0.16, 'sine', 0.12, 0.08); },
  fail() {
    this.tone(320, 0.28, 'sawtooth', 0.07, 0, 160);
    this.tone(220, 0.4, 'sawtooth', 0.07, 0.2, 110);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, 'sine', 0.1, i * 0.09));
  },
};
