#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Sync GitHub Actions repo secrets from a local env file.

Usage:
  scripts/uk_aq_sync_github_secrets.sh [options]

Options:
  --repo <owner/name>   GitHub repo (default: current gh repo)
  --env-file <path>     Env file to read (default: .env)
  --dry-run             Print changes without updating secrets
  -h, --help            Show help

Examples:
  scripts/uk_aq_sync_github_secrets.sh --dry-run --repo ChronicChannel-test/uk-aq
  scripts/uk_aq_sync_github_secrets.sh --repo ChronicChannel-test/uk-aq
EOF
}

REPO=""
ENV_FILE=".env"
DRY_RUN=0
SEEN_FILE="$(mktemp)"

cleanup() {
  rm -f "${SEEN_FILE}"
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required." >&2
  exit 1
fi

if [[ -z "${REPO}" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || true)"
fi
if [[ -z "${REPO}" ]]; then
  echo "Could not determine GitHub repo. Pass --repo owner/name." >&2
  exit 1
fi

if [[ "${DRY_RUN}" -eq 0 ]]; then
  gh auth status >/dev/null
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}" >&2
  exit 1
fi

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

set_secret() {
  local name="$1"
  local value="$2"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    echo "[dry-run] would set ${name} (len=${#value})"
  else
    printf '%s' "${value}" | gh secret set "${name}" --repo "${REPO}"
    echo "set ${name}"
  fi
  printf '%s\n' "${name}" >> "${SEEN_FILE}"
}

while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
  line="${raw_line%$'\r'}"
  line="$(trim "${line}")"
  [[ -z "${line}" ]] && continue
  [[ "${line}" == \#* ]] && continue
  [[ "${line}" == export\ * ]] && line="${line#export }"
  [[ "${line}" != *=* ]] && continue

  key="$(trim "${line%%=*}")"
  value="${line#*=}"
  value="$(trim "${value}")"

  if [[ ! "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "skip invalid key in ${ENV_FILE}: ${key}" >&2
    continue
  fi

  first_char="${value:0:1}"
  last_char="${value: -1}"
  if [[ "${#value}" -ge 2 && "${first_char}" == '"' && "${last_char}" == '"' ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "${#value}" -ge 2 && "${first_char}" == "'" && "${last_char}" == "'" ]]; then
    value="${value:1:${#value}-2}"
  fi

  set_secret "${key}" "${value}"
done < "${ENV_FILE}"

WORKFLOW_DIR=".github/workflows"
if [[ -d "${WORKFLOW_DIR}" ]]; then
  REQUIRED_FILE="$(mktemp)"
  trap 'cleanup; rm -f "${REQUIRED_FILE}"' EXIT
  grep -RnoE "secrets\\.[A-Z0-9_]+" "${WORKFLOW_DIR}" --include="*.yml" \
    | sed -E 's/.*secrets\.([A-Z0-9_]+).*/\1/' \
    | sort -u > "${REQUIRED_FILE}" || true

  sort -u "${SEEN_FILE}" -o "${SEEN_FILE}"
  MISSING="$(comm -23 "${REQUIRED_FILE}" "${SEEN_FILE}" || true)"
  if [[ -n "${MISSING}" ]]; then
    echo
    echo "Secrets referenced by workflows but not set from ${ENV_FILE}:"
    echo "${MISSING}"
  fi
fi

echo
echo "Done for ${REPO}."
