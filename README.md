# LaTeX Server

A REST API server that compiles `.tex` files to PDF using Docker-isolated LaTeX engines. No LaTeX installation required on the host — compilation runs inside a `texlive/texlive` Docker container.

## Features

- **`POST /compile`** — upload a single `.tex` file, get a PDF back
- **`POST /compile/zip`** — upload a `.zip` project (with images, `.bib`, custom `.sty`, etc.)
- **Engine selection** — `pdflatex`, `xelatex`, `lualatex`
- **Multiple passes** — 1–3 compilation runs (needed for references, TOC, BibTeX)
- **Custom output name** — name the downloaded PDF however you like
- **Web UI** — drag-and-drop browser interface at `http://localhost:3000`
- **Security** — containers run with `--no-shell-escape`, `--network=none`, memory/CPU limits
- **Rate limiting** — 10 compilations per minute per IP (configurable)

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (running on the server)
- [Node.js](https://nodejs.org/) v18+ (for running without Docker Compose)

> **First run**: Docker will automatically pull `texlive/texlive:latest` (~4.5 GB) when the first compilation is requested.

---

## Quick Start

### Option A: Docker Compose (recommended for server deployment)

```bash
# 1. Clone / copy the project
cd /your/server/path

# 2. Copy and edit environment config (optional)
cp .env.example .env

# 3. Build and start
docker compose up -d

# 4. Pull the LaTeX image ahead of time (optional but recommended)
docker pull texlive/texlive:latest
```

The server is now running at `http://your-server:9180`.

### Option B: Node.js directly (requires Docker on the host)

```bash
npm install
cp .env.example .env   # edit as needed
npm start
```

---

## API Reference

### `POST /compile`

Upload a single `.tex` file.

| Parameter    | Type   | Required | Description |
|--------------|--------|----------|-------------|
| `file`       | file   | **Yes**  | `.tex` file |
| `outputName` | string | No       | Output PDF name (without `.pdf`) |
| `engine`     | string | No       | `pdflatex` \| `xelatex` \| `lualatex` |
| `runs`       | number | No       | Compilation passes: `1`–`3` |

**Success**: Returns PDF binary with `Content-Disposition: attachment`.

**Error** (4xx/5xx):
```json
{
  "error": "compilation_failed",
  "message": "LaTeX compilation failed.",
  "log": "! Undefined control sequence...",
  "exitCode": 1
}
```

#### Example

```bash
curl -X POST \
  -F "file=@report.tex" \
  -F "outputName=my-report" \
  -F "engine=pdflatex" \
  -F "runs=2" \
  http://localhost:9180/compile \
  -o my-report.pdf
```

---

### `POST /compile/zip`

Upload a `.zip` archive containing a multi-file LaTeX project.

| Parameter    | Type   | Required  | Description |
|--------------|--------|-----------|-------------|
| `file`       | file   | **Yes**   | `.zip` archive |
| `mainFile`   | string | ZIP only  | Relative path to main `.tex` inside archive. Auto-detected if only one `.tex` exists. |
| `outputName` | string | No        | Output PDF name |
| `engine`     | string | No        | LaTeX engine |
| `runs`       | number | No        | Compilation passes |

#### Example

```bash
curl -X POST \
  -F "file=@thesis-project.zip" \
  -F "mainFile=src/thesis.tex" \
  -F "outputName=thesis-final" \
  -F "engine=xelatex" \
  -F "runs=2" \
  http://localhost:9180/compile/zip \
  -o thesis-final.pdf
```

---

### `GET /health`

Returns server and Docker status.

```json
{
  "status": "ok",
  "latex": true,
  "dockerImage": "texlive/texlive:latest",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

## Configuration

Copy `.env.example` to `.env` and edit:

| Variable                  | Default                   | Description |
|---------------------------|---------------------------|-------------|
| `PORT`                    | `3000`                    | Server port |
| `MAX_FILE_SIZE`           | `52428800` (50 MB)        | Max upload size in bytes |
| `COMPILATION_TIMEOUT`     | `60000` (60s)             | Timeout per compilation pass (ms) |
| `DOCKER_IMAGE`            | `texlive/texlive:latest`  | LaTeX Docker image |
| `DEFAULT_ENGINE`          | `pdflatex`                | Default LaTeX engine |
| `DEFAULT_RUNS`            | `1`                       | Default compilation passes |
| `RATE_LIMIT_WINDOW_MS`    | `60000` (1 min)           | Rate limit window |
| `RATE_LIMIT_MAX_REQUESTS` | `10`                      | Max requests per window per IP |
| `WORKDIR_ROOT`            | `/latex-workdirs`         | Host bind-mount path for temp compilation dirs (must match `docker-compose.yml` volume) |

---

## Security Notes

- LaTeX runs inside Docker with `--no-shell-escape` (blocks `\write18` shell injection)
- Containers have `--network=none` (no outbound internet access)
- Memory cap: `512m`, CPU cap: `1 core`
- Containers are auto-removed after completion (`--rm`)
- Root filesystem is read-only; only the work directory is writable
- Temp directories are cleaned up after each request and periodically (every hour)

---

## Project Structure

```
LaTeX Server/
├── server.js               # Express entry point
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── src/
│   ├── compiler.js         # LaTeX compilation logic
│   ├── docker.js           # Docker interaction layer
│   ├── fileManager.js      # Temp file + ZIP handling
│   └── routes/
│       └── compile.js      # /compile & /compile/zip routes
└── public/
    ├── index.html          # Web UI
    ├── style.css           # Styles
    └── app.js              # Frontend JS
```

---

## Troubleshooting

**"Docker not found" on startup**
→ Ensure Docker daemon is running: `systemctl start docker` (Linux) or open Docker Desktop.

**"Compilation timed out"**
→ Increase `COMPILATION_TIMEOUT` in `.env`. Complex documents with many packages can take longer.

**"Ambiguous main file" on ZIP upload**
→ Your ZIP contains multiple `.tex` files. Add `mainFile=path/to/main.tex` to your request.

**"Permission denied" on Docker socket**
→ The container can't access `/var/run/docker.sock`. The server now runs as root by default which resolves this. If you've customised the Dockerfile, ensure the process user can read the socket.

**"I can't find file 'main.tex'" / compilation fails with file not found**
→ This is a **sibling container path mismatch**. The `latex-server` container writes temp files
to `WORKDIR_ROOT` inside its own filesystem. For the sibling `texlive` container to see those
files, `WORKDIR_ROOT` must be a **host bind-mount** (not a container-local path like `/tmp`).
Verify `docker-compose.yml` has:
```yaml
volumes:
  - /latex-workdirs:/latex-workdirs
environment:
  WORKDIR_ROOT: /latex-workdirs
```
Then rebuild: `docker compose down && docker compose up -d --build`
