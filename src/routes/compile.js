'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fsp = require('fs/promises');
const { compileTex, VALID_ENGINES } = require('../compiler');
const {
  WORKDIR_ROOT,
  createTempDir,
  cleanupTempDir,
  copyFileToDir,
  extractZip,
  detectMainTexFile,
} = require('../fileManager');


const router = express.Router();

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 52_428_800; // 50 MB

// ─── Multer config ───────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  // Write uploads directly into WORKDIR_ROOT (the bind-mounted shared volume)
  // so they are on the same device as workDir — avoids EXDEV cross-device rename.
  destination: (req, file, cb) => {
    require('fs').mkdirSync(WORKDIR_ROOT, { recursive: true });
    cb(null, WORKDIR_ROOT);
  },
  filename: (req, file, cb) => {
    cb(null, `upload-${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.tex', '.zip'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      const err = new Error(`Invalid file type: ${ext}. Allowed: .tex, .zip`);
      err.code = 'INVALID_FILE_TYPE';
      err.status = 400;
      cb(err);
    }
  },
});

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Extract query/body parameters for compilation options.
 */
function parseCompileOptions(body) {
  const { outputName, engine, runs } = body;
  return {
    outputName: outputName ? String(outputName).trim() : null,
    engine: engine ? String(engine).trim().toLowerCase() : null,
    runs: runs ? parseInt(runs) : null,
  };
}

/**
 * Send a compiled PDF back to the client.
 * @param {express.Response} res
 * @param {string} pdfPath    Absolute path to the PDF
 * @param {string} outputName Desired download filename (without .pdf)
 */
async function sendPdf(res, pdfPath, outputName) {
  const filename = `${outputName || path.basename(pdfPath, '.pdf')}.pdf`;
  const stat = await fsp.stat(pdfPath);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', stat.size);
  res.sendFile(pdfPath);
}

/**
 * Map a compiler error to an HTTP response.
 */
function handleCompileError(res, err) {
  console.error(`[Route] Compilation error (${err.code}): ${err.message}`);

  const errorMap = {
    COMPILE_ERROR: { status: 422, error: 'compilation_failed' },
    TIMEOUT:       { status: 408, error: 'compilation_timeout' },
    NO_PDF:        { status: 422, error: 'no_pdf_produced' },
  };

  const mapped = errorMap[err.code] || { status: 500, error: 'internal_error' };

  res.status(mapped.status).json({
    error: mapped.error,
    message: err.message,
    log: err.log || null,
    exitCode: err.exitCode || null,
  });
}

// ─── POST /compile ────────────────────────────────────────────────────────────
// Accepts a single .tex file.

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'missing_file',
      message: 'No file uploaded. Send a .tex file in the "file" field.',
    });
  }

  if (path.extname(req.file.originalname).toLowerCase() !== '.tex') {
    return res.status(400).json({
      error: 'invalid_file_type',
      message: 'Only .tex files are accepted on this endpoint. Use /compile/zip for projects.',
    });
  }

  const options = parseCompileOptions(req.body);

  // Validate engine
  if (options.engine && !VALID_ENGINES.includes(options.engine)) {
    return res.status(400).json({
      error: 'invalid_engine',
      message: `Invalid engine "${options.engine}". Valid options: ${VALID_ENGINES.join(', ')}`,
    });
  }

  let workDir = null;

  try {
    workDir = await createTempDir();

    // Move uploaded file into workDir.
    // Use copyFile + unlink instead of rename() to handle cross-device
    // moves (EXDEV) when /tmp and WORKDIR_ROOT are on different mount points.
    const destPath = path.join(workDir, req.file.originalname);
    await fsp.copyFile(req.file.path, destPath);
    await fsp.unlink(req.file.path).catch(() => {});

    const { pdfPath } = await compileTex({
      workDir,
      texFile: req.file.originalname,
      outputName: options.outputName,
      engine: options.engine,
      runs: options.runs,
    });

    await sendPdf(res, pdfPath, options.outputName || path.basename(req.file.originalname, '.tex'));
  } catch (err) {
    // Uploaded file was already unlinked above; nothing extra to clean up.
    handleCompileError(res, err);
  } finally {
    // Cleanup after sending (non-blocking)
    if (workDir) setImmediate(() => cleanupTempDir(workDir));
  }
});

// ─── POST /compile/zip ────────────────────────────────────────────────────────
// Accepts a .zip archive containing a LaTeX project.

router.post('/zip', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'missing_file',
      message: 'No file uploaded. Send a .zip archive in the "file" field.',
    });
  }

  if (path.extname(req.file.originalname).toLowerCase() !== '.zip') {
    return res.status(400).json({
      error: 'invalid_file_type',
      message: 'Only .zip files are accepted on this endpoint.',
    });
  }

  const options = parseCompileOptions(req.body);
  const { mainFile } = req.body;

  // Validate engine
  if (options.engine && !VALID_ENGINES.includes(options.engine)) {
    return res.status(400).json({
      error: 'invalid_engine',
      message: `Invalid engine "${options.engine}". Valid options: ${VALID_ENGINES.join(', ')}`,
    });
  }

  let workDir = null;

  try {
    workDir = await createTempDir();

    // Extract ZIP
    let entryNames;
    try {
      entryNames = await extractZip(req.file.path, workDir);
    } catch (err) {
      return res.status(400).json({
        error: 'invalid_zip',
        message: `Could not extract ZIP archive: ${err.message}`,
      });
    } finally {
      // Clean up uploaded zip file
      try { await fsp.unlink(req.file.path); } catch { /* ignore */ }
    }

    // Resolve main .tex file
    let resolvedMain = mainFile ? String(mainFile).trim() : null;

    if (!resolvedMain) {
      resolvedMain = detectMainTexFile(workDir, entryNames);
    }

    if (!resolvedMain) {
      const texFiles = entryNames.filter(e => e.toLowerCase().endsWith('.tex'));
      return res.status(400).json({
        error: 'ambiguous_main_file',
        message: texFiles.length === 0
          ? 'No .tex files found in the ZIP archive.'
          : `Multiple .tex files found. Specify "mainFile" parameter. Found: ${texFiles.join(', ')}`,
        texFiles,
      });
    }

    const { pdfPath } = await compileTex({
      workDir,
      texFile: resolvedMain,
      outputName: options.outputName,
      engine: options.engine,
      runs: options.runs,
    });

    const defaultName = options.outputName || path.basename(resolvedMain, '.tex');
    await sendPdf(res, pdfPath, defaultName);
  } catch (err) {
    handleCompileError(res, err);
  } finally {
    if (workDir) setImmediate(() => cleanupTempDir(workDir));
  }
});

module.exports = router;
