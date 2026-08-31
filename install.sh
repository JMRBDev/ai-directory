#!/usr/bin/env sh
#
# Install the AI Directory CLI (`aid`) from a GitHub release.
#
# Usage:
#   curl -fsSL https://github.com/JMRBDev/ai-directory/releases/latest/download/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- v0.1.0        # install a specific version
#
# Overrides:
#   AID_VERSION       version tag to install (default: latest release)
#   AID_INSTALL_DIR   install directory (default: /usr/local/bin)
#
set -eu

REPO="JMRBDev/ai-directory"
INSTALL_DIR="${AID_INSTALL_DIR:-/usr/local/bin}"
VERSION="${AID_VERSION:-}"
if [ "$#" -gt 0 ]; then
  VERSION="$1"
fi

say() { printf '%s\n' "$*"; }
fail() { say "error: $*" >&2; exit 1; }

# --- Determine OS and architecture -------------------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) fail "unsupported operating system: $OS" ;;
esac

case "$ARCH" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *) fail "unsupported architecture: $ARCH" ;;
esac

ASSET="aid-${os}-${arch}"
API="https://api.github.com/repos/${REPO}/releases"

# --- Resolve the version tag -------------------------------------------------
if [ -z "$VERSION" ]; then
  say "Resolving the latest release of ${REPO}..."
  LATEST="$(curl -fsSL "${API}/latest")"
  TAG="$(printf '%s' "$LATEST" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$TAG" ] || fail "could not determine the latest release tag"
  VERSION="$TAG"
else
  case "$VERSION" in
    v*) TAG="$VERSION" ;;
    *) TAG="v${VERSION}" ;;
  esac
fi

BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
say "Installing aid ${VERSION} (${ASSET}) into ${INSTALL_DIR}"

# --- Download the binary and the checksums file -------------------------------
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/aid.XXXXXX")"
TMP_CHECKSUMS="$(mktemp "${TMPDIR:-/tmp}/aid-checksums.XXXXXX")"
trap 'rm -f "$TMP_FILE" "$TMP_CHECKSUMS"' EXIT HUP INT TERM

say "Downloading ${BASE_URL}/${ASSET}"
curl -fsSL -o "$TMP_FILE" "${BASE_URL}/${ASSET}"

say "Downloading checksums..."
curl -fsSL -o "$TMP_CHECKSUMS" "${BASE_URL}/aid-checksums.txt" \
  || fail "could not download ${BASE_URL}/aid-checksums.txt"

# --- Verify the SHA-256 checksum ----------------------------------------------
EXPECTED="$(grep -E "[[:space:]]${ASSET}$" "$TMP_CHECKSUMS" | awk '{print $1}' | head -n 1)"
[ -n "$EXPECTED" ] || fail "no checksum found for ${ASSET} in aid-checksums.txt"

say "Verifying the SHA-256 checksum..."
if command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$TMP_FILE" | awk '{print $1}')"
else
  ACTUAL="$(sha256sum "$TMP_FILE" | awk '{print $1}')"
fi
[ "$(printf '%s' "$ACTUAL" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$EXPECTED" | tr '[:upper:]' '[:lower:]')" ] \
  || fail "checksum mismatch: expected ${EXPECTED}, got ${ACTUAL}"

# --- Install ------------------------------------------------------------------
if [ ! -d "$INSTALL_DIR" ]; then
  say "Creating ${INSTALL_DIR}"
  mkdir -p "$INSTALL_DIR" || fail "could not create ${INSTALL_DIR} (use AID_INSTALL_DIR to pick a writable location)"
fi

TARGET="${INSTALL_DIR}/aid"
chmod +x "$TMP_FILE"

backup_existing() {
  if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
    say "Backing up the existing binary to ${TARGET}.previous"
    mv -f "$TARGET" "${TARGET}.previous" 2>/dev/null
  fi
}

# Rename the current binary aside, then move the new one into place. If the
# directory is not writable (for example /usr/local/bin needs sudo on macOS),
# the rename fails and we fall back to a user-local bin when available.
if backup_existing && mv -f "$TMP_FILE" "$TARGET" 2>/dev/null; then
  :
else
  if [ "$INSTALL_DIR" = "/usr/local/bin" ] && [ -d "${HOME}/.local/bin" ]; then
    say "${INSTALL_DIR} is not writable; installing into ${HOME}/.local/bin instead"
    INSTALL_DIR="${HOME}/.local/bin"
    TARGET="${INSTALL_DIR}/aid"
    backup_existing
    mv -f "$TMP_FILE" "$TARGET" || fail "could not write ${TARGET}. Run the installer with sudo, or set AID_INSTALL_DIR to a writable directory."
  else
    fail "could not write ${TARGET}. Run the installer with sudo, or set AID_INSTALL_DIR to a writable directory."
  fi
fi
trap - EXIT HUP INT TERM

say ""
say "Installed aid ${VERSION} to ${TARGET}"
say "Run 'aid' to get started, or 'aid self-update' to upgrade later."

if [ "$os" = "darwin" ]; then
  say ""
  say "Note: the binary is not notarized. If macOS blocks it on first run, open it once via:"
  say "  xattr -d com.apple.quarantine ${TARGET}"
fi
