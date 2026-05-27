'use strict';

/* ─── DOM refs ──────────────────────────────────────────────────────────── */
const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const browseBtn      = document.getElementById('browse-btn');
const fileInfo       = document.getElementById('file-info');
const fileNameEl     = document.getElementById('file-name-display');
const fileSizeEl     = document.getElementById('file-size-display');
const clearFileBtn   = document.getElementById('clear-file-btn');
const outputNameEl   = document.getElementById('output-name');
const engineSelect   = document.getElementById('engine-select');
const runsSelect     = document.getElementById('runs-select');
const mainFileGroup  = document.getElementById('main-file-group');
const mainFileInput  = document.getElementById('main-file-input');
const compileBtn     = document.getElementById('compile-btn');
const progressSec    = document.getElementById('progress-section');
const progressTitle  = document.getElementById('progress-title');
const progressSub    = document.getElementById('progress-sub');
const resultSec      = document.getElementById('result-section');
const resultSuccess  = document.getElementById('result-success');
const resultError    = document.getElementById('result-error');
const resultFilename = document.getElementById('result-filename');
const errorTitle     = document.getElementById('error-title');
const errorMessage   = document.getElementById('error-message');
const downloadBtn    = document.getElementById('download-btn');
const viewLogBtn     = document.getElementById('view-log-btn');
const logContent     = document.getElementById('log-content');
const closeLogBtn    = document.getElementById('close-log-btn');
const healthBadge    = document.getElementById('health-badge');
const healthDot      = healthBadge.querySelector('.health-dot');
const healthLabel    = healthBadge.querySelector('.health-label');
const copyBtns       = document.querySelectorAll('.copy-btn');

let selectedFile = null;

/* ─── Health check ──────────────────────────────────────────────────────── */
async function checkHealth() {
  try {
    const res  = await fetch('/health');
    const data = await res.json();

    if (data.status === 'ok' && data.latex) {
      healthBadge.classList.add('ok');
      healthLabel.textContent = 'LaTeX ready';
    } else {
      healthBadge.classList.add('warn');
      healthLabel.textContent = 'Docker unavailable';
    }
  } catch {
    healthBadge.classList.add('warn');
    healthLabel.textContent = 'Server offline';
  }
}
checkHealth();

/* ─── File selection ─────────────────────────────────────────────────────── */
function formatSize(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

function setFile(file) {
  if (!file) return;
  selectedFile = file;

  const isZip = file.name.toLowerCase().endsWith('.zip');
  fileNameEl.textContent  = file.name;
  fileSizeEl.textContent  = formatSize(file.size);
  mainFileGroup.style.display = isZip ? '' : 'none';

  fileInfo.classList.remove('hidden');
  dropZone.classList.add('hidden');
  resultSec.classList.add('hidden');
  compileBtn.disabled = false;
}

function clearFile() {
  selectedFile = null;
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dropZone.classList.remove('hidden');
  mainFileGroup.style.display = 'none';
  compileBtn.disabled = true;
  resultSec.classList.add('hidden');
}

browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});
clearFileBtn.addEventListener('click', clearFile);

// Keyboard support for drop zone
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

/* ─── Drag & drop ────────────────────────────────────────────────────────── */
['dragenter','dragover'].forEach(evt =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  })
);
['dragleave','drop'].forEach(evt =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  })
);
dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  const ext  = file?.name.split('.').pop().toLowerCase();
  if (file && ['tex', 'zip'].includes(ext)) {
    setFile(file);
  } else {
    showToast('Only .tex and .zip files are supported.', 'error');
  }
});

// Global drag-over guard (prevents browser from opening the file)
document.addEventListener('dragover',  (e) => e.preventDefault());
document.addEventListener('drop',      (e) => e.preventDefault());

/* ─── Compile ────────────────────────────────────────────────────────────── */
compileBtn.addEventListener('click', compileFile);

