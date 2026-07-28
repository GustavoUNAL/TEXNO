/**
 * Extracción DSP heurística: tempo, espectro, dinámica, forma por energía.
 * No sustituye un DAW ni un modelo ML completo; sirve como ADN estructurado base.
 */

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function db(x) {
  return 20 * Math.log10(Math.max(x, 1e-12));
}

/** Downsample mono buffer for analysis. */
export function toMono(channelData) {
  if (!Array.isArray(channelData) && !(channelData instanceof Float32Array)) {
    // audio-decode may return AudioBuffer-like
  }
  return channelData;
}

/**
 * @param {{ channelData: Float32Array[], sampleRate: number } | { getChannelData: Function, numberOfChannels: number, length: number, sampleRate: number }} audio
 */
export function mixToMono(audio) {
  let channels;
  let sampleRate;
  if (audio.channelData) {
    channels = audio.channelData;
    sampleRate = audio.sampleRate;
  } else {
    sampleRate = audio.sampleRate;
    channels = [];
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      channels.push(audio.getChannelData(ch));
    }
  }
  const length = channels[0]?.length || 0;
  const mono = new Float32Array(length);
  const nCh = channels.length || 1;
  for (let ch = 0; ch < nCh; ch++) {
    const data = channels[ch];
    for (let i = 0; i < length; i++) mono[i] += data[i];
  }
  if (nCh > 1) {
    const inv = 1 / nCh;
    for (let i = 0; i < length; i++) mono[i] *= inv;
  }
  return { mono, sampleRate, duration: length / sampleRate };
}

/** Frame RMS envelope. */
export function computeEnvelope(mono, sampleRate, frameMs = 50) {
  const frameSize = Math.max(1, Math.floor((sampleRate * frameMs) / 1000));
  const hop = frameSize;
  const frames = [];
  for (let i = 0; i + frameSize <= mono.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < frameSize; j++) {
      const s = mono[i + j];
      sum += s * s;
    }
    frames.push(Math.sqrt(sum / frameSize));
  }
  return { frames, frameMs, frameSize };
}

export function computeDynamics(mono) {
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
    sumSq += mono[i] * mono[i];
  }
  const rms = Math.sqrt(sumSq / Math.max(mono.length, 1));
  const peakDb = db(peak);
  const rmsDb = db(rms);
  return {
    peak,
    rms,
    peak_db: Math.round(peakDb * 100) / 100,
    rms_db: Math.round(rmsDb * 100) / 100,
    dynamic_range_db: Math.round((peakDb - rmsDb) * 100) / 100,
    lufs_approx: Math.round((rmsDb - 0.691) * 100) / 100,
  };
}

/**
 * Autocorrelación sobre envelope para estimar BPM (60–200).
 */
export function estimateBpm(frames, frameMs) {
  if (frames.length < 32) return { bpm: null, confidence: 0 };

  const minBpm = 70;
  const maxBpm = 180;
  const fps = 1000 / frameMs;
  const minLag = Math.floor((60 / maxBpm) * fps);
  const maxLag = Math.min(frames.length - 1, Math.floor((60 / minBpm) * fps));

  const centered = frames.slice();
  const m = mean(centered);
  for (let i = 0; i < centered.length; i++) centered[i] -= m;

  let bestLag = minLag;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < centered.length - lag; i++) {
      corr += centered[i] * centered[i + lag];
    }
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  let bpm = (60 * fps) / bestLag;
  // Prefer electronic range: if half/double sounds more plausible, snap
  while (bpm < 100 && bpm * 2 <= 180) bpm *= 2;
  while (bpm > 160 && bpm / 2 >= 100) bpm /= 2;

  const confidence = Math.min(1, Math.max(0, bestCorr / (frames.length * 0.1 + 1e-9)));
  return {
    bpm: Math.round(bpm),
    confidence: Math.round(confidence * 100) / 100,
  };
}

