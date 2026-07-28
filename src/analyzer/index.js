import { parseFile, parseBuffer } from 'music-metadata';
import decodeAudio from '@audio/decode';
import yaml from 'js-yaml';
import { emptyTrackDna } from './schema.js';
import {
  mixToMono,
  computeEnvelope,
  computeDynamics,
  estimateBpm,
  detectOnsets,
  analyzeSpectrum,
  estimateHarmony,
  estimateForm,
  estimateLayers,
  energyCurve,
} from './dsp.js';

async function loadMetadata(input) {
  if (Buffer.isBuffer(input.buffer)) {
    return parseBuffer(input.buffer, { mimeType: input.mimeType, size: input.buffer.length });
  }
  return parseFile(input.path);
}

async function decode(input) {
  const buf =
    input.buffer ??
    (await import('node:fs/promises').then((fs) => fs.readFile(input.path)));
  const bytes = Buffer.isBuffer(buf)
    ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    : buf;
  return decodeAudio(bytes);
}

/**
 * @param {{ path?: string, buffer?: Buffer, mimeType?: string, filename?: string }} input
 */
export async function analyzeTrack(input) {
  const filename = input.filename || input.path?.split(/[/\\]/).pop() || 'unknown';
  const [meta, audioBuffer] = await Promise.all([loadMetadata(input), decode(input)]);

  const { mono, sampleRate, duration } = mixToMono(audioBuffer);
  const { frames, frameMs } = computeEnvelope(mono, sampleRate, 50);
  const dynamics = computeDynamics(mono);
  const { bpm, confidence: bpmConfidence } = estimateBpm(frames, frameMs);
  const onsets = detectOnsets(frames, frameMs);
  const spectrum = analyzeSpectrum(mono, sampleRate);
  const form = estimateForm(frames, frameMs, bpm);
  const layers = estimateLayers(spectrum.bands, bpm);
  const curve = energyCurve(frames, frameMs, 48);
  const harmony = estimateHarmony(spectrum, {
    bpm,
    form,
    bands: spectrum.bands,
  });

  const title = meta.common.title || filename.replace(/\.[^.]+$/, '');
  const artist = meta.common.artist || meta.common.albumartist || '';
  const genre = Array.isArray(meta.common.genre)
    ? meta.common.genre.join(', ')
    : meta.common.genre || '';

  const dominant =
    layers.find((l) => l.id === 'kick')?.id ||
    layers[0]?.id ||
    null;

  const dna = emptyTrackDna({
    track: {
      title,
      artist,
      genre,
      duration_s: Math.round((meta.format.duration || duration) * 100) / 100,
      source: filename,
      bpm,
      time_signature: '4/4',
      key: harmony.key ? `${harmony.key} ${harmony.scale}` : null,
      sample_rate: sampleRate,
      bitrate: meta.format.bitrate || null,
      codec: meta.format.codec || meta.format.container || null,
    },
    form,
    layers,
    mix: {
      lufs_approx: dynamics.lufs_approx,
      rms_db: dynamics.rms_db,
      peak_db: dynamics.peak_db,
      dynamic_range_db: dynamics.dynamic_range_db,
      spectral_focus: spectrum.spectral_focus,
      bands: spectrum.bands,
      spectrum_curve: spectrum.curve,
      spectral_centroid_hz: spectrum.spectral_centroid_hz,
    },
    rhythm: {
      density_events_per_s:
        duration > 0 ? Math.round((onsets.length / duration) * 100) / 100 : 0,
      onset_times_s: onsets.slice(0, 64),
      groove: bpm ? `${bpm} BPM · 4/4 (estimado)` : null,
      bpm_confidence: bpmConfidence,
    },
    harmony: {
      key: harmony.key,
      key_es: harmony.key_es,
      scale: harmony.scale,
      scale_es: harmony.scale_es,
      confidence: harmony.confidence,
      scale_notes: harmony.scale_notes,
      scale_notes_es: harmony.scale_notes_es,
      dominant_notes: harmony.dominant_notes,
      relative_key: harmony.relative_key,
      chromagram: harmony.chromagram,
      peaks: harmony.peaks,
      explanation: harmony.explanation,
      explanation_lines: harmony.explanation_lines,
      notes: harmony.explanation,
    },
    timbre: {
      brightness: spectrum.brightness,
      spectral_centroid_hz: spectrum.spectral_centroid_hz,
      roughness:
        dynamics.dynamic_range_db < 6
          ? 'compressed'
          : dynamics.dynamic_range_db < 12
            ? 'moderate'
            : 'open',
    },
    automations: form
      .filter((s) => s.name === 'build')
      .map((s) => ({
        target: 'energy / filter (inferido)',
        section: s.name,
        start_s: s.start_s,
        end_s: s.end_s,
        effect: 'Aumento de energía — posible apertura de filtro / densidad',
      })),
    sound_design: Object.fromEntries(
      layers.map((l) => [
        l.id,
        {
          synthesis: 'unknown',
          confidence: 0.2,
          hint: l.notes,
        },
      ]),
    ),
    narrative: {
      energy_curve: curve,
      dominant_element: dominant,
      atmosphere:
        bpm >= 140
          ? 'alta energía / club'
          : bpm >= 120
            ? 'groove electrónico'
            : 'tempo medio / abierto',
    },
    analysis_meta: {
      engine: 'texno',
      version: '1.1.0',
      analyzed_at: new Date().toISOString(),
      confidence: 'heuristic',
      bpm_confidence: bpmConfidence,
    },
  });

  return dna;
}

export function toYaml(dna) {
  return yaml.dump(dna, { lineWidth: 100, noRefs: true });
}

export { emptyTrackDna } from './schema.js';
