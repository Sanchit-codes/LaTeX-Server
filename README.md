# Sanchit's Tools — LaTeX Server

A modern, fast, and secure REST API to compile `.tex` files and `.zip` archives into PDFs using Docker-isolated LaTeX engines (`pdflatex`, `xelatex`, `lualatex`).

<!-- REPLACE_WITH_YOUR_IMAGE_PATH -->

![LaTeX Server Web Interface](https://i.ibb.co/ycGTHnVK/Screenshot-2026-05-28-at-1-46-09-PM.png)

<!-- ☝️ Add your demo screenshot or GIF above ☝️ -->

## ✨ Features

- **No host dependencies**: LaTeX runs purely inside temporary Docker containers (`texlive/texlive:latest`).
- **Web UI included**: A beautiful, drag-and-drop web dashboard for manual compilations.
- **Multi-file projects**: Upload `.zip` archives with images, custom `.sty` files, and `.bib` bibliographies.
- **Secure execution**: Compilations run with `--no-shell-escape`, stripped network access, and strict timeouts.
- **Smart routing**: Handles single-pass and multi-pass compilations seamlessly.

---

## 🚀 Quick Start

The fastest way to deploy the LaTeX server is using Docker Compose.

```bash
# 1. Clone the repository
git clone https://github.com/Sanchit-codes/latex-server.git
cd latex-server

# 2. Start the server (runs on port 9180 by default)
docker compose up -d

# 3. Pull the TeX Live image (so your first request is instant)
docker pull texlive/texlive:latest
```

Visit `http://localhost:9180` in your browser to access the web interface!

---

## 📖 API Usage

### 1. Compile a single `.tex` file

```bash
curl -X POST -F "file=@main.tex" -F "engine=pdflatex" http://localhost:9180/compile -o output.pdf
```

### 2. Compile a multi-file `.zip` project

Upload a ZIP containing your `.tex` files, images, and bibliography.

```bash
curl -X POST \
  -F "file=@project.zip" \
  -F "mainFile=main.tex" \
  -F "runs=2" \
  http://localhost:9180/compile/zip -o document.pdf
```

### Available Options (Form Data)

- `file` (Required): The `.tex` or `.zip` file.
- `engine` (Optional): `pdflatex` (default), `xelatex`, or `lualatex`.
- `runs` (Optional): `1` (default), `2`, or `3`. Needed for generating Tables of Contents and bibliographies.
- `outputName` (Optional): Custom name for the returned PDF.
- `mainFile` (Optional, ZIP only): Explicitly define the main `.tex` file if auto-detection fails.

---

## ⚙️ Configuration

You can customize the server behavior by copying `.env.example` to `.env`:

```env
PORT=9180
MAX_FILE_SIZE_MB=50
COMPILE_TIMEOUT_MS=60000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=10
```

## 📝 License

MIT License. Created by [Sanchit-codes](https://github.com/Sanchit-codes).
