/*
 * Retrowave Visualizer engine
 * Old-school media-player style music visualizations drawn on a <canvas>,
 * driven by a Web Audio AnalyserNode. Shared by the browser extension and
 * the standalone web page.
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;
  const rand = (a, b) => a + Math.random() * (b - a);

  /* ------------------------------------------------------------------ */
  /* Audio feature extraction                                           */
  /* ------------------------------------------------------------------ */

  class AudioFeatures {
    constructor() {
      this.analyser = null;
      this.freq = new Uint8Array(1024);
      this.wave = new Uint8Array(2048).fill(128);
      this.bass = 0;
      this.mid = 0;
      this.treble = 0;
      this.level = 0;
      this.beat = false;
      this.beatPulse = 0; // decays from 1 after each beat
      this._bassAvg = 0;
      this._lastBeat = 0;
      this._bandCache = new Map();
    }

    setAnalyser(analyser) {
      this.analyser = analyser;
      if (analyser) {
        this.freq = new Uint8Array(analyser.frequencyBinCount);
        this.wave = new Uint8Array(analyser.fftSize);
      }
      this._bandCache.clear();
    }

    _binFor(hz) {
      const a = this.analyser;
      const rate = a ? a.context.sampleRate : 44100;
      const size = a ? a.fftSize : 2048;
      return clamp(Math.round(hz / (rate / size)), 0, this.freq.length - 1);
    }

    _avg(lo, hi) {
      const a = this._binFor(lo);
      const b = Math.max(a + 1, this._binFor(hi));
      let s = 0;
      for (let i = a; i < b; i++) s += this.freq[i];
      return s / ((b - a) * 255);
    }

    update(now) {
      const a = this.analyser;
      if (a) {
        a.getByteFrequencyData(this.freq);
        a.getByteTimeDomainData(this.wave);
      } else {
        this.freq.fill(0);
        this.wave.fill(128);
      }

      this.bass = this._avg(25, 180);
      this.mid = this._avg(180, 2200);
      this.treble = this._avg(2200, 12000);

      let sum = 0;
      for (let i = 0; i < this.wave.length; i++) {
        const v = (this.wave[i] - 128) / 128;
        sum += v * v;
      }
      this.level = Math.sqrt(sum / this.wave.length);

      // Simple energy-based beat detection on the low end.
      this._bassAvg = lerp(this._bassAvg, this.bass, 0.04);
      this.beat = false;
      if (
        this.bass > 0.28 &&
        this.bass > this._bassAvg * 1.18 &&
        now - this._lastBeat > 230
      ) {
        this.beat = true;
        this._lastBeat = now;
        this.beatPulse = 1;
      }
      this.beatPulse *= 0.9;
    }

    /** Returns `count` log-spaced band levels (0..1). */
    bands(count, minHz = 32, maxHz = 15000) {
      let ranges = this._bandCache.get(count + ':' + minHz + ':' + maxHz);
      if (!ranges) {
        ranges = [];
        const lmin = Math.log(minHz);
        const lmax = Math.log(maxHz);
        for (let i = 0; i < count; i++) {
          const lo = this._binFor(Math.exp(lerp(lmin, lmax, i / count)));
          const hi = Math.max(lo + 1, this._binFor(Math.exp(lerp(lmin, lmax, (i + 1) / count))));
          ranges.push([lo, hi]);
        }
        this._bandCache.set(count + ':' + minHz + ':' + maxHz, ranges);
      }
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const [lo, hi] = ranges[i];
        let m = 0;
        for (let j = lo; j < hi; j++) if (this.freq[j] > m) m = this.freq[j];
        // Gentle tilt so the treble end isn't always flat.
        const tilt = 1 + (i / count) * 0.35;
        out[i] = clamp((m / 255) * tilt, 0, 1);
      }
      return out;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Presets                                                            */
  /* Each factory returns { draw(g, f, env) } with fresh state.         */
  /* env = { w, h, t, dt, dpr, canvas }  (w/h in CSS pixels)            */
  /* ------------------------------------------------------------------ */

  function makeBuffer() {
    const c = document.createElement('canvas');
    return { c, g: c.getContext('2d'), w: 0, h: 0 };
  }
  function syncBuffer(buf, canvas) {
    if (buf.w !== canvas.width || buf.h !== canvas.height) {
      buf.c.width = buf.w = canvas.width;
      buf.c.height = buf.h = canvas.height;
    }
  }

  const PRESETS = [
    /* 1 — LED spectrum with falling peak caps and a floor reflection. */
    {
      name: 'Spectrum Bars',
      create() {
        let vals = null;
        let peaks = null;
        let peakVel = null;
        return {
          draw(g, f, { w, h }) {
            const n = clamp(Math.floor(w / 22), 16, 64);
            if (!vals || vals.length !== n) {
              vals = new Float32Array(n);
              peaks = new Float32Array(n);
              peakVel = new Float32Array(n);
            }
            const bands = f.bands(n);
            const bg = g.createLinearGradient(0, 0, 0, h);
            bg.addColorStop(0, '#02030a');
            bg.addColorStop(1, '#0a1022');
            g.fillStyle = bg;
            g.fillRect(0, 0, w, h);

            const floor = h * 0.74;
            const maxH = floor * 0.92;
            const gap = Math.max(2, w / n * 0.18);
            const bw = (w - gap * (n + 1)) / n;
            const seg = Math.max(4, Math.round(h / 90));
            const segGap = Math.max(1, Math.round(seg / 3));

            const grad = g.createLinearGradient(0, floor, 0, floor - maxH);
            grad.addColorStop(0, '#16ff6a');
            grad.addColorStop(0.55, '#d7ff2e');
            grad.addColorStop(0.8, '#ffb400');
            grad.addColorStop(1, '#ff2a2a');

            for (let i = 0; i < n; i++) {
              const target = bands[i];
              vals[i] = target > vals[i] ? lerp(vals[i], target, 0.6) : vals[i] * 0.9;
              const bh = vals[i] * maxH;
              if (bh >= peaks[i]) {
                peaks[i] = bh;
                peakVel[i] = 0;
              } else {
                peakVel[i] += 0.35;
                peaks[i] = Math.max(0, peaks[i] - peakVel[i]);
              }
              const x = gap + i * (bw + gap);

              // LED segments
              g.fillStyle = grad;
              const segs = Math.floor(bh / (seg + segGap));
              for (let s = 0; s < segs; s++) {
                const y = floor - (s + 1) * (seg + segGap) + segGap;
                g.fillRect(x, y, bw, seg);
              }
              // Peak cap
              g.fillStyle = '#e9f6ff';
              g.fillRect(x, floor - peaks[i] - seg, bw, Math.max(2, seg * 0.6));

              // Reflection
              const rh = Math.min(bh * 0.45, h - floor);
              const rg = g.createLinearGradient(0, floor, 0, floor + rh);
              rg.addColorStop(0, 'rgba(40,255,140,0.28)');
              rg.addColorStop(1, 'rgba(40,255,140,0)');
              g.fillStyle = rg;
              g.fillRect(x, floor + 2, bw, rh);
            }

            // Thin waveform skimming the floor line
            g.strokeStyle = 'rgba(120,200,255,0.35)';
            g.lineWidth = 1.5;
            g.beginPath();
            const step = Math.max(1, Math.floor(f.wave.length / w));
            for (let x = 0, i = 0; x < w; x++, i += step) {
              const v = (f.wave[i % f.wave.length] - 128) / 128;
              const y = floor + (h - floor) * 0.55 + v * (h - floor) * 0.4;
              x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
            }
            g.stroke();
          },
        };
      },
    },

    /* 2 — Glowing oscilloscope with misty trails. */
    {
      name: 'Ocean Scope',
      create() {
        let hue = 190;
        return {
          draw(g, f, { w, h, dt }) {
            g.fillStyle = 'rgba(0,6,18,0.18)';
            g.fillRect(0, 0, w, h);
            hue += dt * 0.012 + f.beatPulse * 3;
            const lines = 3;
            g.globalCompositeOperation = 'lighter';
            for (let L = 0; L < lines; L++) {
              const amp = h * (0.42 - L * 0.08) * (0.8 + f.level * 3);
              const yMid = h / 2 + (L - 1) * h * 0.06 * Math.sin(hue * 0.02 + L);
              g.strokeStyle = hsl(hue + L * 35, 90, 60, 0.55 - L * 0.12);
              g.lineWidth = 2.5 + f.bass * 6 - L;
              g.shadowColor = hsl(hue + L * 35, 100, 60, 1);
              g.shadowBlur = 18;
              g.beginPath();
              const N = 256;
              const len = f.wave.length;
              for (let i = 0; i <= N; i++) {
                const idx = Math.floor((i / N) * (len - 1));
                const v = (f.wave[(idx + L * 37) % len] - 128) / 128;
                const x = (i / N) * w;
                const y = yMid + v * amp;
                i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
              }
              g.stroke();
            }
            g.shadowBlur = 0;
            g.globalCompositeOperation = 'source-over';
          },
        };
      },
    },

    /* 3 — Feedback tunnel: previous frame zoomed and rotated forever. */
    {
      name: 'Feedback Tunnel',
      create() {
        const buf = makeBuffer();
        let rot = 0.01;
        let hue = rand(0, 360);
        let shape = 0;
        return {
          draw(g, f, { w, h, canvas }) {
            syncBuffer(buf, canvas);
            buf.g.setTransform(1, 0, 0, 1, 0, 0);
            buf.g.clearRect(0, 0, buf.w, buf.h);
            buf.g.drawImage(canvas, 0, 0);

            if (f.beat) {
              hue += rand(40, 120);
              if (Math.random() < 0.35) rot = -rot;
              if (Math.random() < 0.2) shape = (shape + 1) % 3;
            }
            hue += 0.4;

            g.fillStyle = '#000';
            g.fillRect(0, 0, w, h);
            const cx = w / 2;
            const cy = h / 2;
            const zoom = 1.025 + f.bass * 0.06;
            g.save();
            g.translate(cx, cy);
            g.rotate(rot * (1 + f.mid * 2));
            g.scale(zoom, zoom);
            g.translate(-cx, -cy);
            g.globalAlpha = 0.93;
            g.drawImage(buf.c, 0, 0, w, h);
            g.restore();
            g.globalAlpha = 1;

            // Fresh shape at the centre that the feedback smears outward.
            const r = Math.min(w, h) * (0.07 + f.level * 0.25);
            g.strokeStyle = hsl(hue, 95, 60);
            g.lineWidth = 2 + f.bass * 5;
            g.beginPath();
            const N = 128;
            for (let i = 0; i <= N; i++) {
              const a = (i / N) * TAU;
              const v = (f.wave[Math.floor((i / N) * (f.wave.length - 1))] - 128) / 128;
              let rr = r * (1 + v * 0.9);
              if (shape === 1) rr *= 1 + 0.35 * Math.cos(a * 5);
              if (shape === 2) rr *= 1 + 0.25 * Math.sign(Math.sin(a * 4));
              const x = cx + Math.cos(a) * rr;
              const y = cy + Math.sin(a) * rr;
              i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
            }
            g.closePath();
            g.stroke();
          },
        };
      },
    },

    /* 4 — Particle fireworks + warp-speed stars. */
    {
      name: 'Starburst',
      create() {
        const parts = [];
        const stars = [];
        for (let i = 0; i < 220; i++) stars.push({ a: rand(0, TAU), d: rand(0, 1), s: rand(0.3, 1) });
        let hue = rand(0, 360);
        return {
          draw(g, f, { w, h, dt }) {
            g.fillStyle = 'rgba(0,0,0,0.22)';
            g.fillRect(0, 0, w, h);
            const cx = w / 2;
            const cy = h / 2;
            const R = Math.hypot(cx, cy);
            const k = dt / 16.7;

            // Stars
            const warp = 0.002 + f.bass * 0.02 + f.beatPulse * 0.01;
            g.fillStyle = '#cfe8ff';
            for (const s of stars) {
              s.d += warp * s.s * (0.5 + s.d) * k;
              if (s.d > 1) {
                s.d = rand(0, 0.08);
                s.a = rand(0, TAU);
              }
              const x = cx + Math.cos(s.a) * s.d * R;
              const y = cy + Math.sin(s.a) * s.d * R;
              const z = 0.6 + s.d * 2.4;
              g.fillRect(x, y, z, z);
            }

            // Particles
            hue += 0.3 + f.treble * 2;
            const emit = Math.floor(f.level * 40) + (f.beat ? 160 : 0);
            const ox = f.beat ? cx + rand(-w, w) * 0.25 : cx;
            const oy = f.beat ? cy + rand(-h, h) * 0.25 : cy;
            const bh = f.beat ? hue + rand(0, 180) : hue;
            for (let i = 0; i < emit && parts.length < 1800; i++) {
              const a = rand(0, TAU);
              const sp = rand(1, 4) + f.bass * 8;
              parts.push({
                x: ox, y: oy,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: 1, decay: rand(0.008, 0.022),
                hue: bh + rand(-25, 25), size: rand(1, 3.2),
              });
            }
            g.globalCompositeOperation = 'lighter';
            for (let i = parts.length - 1; i >= 0; i--) {
              const p = parts[i];
              p.x += p.vx * k;
              p.y += p.vy * k;
              p.vy += 0.03 * k;
              p.vx *= 0.99;
              p.vy *= 0.99;
              p.life -= p.decay * k;
              if (p.life <= 0) {
                parts[i] = parts[parts.length - 1];
                parts.pop();
                continue;
              }
              g.fillStyle = hsl(p.hue, 100, 60, p.life);
              g.beginPath();
              g.arc(p.x, p.y, p.size * (0.5 + p.life), 0, TAU);
              g.fill();
            }
            g.globalCompositeOperation = 'source-over';
          },
        };
      },
    },

    /* 5 — Slow, dreamy Lissajous ribbons. */
    {
      name: 'Ambient Swirl',
      create() {
        let t = rand(0, 100);
        const seeds = Array.from({ length: 5 }, () => ({
          fx: rand(1, 3.5), fy: rand(1, 3.5), ph: rand(0, TAU), hue: rand(0, 360),
        }));
        return {
          draw(g, f, { w, h, dt }) {
            g.fillStyle = 'rgba(4,0,12,0.08)';
            g.fillRect(0, 0, w, h);
            t += dt * 0.00025 * (1 + f.mid * 3);
            const cx = w / 2;
            const cy = h / 2;
            const sc = Math.min(w, h) * (0.32 + f.bass * 0.12);
            g.globalCompositeOperation = 'lighter';
            g.lineWidth = 1.5 + f.level * 4;
            for (const s of seeds) {
              s.hue += 0.15 + f.beatPulse;
              g.strokeStyle = hsl(s.hue, 85, 55, 0.35);
              g.beginPath();
              for (let i = 0; i <= 160; i++) {
                const u = t + i * 0.012;
                const x = cx + Math.sin(u * s.fx + s.ph) * sc * (1 + 0.3 * Math.sin(u * 0.7)) * (w / h > 1 ? 1.4 : 1);
                const y = cy + Math.sin(u * s.fy) * sc * (1 + 0.2 * Math.cos(u * 1.3 + s.ph));
                i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
              }
              g.stroke();
            }
            g.globalCompositeOperation = 'source-over';
          },
        };
      },
    },

    /* 6 — Mirrored radial spectrum. */
    {
      name: 'Kaleidoscope',
      create() {
        let spin = 0;
        let hue = rand(0, 360);
        const segments = 8;
        return {
          draw(g, f, { w, h, dt }) {
            g.fillStyle = 'rgba(0,0,0,0.3)';
            g.fillRect(0, 0, w, h);
            spin += dt * 0.0002 + f.beatPulse * 0.02;
            hue += 0.5;
            const cx = w / 2;
            const cy = h / 2;
            const R = Math.hypot(cx, cy) * 0.95;
            const n = 48;
            const bands = f.bands(n, 40, 12000);
            const wedge = TAU / segments;
            g.globalCompositeOperation = 'lighter';
            for (let s = 0; s < segments; s++) {
              g.save();
              g.translate(cx, cy);
              g.rotate(spin + s * wedge);
              if (s % 2) g.scale(1, -1);
              g.beginPath();
              g.moveTo(0, 0);
              for (let i = 0; i < n; i++) {
                const r = (i / n) * R;
                const a = bands[i] * wedge * 0.95;
                g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
              }
              g.lineTo(R, 0);
              g.closePath();
              const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
              gr.addColorStop(0, hsl(hue, 100, 65, 0.45));
              gr.addColorStop(0.5, hsl(hue + 60, 90, 50, 0.3));
              gr.addColorStop(1, hsl(hue + 140, 90, 40, 0));
              g.fillStyle = gr;
              g.fill();
              g.restore();
            }
            g.globalCompositeOperation = 'source-over';
          },
        };
      },
    },

    /* 7 — Circular spectrum halo around a pulsing core. */
    {
      name: 'Halo',
      create() {
        let hue = rand(0, 360);
        let spin = 0;
        let smooth = null;
        return {
          draw(g, f, { w, h, dt }) {
            const cx = w / 2;
            const cy = h / 2;
            const m = Math.min(w, h);
            const bg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(cx, cy));
            bg.addColorStop(0, hsl(hue + 200, 60, 8 + f.beatPulse * 10));
            bg.addColorStop(1, '#000');
            g.fillStyle = bg;
            g.fillRect(0, 0, w, h);
            hue += 0.25;
            spin += dt * 0.00012;

            const n = 96;
            const bands = f.bands(n / 2, 40, 14000);
            if (!smooth) smooth = new Float32Array(n);
            const base = m * (0.17 + f.bass * 0.08);
            g.lineCap = 'round';
            g.lineWidth = Math.max(2, (TAU * base) / n * 0.55);
            for (let i = 0; i < n; i++) {
              const bi = i < n / 2 ? i : n - 1 - i; // mirror
              smooth[i] = lerp(smooth[i], bands[bi], 0.45);
              const a = spin + (i / n) * TAU - Math.PI / 2;
              const len = smooth[i] * m * 0.3 + 2;
              g.strokeStyle = hsl(hue + (i / n) * 360, 95, 60);
              g.beginPath();
              g.moveTo(cx + Math.cos(a) * base, cy + Math.sin(a) * base);
              g.lineTo(cx + Math.cos(a) * (base + len), cy + Math.sin(a) * (base + len));
              g.stroke();
            }
            // Inner waveform ring
            g.strokeStyle = 'rgba(255,255,255,0.75)';
            g.lineWidth = 2;
            g.beginPath();
            for (let i = 0; i <= 180; i++) {
              const a = (i / 180) * TAU;
              const v = (f.wave[Math.floor((i / 180) * (f.wave.length - 1))] - 128) / 128;
              const r = base * (0.78 + v * 0.35);
              const x = cx + Math.cos(a) * r;
              const y = cy + Math.sin(a) * r;
              i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
            }
            g.closePath();
            g.stroke();
            g.lineCap = 'butt';
          },
        };
      },
    },

    /* 8 — Scrolling 3D spectrum terrain. */
    {
      name: 'Terrain',
      create() {
        const rows = [];
        const ROWS = 42;
        let hue = rand(0, 360);
        let acc = 0;
        return {
          draw(g, f, { w, h, dt }) {
            g.fillStyle = '#03010a';
            g.fillRect(0, 0, w, h);
            hue += 0.2;
            acc += dt;
            if (acc > 40 || rows.length === 0) {
              acc = 0;
              rows.unshift(f.bands(64, 40, 12000));
              if (rows.length > ROWS) rows.pop();
            }
            const horizon = h * 0.22;
            for (let r = rows.length - 1; r >= 0; r--) {
              const d = r / ROWS; // 0 = nearest
              const persp = 1 - d * 0.75;
              const y0 = lerp(h * 0.98, horizon, Math.pow(d, 0.7));
              const width = w * persp * 1.1;
              const x0 = (w - width) / 2;
              const amp = h * 0.35 * persp;
              const row = rows[r];
              g.beginPath();
              g.moveTo(x0, y0);
              for (let i = 0; i < row.length; i++) {
                const x = x0 + (i / (row.length - 1)) * width;
                g.lineTo(x, y0 - row[i] * amp);
              }
              g.lineTo(x0 + width, y0);
              g.closePath();
              g.fillStyle = '#03010a';
              g.fill();
              g.strokeStyle = hsl(hue + d * 140, 95, 60, 1 - d * 0.85);
              g.lineWidth = 1.5 * persp + 0.5;
              g.stroke();
            }
          },
        };
      },
    },
  ];

  /* ------------------------------------------------------------------ */
  /* Engine                                                             */
  /* ------------------------------------------------------------------ */

  class VisualizerEngine {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.g = canvas.getContext('2d');
      this.features = new AudioFeatures();
      this.index = clamp(opts.preset | 0, 0, PRESETS.length - 1);
      this.autoCycle = opts.autoCycle !== false;
      this.cycleSeconds = opts.cycleSeconds || 30;
      this.onPresetChange = opts.onPresetChange || null;
      this.running = false;
      this._raf = 0;
      this._last = 0;
      this._since = 0;
      this._loop = this._loop.bind(this);
      this._instantiate();
    }

    static get presetNames() {
      return PRESETS.map((p) => p.name);
    }

    get presetName() {
      return PRESETS[this.index].name;
    }

    setAnalyser(analyser) {
      this.features.setAnalyser(analyser);
    }

    setPreset(i) {
      this.index = ((i % PRESETS.length) + PRESETS.length) % PRESETS.length;
      this._instantiate();
      if (this.onPresetChange) this.onPresetChange(this.index, this.presetName);
    }
    next() { this.setPreset(this.index + 1); }
    prev() { this.setPreset(this.index - 1); }
    random() {
      let i = this.index;
      while (PRESETS.length > 1 && i === this.index) i = Math.floor(Math.random() * PRESETS.length);
      this.setPreset(i);
    }

    _instantiate() {
      this.preset = PRESETS[this.index].create();
      this._since = 0;
      // Clear so trail-based presets start fresh.
      const { width, height } = this.canvas;
      this.g.setTransform(1, 0, 0, 1, 0, 0);
      this.g.fillStyle = '#000';
      this.g.fillRect(0, 0, width, height);
    }

    _resize() {
      const c = this.canvas;
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const w = Math.max(1, c.clientWidth);
      const h = Math.max(1, c.clientHeight);
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (c.width !== pw || c.height !== ph) {
        c.width = pw;
        c.height = ph;
        this.g.fillStyle = '#000';
        this.g.fillRect(0, 0, pw, ph);
      }
      return { w, h, dpr };
    }

    start() {
      if (this.running) return;
      this.running = true;
      this._last = performance.now();
      this._raf = requestAnimationFrame(this._loop);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this._raf);
    }

    _loop(now) {
      if (!this.running) return;
      this._raf = requestAnimationFrame(this._loop);
      const dt = Math.min(100, now - this._last);
      this._last = now;

      const { w, h, dpr } = this._resize();
      if (w < 2 || h < 2) return;
      this.features.update(now);

      if (this.autoCycle) {
        this._since += dt;
        if (this._since > this.cycleSeconds * 1000) this.random();
      }

      const g = this.g;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      try {
        this.preset.draw(g, this.features, { w, h, t: now, dt, dpr, canvas: this.canvas });
      } catch (err) {
        console.error('[Retrowave] preset error', err);
        this.next();
        return;
      }

    }
  }

  global.RetrowaveVisualizer = VisualizerEngine;
})(typeof window !== 'undefined' ? window : globalThis);