/** Onsets simples por umbral sobre envelope. */
export function detectOnsets(frames, frameMs, thresholdFactor = 1.4) {
  const m = mean(frames);
  const thr = m * thresholdFactor;
  const times = [];
  let last = -Infinity;
  const minGap = 0.08; // s
  for (let i = 1; i < frames.length - 1; i++) {
    if (frames[i] > thr && frames[i] >= frames[i - 1] && frames[i] >= frames[i + 1]) {
      const t = (i * frameMs) / 1000;
      if (t - last >= minGap) {
        times.push(Math.round(t * 1000) / 1000);
        last = t;
      }
    }
  }
  return times.slice(0, 200);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_ES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

/** Perfiles Krumhansl-Schmuckler (mayor / menor). */
const KEY_PROFILE_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KEY_PROFILE_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

function midiToNoteName(midi) {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const octave = Math.floor(m / 12) - 1;
  return { name: NOTE_NAMES[pc], name_es: NOTE_NAMES_ES[pc], pitch_class: pc, midi: m, octave };
}

function corrProfiles(chroma, profile, shift) {
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < 12; i++) {
    const x = chroma[i];
    const y = profile[(i - shift + 12) % 12];
    a += x * y;
    b += x * x;
    c += y * y;
  }
  return a / (Math.sqrt(b * c) + 1e-12);
}

function buildLogBins(nBins = 96, fMin = 20, fMax = 20000) {
  const edges = [];
  for (let i = 0; i <= nBins; i++) {
    const t = i / nBins;
    edges.push(fMin * Math.pow(fMax / fMin, t));
  }
  return edges;
}

/**
 * Energia por bandas + curva log-frecuencia + cromagrama (una pasada FFT).
 */
export function analyzeSpectrum(mono, sampleRate) {
  const N = 2048;
  const bands = {
    sub_20_60: 0,
    low_60_250: 0,
    mid_250_2k: 0,
    high_2k_8k: 0,
    air_8k_20k: 0,
  };
  const nCurve = 96;
  const edges = buildLogBins(nCurve);
  const curveAcc = new Float64Array(nCurve);
  const chroma = new Float64Array(12);
  let centroidNum = 0;
  let centroidDen = 0;
  let blocks = 0;
  const peakCandidates = [];

  const step = N * 4;
  for (let start = 0; start + N < mono.length; start += step) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
      re[i] = mono[start + i] * w;
    }
    fftInPlace(re, im);

    const half = N / 2;
    let localPeakMag = 0;
    let localPeakFreq = 0;
    let binIdx = 0;

    for (let k = 1; k < half; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const freq = (k * sampleRate) / N;
      if (freq < 20 || freq > 20000) continue;

      centroidNum += freq * mag;
      centroidDen += mag;

      if (freq < 60) bands.sub_20_60 += mag;
      else if (freq < 250) bands.low_60_250 += mag;
      else if (freq < 2000) bands.mid_250_2k += mag;
      else if (freq < 8000) bands.high_2k_8k += mag;
      else bands.air_8k_20k += mag;

      while (binIdx < nCurve - 1 && freq >= edges[binIdx + 1]) binIdx++;
      if (freq >= edges[0] && freq <= edges[nCurve]) {
        curveAcc[Math.min(binIdx, nCurve - 1)] += mag;
      }

      if (freq >= 55 && freq <= 5000) {
        const midi = hzToMidi(freq);
        if (Number.isFinite(midi)) {
          const pc = ((Math.round(midi) % 12) + 12) % 12;
          const weight = mag * (freq < 400 ? 1.35 : freq > 2000 ? 0.7 : 1);
          chroma[pc] += weight;
        }
      }

      if (mag > localPeakMag && freq >= 40 && freq <= 2000) {
        localPeakMag = mag;
        localPeakFreq = freq;
      }
    }

    if (localPeakFreq > 0) {
      peakCandidates.push({ hz: localPeakFreq, mag: localPeakMag });
    }
    blocks++;
  }

  const total =
    bands.sub_20_60 +
    bands.low_60_250 +
    bands.mid_250_2k +
    bands.high_2k_8k +
    bands.air_8k_20k || 1;

  const normalized = {};
  for (const [k, v] of Object.entries(bands)) {
    normalized[k] = Math.round((v / total) * 1000) / 1000;
  }

  const maxCurve = Math.max(...curveAcc, 1e-12);
  const curve = [];
  for (let i = 0; i < nCurve; i++) {
    const f0 = edges[i];
    const f1 = edges[i + 1];
    const hz = Math.sqrt(f0 * f1);
    const mag = curveAcc[i] / maxCurve;
    curve.push({
      hz: Math.round(hz * 10) / 10,
      mag: Math.round(mag * 1000) / 1000,
      db: Math.round(20 * Math.log10(Math.max(mag, 1e-6)) * 10) / 10,
    });
  }

  const chromaSum = chroma.reduce((a, b) => a + b, 0) || 1;
  const chromaNorm = Array.from(chroma, (v) => Math.round((v / chromaSum) * 1000) / 1000);

  const centroid = centroidDen > 0 ? centroidNum / centroidDen : 0;
  let spectral_focus = 'balanced';
  if (normalized.sub_20_60 + normalized.low_60_250 > 0.45) spectral_focus = 'sub-heavy';
  else if (normalized.high_2k_8k + normalized.air_8k_20k > 0.4) spectral_focus = 'bright';
  else if (normalized.mid_250_2k > 0.35) spectral_focus = 'mid-forward';

  const brightness =
    centroid > 4000 ? 'high' : centroid > 2000 ? 'medium' : 'low';

  // Picos espectrales más fuertes → notas destacadas
  peakCandidates.sort((a, b) => b.mag - a.mag);
  const topPeaks = [];
  const usedPc = new Set();
  for (const p of peakCandidates.slice(0, 40)) {
    const note = midiToNoteName(hzToMidi(p.hz));
    if (usedPc.has(note.pitch_class)) continue;
    usedPc.add(note.pitch_class);
    topPeaks.push({
      hz: Math.round(p.hz),
      note: note.name,
      note_es: note.name_es,
      octave: note.octave,
      strength: Math.round((p.mag / (peakCandidates[0]?.mag || 1)) * 1000) / 1000,
    });
    if (topPeaks.length >= 8) break;
  }

  return {
    bands: normalized,
    curve,
    chromagram: chromaNorm,
    peaks: topPeaks,
    spectral_centroid_hz: Math.round(centroid),
    spectral_focus,
    brightness,
    blocks,
  };
}

