'use strict';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_DOWNLOAD_MB = Number(process.env.MAX_DOWNLOAD_MB || 150);
const MAX_CONCURRENT_DOWNLOADS = Number(process.env.MAX_CONCURRENT_DOWNLOADS || 1);
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ITEMS = 80;
const analysisCache = new Map();
let activeDownloads = 0;

app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use('/api', rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
}));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function validateReelUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'instagram.com' || !/^\/(reel|reels)\/[A-Za-z0-9_-]+\/?/.test(u.pathname)) return null;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function runYtDlp(args, timeoutMs = 55000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args, { windowsHide: true, env: { ...process.env, LC_ALL: 'C.UTF-8' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      const e = new Error('Request timed out.');
      e.stderr = stderr;
      reject(e);
    }, timeoutMs);
    proc.stdout.on('data', c => { stdout += c.toString(); });
    proc.stderr.on('data', c => { stderr += c.toString(); });
    proc.on('error', err => {
      clearTimeout(timer);
      err.stderr = stderr;
      reject(err);
    });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const e = new Error(stderr.trim() || `yt-dlp exited with code ${code}`);
        e.stderr = stderr;
        e.code = code;
        reject(e);
      }
    });
  });
}

function commonArgs() {
  return [
    '--no-playlist',
    '--no-warnings',
    '--no-call-home',
    '--socket-timeout', '18',
    '--retries', '2',
    '--extractor-retries', '2',
    '--force-ipv4',
    '--user-agent', 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    '--referer', 'https://www.instagram.com/'
  ];
}

