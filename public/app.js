const form = document.getElementById('analyze-form');
const fileInput = document.getElementById('audio');
const formatSelect = document.getElementById('format');
const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const progressBar = document.getElementById('progress-bar');
const modal = document.getElementById('lab-modal');
const labBusy = document.getElementById('lab-busy');
const busyText = document.getElementById('busy-text');
const outputEl = document.getElementById('output');
const metricsEl = document.getElementById('metrics');
const resultTitle = document.getElementById('result-title');
const resultSub = document.getElementById('result-sub');
const submitBtn = document.getElementById('submit-btn');
const resetBtn = document.getElementById('reset-btn');
const copyBtn = document.getElementById('copy-btn');
const downloadBtn = document.getElementById('download-btn');
const closeModalBtn = document.getElementById('close-modal');
const docsModal = document.getElementById('docs-modal');
const closeDocsBtn = document.getElementById('close-docs');
const openDocsLink = document.getElementById('open-docs');
const dropzone = form;
const dropTitle = document.getElementById('drop-title');
const dropMeta = document.getElementById('drop-meta');
const fileChip = document.getElementById('file-chip');
const fileChipName = document.getElementById('file-chip-name');
const clearFileBtn = document.getElementById('clear-file');

const BANDS = [
  { key: 'sub_20_60', label: 'SUB', range: '20–60', color: '#3a4250' },
  { key: 'low_60_250', label: 'LOW', range: '60–250', color: '#5c6b2e' },
  { key: 'mid_250_2k', label: 'MID', range: '250–2k', color: '#8aa812' },
  { key: 'high_2k_8k', label: 'HIGH', range: '2–8k', color: '#b6e016' },
  { key: 'air_8k_20k', label: 'AIR', range: '8–20k', color: '#c6ff1a' },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_ES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const PLOT_IDS = [
  'plot-spectrum',
  'plot-energy',
  'plot-chroma',
  'plot-bands',
  'plot-rhythm',
];

const ACCENT = '#c6ff1a';
const INK = '#d7dde6';
const MUTED = '#8b93a0';
const GRID = 'rgba(198,255,26,0.08)';

let lastPayload = '';
let lastFilename = 'texno-dna.json';
let lastDna = null;
let analyzeAbort = null;
let progressTimer = null;
let renderToken = 0;
let selectedFile = null;

function waitForPlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  return new Promise((resolve, reject) => {
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (window.Plotly) {
        clearInterval(t);
        resolve(window.Plotly);
      } else if (n > 80) {
        clearInterval(t);
        reject(new Error('Plotly no cargó'));
      }
    }, 50);
  });
}

function setStatus(text, { error = false, busy = false } = {}) {
  statusEl.hidden = !text;
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
  statusEl.classList.toggle('busy', busy);
}

function formatDur(s) {
  if (s == null || Number.isNaN(s)) return '—';
  const t = Math.max(0, Math.round(s));
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatBytes(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function metric(label, value, hint) {
  const div = document.createElement('div');
  div.className = 'metric';
  div.innerHTML = `<span>${label}</span><strong>${value ?? '—'}</strong>${
    hint ? `<em>${hint}</em>` : ''
  }`;
  return div;
}

function dnaToYaml(obj, level = 0) {
  const sp = '  '.repeat(level);
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    if (!obj.length) return '[]';
    return obj
      .map((item) => {
        if (item !== null && typeof item === 'object') {
          const lines = dnaToYaml(item, level + 1).split('\n');
          const first = `${sp}- ${lines[0].trimStart()}`;
          const rest = lines
            .slice(1)
            .map((l) => `${'  '.repeat(level + 1)}${l.trimStart()}`)
            .join('\n');
          return rest ? `${first}\n${rest}` : first;
        }
        return `${sp}- ${dnaToYaml(item, 0)}`;
      })
      .join('\n');
  }
  return Object.entries(obj)
    .map(([k, v]) => {
      if (v !== null && typeof v === 'object') {
        const inner = dnaToYaml(v, level + 1);
        if (inner === '[]' || inner === '{}') return `${sp}${k}: ${inner}`;
        return `${sp}${k}:\n${inner}`;
      }
      return `${sp}${k}: ${dnaToYaml(v, 0)}`;
    })
    .join('\n');
}

function syncFileUI(file) {
  selectedFile = file || null;
  if (!file) {
    fileChip.hidden = true;
    fileChipName.textContent = '';
    dropTitle.textContent = 'Arrastra o elige un audio';
    dropMeta.textContent = 'MP3, WAV, FLAC, OGG · máx. 80 MB';
    dropzone.classList.remove('has-file');
    return;
  }
  fileChip.hidden = false;
  fileChipName.textContent = file.name;
  dropTitle.textContent = 'Archivo listo';
  dropMeta.textContent = `${formatBytes(file.size)} · listo para analizar`;
  dropzone.classList.add('has-file');
}

function setFile(file) {
  if (!file) {
    fileInput.value = '';
    syncFileUI(null);
    return;
  }
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
  } catch {
    /* some browsers restrict DataTransfer assignment */
  }
  syncFileUI(file);
}

