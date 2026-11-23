/*
 * Retrowave Visualizer: content script for youtube.com and music.youtube.com.
 * Taps the page's <video> element through Web Audio and paints old-school
 * media-player visualizations over the player.
 */
(() => {
  'use strict';
  if (window.__retrowaveLoaded) return;
  window.__retrowaveLoaded = true;

  const IS_MUSIC = location.hostname === 'music.youtube.com';
  const DEFAULTS = {
    autoStart: 'music', // 'off' | 'music' | 'all'
    autoCycle: true,
    cycleSeconds: 30,
    preset: 0,
    mode: 'cover', // 'cover' hides the video, 'blend' mixes over it
    blendOpacity: 0.7,
  };
  let settings = { ...DEFAULTS };

  let audioCtx = null;
  let analyser = null;
  const tapped = new WeakSet();
  let overlay = null;
  let canvas = null;
  let titleEl = null;
  let hintEl = null;
  let engine = null;
  let visible = false;
  let dismissedFor = null; // video URL the user closed the visualizer on
  let hudTimer = 0;
  let titleTimer = 0;

  /* ---------------- settings ---------------- */

  const storage = chrome.storage && chrome.storage.sync;
  if (storage) {
    storage.get(DEFAULTS, (s) => {
      settings = { ...DEFAULTS, ...s };
      applySettings();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k in changes) settings[k] = changes[k].newValue;
      if (changes.preset && engine && engine.index !== changes.preset.newValue) {
        engine.setPreset(Number(changes.preset.newValue) || 0);
      }
      applySettings();
    });
  }

  function applySettings() {
    if (engine) {
      engine.autoCycle = !!settings.autoCycle;
      engine.cycleSeconds = Math.max(5, Number(settings.cycleSeconds) || 30);
    }
    if (overlay) {
      overlay.classList.toggle('rw-blend', settings.mode === 'blend');
      overlay.style.setProperty('--rw-blend-opacity', String(settings.blendOpacity));
    }
  }

  /* ---------------- DOM helpers (no innerHTML: YouTube enforces Trusted Types) ---------------- */

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function svgIcon(pathD, size = 24) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'currentColor');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', pathD);
    svg.appendChild(p);
    return svg;
  }

  const ICON_BARS = 'M3 20h3V10H3v10zm5 0h3V4H8v16zm5 0h3v-7h-3v7zm5 0h3V8h-3v12z';
  const ICON_PREV = 'M15.5 5 8.5 12l7 7 1.4-1.4L11.3 12l5.6-5.6z';
  const ICON_NEXT = 'M8.5 5 7.1 6.4l5.6 5.6-5.6 5.6L8.5 19l7-7z';
  const ICON_SHUFFLE = 'M10.6 9.2 5.4 4 4 5.4l5.2 5.2 1.4-1.4zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4h-5.5zm.3 9.4-1.4 1.4 3.1 3.1-2 2H20v-5.5l-2 2-3.2-3z';
  const ICON_CLOSE = 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z';

  /* ---------------- page lookups ---------------- */

  function getVideo() {
    return (
      document.querySelector('#movie_player video.html5-main-video') ||
      document.querySelector('ytmusic-player video') ||
      document.querySelector('video')
    );
  }

  function getHost() {
    if (IS_MUSIC) return document.querySelector('ytmusic-player#player') || document.querySelector('ytmusic-player');
    return document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
  }

  /** Best-effort "is this music?" check for youtube.com watch pages. */
  function looksLikeMusic() {
    if (IS_MUSIC) return true;
    const genre = document.querySelector('meta[itemprop="genre"]');
    if (genre && /music/i.test(genre.content || '')) return true;
    const channel = document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner #channel-name a');
    const chName = channel ? channel.textContent.trim() : '';
    if (/ - Topic$/.test(chName) || /vevo/i.test(chName)) return true;
    const desc = document.querySelector('ytd-watch-metadata #description, #description-inline-expander');
    if (desc && /Provided to YouTube by/i.test(desc.textContent || '')) return true;
    const title = document.title || '';
    if (/\b(official (music )?video|official audio|lyrics?|lyric video|remix|feat\.|ft\.)\b/i.test(title)) return true;
    return false;
  }

  /* ---------------- audio ---------------- */

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
  }

  /** Returns true when the analyser is receiving the video's audio. */
  async function connectAudio() {
    const video = getVideo();
    if (!video) return false;
    try {
      if (!audioCtx) {
        audioCtx = new AudioContext();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.78;
        analyser.connect(audioCtx.destination);
      }
      if (audioCtx.state !== 'running') await withTimeout(audioCtx.resume(), 400);
      // Never reroute the video into a suspended context: that would mute it.
      if (audioCtx.state !== 'running') return false;
      if (!tapped.has(video)) {
        const src = audioCtx.createMediaElementSource(video);
        src.connect(analyser);
        tapped.add(video);
      }
      if (engine) engine.setAnalyser(analyser);
      return true;
    } catch (err) {
      console.warn('[Retrowave] could not tap audio:', err);
      return false;
    }
  }

  // If autoplay policy blocked the AudioContext, retry on the next user gesture.
  let gestureArmed = false;
  function armGestureRetry() {
    if (gestureArmed) return;
    gestureArmed = true;
    const retry = async () => {
      if (await connectAudio()) {
        gestureArmed = false;
        window.removeEventListener('pointerdown', retry, true);
        window.removeEventListener('keydown', retry, true);
        setHint(null);
      }
    };
    window.addEventListener('pointerdown', retry, true);
    window.addEventListener('keydown', retry, true);
  }

  /* ---------------- overlay ---------------- */

  function hudButton(icon, label, onClick) {
    const b = el('button', 'rw-btn');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(svgIcon(icon, 20));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onClick();
    });
    return b;
  }

  function buildOverlay() {
    overlay = el('div', 'rw-overlay');
    canvas = el('canvas', 'rw-canvas');
    titleEl = el('div', 'rw-title');
    hintEl = el('div', 'rw-hint');
    const hud = el('div', 'rw-hud');
    hud.append(
      hudButton(ICON_PREV, 'Previous visualization  [', () => engine.prev()),
      hudButton(ICON_SHUFFLE, 'Random visualization', () => engine.random()),
      hudButton(ICON_NEXT, 'Next visualization  ]', () => engine.next()),
      hudButton(ICON_CLOSE, 'Close visualizer  (V)', () => hide(true))
    );
    // Keep clicks on the HUD from pausing the video underneath.
    hud.addEventListener('mousedown', (e) => e.stopPropagation());
    overlay.append(canvas, titleEl, hintEl, hud);

    engine = new window.RetrowaveVisualizer(canvas, {
      preset: settings.preset,
      autoCycle: settings.autoCycle,
      cycleSeconds: settings.cycleSeconds,
      onPresetChange: (i, name) => {
        showTitle(name);
        if (storage) storage.set({ preset: i });
      },
    });
    applySettings();
  }

  function showTitle(name) {
    if (!titleEl) return;
    titleEl.textContent = name;
    titleEl.classList.add('rw-show');
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => titleEl.classList.remove('rw-show'), 2600);
  }

  function setHint(text) {
    if (!hintEl) return;
    hintEl.textContent = text || '';
    hintEl.classList.toggle('rw-show', !!text);
  }

  function pokeHud() {
    if (!overlay) return;
    overlay.classList.add('rw-hud-on');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => overlay && overlay.classList.remove('rw-hud-on'), 2500);
  }

  async function show() {
    const host = getHost();
    if (!host) return;
    if (!overlay) buildOverlay();
    if (overlay.parentElement !== host) host.appendChild(overlay);
    overlay.classList.toggle('rw-music', IS_MUSIC);
    visible = true;
    overlay.classList.add('rw-visible');
    updateToggleButtons();
    engine.start();
    showTitle(engine.presetName);
    pokeHud();
    if (!(await connectAudio())) {
      setHint('Click anywhere on the page to connect the audio');
      armGestureRetry();
    } else {
      setHint(null);
    }
  }

  function hide(byUser) {
    visible = false;
    if (byUser) dismissedFor = location.href;
    if (overlay) overlay.classList.remove('rw-visible');
    if (engine) engine.stop();
    updateToggleButtons();
  }

  function toggle() {
    visible ? hide(true) : (dismissedFor = null, show());
  }

  /* ---------------- player button ---------------- */

  const toggleButtons = new Set();

  function makeToggleButton(cls) {
    const b = el('button', cls);
    b.type = 'button';
    b.title = 'Visualizer (V)';
    b.setAttribute('aria-label', 'Toggle visualizer');
    b.appendChild(svgIcon(ICON_BARS, IS_MUSIC ? 24 : 26));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });
    toggleButtons.add(b);
    return b;
  }

  function updateToggleButtons() {
    for (const b of toggleButtons) b.classList.toggle('rw-active', visible);
  }

  function ensurePlayerButton() {
    if (IS_MUSIC) {
      const bar = document.querySelector('ytmusic-player-bar .right-controls-buttons');
      if (bar && !bar.querySelector('.rw-music-toggle')) {
        bar.prepend(makeToggleButton('rw-music-toggle'));
      }
    } else {
      const controls = document.querySelector('#movie_player .ytp-right-controls');
      if (controls && !controls.querySelector('.rw-ytp-toggle')) {
        controls.prepend(makeToggleButton('ytp-button rw-ytp-toggle'));
      }
    }
    updateToggleButtons();
  }

  /* ---------------- auto start ---------------- */

  function shouldAutoStart() {
    if (settings.autoStart === 'all') return true;
    if (settings.autoStart === 'music') return looksLikeMusic();
    return false;
  }

  function onPlay() {
    if (visible || dismissedFor === location.href) return;
    // Give the watch-page metadata a moment to render before classifying.
    setTimeout(() => {
      const v = getVideo();
      if (!visible && v && !v.paused && shouldAutoStart()) show();
    }, IS_MUSIC ? 0 : 1200);
  }

  const watchedVideos = new WeakSet();
  function watchVideo() {
    const v = getVideo();
    if (!v || watchedVideos.has(v)) return;
    watchedVideos.add(v);
    v.addEventListener('play', onPlay);
    if (!v.paused) onPlay();
  }

  /* ---------------- wiring ---------------- */

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'v' || e.key === 'V') {
        toggle();
      } else if (visible && e.key === ']') {
        engine.next();
      } else if (visible && e.key === '[') {
        engine.prev();
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );

  document.addEventListener('mousemove', (e) => {
    if (!visible) return;
    const host = getHost();
    if (host && host.contains(e.target)) pokeHud();
  });

  // YouTube is a single-page app: re-check the player after navigation.
  document.addEventListener('yt-navigate-finish', () => {
    if (visible) {
      const host = getHost();
      if (host && overlay && overlay.parentElement !== host) host.appendChild(overlay);
      connectAudio();
    }
    if (dismissedFor && dismissedFor !== location.href) dismissedFor = null;
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === 'retrowave:toggle') {
      toggle();
      reply({ visible });
    } else if (msg && msg.type === 'retrowave:status') {
      reply({ visible, preset: engine ? engine.presetName : null });
    }
  });

  setInterval(() => {
    ensurePlayerButton();
    watchVideo();
    // Re-attach if YouTube rebuilt the player element.
    if (visible && overlay) {
      const host = getHost();
      if (host && overlay.parentElement !== host) host.appendChild(overlay);
    }
  }, 1000);
  ensurePlayerButton();
  watchVideo();
})();