async function extractJson(reelUrl) {
  const attempts = [
    [...commonArgs(), '--impersonate', 'chrome', '--dump-single-json', reelUrl],
    [...commonArgs(), '--dump-single-json', reelUrl]
  ];
  let lastErr;
  for (const args of attempts) {
    try {
      const out = await runYtDlp(args);
      return {
        data: JSON.parse(out.stdout),
        method: args.includes('--impersonate') ? 'browser-like request' : 'standard request'
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function classifyUpstream(err) {
  const s = String(err?.stderr || err?.message || '').toLowerCase();
  if (
    s.includes('login required') ||
    s.includes('rate-limit') ||
    s.includes('rate limit') ||
    s.includes('challenge') ||
    s.includes('requested content is not available')
  ) return 'UPSTREAM_BLOCKED';
  return 'EXTRACTION_FAILED';
}

function cleanupCache() {
  const now = Date.now();
  for (const [key, entry] of analysisCache) {
    if (now - entry.savedAt > CACHE_TTL_MS) analysisCache.delete(key);
  }
  while (analysisCache.size > CACHE_MAX_ITEMS) {
    const oldest = analysisCache.keys().next().value;
    analysisCache.delete(oldest);
  }
}

function getCached(reelUrl) {
  cleanupCache();
  const entry = analysisCache.get(reelUrl);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > CACHE_TTL_MS) {
    analysisCache.delete(reelUrl);
    return null;
  }
  return entry;
}

function saveCached(reelUrl, data, method) {
  analysisCache.delete(reelUrl);
  analysisCache.set(reelUrl, { data, method, savedAt: Date.now() });
  cleanupCache();
}

function directFormats(data) {
  const candidates = [];
  const formats = Array.isArray(data?.formats) ? data.formats : [];

  for (const f of formats) {
    if (!f?.url || !/^https?:\/\//i.test(f.url)) continue;
    if (f.vcodec === 'none') continue;
    if (f.acodec === 'none') continue;
    const ext = String(f.ext || 'mp4').toLowerCase();
    if (ext !== 'mp4') continue;
    candidates.push({
      formatId: String(f.format_id || 'best'),
      ext,
      width: f.width || null,
      height: f.height || null,
      filesize: f.filesize || f.filesize_approx || null,
      fps: f.fps || null,
      note: f.format_note || null,
      url: f.url,
      httpHeaders: f.http_headers || data.http_headers || {}
    });
  }

  if (
    data?.url && /^https?:\/\//i.test(data.url) &&
    data.vcodec !== 'none' && data.acodec !== 'none' &&
    String(data.ext || 'mp4').toLowerCase() === 'mp4'
  ) {
    candidates.push({
      formatId: String(data.format_id || 'best'),
      ext: 'mp4',
      width: data.width || null,
      height: data.height || null,
      filesize: data.filesize || data.filesize_approx || null,
      fps: data.fps || null,
      note: data.format_note || null,
      url: data.url,
      httpHeaders: data.http_headers || {}
    });
  }

  candidates.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.filesize || 0) - (a.filesize || 0));
  const seen = new Set();
  return candidates.filter(item => {
    const key = `${item.height || 0}-${item.width || 0}-${item.ext}-${item.formatId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function publicFormats(data) {
  const seenHeights = new Set();
  return directFormats(data).filter(item => {
    const key = `${item.height || 0}-${item.ext}`;
    if (seenHeights.has(key)) return false;
    seenHeights.add(key);
    return true;
  }).slice(0, 6).map(({ url, httpHeaders, ...safe }) => safe);
}

async function getOrExtract(reelUrl) {
  const cached = getCached(reelUrl);
  if (cached) return cached;
  const fresh = await extractJson(reelUrl);
  saveCached(reelUrl, fresh.data, fresh.method);
  return getCached(reelUrl);
}

function chooseDirectFormat(data, requestedId) {
  const formats = directFormats(data);
  if (!formats.length) return null;
  if (requestedId && requestedId !== 'best') {
    const exact = formats.find(f => f.formatId === requestedId);
    if (exact) return exact;
  }
  return formats[0];
}

function safeFileBase(value) {
  return String(value || 'reel').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'reel';
}

function buildUpstreamHeaders(format, data) {
  const raw = format.httpHeaders || data.http_headers || {};
  const out = {};
  const copy = (sourceKey, targetKey = sourceKey) => {
    const v = raw[sourceKey] || raw[sourceKey.toLowerCase()];
    if (v) out[targetKey] = String(v);
  };
  copy('User-Agent', 'User-Agent');
  copy('Referer', 'Referer');
  copy('Accept', 'Accept');
  copy('Accept-Language', 'Accept-Language');
  out['User-Agent'] ||= 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
  out.Referer ||= 'https://www.instagram.com/';
  out.Accept ||= '*/*';
  return out;
}

app.get('/api/health', (req, res) => {
  // Keep health checks extremely cheap on Render Free. Spawning yt-dlp on every
  // health probe can waste CPU and contribute to transient gateway failures.
  res.json({ ok: true, service: 'instakuku', mode: 'public-reels-only', download: 'direct-stream' });
});

app.post('/api/analyze', async (req, res) => {
  const reelUrl = validateReelUrl(req.body?.url || '');
  if (!reelUrl) return res.status(400).json({ code: 'INVALID_URL', error: 'Please enter a valid public Instagram Reel URL.' });

  try {
    const { data, method } = await getOrExtract(reelUrl);
    const formats = publicFormats(data);
    res.json({
      id: data.id || null,
      title: (data.title || 'Instagram Reel').slice(0, 180),
      thumbnail: data.thumbnail || null,
      duration: data.duration || null,
      uploader: data.uploader || data.channel || null,
      formats,
      method
    });
  } catch (err) {
    const code = classifyUpstream(err);
    res.status(code === 'UPSTREAM_BLOCKED' ? 503 : 422).json({
      code,
      error: code === 'UPSTREAM_BLOCKED'
        ? 'Instagram blocked the server request for this Reel. Try again later.'
        : 'Could not read this public Reel right now.',
      detail: process.env.DEBUG === 'true' ? String(err.stderr || err.message).slice(0, 1200) : undefined
    });
  }
});

app.get('/api/download', async (req, res) => {
  const reelUrl = validateReelUrl(req.query.url || '');
  if (!reelUrl) return res.status(400).json({ error: 'Invalid Reel URL.' });

  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    return res.status(429).json({ error: 'Another download is being prepared. Please try again in a moment.' });
  }

  const formatId = String(req.query.format || 'best').replace(/[^A-Za-z0-9._+-]/g, '');
  activeDownloads += 1;
  const controller = new AbortController();
  let finished = false;

  const abortIfUnfinished = () => {
    if (!finished) controller.abort();
  };
  res.once('close', abortIfUnfinished);

  try {
    const { data } = await getOrExtract(reelUrl);
    const selected = chooseDirectFormat(data, formatId);
    if (!selected) {
      return res.status(422).json({ error: 'A direct MP4 stream is not available for this Reel right now.' });
    }

    const knownSize = Number(selected.filesize || 0);
    const maxBytes = MAX_DOWNLOAD_MB * 1024 * 1024;
    if (knownSize && knownSize > maxBytes) {
      return res.status(413).json({ error: `This Reel is larger than the ${MAX_DOWNLOAD_MB} MB server limit.` });
    }

    const upstream = await fetch(selected.url, {
      method: 'GET',
      redirect: 'follow',
      headers: buildUpstreamHeaders(selected, data),
      signal: controller.signal
    });

    if (!upstream.ok || !upstream.body) {
      throw new Error(`Media server returned HTTP ${upstream.status}`);
    }

    const contentLength = Number(upstream.headers.get('content-length') || 0);
    if (contentLength && contentLength > maxBytes) {
      controller.abort();
      return res.status(413).json({ error: `This Reel is larger than the ${MAX_DOWNLOAD_MB} MB server limit.` });
    }

    const type = upstream.headers.get('content-type') || 'video/mp4';
    const reelId = safeFileBase(data.id || 'reel');
    res.status(200);
    res.setHeader('Content-Type', type.startsWith('video/') ? type : 'video/mp4');
    if (contentLength) res.setHeader('Content-Length', String(contentLength));
    res.setHeader('Content-Disposition', `attachment; filename="instakuku-${reelId}.mp4"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    let transferred = 0;
    const limiter = new Transform({
      transform(chunk, enc, cb) {
        transferred += chunk.length;
        if (transferred > maxBytes) {
          controller.abort();
          cb(new Error('Download exceeded server size limit.'));
          return;
        }
        cb(null, chunk);
      }
    });

    await pipeline(Readable.fromWeb(upstream.body), limiter, res);
    finished = true;
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (!res.headersSent) res.status(499).json({ error: 'Download was cancelled.' });
    } else if (!res.headersSent) {
      res.status(422).json({ error: 'Download could not be started. Please analyze the Reel again and retry.' });
    }
  } finally {
    finished = true;
    res.removeListener('close', abortIfUnfinished);
    activeDownloads = Math.max(0, activeDownloads - 1);
  }
});

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`InstaKuku running on http://localhost:${PORT}`);
});
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