function startProgress() {
  progressEl.hidden = false;
  progressBar.style.width = '8%';
  let p = 8;
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    p = Math.min(92, p + Math.random() * 6);
    progressBar.style.width = `${p}%`;
  }, 400);
}

function stopProgress(ok = true) {
  clearInterval(progressTimer);
  progressTimer = null;
  progressBar.style.width = ok ? '100%' : '0%';
  setTimeout(() => {
    progressEl.hidden = true;
    progressBar.style.width = '0%';
  }, ok ? 280 : 0);
}

function baseLayout(extra = {}) {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'IBM Plex Mono, monospace', size: 11, color: MUTED },
    margin: { t: 18, r: 18, b: 42, l: 48 },
    hovermode: 'x unified',
    dragmode: false,
    ...extra,
  };
}

function axisStyle(overrides = {}) {
  return {
    gridcolor: GRID,
    zerolinecolor: 'rgba(198,255,26,0.2)',
    linecolor: 'rgba(198,255,26,0.2)',
    tickfont: { color: MUTED, size: 10 },
    ...overrides,
  };
}

const plotConfig = {
  displayModeBar: false,
  responsive: true,
  staticPlot: false,
};

async function purgePlots() {
  const Plotly = window.Plotly;
  if (!Plotly) return;
  for (const id of PLOT_IDS) {
    const el = document.getElementById(id);
    if (el && el.data) {
      try {
        await Plotly.purge(el);
      } catch {
        /* ignore */
      }
    }
    if (el) el.innerHTML = '';
  }
}

function syncModalBodyLock() {
  const anyOpen = !modal.hidden || (docsModal && !docsModal.hidden);
  document.body.classList.toggle('modal-open', anyOpen);
}

function openModal({ loading = false } = {}) {
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  syncModalBodyLock();
  labBusy.hidden = !loading;
  if (loading) busyText.textContent = 'Analizando…';
}

function closeModal() {
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  syncModalBodyLock();
  labBusy.hidden = true;
}

function openDocsModal() {
  if (!docsModal) return;
  docsModal.hidden = false;
  docsModal.setAttribute('aria-hidden', 'false');
  syncModalBodyLock();
  if (location.hash !== '#documentacion') {
    history.replaceState(null, '', '#documentacion');
  }
}

