/* BITPEGGIO - app shell. Owns the 8-BIT / 16-BIT tab state and lets each engine
   register itself so it can be paused when its tab isn't showing. */

window.BITPEGGIO = (() => {
  "use strict";
  const engines = {};
  let mode = "8bit";

  // Each engine registers { activate, deactivate } so the shell can suspend the
  // inactive one (stop its songs, suspend its AudioContext) on tab switch.
  function register(name, api) { engines[name] = api || {}; }
  function get() { return mode; }

  function switchTo(name) {
    if (name === mode || !engines[name]) return;
    if (engines[mode] && engines[mode].deactivate) engines[mode].deactivate();
    mode = name;

    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.mode === name)
    );
    document.querySelectorAll(".mode-panel").forEach((p) =>
      p.classList.toggle("hidden", p.dataset.mode !== name)
    );
    const sub = document.getElementById("subtitle");
    if (sub) sub.textContent = name === "16bit" ? "16-BIT SYNTH KEYBOARD" : "8-BIT SYNTH KEYBOARD";

    if (engines[name].activate) engines[name].activate();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => switchTo(t.dataset.mode))
    );
  });

  return { register, get, switchTo };
})();
