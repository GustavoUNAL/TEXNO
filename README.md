# TEXNO

Análisis estructural de composiciones musicales. Extrae un “ADN” (JSON/YAML) a partir de un audio y lo muestra en una landing.

## Requisitos

- Node.js 18+
- (Opcional) [PM2](https://pm2.keymetrics.io/) para producción

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Producción (npm)

```bash
npm start
```

## Producción (PM2)

```bash
npm install -g pm2
npm run pm2:start
```

Comandos útiles:

```bash
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
```

## CLI

Analiza un archivo local y escribe el resultado:

```bash
npm run analyze -- ./track.mp3
npm run analyze -- ./track.mp3 --format yaml --out dna.yaml
```

## API

`POST /api/analyze` — `multipart/form-data` con campo `audio`.

Respuesta: JSON con forma, tempo, espectro, dinámica, capas estimadas y schema completo.

---

📧 gustavoarteaga0508@gmail.com