function closeDocsModal() {
  if (!docsModal) return;
  docsModal.hidden = true;
  docsModal.setAttribute('aria-hidden', 'true');
  syncModalBodyLock();
  if (location.hash === '#documentacion') {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
}

function clearLabDom() {
  metricsEl.replaceChildren();
  document.getElementById('scale-row')?.replaceChildren();
  document.getElementById('peaks-row')?.replaceChildren();
  document.getElementById('explain-list')?.replaceChildren();
  document.getElementById('form-strip')?.replaceChildren();
  document.getElementById('layers-row')?.replaceChildren();
  document.getElementById('mix-stats')?.replaceChildren();
  document.getElementById('key-hero').innerHTML = '—';
  document.getElementById('spectrum-meta').textContent = '20 Hz → 20 kHz';
  document.getElementById('energy-meta').textContent = 'timeline';
  document.getElementById('chroma-meta').textContent = 'pitch';
  document.getElementById('bands-meta').textContent = 'mix';
  document.getElementById('rhythm-meta').textContent = 'onsets';
  resultTitle.textContent = 'Resultado';
  resultSub.textContent = '';
  outputEl.textContent = '';
}

async function fullReset() {
  if (analyzeAbort) {
    analyzeAbort.abort();
    analyzeAbort = null;
  }
  stopProgress(false);
  renderToken += 1;
  lastDna = null;
  lastPayload = '';
  lastFilename = 'texno-dna.json';

  form.reset();
  formatSelect.value = 'json';
  setFile(null);
  await purgePlots();
  clearLabDom();
  closeModal();

  submitBtn.disabled = false;
  submitBtn.textContent = 'Extraer ADN';
  setStatus('');
}

function renderMetrics(dna) {
  const key = dna.harmony?.key_es || dna.track?.key || '—';
  const conf =
    dna.harmony?.confidence != null
      ? `${Math.round(dna.harmony.confidence * 100)}%`
      : null;
  metricsEl.replaceChildren(
    metric('BPM', dna.track?.bpm, dna.rhythm?.bpm_confidence != null
      ? `conf ${Math.round(dna.rhythm.bpm_confidence * 100)}%`
      : null),
    metric('Tonalidad', key, conf ? `conf ${conf}` : null),
    metric('Duración', formatDur(dna.track?.duration_s)),
    metric('Foco', dna.mix?.spectral_focus),
    metric('RMS', dna.mix?.rms_db != null ? `${dna.mix.rms_db}` : null, 'dB'),
    metric('Peak', dna.mix?.peak_db != null ? `${dna.mix.peak_db}` : null, 'dB'),
    metric('DR', dna.mix?.dynamic_range_db != null ? `${dna.mix.dynamic_range_db}` : null, 'dB'),
    metric('Centroide', dna.mix?.spectral_centroid_hz
      ? `${Math.round(dna.mix.spectral_centroid_hz)}`
      : null, 'Hz'),
    metric('Densidad', dna.rhythm?.density_events_per_s ?? null, 'onsets/s'),
    metric('Capas', dna.layers?.length ?? null),
  );
}

async function plotSpectrum(Plotly, dna) {
  const curve = dna.mix?.spectrum_curve || [];
  const peaks = dna.harmony?.peaks || [];
  const centroid = dna.mix?.spectral_centroid_hz;
  const hz = curve.map((p) => p.hz);
  const mag = curve.map((p) => Math.round(p.mag * 1000) / 10);

  const shapes = [];
  const zones = [
    [20, 60, 'rgba(58,66,80,0.25)'],
    [60, 250, 'rgba(92,107,46,0.22)'],
    [250, 2000, 'rgba(138,168,18,0.18)'],
    [2000, 8000, 'rgba(182,224,22,0.16)'],
    [8000, 20000, 'rgba(198,255,26,0.14)'],
  ];
  for (const [a, b, fill] of zones) {
    shapes.push({
      type: 'rect',
      xref: 'x',
      yref: 'paper',
      x0: a,
      x1: b,
      y0: 0,
      y1: 1,
      fillcolor: fill,
      line: { width: 0 },
      layer: 'below',
    });
  }
  if (centroid) {
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: centroid,
      x1: centroid,
      y0: 0,
      y1: 1,
      line: { color: ACCENT, width: 1.5, dash: 'dot' },
    });
  }

  const traces = [
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Espectro',
      x: hz,
      y: mag,
      fill: 'tozeroy',
      line: { color: ACCENT, width: 2, shape: 'spline' },
      fillcolor: 'rgba(198,255,26,0.18)',
      hovertemplate: '%{x:.0f} Hz<br>%{y:.1f}%<extra></extra>',
    },
  ];

  if (peaks.length) {
    traces.push({
      type: 'scatter',
      mode: 'markers+text',
      name: 'Notas',
      x: peaks.map((p) => p.hz),
      y: peaks.map((p) => Math.max(8, (p.strength || 0.5) * 90)),
      text: peaks.map((p) => `${p.note_es}${p.octave}`),
      textposition: 'top center',
      textfont: { color: INK, size: 11, family: 'Syne, sans-serif' },
      marker: {
        size: 9,
        color: '#0b0d10',
        line: { color: ACCENT, width: 2 },
      },
      hovertemplate: '%{text}<br>%{x} Hz<extra></extra>',
    });
  }

  await Plotly.react(
    'plot-spectrum',
    traces,
    baseLayout({
      margin: { t: 20, r: 20, b: 48, l: 48 },
      xaxis: axisStyle({
        type: 'log',
        title: { text: 'Hz', font: { size: 10, color: MUTED } },
        range: [Math.log10(20), Math.log10(20000)],
        tickvals: [20, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000],
        ticktext: ['20', '50', '100', '250', '500', '1k', '2k', '5k', '10k', '20k'],
      }),
      yaxis: axisStyle({
        title: { text: 'mag %', font: { size: 10, color: MUTED } },
        range: [0, 105],
      }),
      shapes,
      showlegend: false,
    }),
    plotConfig,
  );

  document.getElementById('spectrum-meta').textContent =
    `${dna.mix?.spectral_focus || '—'} · ${curve.length} bins · log`;
}

