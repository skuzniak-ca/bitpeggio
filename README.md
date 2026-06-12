# Bitpeggio

Bitpeggio is a locally-running chiptune synthesizer keyboard that runs in the browser. It has two modes you switch between with a tab: an 8-bit (NES) mode and a 16-bit (SNES) mode. You play it with your computer keyboard or by clicking the on-screen keys. It is built with plain HTML, CSS, and JavaScript on the Web Audio API, with no build step, no dependencies, and no network access.

## How It Works

1. Pick an era with the **8-BIT / 16-BIT** tab. Only the active mode makes sound; the other one is paused.
2. Play notes with your computer keyboard (`A S D F` are white keys, `W E T Y U` are black keys) or by clicking the on-screen keyboard.
3. Shape the sound with the controls, or pick a preset patch for an instant sound.
4. Optionally choose a guided song and press play to hear a public-domain tune while its keys light up in time.

## Features

- **Two modes**: an 8-bit (NES) engine and a 16-bit (SNES) engine, switched with a tab. The inactive engine's audio is suspended so only the visible one plays.
- **8-bit sound**: pulse, triangle, sawtooth, and noise waveforms, with an adjustable pulse width (the pulse wave's duty cycle, swept via a band-limited Fourier series since the Web Audio `square` wave is fixed at 50%).
- **16-bit sound**: two detuned oscillators per note for body, a low-pass "warmth" filter, a generated reverb, stereo panning, and a vibrato LFO. No samples; it approximates the SNES character with synthesis.
- **ADSR envelope** in both modes (attack, decay, sustain, release).
- **Polyphony**: hold multiple keys to play chords.
- **Preset patches**: NES Lead, GB Bass, Laser, Coin, and Jump in 8-bit; Strings, Bell, Choir, Marimba, and Brass in 16-bit.
- **Guided songs**: pick a tune (Twinkle Twinkle, Ode to Joy, Mary Had a Little Lamb, Jingle Bells) and the keys light up in time as it plays. The song uses whatever sound you have dialed in.
- **Octave control**, master volume, an oscilloscope, and an in-app legend explaining every control.

## Architecture

- **App shell** (`app.js`): owns the 8-bit/16-bit tab state, shows the active panel, and pauses the inactive engine by suspending its `AudioContext`.
- **8-bit engine** (`synth.js`): each held note is one oscillator (or noise source) into a gain node running the ADSR envelope, summed into a master gain and an `AnalyserNode` for the oscilloscope. Pulse waves are built with `createPeriodicWave` and cached per duty-cycle value.
- **16-bit engine** (`synth16.js`): each note is two detuned oscillators into an ADSR gain and a `StereoPannerNode`, summed onto a bus that runs through a `BiquadFilter` (low-pass warmth) and splits into a dry path plus a `ConvolverNode` reverb whose impulse response is generated procedurally. A shared LFO drives each voice's detune for vibrato.
- **Shared song data** (`songs.js`): the guided-song melodies, used by both engines. Each note is `[semitoneOffset, durationInBeats]`, scheduled with `setTimeout`.

## Tech Stack

Vanilla HTML/CSS/JS · Web Audio API (no framework, no build step, no dependencies)

# Getting Started

## Requirements

- A modern web browser (audio is blocked until you interact, so the first key press also starts the audio engine).

## Usage

Open `index.html` in a browser.

### Controls

| Keys                       | Action                          |
| -------------------------- | ------------------------------- |
| `A S D F G H J K` (+`O L`) | White keys (C D E F G A B C...) |
| `W E T Y U` (+`O`)         | Black keys (sharps/flats)       |
| `Z` / `X`                  | Octave down / up                |
| Mouse / touch              | Click the on-screen keys        |

To add your own guided song, extend the `BITPEGGIO_SONGS` table in `songs.js`; each note is `[semitoneOffset, durationInBeats]` and `-1` is a rest.

## Project Structure

```
bitpeggio/
├── index.html      # Page shell, both mode panels, on-screen layout
├── style.css       # CRT / NES theme, shared by both modes
├── app.js          # Tab shell: owns 8-bit/16-bit state, pauses inactive engine
├── songs.js        # Shared guided-song data (public-domain tunes)
├── synth.js        # 8-bit (NES) engine
├── synth16.js      # 16-bit (SNES) engine
└── README.md
```

## Acknowledgements

Built with assistance from [Claude](https://claude.ai) by Anthropic.
