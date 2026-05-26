'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const DOCKER_IMAGE = process.env.DOCKER_IMAGE || 'texlive/texlive:latest';

/**
 * Check if Docker daemon is reachable.
 * Returns { available: bool, reason: string }.
 */
async function checkDockerAvailable() {
  try {
    // `docker images` is lighter than `docker info` and sufficient to confirm
    // the daemon is reachable and the socket is accessible.
    await execFileAsync('docker', ['images', '--format', '{{.ID}}'], { timeout: 5000 });
    return true;
  } catch (err) {
    // Log the real error so it shows up in `docker compose logs latex-server`
    const reason = err.stderr || err.message || String(err);
    console.warn('[Docker] Availability check failed:', reason.trim());
    return false;
  }
}

/**
 * Return detailed Docker status for the /health endpoint.
 * @returns {Promise<{ available: boolean, reason: string|null }>}
 */
async function getDockerStatus() {
  try {
    await execFileAsync('docker', ['images', '--format', '{{.ID}}'], { timeout: 5000 });
    return { available: true, reason: null };
  } catch (err) {
    const reason = (err.stderr || err.message || '').trim();
    return { available: false, reason };
  }
}

/**
 * Pull the LaTeX Docker image if not already present.
 * Logs progress to stdout.
 * @returns {Promise<void>}
 */
async function pullDockerImage() {
  console.log(`[Docker] Pulling image: ${DOCKER_IMAGE} ...`);
  try {
    const { stdout } = await execFileAsync('docker', ['pull', DOCKER_IMAGE], {
      timeout: 300_000, // 5 minutes for first pull
    });
    console.log(`[Docker] Pull complete.\n${stdout}`);
  } catch (err) {
    throw new Error(`Failed to pull Docker image "${DOCKER_IMAGE}": ${err.message}`);
  }
}

/**
 * Run a LaTeX compilation command inside a Docker container.
 *
 * Security flags:
 *  - --network=none     No network access inside container
 *  - --memory=512m      Cap RAM usage
 *  - --cpus=1           Cap CPU
 *  - --rm               Auto-remove container after exit
 *  - --read-only        Read-only root FS (work dir is a tmpfs exception)
 *  - No shell-escape    Passed via engine flags
 *
 * @param {string} workDir   Absolute path on the host to mount as /workspace
 * @param {string[]} cmd     Command to run inside the container (e.g. ['pdflatex', '-interaction=nonstopmode', 'main.tex'])
 * @param {number} timeout   Timeout in milliseconds
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runInDocker(workDir, cmd, timeout = 60_000) {
  const dockerArgs = [
    'run',
    '--rm',
    '--network=none',
    '--memory=512m',
    '--cpus=1',
    '--read-only',
    '--tmpfs=/tmp',
    '-v', `${workDir}:/workspace`,
    '-w', '/workspace',
    DOCKER_IMAGE,
    ...cmd,
  ];

  try {
    const result = await execFileAsync('docker', dockerArgs, {
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10 MB log buffer
    });
    return { stdout: result.stdout || '', stderr: result.stderr || '' };
  } catch (err) {
    // execFileAsync rejects on non-zero exit code; preserve stdout/stderr for log reporting
    const stdout = err.stdout || '';
    const stderr = err.stderr || '';

    if (err.killed || err.code === 'ETIMEDOUT') {
      const timeoutErr = new Error('Compilation timed out.');
      timeoutErr.code = 'TIMEOUT';
      timeoutErr.stdout = stdout;
      timeoutErr.stderr = stderr;
      throw timeoutErr;
    }

    const compileErr = new Error('LaTeX compilation failed.');
    compileErr.code = 'COMPILE_ERROR';
    compileErr.exitCode = err.code;
    compileErr.stdout = stdout;
    compileErr.stderr = stderr;
    throw compileErr;
  }
}

module.exports = { checkDockerAvailable, getDockerStatus, pullDockerImage, runInDocker };

