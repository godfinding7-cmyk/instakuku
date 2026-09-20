const menuBtn = document.querySelector('[data-menu]');
const navLinks = document.querySelector('[data-navlinks]');
if (menuBtn && navLinks) menuBtn.addEventListener('click', () => navLinks.classList.toggle('open'));

const form = document.querySelector('#downloadForm');
const urlInput = document.querySelector('#reelUrl');
const pasteBtn = document.querySelector('#pasteBtn');
const statusEl = document.querySelector('#status');
const result = document.querySelector('#result');

function prettyBytes(bytes) {
  if (!bytes) return '';
  const units = ['B','KB','MB','GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
function prettyTime(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

if (pasteBtn && urlInput) {
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      urlInput.value = text;
      urlInput.focus();
    } catch {
      statusEl.textContent = 'Clipboard access was blocked. Paste the Reel URL manually.';
    }
  });
}

if (form) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;
    statusEl.textContent = 'Analyzing public Reel…';
    result.classList.remove('visible');
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ url })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Analysis failed.');

      const thumb = result.querySelector('[data-thumb]');
      const title = result.querySelector('[data-title]');
      const meta = result.querySelector('[data-meta]');
      const qualities = result.querySelector('[data-qualities]');
      thumb.src = data.thumbnail || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="600"%3E%3Crect width="100%25" height="100%25" fill="%23eee"/%3E%3C/svg%3E';
      title.textContent = data.title || 'Instagram Reel';
      meta.textContent = [data.uploader, prettyTime(data.duration)].filter(Boolean).join(' • ');
      qualities.innerHTML = '';

      const formats = data.formats?.length ? data.formats : [{formatId:'best', height:null, ext:'mp4'}];
      formats.forEach((f, index) => {
        const a = document.createElement('a');
        const label = f.height ? `${f.height}p` : (index === 0 ? 'Best quality' : 'MP4');
        const size = prettyBytes(f.filesize);
        a.className = 'quality-btn';
        a.textContent = `${label}${size ? ` · ${size}` : ''}`;
        a.href = `/api/download?url=${encodeURIComponent(url)}&format=${encodeURIComponent(f.formatId)}`;
        a.rel = 'nofollow';
        qualities.appendChild(a);
      });
      result.classList.add('visible');
      statusEl.textContent = 'Ready. Choose an available quality below.';
    } catch (err) {
      statusEl.textContent = err.message || 'Could not analyze this Reel.';
    }
  });
}