async function plotEnergy(Plotly, dna) {
  const curve = dna.narrative?.energy_curve || [];
  const sections = dna.form || [];
  const duration = dna.track?.duration_s || curve.at(-1)?.t || 1;
  const shapes = sections.map((s) => {
    const colors = {
      intro: 'rgba(215,221,230,0.06)',
      build: 'rgba(168,201,26,0.14)',
      drop: 'rgba(198,255,26,0.22)',
      break: 'rgba(215,221,230,0.04)',
      outro: 'rgba(215,221,230,0.08)',
    };
    return {
      type: 'rect',
      xref: 'x',
      yref: 'paper',
      x0: s.start_s,
      x1: s.end_s ?? duration,
      y0: 0,
      y1: 1,
      fillcolor: colors[s.name] || 'rgba(255,255,255,0.04)',
      line: { width: 0 },
      layer: 'below',
    };
  });

  const annotations = sections
    .filter((s) => (s.end_s ?? duration) - s.start_s > duration * 0.06)
    .map((s) => ({
      x: (s.start_s + (s.end_s ?? duration)) / 2,
      y: 1.02,
      xref: 'x',
      yref: 'paper',
      text: s.name.toUpperCase(),
      showarrow: false,
      font: { size: 9, color: MUTED, family: 'IBM Plex Mono' },
    }));

  await Plotly.react(
    'plot-energy',
    [
      {
        type: 'scatter',
        mode: 'lines',
        x: curve.map((p) => p.t),
        y: curve.map((p) => p.energy),
        line: { color: ACCENT, width: 2.4, shape: 'spline' },
        fill: 'tozeroy',
        fillcolor: 'rgba(198,255,26,0.12)',
        hovertemplate: '%{x:.1f}s<br>E %{y:.2f}<extra></extra>',
      },
    ],
    baseLayout({
      margin: { t: 28, r: 16, b: 42, l: 42 },
      xaxis: axisStyle({
        title: { text: 'tiempo', font: { size: 10, color: MUTED } },
        tickformat: '.0f',
        ticksuffix: 's',
      }),
      yaxis: axisStyle({ range: [0, 1.05], title: { text: 'energy', font: { size: 10, color: MUTED } } }),
      shapes,
      annotations,
      showlegend: false,
    }),
    plotConfig,
  );

  document.getElementById('energy-meta').textContent =
    sections.map((s) => s.name).join(' → ') || '—';
}

async function plotChroma(Plotly, dna) {
  const chroma = dna.harmony?.chromagram || Array(12).fill(0);
  const keyName = dna.harmony?.key || '';
  const flatMap = { Db: 1, Eb: 3, Gb: 6, Ab: 8, Bb: 10 };
  const keyPc =
    NOTE_NAMES.indexOf(keyName) >= 0
      ? NOTE_NAMES.indexOf(keyName)
      : flatMap[keyName] ?? -1;
  const colors = chroma.map((_, i) => (i === keyPc ? ACCENT : 'rgba(215,221,230,0.55)'));

  await Plotly.react(
    'plot-chroma',
    [
      {
        type: 'barpolar',
        r: chroma.map((v) => Math.round(v * 1000) / 10),
        theta: NOTE_NAMES,
        marker: {
          color: colors,
          line: { color: '#0b0d10', width: 1 },
        },
        hovertemplate: '%{theta}<br>%{r:.1f}%<extra></extra>',
      },
    ],
    baseLayout({
      margin: { t: 24, r: 24, b: 24, l: 24 },
      polar: {
        bgcolor: 'rgba(0,0,0,0)',
        radialaxis: {
          visible: true,
          gridcolor: GRID,
          tickfont: { size: 9, color: MUTED },
          showline: false,
        },
        angularaxis: {
          gridcolor: GRID,
          tickfont: { size: 11, color: INK, family: 'Syne, sans-serif' },
          rotation: 90,
          direction: 'clockwise',
        },
      },
      showlegend: false,
    }),
    plotConfig,
  );

  const conf =
    dna.harmony?.confidence != null ? Math.round(dna.harmony.confidence * 100) : 0;
  document.getElementById('chroma-meta').textContent =
    `${dna.harmony?.key_es || '—'} · ${conf}%`;
}

