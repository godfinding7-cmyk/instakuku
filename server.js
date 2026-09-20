'use strict';

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_DOWNLOAD_MB = Number(process.env.MAX_DOWNLOAD_MB || 250);
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

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

const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});

app.use('/api', apiLimiter);
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function validateReelUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const allowedHost = host === 'instagram.com';
    const allowedPath = /^\/(reel|reels)\/[A-Za-z0-9_-]+\/?/.test(u.pathname);
    return allowedHost && allowedPath ? u.toString() : null;
  } catch {
    return null;
  }
}

function runYtDlp(args, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Request timed out.'));
    }, timeoutMs);

    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
    });
  });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'instakuku', mode: 'public-reels-only' });
});

app.post('/api/analyze', async (req, res) => {
  const reelUrl = validateReelUrl(req.body?.url || '');
  if (!reelUrl) return res.status(400).json({ error: 'Please enter a valid public Instagram Reel URL.' });

  try {
    const { stdout } = await runYtDlp([
      '--dump-single-json', '--no-playlist', '--no-warnings', '--no-call-home',
      '--socket-timeout', '15', reelUrl
    ]);
    const data = JSON.parse(stdout);

    const progressive = (data.formats || [])
      .filter(f => f.url && f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
      .map(f => ({
        formatId: String(f.format_id),
        ext: f.ext || 'mp4',
        width: f.width || null,
        height: f.height || null,
        filesize: f.filesize || f.filesize_approx || null,
        fps: f.fps || null,
        note: f.format_note || null
      }))
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    const seen = new Set();
    const formats = progressive.filter(item => {
      const key = `${item.height || 0}-${item.ext}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5);

    res.json({
      id: data.id || null,
      title: (data.title || 'Instagram Reel').slice(0, 160),
      thumbnail: data.thumbnail || null,
      duration: data.duration || null,
      uploader: data.uploader || data.channel || null,
      formats
    });
  } catch (err) {
    res.status(422).json({ error: 'Could not analyze this Reel. It may be private, unavailable, age-restricted, or temporarily blocked by Instagram.' });
  }
});

app.get('/api/download', async (req, res) => {
  const reelUrl = validateReelUrl(req.query.url || '');
  if (!reelUrl) return res.status(400).json({ error: 'Invalid Reel URL.' });

  const formatId = String(req.query.format || 'best').replace(/[^A-Za-z0-9._+-]/g, '');
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'instakuku-'));
  const outputTpl = path.join(tmpDir, 'reel.%(ext)s');

  try {
    const selector = formatId === 'best'
      ? 'best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]'
      : `${formatId}/best[ext=mp4][vcodec!=none][acodec!=none]`;

    await runYtDlp([
      '--no-playlist', '--no-warnings', '--no-call-home', '--socket-timeout', '15',
      '--max-filesize', `${MAX_DOWNLOAD_MB}M`, '-f', selector,
      '--restrict-filenames', '-o', outputTpl, reelUrl
    ], 180000);

    const files = (await fsp.readdir(tmpDir)).filter(name => !name.endsWith('.part'));
    if (!files.length) throw new Error('No output file produced.');
    const filePath = path.join(tmpDir, files[0]);
    const stat = await fsp.stat(filePath);
    if (stat.size > MAX_DOWNLOAD_MB * 1024 * 1024) throw new Error('File exceeds server limit.');

    const safeName = `instakuku-reel-${Date.now()}${path.extname(filePath) || '.mp4'}`;
    res.download(filePath, safeName, async () => {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });
  } catch (err) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    if (!res.headersSent) res.status(422).json({ error: 'Download could not be prepared. Try another public Reel or a different quality.' });
  }
});

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`InstaKuku running on http://localhost:${PORT}`);
});
