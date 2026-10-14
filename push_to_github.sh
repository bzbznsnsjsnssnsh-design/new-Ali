#!/usr/bin/env bash
set -e

# Usage: ./push_to_github.sh <GITHUB_USERNAME> <REPO_NAME> <PERSONAL_ACCESS_TOKEN> [BRANCH]
USERNAME="$1"
REPO="$2"
TOKEN="$3"
BRANCH="${4:-main}"

if [ -z "$USERNAME" ] || [ -z "$REPO" ] || [ -z "$TOKEN" ]; then
  echo "Usage: $0 <github_username> <repo_name> <github_token> [branch]"
  echo "Example: $0 octocat my-manga-reader ghp_xxxxxxxxxxxx"
  exit 1
fi

echo "[1/3] Preparing git repository..."
git branch -M "$BRANCH"

# Remove existing origin if set
git remote remove origin 2>/dev/null || true

# Add authenticated remote (token masked in output)
REMOTE_URL="https://${USERNAME}:${TOKEN}@github.com/${USERNAME}/${REPO}.git"
git remote add origin "$REMOTE_URL"

echo "[2/3] Configuring postBuffer and compression..."
git config http.postBuffer 524288000
git config http.maxRequestBuffer 100M
git config core.compression 0

echo "[3/3] Pushing to GitHub (origin/${BRANCH})..."
git push -u origin "$BRANCH" --force

echo "Successfully pushed codebase to https://github.com/${USERNAME}/${REPO}!"