async function plotBands(Plotly, dna) {
  const bands = dna.mix?.bands || {};
  const labels = BANDS.map((b) => b.label);
  const values = BANDS.map((b) => Math.round((bands[b.key] || 0) * 1000) / 10);
  const colors = BANDS.map((b) => b.color);

  await Plotly.react(
    'plot-bands',
    [
      {
        type: 'bar',
        orientation: 'h',
        y: labels,
        x: values,
        marker: {
          color: colors,
          line: { color: 'rgba(0,0,0,0.35)', width: 1 },
        },
        text: values.map((v) => `${v}%`),
        textposition: 'outside',
        textfont: { color: INK, size: 11 },
        hovertemplate: '%{y}: %{x}%<extra></extra>',
      },
    ],
    baseLayout({
      margin: { t: 16, r: 48, b: 32, l: 56 },
      xaxis: axisStyle({ range: [0, 110], ticksuffix: '%' }),
      yaxis: axisStyle({ automargin: true }),
      showlegend: false,
    }),
    plotConfig,
  );

  document.getElementById('bands-meta').textContent =
    `RMS ${dna.mix?.rms_db ?? '—'} · Peak ${dna.mix?.peak_db ?? '—'} · DR ${
      dna.mix?.dynamic_range_db ?? '—'
    }`;
}

async function plotRhythm(Plotly, dna) {
  const onsets = dna.rhythm?.onset_times_s || [];
  const duration = dna.track?.duration_s || onsets.at(-1) || 1;
  const bins = 48;
  const counts = new Array(bins).fill(0);
  const centers = [];
  onsets.forEach((t) => {
    const i = Math.min(bins - 1, Math.floor((t / duration) * bins));
    counts[i] += 1;
  });
  for (let i = 0; i < bins; i++) {
    centers.push(((i + 0.5) / bins) * duration);
  }
  const density = dna.rhythm?.density_events_per_s || 0;

  await Plotly.react(
    'plot-rhythm',
    [
      {
        type: 'bar',
        x: centers,
        y: counts,
        marker: {
          color: counts.map((c) =>
            c > 0 ? 'rgba(198,255,26,0.75)' : 'rgba(215,221,230,0.08)',
          ),
          line: { width: 0 },
        },
        hovertemplate: '%{x:.1f}s<br>%{y} onsets<extra></extra>',
      },
      {
        type: 'scatter',
        mode: 'markers',
        x: onsets.slice(0, 120),
        y: onsets.slice(0, 120).map(() => -0.15),
        marker: { size: 5, color: ACCENT, symbol: 'line-ns-open' },
        hoverinfo: 'skip',
      },
    ],
    baseLayout({
      margin: { t: 16, r: 16, b: 42, l: 42 },
      xaxis: axisStyle({ title: { text: 'tiempo', font: { size: 10, color: MUTED } } }),
      yaxis: axisStyle({ title: { text: 'count', font: { size: 10, color: MUTED } } }),
      showlegend: false,
      annotations: [
        {
          x: 0.02,
          y: 0.98,
          xref: 'paper',
          yref: 'paper',
          text: `<b style="color:${ACCENT};font-size:22px">${density}</b><br>onsets/s`,
          showarrow: false,
          align: 'left',
          font: { color: MUTED, size: 11 },
        },
      ],
    }),
    plotConfig,
  );

  document.getElementById('rhythm-meta').textContent =
    dna.rhythm?.groove || `${onsets.length} eventos`;
}

