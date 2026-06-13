/* CHIPPEGGIO - 16-bit (SNES-style) engine. Warm-synth emulation of the SNES vibe:
   two detuned oscillators per voice for chorus-y body, a global low-pass filter
   for warmth, a procedurally generated reverb, stereo panning, and a vibrato
   LFO. Web Audio only, no samples, no dependencies. */

(() => {
  "use strict";

  // ---- Audio graph (built lazily on first gesture) -----------------------
  let ac = null;
  let master = null, analyser = null;
  let bus = null, lowpass = null;        // voices -> bus -> lowpass
  let convolver = null, wetGain = null, dryGain = null; // reverb send
  let lfo = null, lfoGain = null;        // shared vibrato

  const state = {
    tone: "sawtooth",
    detune: 12,     // cents between the two stacked oscillators
    cutoff: 4500,   // low-pass frequency (warmth)
    reverb: 0.35,   // wet amount
    vibrato: 6,     // cents of pitch wobble
    attack: 0.04, decay: 0.2, sustain: 0.75, release: 0.5,
    octave: 4,
  };

  const voices = new Map();

  // Same key layout as the 8-bit engine.
  const KEY_MAP = {
    a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6,
    g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14,
  };
  const BLACK = new Set([1, 3, 6, 8, 10, 13]);

  const $ = (id) => document.getElementById(id);

  // ---- Reverb impulse response (decaying stereo noise) -------------------
  function makeImpulse(seconds, decay) {
    const rate = ac.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ac.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function initAudio() {
    if (ac) return;
    ac = new (window.AudioContext || window.webkitAudioContext)();

    master = ac.createGain();
    master.gain.value = parseFloat($("volume16").value);
    analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    master.connect(analyser);
    analyser.connect(ac.destination);

    lowpass = ac.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = state.cutoff;
    lowpass.Q.value = 0.7;

    bus = ac.createGain();
    bus.connect(lowpass);

    // Dry path.
    dryGain = ac.createGain();
    dryGain.gain.value = 1;
    lowpass.connect(dryGain).connect(master);

    // Wet (reverb) path.
    convolver = ac.createConvolver();
    convolver.buffer = makeImpulse(2.6, 2.2);
    wetGain = ac.createGain();
    wetGain.gain.value = state.reverb;
    lowpass.connect(convolver).connect(wetGain).connect(master);

    // Shared vibrato LFO -> each voice's oscillator detune.
    lfo = ac.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 5.2;
    lfoGain = ac.createGain();
    lfoGain.gain.value = state.vibrato;
    lfo.connect(lfoGain);
    lfo.start();

    drawScope();
  }

  function freqFor(semitoneOffset) {
    const midi = 12 * (state.octave + 1) + semitoneOffset;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // ---- Voice lifecycle ---------------------------------------------------
  function noteOn(id, offset) {
    initAudio();
    if (ac.state === "suspended") ac.resume();
    if (voices.has(id)) return;

    const t = ac.currentTime;
    const freq = freqFor(offset);

    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);

    const pan = ac.createStereoPanner();
    pan.pan.value = Math.max(-0.5, Math.min(0.5, (offset - 7) / 14));

    // Two detuned oscillators = fat, chorus-y 16-bit body.
    const oscs = [];
    [-1, 1].forEach((dir) => {
      const o = ac.createOscillator();
      o.type = state.tone;
      o.frequency.value = freq;
      o.detune.value = dir * state.detune;
      lfoGain.connect(o.detune); // vibrato
      o.connect(g);
      o.start(t);
      oscs.push(o);
    });

    g.connect(pan).connect(bus);

    const peak = 0.42; // two oscillators sum, so keep headroom
    g.gain.linearRampToValueAtTime(peak, t + state.attack);
    g.gain.linearRampToValueAtTime(peak * state.sustain, t + state.attack + state.decay);

    voices.set(id, { oscs, g, pan, offset });
    paintKey(offset, true);
  }

  function noteOff(id) {
    const v = voices.get(id);
    if (!v) return;
    const t = ac.currentTime;
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setValueAtTime(v.g.gain.value, t);
    v.g.gain.linearRampToValueAtTime(0, t + state.release);
    const stopAt = t + state.release + 0.05;
    v.oscs.forEach((o) => {
      try { lfoGain.disconnect(o.detune); } catch (e) { /* already gone */ }
      o.stop(stopAt);
    });
    voices.delete(id);
    paintKey(v.offset, false);
  }

  // ---- Controls ----------------------------------------------------------
  $("volume16").addEventListener("input", (e) => {
    if (master) master.gain.value = parseFloat(e.target.value);
  });

  function bindSlider(id, valId, key, fmt, live) {
    const el = $(id), out = $(valId);
    el.addEventListener("input", () => {
      state[key] = parseFloat(el.value);
      out.textContent = fmt(state[key]);
      if (live) live(state[key]);
    });
    out.textContent = fmt(state[key]);
  }
  bindSlider("detune", "detuneVal", "detune", (v) => v + "¢");
  bindSlider("cutoff", "cutoffVal", "cutoff", (v) => Math.round(v) + " HZ",
    (v) => { if (lowpass) lowpass.frequency.setTargetAtTime(v, ac.currentTime, 0.02); });
  bindSlider("reverb", "reverbVal", "reverb", (v) => Math.round(v * 100) + "%",
    (v) => { if (wetGain) wetGain.gain.setTargetAtTime(v, ac.currentTime, 0.02); });
  bindSlider("vibrato", "vibratoVal", "vibrato", (v) => v + "¢",
    (v) => { if (lfoGain) lfoGain.gain.setTargetAtTime(v, ac.currentTime, 0.02); });

  ["attack", "decay", "sustain", "release"].forEach((p) => {
    $(p + "16").addEventListener("input", (e) => (state[p] = parseFloat(e.target.value)));
  });

  // Tone buttons
  document.querySelectorAll("#wave16Buttons .wave-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#wave16Buttons .wave-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.tone = btn.dataset.wave;
    });
  });

  // Octave
  const octVal = $("octVal16");
  $("octDown16").addEventListener("click", () => setOctave(state.octave - 1));
  $("octUp16").addEventListener("click", () => setOctave(state.octave + 1));
  function setOctave(o) {
    state.octave = Math.max(0, Math.min(8, o));
    octVal.textContent = state.octave;
  }

  // ---- Presets -----------------------------------------------------------
  const PRESETS = {
    strings: { tone: "sawtooth", detune: 14, cutoff: 3500, reverb: 0.4,  vibrato: 8,  attack: 0.15, decay: 0.3,  sustain: 0.85, release: 0.7 },
    bell:    { tone: "triangle", detune: 6,  cutoff: 9000, reverb: 0.5,  vibrato: 0,  attack: 0.0,  decay: 0.6,  sustain: 0.2,  release: 0.9 },
    choir:   { tone: "triangle", detune: 18, cutoff: 2600, reverb: 0.6,  vibrato: 10, attack: 0.25, decay: 0.4,  sustain: 0.9,  release: 1.0 },
    marimba: { tone: "triangle", detune: 4,  cutoff: 7000, reverb: 0.25, vibrato: 0,  attack: 0.0,  decay: 0.25, sustain: 0.0,  release: 0.25 },
    brass:   { tone: "sawtooth", detune: 10, cutoff: 5000, reverb: 0.3,  vibrato: 7,  attack: 0.05, decay: 0.2,  sustain: 0.8,  release: 0.4 },
  };
  document.querySelectorAll("#preset16Buttons button").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });
  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.assign(state, p);
    // Reflect into the UI + live audio nodes.
    $("detune").value = p.detune;   $("detuneVal").textContent = p.detune + "¢";
    $("cutoff").value = p.cutoff;   $("cutoffVal").textContent = Math.round(p.cutoff) + " HZ";
    $("reverb").value = p.reverb;   $("reverbVal").textContent = Math.round(p.reverb * 100) + "%";
    $("vibrato").value = p.vibrato; $("vibratoVal").textContent = p.vibrato + "¢";
    ["attack", "decay", "sustain", "release"].forEach((k) => ($(k + "16").value = p[k]));
    document.querySelectorAll("#wave16Buttons .wave-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.wave === p.tone)
    );
    if (lowpass) lowpass.frequency.setTargetAtTime(p.cutoff, ac.currentTime, 0.02);
    if (wetGain) wetGain.gain.setTargetAtTime(p.reverb, ac.currentTime, 0.02);
    if (lfoGain) lfoGain.gain.setTargetAtTime(p.vibrato, ac.currentTime, 0.02);
  }

  // ---- On-screen keyboard ------------------------------------------------
  const keyboardEl = $("keyboard16");
  const keyEls = new Map();
  function buildKeyboard() {
    Object.entries(KEY_MAP).forEach(([kbKey, offset]) => {
      const el = document.createElement("div");
      el.className = "key " + (BLACK.has(offset) ? "black" : "white");
      el.textContent = kbKey.toUpperCase();
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

  // ---- Computer keyboard (only when 16-bit tab is active) ----------------
  window.addEventListener("keydown", (e) => {
    if (e.repeat || window.CHIPPEGGIO.get() !== "16bit") return;
    const k = e.key.toLowerCase();
    if (k === "z") return setOctave(state.octave - 1);
    if (k === "x") return setOctave(state.octave + 1);
    if (k in KEY_MAP) { e.preventDefault(); noteOn("k" + k, KEY_MAP[k]); }
  });
  window.addEventListener("keyup", (e) => {
    if (window.CHIPPEGGIO.get() !== "16bit") return;
    const k = e.key.toLowerCase();
    if (k in KEY_MAP) noteOff("k" + k);
  });

  // ---- Guided songs (shared data) ----------------------------------------
  const SONGS = window.CHIPPEGGIO_SONGS;
  const player = { timers: [], active: new Set(), playing: false };
  const playBtn = $("playSong16");
  const songSelect = $("songSelect16");

  function playSong(name) {
    stopSong();
    initAudio();
    if (ac.state === "suspended") ac.resume();
    const song = SONGS[name];
    if (!song) return;
    setOctave(song.octave);
    const beat = 60 / song.tempo;
    let t = 0.3;
    song.notes.forEach((n, i) => {
      const [offset, beats] = n;
      const dur = beats * beat;
      if (offset >= 0) {
        const id = "song-" + i;
        player.timers.push(setTimeout(() => { noteOn(id, offset); player.active.add(id); }, t * 1000));
        player.timers.push(setTimeout(() => { noteOff(id); player.active.delete(id); }, (t + dur * 0.92) * 1000));
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
  songSelect.addEventListener("change", () => { if (player.playing) playSong(songSelect.value); });

  // ---- Oscilloscope ------------------------------------------------------
  function drawScope() {
    const canvas = $("scope16");
    const ctx = canvas.getContext("2d");
    const buf = new Uint8Array(analyser.fftSize);
    function frame() {
      requestAnimationFrame(frame);
      analyser.getByteTimeDomainData(buf);
      ctx.fillStyle = "#0a0a1e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#6fa8ff";
      ctx.shadowColor = "#6fa8ff";
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

  window.CHIPPEGGIO.register("16bit", {
    deactivate: () => { stopSong(); if (ac) ac.suspend(); },
    activate: () => { if (ac) ac.resume(); },
  });
})();
