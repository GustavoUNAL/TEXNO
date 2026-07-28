import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeTrack, toYaml } from './analyzer/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok =
      /^audio\//.test(file.mimetype) ||
      /\.(mp3|wav|flac|ogg|m4a|aac|aiff|aif)$/i.test(file.originalname);
    cb(ok ? null : new Error('Solo archivos de audio'), ok);
  },
});

const app = express();
app.disable('x-powered-by');
app.use(express.static(join(root, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'texno', version: '1.0.0' });
});

app.post('/api/analyze', (req, res) => {
  upload.single('audio')(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Upload inválido' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Falta el campo audio' });
      return;
    }

    const format = (req.query.format || req.body?.format || 'json').toString();

    try {
      const dna = await analyzeTrack({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        filename: req.file.originalname,
      });

      if (format === 'yaml' || format === 'yml') {
        res.type('text/yaml').send(toYaml(dna));
        return;
      }
      res.json(dna);
    } catch (e) {
      console.error(e);
      res.status(500).json({
        error: 'No se pudo analizar el audio',
        detail: e.message || String(e),
      });
    }
  });
});

app.listen(PORT, () => {
  console.log(`TEXNO listening on http://localhost:${PORT}`);
});