function renderMusic(dna) {
  const h = dna.harmony || {};
  const conf = h.confidence != null ? Math.round(h.confidence * 100) : 0;
  document.getElementById('key-hero').innerHTML = `
    <span class="key-name">${h.key_es || '—'}</span>
    <span class="key-sub">${h.key || '—'} ${h.scale || ''} · relativa ${
      h.relative_key || '—'
    } · confianza ${conf}%</span>
  `;

  document.getElementById('scale-row').replaceChildren(
    ...(h.scale_notes_es || []).map((n, i) => {
      const el = document.createElement('span');
      el.className = 'note-pill' + (i === 0 ? ' tonic' : '');
      el.innerHTML = `<strong>${n}</strong><small>${h.scale_notes?.[i] || ''}</small>`;
      return el;
    }),
  );

  document.getElementById('peaks-row').replaceChildren(
    ...(h.peaks || []).slice(0, 6).map((p) => {
      const el = document.createElement('span');
      el.className = 'peak-pill';
      el.innerHTML = `<strong>${p.note_es}${p.octave}</strong><small>${p.hz} Hz</small>`;
      return el;
    }),
  );

  const mixStats = document.getElementById('mix-stats');
  mixStats.replaceChildren();
  [
    ['Brillo', dna.timbre?.brightness],
    ['Textura', dna.timbre?.roughness],
    ['Atmósfera', dna.narrative?.atmosphere],
    ['Dominante', dna.narrative?.dominant_element],
    ['Sample rate', dna.track?.sample_rate ? `${dna.track.sample_rate} Hz` : null],
    ['Codec', dna.track?.codec],
  ]
    .filter(([, v]) => v != null && v !== '')
    .forEach(([k, v]) => {
      const el = document.createElement('div');
      el.className = 'mix-stat';
      el.innerHTML = `<span>${k}</span><strong>${v}</strong>`;
      mixStats.appendChild(el);
    });

  const lines = h.explanation_lines?.length
    ? h.explanation_lines
    : h.explanation
      ? [h.explanation]
      : ['Sin explicación armónica.'];
  document.getElementById('explain-list').replaceChildren(
    ...lines.map((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      return li;
    }),
  );
}

function renderFormStrip(dna) {
  const strip = document.getElementById('form-strip');
  const sections = dna.form || [];
  const duration = dna.track?.duration_s || 1;
  strip.replaceChildren(
    ...sections.map((s) => {
      const el = document.createElement('div');
      el.className = `form-seg form-${s.name}`;
      const len = Math.max(0.01, (s.end_s ?? duration) - s.start_s);
      el.style.flex = String(len);
      el.innerHTML = `<strong>${s.name}</strong><span>${formatDur(s.start_s)}–${formatDur(
        s.end_s,
      )} · E${s.energy}/10 · ${s.bars} bars</span>`;
      return el;
    }),
  );
}

function renderLayers(dna) {
  document.getElementById('layers-row').replaceChildren(
    ...(dna.layers || []).map((l) => {
      const el = document.createElement('div');
      el.className = `layer-chip presence-${l.presence || 'unknown'}`;
      el.innerHTML = `<strong>${l.id}</strong><span>${l.role} · ${l.freq_hint} · ${l.presence}</span><em>${l.notes}</em>`;
      return el;
    }),
  );
}

async function renderLab(dna) {
  const Plotly = await waitForPlotly();
  renderMetrics(dna);
  renderMusic(dna);
  renderFormStrip(dna);
  renderLayers(dna);
  await Promise.all([
    plotSpectrum(Plotly, dna),
    plotEnergy(Plotly, dna),
    plotChroma(Plotly, dna),
    plotBands(Plotly, dna),
    plotRhythm(Plotly, dna),
  ]);
  // Force layout after modal is visible
  requestAnimationFrame(() => {
    PLOT_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) Plotly.Plots.resize(el);
    });
  });
}

function applyDna(dna, file, format) {
  lastDna = dna;
  const title = dna.track?.title || file.name;
  resultTitle.textContent = title;
  resultSub.textContent = [
    dna.track?.artist || null,
    dna.track?.bpm ? `${dna.track.bpm} BPM` : null,
    dna.harmony?.key_es || null,
    formatDur(dna.track?.duration_s),
    dna.narrative?.atmosphere || null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (format === 'yaml') {
    lastPayload = `${dnaToYaml(dna)}\n`;
    lastFilename = `${file.name.replace(/\.[^.]+$/, '')}-dna.yaml`;
  } else {
    lastPayload = JSON.stringify(dna, null, 2);
    lastFilename = `${title.replace(/\s+/g, '-')}-dna.json`;
  }
  outputEl.textContent = lastPayload;
}

/* ── events ─────────────────────────────────────────── */

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0] || null;
  setFile(file);
  if (file) setStatus(`Seleccionado: ${file.name}`);
});

clearFileBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  setFile(null);
  setStatus('Archivo quitado. Elige otro audio.');
});

resetBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  await fullReset();
  setStatus('Formulario reiniciado.');
});

closeModalBtn.addEventListener('click', () => closeModal());

modal.querySelectorAll('[data-close-modal]').forEach((el) => {
  el.addEventListener('click', () => closeModal());
});

if (docsModal) {
  closeDocsBtn?.addEventListener('click', () => closeDocsModal());
  docsModal.querySelectorAll('[data-close-docs]').forEach((el) => {
    el.addEventListener('click', () => closeDocsModal());
  });
  openDocsLink?.addEventListener('click', (e) => {
    e.preventDefault();
    openDocsModal();
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!docsModal?.hidden) closeDocsModal();
  else if (!modal.hidden) closeModal();
});

if (location.hash === '#documentacion') {
  openDocsModal();
}

window.addEventListener('hashchange', () => {
  if (location.hash === '#documentacion') openDocsModal();
  else if (!docsModal?.hidden) closeDocsModal();
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    setFile(file);
    setStatus(`Seleccionado: ${file.name}`);
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = selectedFile || fileInput.files?.[0];
  if (!file) {
    setStatus('Selecciona un archivo de audio.', { error: true });
    return;
  }

  if (analyzeAbort) analyzeAbort.abort();
  analyzeAbort = new AbortController();
  const { signal } = analyzeAbort;
  const token = ++renderToken;
  const format = formatSelect.value;

  const body = new FormData();
  body.append('audio', file);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Analizando…';
  setStatus(`Extrayendo ADN de ${file.name}…`, { busy: true });
  startProgress();

  openModal({ loading: true });
  clearLabDom();
  await purgePlots();

  try {
    const res = await fetch('/api/analyze?format=json', {
      method: 'POST',
      body,
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.detail || `Error ${res.status}`);
    }

    const dna = await res.json();
    if (token !== renderToken) return;

    applyDna(dna, file, format);
    labBusy.hidden = true;
    stopProgress(true);
    setStatus('Análisis listo — laboratorio abierto.');
    await renderLab(dna);

    // Reset form so user can pick another file cleanly
    form.reset();
    formatSelect.value = format;
    setFile(null);
    submitBtn.textContent = 'Extraer ADN';
  } catch (err) {
    if (err.name === 'AbortError') {
      setStatus('Análisis cancelado.');
      stopProgress(false);
      closeModal();
      return;
    }
    stopProgress(false);
    labBusy.hidden = true;
    closeModal();
    setStatus(err.message || 'Falló el análisis', { error: true });
  } finally {
    if (token === renderToken) {
      submitBtn.disabled = false;
      if (submitBtn.textContent === 'Analizando…') submitBtn.textContent = 'Extraer ADN';
    }
  }
});

copyBtn.addEventListener('click', async () => {
  if (!lastPayload) return;
  await navigator.clipboard.writeText(lastPayload);
  setStatus('ADN copiado.');
});

downloadBtn.addEventListener('click', () => {
  if (!lastPayload) return;
  const blob = new Blob([lastPayload], {
    type: lastFilename.endsWith('.yaml') ? 'text/yaml' : 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = lastFilename;
  a.click();
  URL.revokeObjectURL(url);
});

window.addEventListener('resize', () => {
  if (modal.hidden || !window.Plotly) return;
  PLOT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el?.data) window.Plotly.Plots.resize(el);
  });
});

/* Hero scope */
(function scopeAnim() {
  const canvas = document.getElementById('scope');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w;
  let h;
  let t0 = performance.now();

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    w = Math.max(320, Math.floor(rect.width));
    h = Math.max(240, Math.floor(rect.width * 0.52));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function wave(x, t, layer) {
    const n1 = Math.sin(x * 0.018 + t * 2.1 + layer) * 18;
    const n2 = Math.sin(x * 0.045 - t * 3.4 + layer * 2) * 8;
    const kick = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2.4)), 12) * 42;
    return h * 0.55 + n1 + n2 - kick * (layer === 0 ? 1 : 0.35);
  }

  function frame(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(18,21,26,0.12)';
    ctx.lineWidth = 1;
    for (let y = 40; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ['#12151a', '#c6ff1a', 'rgba(18,21,26,0.35)'].forEach((color, layer) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = layer === 1 ? 2.2 : 1.4;
      for (let x = 0; x <= w; x += 2) {
        const y = wave(x, t + layer * 0.15, layer);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