/**
 * Estima tonalidad / escala y redacta explicación musical.
 */
export function estimateHarmony(spectrum, { bpm, form, bands } = {}) {
  const chroma = spectrum.chromagram || Array(12).fill(0);
  let best = { key: 'C', scale: 'minor', score: -Infinity, pc: 0 };

  for (let shift = 0; shift < 12; shift++) {
    const maj = corrProfiles(chroma, KEY_PROFILE_MAJOR, shift);
    const min = corrProfiles(chroma, KEY_PROFILE_MINOR, shift);
    if (maj > best.score) {
      best = { key: NOTE_NAMES[shift], scale: 'major', score: maj, pc: shift };
    }
    if (min > best.score) {
      best = { key: NOTE_NAMES[shift], scale: 'minor', score: min, pc: shift };
    }
  }

  const confidence = Math.max(0, Math.min(1, (best.score - 0.55) / 0.4));
  const scaleDegrees =
    best.scale === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];

  // Preferir bemoles en tonalidades con bemoles (F, Bb, Eb, Ab, Db, Gb)
  const flatKeys = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb (pitch classes)
  const useFlats = flatKeys.has(best.pc) || (best.scale === 'minor' && flatKeys.has((best.pc + 3) % 12));
  const nameAt = (pc) => {
    if (!useFlats) return { en: NOTE_NAMES[pc], es: NOTE_NAMES_ES[pc] };
    const flatEn = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const flatEs = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
    return { en: flatEn[pc], es: flatEs[pc] };
  };

  const scaleNotes = scaleDegrees.map((d) => nameAt((best.pc + d) % 12).en);
  const scaleNotesEs = scaleDegrees.map((d) => nameAt((best.pc + d) % 12).es);

  const ranked = chroma
    .map((v, i) => ({ pc: i, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 5)
    .map((x) => {
      const n = nameAt(x.pc);
      return {
        note: n.en,
        note_es: n.es,
        weight: x.v,
      };
    });

  const tonic = nameAt(best.pc);
  const tonicEs = tonic.es;
  const modeEs = best.scale === 'major' ? 'mayor' : 'menor';
  const relPc = best.scale === 'minor' ? (best.pc + 3) % 12 : (best.pc + 9) % 12;
  const relative = `${nameAt(relPc).en} ${best.scale === 'minor' ? 'mayor' : 'menor'}`;

  const focus = spectrum.spectral_focus;
  const formNames = (form || []).map((s) => s.name);
  const hasDrop = formNames.includes('drop');
  const hasBuild = formNames.includes('build');

  // Remap peak labels to flat names when the key prefers flats
  const peaks = (spectrum.peaks || []).map((p) => {
    const named = nameAt(NOTE_NAMES.indexOf(p.note));
    return {
      ...p,
      note: named.en,
      note_es: named.es,
    };
  });

  const lines = [];
  lines.push(
    `Tonalidad estimada: ${tonic.en} ${modeEs} (${tonicEs} ${modeEs}). Relativa: ${relative}.`,
  );
  lines.push(
    `Notas de la escala: ${scaleNotesEs.join(' · ')} (${scaleNotes.join(' ')}).`,
  );
  if (ranked[0]) {
    lines.push(
      `Pitch classes dominantes: ${ranked
        .map((r) => `${r.note_es} (${Math.round(r.weight * 100)}%)`)
        .join(', ')}.`,
    );
  }
  if (peaks.length) {
    const peakStr = peaks
      .slice(0, 4)
      .map((p) => `${p.note_es}${p.octave} ≈ ${p.hz} Hz`)
      .join(' · ');
    lines.push(`Parciales / fundamentales destacados: ${peakStr}.`);
  }

  if (focus === 'sub-heavy') {
    lines.push(
      'Espectro sub-heavy: el centro armónico suele estar en el kick/bajo; la melodía puede ser monotonal o drone.',
    );
  } else if (focus === 'bright') {
    lines.push(
      'Espectro brillante: hats, noise y parciales altos; la percepción de tono puede ser más ruidosa que melódica.',
    );
  } else if (focus === 'mid-forward') {
    lines.push(
      'Mids al frente: cuerpo percusivo / lead en zona de presencia; buen lugar para hooks y claps.',
    );
  } else {
    lines.push('Balance espectral relativamente uniforme entre sub, mids y aire.');
  }

  if (bpm) {
    if (bpm >= 140 && bpm <= 160) {
      lines.push(
        `${bpm} BPM encaja en hard techno / techno rápido: grooves 4/4, poco cambio armónico, tensión por textura y filtros.`,
      );
    } else if (bpm >= 120 && bpm < 140) {
      lines.push(`${bpm} BPM: terreno techno / house — espacio para progresiones cortas o ostinatos.`);
    } else {
      lines.push(`Tempo estimado ${bpm} BPM — interpreta el groove relativo a ese pulso.`);
    }
  }

  if (hasBuild && hasDrop) {
    lines.push(
      'Narrativa detectada build→drop: la armonía suele sostenerse; el drama viene de densidad, filtro y sidechain.',
    );
  }

  const bandHint = bands || spectrum.bands || {};
  if ((bandHint.sub_20_60 || 0) > 0.12) {
    lines.push('Sub presente: ancla el track en una nota pedal (a menudo la tónica o la 5ª).');
  }

  return {
    key: tonic.en,
    key_es: `${tonicEs} ${modeEs}`,
    scale: best.scale,
    scale_es: modeEs,
    confidence: Math.round(confidence * 100) / 100,
    scale_notes: scaleNotes,
    scale_notes_es: scaleNotesEs,
    dominant_notes: ranked,
    relative_key: relative,
    peaks,
    chromagram: chroma,
    explanation: lines.join(' '),
    explanation_lines: lines,
  };
}

function fftInPlace(re, im) {
  const n = re.length;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const tableStep = (2 * Math.PI) / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const angle = tableStep * k;
        const wr = Math.cos(angle);
        const wi = -Math.sin(angle);
        const even = i + k;
        const odd = even + half;
        const tr = wr * re[odd] - wi * im[odd];
        const ti = wr * im[odd] + wi * re[odd];
        re[odd] = re[even] - tr;
        im[odd] = im[even] - ti;
        re[even] += tr;
        im[even] += ti;
      }
    }
  }
}

