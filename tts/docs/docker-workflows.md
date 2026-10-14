# Docker Build Workflows

## Overview

Starting with v3.4.0, TTSFM uses **separate GitHub Actions workflows** for building the full and slim Docker image variants. This provides better clarity, easier debugging, and independent execution.

## Workflow Files

### 1. `.github/workflows/docker-build-full.yml`

**Purpose**: Builds the full variant with ffmpeg support

**Triggers**:
- Push to `main` branch
- Pull requests to `main` branch
- Release published

**Image Tags** (on release):
- `dbcccc/ttsfm:vX.X.X`
- `dbcccc/ttsfm:latest` (only for stable releases, not pre-releases)
- `ghcr.io/dbccccccc/ttsfm:vX.X.X`
- `ghcr.io/dbccccccc/ttsfm:latest` (only for stable releases)

**Features**:
- ✅ ffmpeg included
- ✅ MP3 auto-combine
- ✅ Speed adjustment (0.25x - 4.0x)
- ✅ Format conversion
- ✅ Multi-platform builds (linux/amd64, linux/arm64)
- ✅ Smoke test on PR/push
- ✅ GitHub Actions cache (scope: `full`)

---

### 2. `.github/workflows/docker-build-slim.yml`

**Purpose**: Builds the slim variant without ffmpeg

**Triggers**:
- Push to `main` branch
- Pull requests to `main` branch
- Release published

**Image Tags** (on release):
- `dbcccc/ttsfm:vX.X.X-slim`
- `dbcccc/ttsfm:vX.X-slim` (only for stable releases, not pre-releases)
- `ghcr.io/dbccccccc/ttsfm:vX.X.X-slim`
- `ghcr.io/dbccccccc/ttsfm:vX.X-slim` (only for stable releases)

**Features**:
- ✅ No ffmpeg (smaller image)
- ✅ Basic TTS (MP3/WAV)
- ✅ WAV auto-combine (simple concatenation)
- ❌ No MP3 auto-combine
- ❌ No speed adjustment
- ❌ No format conversion
- ✅ Multi-platform builds (linux/amd64, linux/arm64)
- ✅ Smoke test on PR/push (port 8001)
- ✅ GitHub Actions cache (scope: `slim`)

---

## Build Behavior

### On Pull Request or Push to Main

Both workflows run in parallel:
- Build for `linux/amd64` only (faster)
- Images are **not pushed** to registries
- Images are loaded locally for smoke testing
- Temporary tags: `ghcr.io/dbccccccc/ttsfm:ci-{RUN_ID}-full` and `ci-{RUN_ID}-slim`

### On Release Published

Both workflows run in parallel:
- Build for `linux/amd64` and `linux/arm64` (multi-platform)
- Images are **pushed** to Docker Hub and GitHub Container Registry
- No local loading (images go directly to registries)
- Production tags based on release version

### Pre-release vs Stable Release

**Pre-release** (e.g., `v3.4.0-alpha1`):
- Full variant: `vX.X.X` only (no `latest` tag)
- Slim variant: `vX.X.X-slim` only (no `vX.X-slim` tag)

**Stable release** (e.g., `v3.4.0`):
- Full variant: `vX.X.X` + `latest`
- Slim variant: `vX.X.X-slim` + `vX.X-slim`

---

## Advantages of Separate Workflows

1. **Clarity**: Each workflow has a single, clear purpose
2. **Easier debugging**: When a build fails, you immediately know which variant failed
3. **Independent execution**: Can trigger/retry builds independently
4. **Simpler logic**: No complex conditionals or fallback logic
5. **Better visibility**: GitHub Actions UI shows them as separate jobs
6. **Parallel execution**: Both variants build truly in parallel
7. **Independent caching**: Each variant has its own cache scope

---

## Monitoring Builds

### GitHub Actions UI

When you create a release, you'll see **two separate workflow runs**:
- ✅ Docker Build and Push (Full)
- ✅ Docker Build and Push (Slim)

Each can succeed or fail independently.

### Checking Build Status

**Via GitHub UI**:
1. Go to repository → Actions tab
2. Look for the two workflow runs
3. Click on each to see detailed logs

**Via API**:
```bash
# Check latest workflow runs
gh run list --workflow=docker-build-full.yml
gh run list --workflow=docker-build-slim.yml
```

---

## Troubleshooting

### Slim variant not building

1. Check if the workflow file exists: `.github/workflows/docker-build-slim.yml`
2. Check the Actions tab for the "Docker Build and Push (Slim)" workflow
3. Look for error messages in the workflow logs
4. Verify Docker Hub and GitHub Container Registry credentials

### Images not pushed to registry

1. Verify the event is a "release published" (not draft)
2. Check Docker Hub credentials in repository secrets:
   - `DOCKERHUB_USERNAME`
   - `DOCKERHUB_TOKEN`
3. Check GitHub Container Registry permissions (automatic via `GITHUB_TOKEN`)

### Smoke test failing

1. Check the smoke test logs in the workflow run
2. Verify the health endpoint is working: `/api/health`
3. For slim variant, ensure it's using port 8001 (not 8000)

---

## Future Enhancements

Potential improvements for the workflows:

1. **Matrix builds**: Use a single workflow with matrix strategy
2. **Reusable workflows**: Extract common steps into a reusable workflow
3. **Build notifications**: Send notifications on build success/failure
4. **Image scanning**: Add security scanning with Trivy or Snyk
5. **Performance metrics**: Track and report build times and image sizes

