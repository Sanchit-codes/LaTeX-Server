'use strict';

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { checkDockerAvailable, getDockerStatus } = require('./src/docker');
const compileRoutes = require('./src/routes/compile');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Web UI
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting — applied to compile endpoints only
const compileLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limit_exceeded',
    message: 'Too many compilation requests. Please slow down.',
  },
});

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  const { available, reason } = await getDockerStatus();
  res.status(available ? 200 : 503).json({
    status: available ? 'ok' : 'degraded',
    latex: available,
    build: 'v2-exdev-fix',
    dockerImage: process.env.DOCKER_IMAGE || 'texlive/texlive:latest',
    ...(reason ? { dockerError: reason } : {}),
    timestamp: new Date().toISOString(),
  });
});

app.use('/compile', compileLimiter, compileRoutes);

// Catch-all: serve Web UI for non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global Error Handler ────────────────────────────────────────────────────

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[Error]', err);
  res.status(err.status || 500).json({
    error: err.code || 'internal_error',
    message: err.message || 'An unexpected error occurred.',
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀  LaTeX Server running on http://localhost:${PORT}`);
  console.log(`📄  API: POST /compile  |  POST /compile/zip`);
  console.log(`🔍  Health: GET /health\n`);

  // Validate Docker on startup (non-blocking)
  checkDockerAvailable().then((ok) => {
    if (ok) {
      console.log(`✅  Docker is available — LaTeX compilation ready.`);
    } else {
      console.warn(`⚠️   Docker not found! Compilation will fail. Ensure Docker is running.`);
    }
  });
});

module.exports = app;
