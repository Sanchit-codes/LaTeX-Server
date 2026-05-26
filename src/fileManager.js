'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');

const TEMP_FILE_MAX_AGE = parseInt(process.env.TEMP_FILE_MAX_AGE) || 3_600_000; // 1 hour
const TEMP_CLEANUP_INTERVAL = parseInt(process.env.TEMP_CLEANUP_INTERVAL) || 3_600_000;

/**
 * WORKDIR_ROOT is the directory used for temp compilation jobs.
 *
 * CRITICAL for Docker deployments:
 * This path must be a bind-mount shared between the latex-server container
 * and the host, so that when we spawn sibling texlive containers with
 *   -v <workDir>:/workspace
 * Docker resolves that path on the HOST filesystem (not inside this container).
 *
 * Set via the WORKDIR_ROOT env var in docker-compose.yml.
 * The same path must be bind-mounted into the latex-server container.
 */
const WORKDIR_ROOT = process.env.WORKDIR_ROOT || '/latex-workdirs';

/** Prefix for all temp directories created by this service. */
const TEMP_PREFIX = 'latex-server-';

/**
 * Create a unique temp working directory for a compilation job.
 * @returns {Promise<string>} Absolute path to the new temp dir
 */
async function createTempDir() {
  // Ensure the root exists (first-run / volume not pre-created)
  await fsp.mkdir(WORKDIR_ROOT, { recursive: true });
  const dir = path.join(WORKDIR_ROOT, `${TEMP_PREFIX}${uuidv4()}`);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Remove a temp directory and all its contents.
 * Silently ignores errors (e.g. already deleted).
 * @param {string} dirPath
 */
async function cleanupTempDir(dirPath) {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

/**
 * Copy a single file into a target directory.
 * @param {string} srcPath    Source file path
 * @param {string} destDir    Destination directory
 * @returns {Promise<string>} Path of the copied file
 */
async function copyFileToDir(srcPath, destDir) {
  const dest = path.join(destDir, path.basename(srcPath));
  await fsp.copyFile(srcPath, dest);
  return dest;
}

/**
 * Extract a ZIP archive into a target directory.
 * Returns the list of extracted file paths.
 * @param {string} zipPath    Path to the ZIP file
 * @param {string} destDir    Target extraction directory
 * @returns {Promise<string[]>} List of extracted entry names
 */
async function extractZip(zipPath, destDir) {
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, /* overwrite */ true);

  const entries = zip.getEntries()
    .filter(e => !e.isDirectory)
    .map(e => e.entryName);

  return entries;
}

/**
 * Auto-detect the main .tex file in a directory.
 * Priority:
 *   1. A file named "main.tex"
 *   2. The only .tex file present (if exactly one)
 *   3. null (caller must specify manually)
 *
 * @param {string} dirPath
 * @param {string[]} entryNames   List of relative entry names from ZIP extraction
 * @returns {string|null}  Relative path to the main .tex file, or null
 */
function detectMainTexFile(dirPath, entryNames) {
  const texFiles = entryNames.filter(e => e.toLowerCase().endsWith('.tex'));

  if (texFiles.length === 0) return null;
  if (texFiles.some(f => path.basename(f).toLowerCase() === 'main.tex')) {
    return texFiles.find(f => path.basename(f).toLowerCase() === 'main.tex');
  }
  if (texFiles.length === 1) return texFiles[0];

  return null; // Ambiguous — caller must specify
}

/**
 * Read a `.log` file from a compilation directory.
 * Returns empty string if not found.
 * @param {string} workDir
 * @param {string} baseName  Base name (without extension) of the .tex file
 * @returns {Promise<string>}
 */
async function readCompilationLog(workDir, baseName) {
  const logPath = path.join(workDir, `${baseName}.log`);
  try {
    return await fsp.readFile(logPath, 'utf8');
  } catch {
    return '';
  }
}

// ─── Scheduled Cleanup ───────────────────────────────────────────────────────

/**
 * Remove any stale latex-server temp directories older than TEMP_FILE_MAX_AGE.
 */
async function cleanupStaleTempDirs() {
  const tmpDir = WORKDIR_ROOT;
  try {
    const entries = await fsp.readdir(tmpDir, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) continue;

      const fullPath = path.join(tmpDir, entry.name);
      try {
        const stat = await fsp.stat(fullPath);
        if (now - stat.mtimeMs > TEMP_FILE_MAX_AGE) {
          await cleanupTempDir(fullPath);
          console.log(`[Cleanup] Removed stale temp dir: ${entry.name}`);
        }
      } catch {
        // Ignore individual stat/rm errors
      }
    }
  } catch (err) {
    console.error('[Cleanup] Error scanning temp dir:', err.message);
  }
}

// Start periodic cleanup
setInterval(cleanupStaleTempDirs, TEMP_CLEANUP_INTERVAL).unref();

module.exports = {
  WORKDIR_ROOT,
  createTempDir,
  cleanupTempDir,
  copyFileToDir,
  extractZip,
  detectMainTexFile,
  readCompilationLog,
};

