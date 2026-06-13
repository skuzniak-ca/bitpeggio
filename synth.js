/* CHIPPEGGIO - 8-bit synth keyboard engine. Web Audio API, no dependencies. */

(() => {
  "use strict";

  // ---- Audio graph -------------------------------------------------------
  // Created lazily on first user gesture (browsers block autoplay).
  let ac = null;
  let master = null;   // master gain
  let analyser = null; // for the oscilloscope

  function initAudio() {
    if (ac) return;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = parseFloat(volume.value);
    analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    master.connect(analyser);
    analyser.connect(ac.destination);
    drawScope();
  }

  // ---- State -------------------------------------------------------------
  const state = {
    wave: "pulse",
    pulseWidth: 0.5,
    attack: 0.01,
    decay: 0.12,
    sustain: 0.6,
    release: 0.2,
    octave: 4,
  };

  // One active "voice" per held key/note id, so we can release it cleanly.
  const voices = new Map();

  // Semitone offset from C for each computer key.
  const KEY_MAP = {
    a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6,
    g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14,
  };
  // Which semitone offsets are black keys (for on-screen layout/coloring).
  const BLACK = new Set([1, 3, 6, 8, 10, 13]);

  // ---- Pulse wave with adjustable duty cycle -----------------------------
  // Web Audio's built-in "square" is fixed 50%. We synthesize a band-limited
  // pulse via a Fourier series so the duty cycle (that classic NES timbre)
  // can be swept. Cached per duty value to avoid rebuilding every note.
  const pulseCache = new Map();
  function pulseWave(duty) {
    const key = duty.toFixed(2);
    if (pulseCache.has(key)) return pulseCache.get(key);
    const n = 32; // harmonics
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    for (let i = 1; i <= n; i++) {
      // Cosine coefficients of a rectangular pulse, DC removed.
      real[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
    }
    const w = ac.createPeriodicWave(real, imag, { disableNormalization: false });
    pulseCache.set(key, w);
    return w;
  }

  // White-noise buffer (built once), used for the NOISE waveform.
  let noiseBuffer = null;
  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const len = ac.sampleRate * 1.5;
    noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  // ---- Note frequency ----------------------------------------------------
  function freqFor(semitoneOffset) {
    // MIDI note: C of current octave = 12 * (octave + 1).
    const midi = 12 * (state.octave + 1) + semitoneOffset;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // ---- Voice lifecycle ---------------------------------------------------
  function noteOn(id, semitoneOffset) {
    initAudio();
    if (ac.state === "suspended") ac.resume();
    if (voices.has(id)) return; // already sounding

    const t = ac.currentTime;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t);

    let source;
    if (state.wave === "noise") {
      source = ac.createBufferSource();
      source.buffer = getNoiseBuffer();
      source.loop = true;
      // Pitch the noise a little by playback rate so keys still feel tonal.
      source.playbackRate.value = freqFor(semitoneOffset) / 220;
    } else {
      source = ac.createOscillator();
      if (state.wave === "pulse") {
        source.setPeriodicWave(pulseWave(state.pulseWidth));
      } else {
        source.type = state.wave; // "triangle" | "sawtooth"
      }
      source.frequency.value = freqFor(semitoneOffset);
    }

    // ADSR attack -> decay -> sustain.
    const peak = 0.9;
    gain.gain.linearRampToValueAtTime(peak, t + state.attack);
    gain.gain.linearRampToValueAtTime(
      peak * state.sustain,
      t + state.attack + state.decay
    );

    source.connect(gain).connect(master);
    source.start(t);
    voices.set(id, { source, gain, offset: semitoneOffset });
    paintKey(semitoneOffset, true);
  }

  function noteOff(id) {
    const v = voices.get(id);
    if (!v) return;
    const t = ac.currentTime;
    // Release ramp, then stop and disconnect.
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + state.release);
    v.source.stop(t + state.release + 0.02);
    voices.delete(id);
    paintKey(v.offset, false);
  }

  // ---- DOM: controls -----------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const volume = $("volume");
  const pulseWidth = $("pulseWidth");
  const pulseWidthVal = $("pulseWidthVal");
  const octVal = $("octVal");

  volume.addEventListener("input", () => {
    if (master) master.gain.value = parseFloat(volume.value);
  });
  pulseWidth.addEventListener("input", () => {
    state.pulseWidth = parseFloat(pulseWidth.value);
    pulseWidthVal.textContent = Math.round(state.pulseWidth * 100) + "%";
  });
  ["attack", "decay", "sustain", "release"].forEach((p) => {
    $(p).addEventListener("input", (e) => (state[p] = parseFloat(e.target.value)));
  });

  // Waveform buttons
  document.querySelectorAll(".wave-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".wave-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.wave = btn.dataset.wave;
    });
  });

  // Octave buttons
  $("octDown").addEventListener("click", () => setOctave(state.octave - 1));
  $("octUp").addEventListener("click", () => setOctave(state.octave + 1));
  function setOctave(o) {
    state.octave = Math.max(0, Math.min(8, o));
    octVal.textContent = state.octave;
  }

  // ---- Presets -----------------------------------------------------------
  const PRESETS = {
    lead:  { wave: "pulse", pulseWidth: 0.5,  attack: 0.01, decay: 0.1,  sustain: 0.7, release: 0.18 },
    bass:  { wave: "triangle", pulseWidth: 0.5, attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.25 },
    laser: { wave: "sawtooth", pulseWidth: 0.5, attack: 0.0, decay: 0.3, sustain: 0.0, release: 0.1 },
    coin:  { wave: "pulse", pulseWidth: 0.25, attack: 0.0, decay: 0.08, sustain: 0.4, release: 0.08 },
    jump:  { wave: "pulse", pulseWidth: 0.12, attack: 0.0, decay: 0.15, sustain: 0.3, release: 0.12 },
  };
  document.querySelectorAll("#presetButtons button").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });
  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.assign(state, p);
    // Reflect into the UI.
    pulseWidth.value = p.pulseWidth;
    pulseWidthVal.textContent = Math.round(p.pulseWidth * 100) + "%";
    ["attack", "decay", "sustain", "release"].forEach((k) => ($(k).value = p[k]));
    document.querySelectorAll(".wave-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.wave === p.wave)
    );
  }

  // ---- On-screen keyboard ------------------------------------------------
  const keyboardEl = $("keyboard");
  const keyEls = new Map(); // semitone offset -> element
  function buildKeyboard() {
    // Build white keys as flex children; black keys positioned between them.
    const entries = Object.entries(KEY_MAP); // preserves insertion order
    entries.forEach(([kbKey, offset]) => {
      const el = document.createElement("div");
      el.className = "key " + (BLACK.has(offset) ? "black" : "white");
      el.textContent = kbKey.toUpperCase();
      el.dataset.offset = offset;
      const id = "m" + offset;
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); noteOn(id, offset); });
      el.addEventListener("pointerup", () => noteOff(id));
      el.addEventListener("pointerleave", () => noteOff(id));
      keyboardEl.appendChild(el);
      keyEls.set(offset, el);
    });
  }
  function paintKey(offset, held) {
    const el = keyEls.get(offset);
    if (el) el.classList.toggle("held", held);
  }

  // ---- Computer keyboard -------------------------------------------------
  window.addEventListener("keydown", (e) => {
    if (e.repeat || window.CHIPPEGGIO.get() !== "8bit") return;
    const k = e.key.toLowerCase();
    if (k === "z") return setOctave(state.octave - 1);
    if (k === "x") return setOctave(state.octave + 1);
    if (k in KEY_MAP) {
      e.preventDefault();
      noteOn("k" + k, KEY_MAP[k]);
    }
  });
  window.addEventListener("keyup", (e) => {
    if (window.CHIPPEGGIO.get() !== "8bit") return;
    const k = e.key.toLowerCase();
    if (k in KEY_MAP) noteOff("k" + k);
  });

  // ---- Guided songs ------------------------------------------------------
  // Shared public-domain melodies (see songs.js), used by both engines.
  const SONGS = window.CHIPPEGGIO_SONGS;

  // Auto-play scheduler. Reuses noteOn/noteOff, so each note both sounds and
  // lights its key. Visual+audio timing is driven off setTimeout - plenty
  // accurate for a melody, and it keeps the engine simple.
  const player = { timers: [], active: new Set(), playing: false };
  const playBtn = $("playSong");
  const songSelect = $("songSelect");

  function playSong(name) {
    stopSong();
    initAudio();
    if (ac.state === "suspended") ac.resume();
    const song = SONGS[name];
    if (!song) return;
    setOctave(song.octave); // keep pitch consistent with the demo
    const beat = 60 / song.tempo; // seconds per beat
    let t = 0.3; // small lead-in
    song.notes.forEach((n, i) => {
      const [offset, beats] = n;
      const dur = beats * beat;
      if (offset >= 0) {
        const id = "song-" + i;
        player.timers.push(setTimeout(() => {
          noteOn(id, offset);
          player.active.add(id);
        }, t * 1000));
        player.timers.push(setTimeout(() => {
          noteOff(id);
          player.active.delete(id);
        }, (t + dur * 0.92) * 1000)); // tiny gap so repeats retrigger
      }
      t += dur;
    });
    player.timers.push(setTimeout(stopSong, t * 1000 + 300));
    player.playing = true;
    playBtn.textContent = "■ STOP";
    playBtn.classList.add("playing");
  }

  function stopSong() {
    player.timers.forEach(clearTimeout);
    player.timers = [];
    player.active.forEach((id) => noteOff(id));
    player.active.clear();
    player.playing = false;
    playBtn.textContent = "▶ PLAY";
    playBtn.classList.remove("playing");
  }

  playBtn.addEventListener("click", () => {
    if (player.playing) stopSong();
    else playSong(songSelect.value);
  });
  // Switching songs mid-play restarts with the new pick.
  songSelect.addEventListener("change", () => {
    if (player.playing) playSong(songSelect.value);
  });

  // ---- Oscilloscope ------------------------------------------------------
  function drawScope() {
    const canvas = $("scope");
    const ctx = canvas.getContext("2d");
    const buf = new Uint8Array(analyser.fftSize);
    function frame() {
      requestAnimationFrame(frame);
      analyser.getByteTimeDomainData(buf);
      ctx.fillStyle = "#04140a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#2fbf4f";
      ctx.shadowColor = "#2fbf4f";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      const slice = canvas.width / buf.length;
      for (let i = 0; i < buf.length; i++) {
        const y = (buf[i] / 128) * (canvas.height / 2);
        const x = i * slice;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    frame();
  }

  // ---- Boot --------------------------------------------------------------
  buildKeyboard();
  setOctave(state.octave);
  pulseWidthVal.textContent = Math.round(state.pulseWidth * 100) + "%";

  // Pause this engine (stop songs + suspend audio) when its tab isn't showing.
  window.CHIPPEGGIO.register("8bit", {
    deactivate: () => { stopSong(); if (ac) ac.suspend(); },
    activate: () => { if (ac) ac.resume(); },
  });
})();