/**
 * Segmenta por energía relativa → forma aproximada.
 */
export function estimateForm(frames, frameMs, bpm) {
  if (!frames.length) return [];
  const duration = (frames.length * frameMs) / 1000;
  const barSec = bpm ? (60 / bpm) * 4 : 2;
  const n = frames.length;
  const window = Math.max(4, Math.floor(n / 16));
  const energies = [];
  for (let i = 0; i < n; i += window) {
    const slice = frames.slice(i, i + window);
    energies.push({ t: (i * frameMs) / 1000, e: mean(slice) });
  }
  const maxE = Math.max(...energies.map((x) => x.e), 1e-9);
  const sections = [];
  let current = null;

  const labelFor = (norm, t, duration) => {
    if (t < duration * 0.12 && norm < 0.45) return 'intro';
    if (t > duration * 0.85) return 'outro';
    if (norm < 0.35) return 'break';
    if (norm < 0.55) return 'build';
    return 'drop';
  };

  for (const { t, e } of energies) {
    const norm = e / maxE;
    const name = labelFor(norm, t, duration);
    const energy = Math.round(norm * 10);
    if (!current || current.name !== name) {
      if (current) {
        current.end_s = Math.round(t * 100) / 100;
        current.bars = Math.max(1, Math.round((current.end_s - current.start_s) / barSec));
        sections.push(current);
      }
      current = {
        name,
        start_s: Math.round(t * 100) / 100,
        end_s: null,
        bars: 0,
        energy,
      };
    } else {
      current.energy = Math.max(current.energy, energy);
    }
  }
  if (current) {
    current.end_s = Math.round(duration * 100) / 100;
    current.bars = Math.max(1, Math.round((current.end_s - current.start_s) / barSec));
    sections.push(current);
  }
  return sections;
}

