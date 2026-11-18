// Sound, synthesized live with WebAudio — no audio files, no network, everything
// original. A low engine hum that follows the car's speed, a two-tone police siren,
// and short effects: gunshot, crash, pickup, mission jingle, bust sting. A tiny
// bass-and-hat groove loops under play. Created lazily on the first user gesture
// (browsers block audio before one) and silent until then; M toggles mute.

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let musicTimer = null;
  let muted = false;
  let musicStep = 0;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      // Engine: a sawtooth whose pitch follows speed, kept very quiet.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 50;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      // Siren: a triangle alternating two tones.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 660;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      startMusic();
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  function tone(freq, dur, type, vol, when = 0, slideTo = null) {
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(dur, vol, filterFreq, when = 0) {
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  // A simple original groove: root notes on a bass square wave, hats as noise ticks.
  // 8 steps a bar at 112 bpm; the root walks a little funk line in A minor.
  const BASS_LINE = [55, 0, 55, 65.41, 0, 55, 0, 49, 55, 0, 55, 65.41, 82.41, 0, 73.42, 0];
  function startMusic() {
    if (musicTimer !== null) return;
    const stepDur = 60 / 112 / 2;
    musicTimer = window.setInterval(() => {
      if (!ctx || muted) return;
      const note = BASS_LINE[musicStep % BASS_LINE.length];
      if (note > 0) tone(note, stepDur * 0.9, 'square', 0.055);
      if (musicStep % 2 === 0) noise(0.03, 0.02, 6000);
      musicStep += 1;
    }, stepDur * 1000);
  }

  return {
    /** Call on any user gesture (start button, key press). Safe to call often. */
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    isMuted() {
      return muted;
    },
    /** speed 0..1: engine pitch and loudness. wanted>0: siren on. */
    update(speed01, wanted) {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (engineGain) {
        engineGain.gain.setTargetAtTime(speed01 > 0.02 ? 0.05 + speed01 * 0.05 : 0, now, 0.1);
        engineOsc.frequency.setTargetAtTime(48 + speed01 * 150, now, 0.08);
      }
      if (sirenGain && sirenOsc) {
        sirenGain.gain.setTargetAtTime(wanted > 0 ? 0.045 : 0, now, 0.2);
        if (wanted > 0) sirenOsc.frequency.setTargetAtTime(Math.floor(now * 1.6) % 2 === 0 ? 660 : 880, now, 0.05);
      }
    },
    shoot() {
      noise(0.12, 0.35, 2400);
      tone(180, 0.08, 'square', 0.12, 0, 60);
    },
    crash(strength) {
      noise(0.25, Math.min(0.5, 0.15 + strength * 0.4), 900);
    },
    pickup() {
      tone(660, 0.09, 'sine', 0.2);
      tone(990, 0.14, 'sine', 0.2, 0.08);
    },
    mission() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.22, 'triangle', 0.22, i * 0.11));
    },
    bust() {
      [392, 311, 233].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.16, i * 0.16));
    },
    click() {
      tone(440, 0.06, 'sine', 0.15);
    },
  };
}
