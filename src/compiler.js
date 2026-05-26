'use strict';

const path = require('path');
const fsp = require('fs/promises');
const { runInDocker } = require('./docker');
const { readCompilationLog } = require('./fileManager');

const VALID_ENGINES = ['pdflatex', 'xelatex', 'lualatex'];
const DEFAULT_ENGINE = process.env.DEFAULT_ENGINE || 'pdflatex';
const DEFAULT_RUNS = parseInt(process.env.DEFAULT_RUNS) || 1;
const COMPILATION_TIMEOUT = parseInt(process.env.COMPILATION_TIMEOUT) || 60_000;

/**
 * Sanitize a string for use as a safe filename.
 * Strips path separators and dangerous characters.
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, 200); // Enforce max length
}

/**
 * Core LaTeX compilation function.
 *
 * @param {object} options
 * @param {string} options.workDir      Temp directory containing the .tex file
 * @param {string} options.texFile      Relative path to the .tex file within workDir
 * @param {string} [options.outputName] Desired base name for the output PDF (no extension)
 * @param {string} [options.engine]     LaTeX engine: pdflatex | xelatex | lualatex
 * @param {number} [options.runs]       Number of compilation passes (1-3)
 *
 * @returns {Promise<{ pdfPath: string, log: string }>}
 *   pdfPath — absolute path to the compiled PDF on the host
 *   log     — full LaTeX log text
 *
 * @throws Error with .code = 'COMPILE_ERROR' | 'TIMEOUT' | 'NO_PDF'
 */
async function compileTex({ workDir, texFile, outputName, engine, runs }) {
  // ── Validate / default options ──────────────────────────────────────────
  const resolvedEngine = VALID_ENGINES.includes(engine) ? engine : DEFAULT_ENGINE;
  const resolvedRuns = Math.min(Math.max(parseInt(runs) || DEFAULT_RUNS, 1), 3);

  const texBase = path.basename(texFile, '.tex'); // e.g. "report"
  const safeOutput = outputName ? sanitizeFilename(outputName) : texBase;

  // Relative path within workDir (Docker maps workDir → /workspace)
  const texRelative = path.relative(workDir, path.join(workDir, texFile));

  // ── Build engine command ─────────────────────────────────────────────────
  // -interaction=nonstopmode  Don't pause on errors
  // -no-shell-escape          Block \write18 shell access (security)
  // -halt-on-error            Exit on first error
  // -jobname                  Set the output base name
  const engineCmd = [
    resolvedEngine,
    '-interaction=nonstopmode',
    '-no-shell-escape',
    '-halt-on-error',
    `-jobname=${safeOutput}`,
    texRelative,
  ];

  // ── Compilation passes ───────────────────────────────────────────────────
  let lastStdout = '';
  let lastStderr = '';

  for (let pass = 1; pass <= resolvedRuns; pass++) {
    console.log(`[Compiler] Pass ${pass}/${resolvedRuns} — ${resolvedEngine} on ${texRelative}`);

    try {
      const result = await runInDocker(workDir, engineCmd, COMPILATION_TIMEOUT);
      lastStdout = result.stdout;
      lastStderr = result.stderr;
    } catch (err) {
      // Attach log content to the error for rich error reporting
      const log = await readCompilationLog(workDir, safeOutput);
      err.log = log || err.stdout || err.stderr || '';
      throw err;
    }
  }

  // ── Verify PDF was produced ──────────────────────────────────────────────
  const pdfPath = path.join(workDir, `${safeOutput}.pdf`);
  try {
    await fsp.access(pdfPath);
  } catch {
    const log = await readCompilationLog(workDir, safeOutput);
    const noFileErr = new Error(
      `Compilation succeeded but no PDF was found. ` +
      `Expected: ${safeOutput}.pdf`
    );
    noFileErr.code = 'NO_PDF';
    noFileErr.log = log || lastStdout;
    throw noFileErr;
  }

  const log = await readCompilationLog(workDir, safeOutput);
  console.log(`[Compiler] ✅ PDF produced: ${safeOutput}.pdf`);

  return { pdfPath, log };
}

module.exports = { compileTex, VALID_ENGINES, sanitizeFilename };
