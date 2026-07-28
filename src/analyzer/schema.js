/** Esquema / plantilla del ADN de una composición musical. */

export function emptyTrackDna(overrides = {}) {
  return {
    track: {
      title: '',
      artist: '',
      genre: '',
      duration_s: 0,
      source: '',
      bpm: null,
      time_signature: '4/4',
      key: null,
      ...overrides.track,
    },
    form: overrides.form ?? [],
    layers: overrides.layers ?? [],
    mix: {
      lufs_approx: null,
      rms_db: null,
      peak_db: null,
      dynamic_range_db: null,
      spectral_focus: null,
      bands: {
        sub_20_60: null,
        low_60_250: null,
        mid_250_2k: null,
        high_2k_8k: null,
        air_8k_20k: null,
      },
      spectrum_curve: [],
      spectral_centroid_hz: null,
      ...overrides.mix,
    },
    rhythm: {
      density_events_per_s: null,
      onset_times_s: [],
      groove: null,
      ...overrides.rhythm,
    },
    harmony: {
      key: null,
      key_es: null,
      scale: null,
      scale_es: null,
      confidence: null,
      scale_notes: [],
      scale_notes_es: [],
      dominant_notes: [],
      relative_key: null,
      chromagram: [],
      peaks: [],
      explanation: '',
      explanation_lines: [],
      notes: 'Estimación heurística; hard techno suele ser monotonal.',
      ...overrides.harmony,
    },
    timbre: {
      brightness: null,
      spectral_centroid_hz: null,
      roughness: null,
      ...overrides.timbre,
    },
    automations: overrides.automations ?? [],
    sound_design: overrides.sound_design ?? {},
    narrative: {
      energy_curve: [],
      dominant_element: null,
      atmosphere: null,
      ...overrides.narrative,
    },
    analysis_meta: {
      engine: 'texno',
      version: '1.1.0',
      analyzed_at: new Date().toISOString(),
      confidence: 'heuristic',
      ...overrides.analysis_meta,
    },
  };
}

export const BAND_LABELS = {
  sub_20_60: '20–60 Hz · Kick / sub',
  low_60_250: '60–250 Hz · Bajo',
  mid_250_2k: '250 Hz–2 kHz · Percusión / body',
  high_2k_8k: '2–8 kHz · Hats / presencia',
  air_8k_20k: '8–20 kHz · Aire',
};