export function estimateLayers(bands, bpm) {
  const layers = [];
  if (bands.sub_20_60 > 0.08) {
    layers.push({
      id: 'kick',
      role: 'drums',
      freq_hint: '20–100 Hz',
      presence: bands.sub_20_60 > 0.15 ? 'high' : 'medium',
      notes: 'Energía en sub sugiere kick presente',
    });
  }
  if (bands.low_60_250 > 0.1) {
    layers.push({
      id: 'bass',
      role: 'bass',
      freq_hint: '60–250 Hz',
      presence: bands.low_60_250 > 0.2 ? 'high' : 'medium',
      notes: 'Cuerpo de bajo',
    });
  }
  if (bands.mid_250_2k > 0.15) {
    layers.push({
      id: 'percussion',
      role: 'drums',
      freq_hint: '250 Hz–2 kHz',
      presence: 'medium',
      notes: 'Percusión / body / snare-clap zone',
    });
  }
  if (bands.high_2k_8k > 0.12) {
    layers.push({
      id: 'hats',
      role: 'drums',
      freq_hint: '2–8 kHz',
      presence: bands.high_2k_8k > 0.2 ? 'high' : 'medium',
      notes: 'Hi-hats / presencia',
    });
  }
  if (bands.air_8k_20k > 0.08) {
    layers.push({
      id: 'air_fx',
      role: 'fx',
      freq_hint: '8–20 kHz',
      presence: 'low',
      notes: 'Aire, noise, FX brillantes',
    });
  }
  if (bpm && bpm >= 130 && bpm <= 160) {
    layers.push({
      id: 'synth_texture',
      role: 'synth',
      freq_hint: 'mids',
      presence: 'unknown',
      notes: 'Rango BPM típico hard techno / techno — posible lead/texture',
    });
  }
  return layers;
}

export function energyCurve(frames, frameMs, points = 24) {
  if (!frames.length) return [];
  const step = Math.max(1, Math.floor(frames.length / points));
  const maxE = Math.max(...frames, 1e-9);
  const curve = [];
  for (let i = 0; i < frames.length; i += step) {
    curve.push({
      t: Math.round(((i * frameMs) / 1000) * 100) / 100,
      energy: Math.round((frames[i] / maxE) * 100) / 100,
    });
  }
  return curve;
}