async function compileFile() {
  if (!selectedFile) return;

  const isZip = selectedFile.name.toLowerCase().endsWith('.zip');
  const endpoint = isZip ? '/compile/zip' : '/compile';

  const formData = new FormData();
  formData.append('file', selectedFile);

  const outputName = outputNameEl.value.trim();
  if (outputName)                 formData.append('outputName', outputName);
  formData.append('engine', engineSelect.value);
  formData.append('runs',   runsSelect.value);

  if (isZip && mainFileInput.value.trim()) {
    formData.append('mainFile', mainFileInput.value.trim());
  }

  // Show progress
  compileBtn.disabled = true;
  resultSec.classList.add('hidden');
  progressSec.classList.remove('hidden');
  progressTitle.textContent = 'Compiling…';
  progressSub.textContent   = 'This may take up to 60 seconds';

  // Animate progress sub after delay
  const subTimer = setTimeout(() => {
    progressSub.textContent = `Running ${engineSelect.value} (pass ${runsSelect.value} of ${runsSelect.value})…`;
  }, 5000);

  try {
    const res = await fetch(endpoint, { method: 'POST', body: formData });

    clearTimeout(subTimer);
    progressSec.classList.add('hidden');
    resultSec.classList.remove('hidden');

    if (res.ok && res.headers.get('Content-Type')?.includes('application/pdf')) {
      // Success — create object URL for download
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);

      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : (outputName || selectedFile.name.replace(/\.tex$/, '')) + '.pdf';

      downloadBtn.href     = url;
      downloadBtn.download = filename;
      resultFilename.textContent = filename;

      resultSuccess.style.display = '';
      resultError.style.display   = 'none';

      // Auto-revoke after 10 min
      setTimeout(() => URL.revokeObjectURL(url), 600_000);
    } else {
      // Error response
      const data = await res.json().catch(() => ({ message: 'Unknown error', log: null }));
      showError(data);
    }
  } catch (err) {
    clearTimeout(subTimer);
    progressSec.classList.add('hidden');
    resultSec.classList.remove('hidden');
    showError({ message: `Network error: ${err.message}`, log: null });
  } finally {
    compileBtn.disabled = false;
  }
}

function showError(data) {
  resultSuccess.style.display = 'none';
  resultError.style.display   = '';
  errorTitle.textContent   = data.error ? `Error: ${data.error}` : 'Compilation failed';
  errorMessage.textContent = data.message || 'An error occurred during compilation.';
  logContent.textContent   = data.log || '(no log available)';

  // Auto-open the log panel when there's log content
  if (data.log) {
    // Slight delay so the result section renders first
    setTimeout(openLogPanel, 200);
  }
}

/* ─── Log Side Panel ─────────────────────────────────────────────────────── */
const logPanel    = document.getElementById('log-panel');
const copyLogBtn  = document.getElementById('copy-log-btn');

function openLogPanel() {
  logPanel.classList.add('open');
  logPanel.setAttribute('aria-hidden', 'false');
}
function closeLogPanel() {
  logPanel.classList.remove('open');
  logPanel.setAttribute('aria-hidden', 'true');
}

viewLogBtn.addEventListener('click', openLogPanel);
closeLogBtn.addEventListener('click', closeLogPanel);

// Escape to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && logPanel.classList.contains('open')) {
    closeLogPanel();
  }
});

// Copy log content
copyLogBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(logContent.textContent);
    copyLogBtn.style.color = 'var(--clr-success)';
    setTimeout(() => { copyLogBtn.style.color = ''; }, 1500);
  } catch { /* ignore */ }
});

/* ─── Copy buttons ───────────────────────────────────────────────────────── */
copyBtns.forEach(btn => {
  btn.addEventListener('click', async () => {
    const target = document.getElementById(btn.dataset.target);
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.textContent.trim());
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 2000);
    } catch {
      btn.textContent = 'Failed';
    }
  });
});

/* ─── Toast ──────────────────────────────────────────────────────────────── */
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px);
    background:${type === 'error' ? '#7f1d1d' : '#1e1b4b'};
    border:1px solid ${type === 'error' ? '#f87171' : '#7c6af7'};
    color:#fff; padding:10px 20px; border-radius:10px;
    font-size:14px; font-family:Inter,sans-serif;
    opacity:0; transition:all 0.3s ease; z-index:9999; pointer-events:none;
    max-width:90vw; text-align:center;
  `;
  document.body.appendChild(t);
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}
