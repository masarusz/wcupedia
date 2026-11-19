#!/bin/bash
# Wcupedia deploy — publishes public/ to the gh-pages branch, which GitHub Pages
# serves at https://masarusz.github.io/wcupedia/
#
# Adapted from the 出番表 (debanhyo) deploy script; every rule below exists
# because something went wrong without it on an earlier project.
# On 2026-11-19, two runs plus a manual check made roughly five full passes over
# 5,202 files. Pages returned HTTP 429, producing 2,120 false DIFFs and 11 false
# LEAKs even though round one had matched every file.
# Verification therefore proves the complete Git tree locally and keeps HTTPS
# traffic to five representative files plus the 11 unpublished-path probes.
#
#   ./scripts/deploy.sh --dry-run    show what would ship, touch nothing
#   ./scripts/deploy.sh              publish and verify
#   ./scripts/deploy.sh --verify-only  verify the local gh-pages ref, no publish
set -euo pipefail

REPO_ROOT="${WCUPEDIA_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO_ROOT"
SITE="${WCUPEDIA_SITE:-https://masarusz.github.io/wcupedia}"
REPO_SLUG="${WCUPEDIA_REPO_SLUG:-masarusz/wcupedia}"
BRANCH="gh-pages"
WORKTREE=".publish"
DRY_RUN=0
VERIFY_ONLY=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  --verify-only) VERIFY_ONLY=1 ;;
  "") ;;
  *) echo "usage: $0 [--dry-run|--verify-only]" >&2; exit 2 ;;
esac

fail() { echo "DEPLOY FAILED: $*" >&2; exit 1; }
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wcupedia-deploy.XXXXXX")"
TMP_LOG="$TMP_DIR/tests.log"
trap 'rm -rf "$TMP_DIR"' EXIT

# --- 1. Preflight -----------------------------------------------------------
if [[ $VERIFY_ONLY -eq 0 ]]; then
  echo "== preflight"
  node tests/run.mjs > "$TMP_LOG" 2>&1 \
    || { tail -40 "$TMP_LOG"; fail "test suite is red - refusing to deploy"; }
  echo "   tests: $(tail -1 "$TMP_LOG")"
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "   WARNING: working tree is not clean; deploying the files on disk"
  fi
else
  echo "== verify only: skipping tests, staging, and push"
fi

# --- 2. The allowlist -------------------------------------------------------
# NAME WHAT PRODUCTION RUNS, never what it must not have. These are fixed
# patterns, not a blocklist: a new kind of file (a .DS_Store, a draft, a
# report) matches none of them and is simply not published. Every pattern must
# match at least one file, so a renamed directory fails loudly here instead of
# shipping a half-empty site.
PATTERNS=(
  "index.html"
  "manifest.webmanifest"
  "css/*.css"
  "js/*.js"
  "data/*.json"
  "data/t/*.json"
  "assets/*.png" "assets/players/*.webp"
  "assets/flags/*.svg"
  "assets/flags/LICENSE-flag-icons.txt"
)
FILES=()
shopt -s nullglob
for p in "${PATTERNS[@]}"; do
  matches=( public/$p )
  [[ ${#matches[@]} -gt 0 ]] || fail "allowlist pattern matched nothing: public/$p"
  printf '   %-40s %3d file(s)\n' "$p" "${#matches[@]}"
  for m in "${matches[@]}"; do FILES+=( "${m#public/}" ); done
done
shopt -u nullglob
echo "== allowlist: ${#FILES[@]} files"

if [[ $DRY_RUN -eq 1 ]]; then
  echo; echo "== dry run: nothing was written, nothing was pushed"; exit 0
fi

CURL_CMD="${WCUPEDIA_CURL:-curl}"
GH_CMD="${WCUPEDIA_GH:-gh}"
# Authentication is checked before staging because discovering it after a push
# leaves a published commit whose Pages build cannot be verified.
command -v "$GH_CMD" >/dev/null 2>&1 || fail "gh is missing; install GitHub CLI before deploying"
if ! "$GH_CMD" auth status > /dev/null 2> "$TMP_DIR/gh-auth.log"; then
  fail "gh is unauthenticated; run 'gh auth login' before deploying"
fi
command -v "$CURL_CMD" >/dev/null 2>&1 || fail "curl is missing; live verification cannot run"

# --- 3. Stage the publish branch -------------------------------------------
if [[ $VERIFY_ONLY -eq 0 ]]; then
  echo "== staging $BRANCH"
  git worktree remove --force "$WORKTREE" 2>/dev/null || true
  rm -rf "$WORKTREE"
  git worktree prune
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git worktree add "$WORKTREE" "$BRANCH" >/dev/null
  elif git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
    git fetch -q origin "$BRANCH:$BRANCH"
    git worktree add "$WORKTREE" "$BRANCH" >/dev/null
  else
    # First publish: an EMPTY worktree on a new unborn branch. Measured 2026-09-11:
    # `worktree add --detach` + `checkout --orphan` keeps every file of main staged,
    # and `git rm` then refuses ("files have changes staged in the index").
    git worktree add --orphan -b "$BRANCH" "$WORKTREE" >/dev/null
  fi
  # Remove everything tracked, then lay down exactly the allowlist. The error from
  # `git rm` is not suppressed: a partial cleanup must not leave a stray file.
  if [[ -n "$( cd "$WORKTREE" && git ls-files )" ]]; then
    ( cd "$WORKTREE" && git rm -rfq . ) || fail "could not clear the $BRANCH worktree"
  fi
  ( cd "$WORKTREE" && git clean -fdq ) || fail "could not clean the $BRANCH worktree"
  for f in "${FILES[@]}"; do
    mkdir -p "$WORKTREE/$(dirname "$f")"
    cp "public/$f" "$WORKTREE/$f"
  done
  # .nojekyll: without it Pages runs Jekyll, which drops files starting with "_".
  touch "$WORKTREE/.nojekyll"

  # The published tree must be EXACTLY the allowlist plus .nojekyll.
  # Stage the allowlist by name, never `git add -A`: measured 2026-09-11, macOS
  # wrote .DS_Store into the fresh worktree between the copy and the add (the
  # gh-pages branch has no .gitignore), `add -A` staged it, and the check below
  # refused the deploy. Untracked junk now stays out of the commit; the exact-tree
  # check still catches anything that does get staged.
  ( cd "$WORKTREE"
    git add -- "${FILES[@]}" .nojekyll
    EXPECTED=$(printf '%s\n' "${FILES[@]}" .nojekyll | sort)
    ACTUAL=$(git ls-files | sort)
    if [[ "$EXPECTED" != "$ACTUAL" ]]; then
      echo "   published tree does not match the allowlist:" >&2
      diff <(echo "$EXPECTED") <(echo "$ACTUAL") | sed 's/^/     /' >&2
      exit 90
    fi
    if git diff --cached --quiet; then echo "   no changes to publish"
    else git commit -q -m "Publish $(date -u +%Y-%m-%dT%H:%M:%SZ)"; fi
    git push -q origin "$BRANCH" ) || fail "staging or pushing $BRANCH failed"
  PUBLISHED_SHA="$(git -C "$WORKTREE" rev-parse HEAD)"
  echo "   pushed $BRANCH at $PUBLISHED_SHA"
  # The remote ref is checked after push because a successful-looking transport
  # must not be mistaken for proof that origin accepted the intended commit.
  if ! REMOTE_LINE="$(git ls-remote origin "refs/heads/$BRANCH")"; then
    fail "could not read origin refs/heads/$BRANCH after push"
  fi
  REMOTE_SHA="$(printf '%s\n' "$REMOTE_LINE" | awk 'NR == 1 { print $1 }')"
  [[ "$REMOTE_SHA" == "$PUBLISHED_SHA" ]] \
    || fail "origin refs/heads/$BRANCH is ${REMOTE_SHA:-missing}, expected $PUBLISHED_SHA"
  git worktree remove --force "$WORKTREE" 2>/dev/null || true
else
  PUBLISHED_SHA="$(git rev-parse "refs/heads/$BRANCH" 2>/dev/null)" \
    || fail "local refs/heads/$BRANCH does not exist"
  echo "== verifying local $BRANCH at $PUBLISHED_SHA"
fi

# --- 4. Verify the complete Git tree, then five live samples ----------------
# On 2026-11-19, two runs plus a manual check made about five full passes over
# 5,202 files. Pages returned 429, which the old verifier misreported as 2,120
# DIFFs and all 11 unpublished paths leaking. One bulk tree/hash comparison now
# proves every file without HTTP; only five representative paths go to Pages.
echo "== comparing the $BRANCH tree with the local build"
CHECKED=${#FILES[@]}
[[ $CHECKED -gt 0 ]] || fail "manifest was empty - verified nothing"
EXPECTED_PATHS="$TMP_DIR/expected-paths"
EXPECTED_HASHES="$TMP_DIR/expected-hashes"
EXPECTED_TREE="$TMP_DIR/expected-tree"
ACTUAL_TREE="$TMP_DIR/actual-tree"
TREE_MISMATCHES="$TMP_DIR/tree-mismatches"
printf '%s\n' "${FILES[@]}" > "$EXPECTED_PATHS"
# `--stdin-paths` resolves names from the repository root even after `cd`; add
# public/ explicitly so verification hashes the build, not same-named root files.
sed 's#^#public/#' "$EXPECTED_PATHS" | git hash-object --stdin-paths > "$EXPECTED_HASHES" \
  || fail "could not hash the local build"
paste "$EXPECTED_HASHES" "$EXPECTED_PATHS" > "$EXPECTED_TREE"
printf '%s\t.nojekyll\n' "$(printf '' | git hash-object --stdin)" >> "$EXPECTED_TREE"
git ls-tree -r "$PUBLISHED_SHA" \
  | awk '{ hash=$3; sub(/^[^\t]*\t/, ""); print hash "\t" $0 }' > "$ACTUAL_TREE" \
  || fail "could not read tree $PUBLISHED_SHA"
awk -F '\t' 'NR == FNR { want[$2]=$1; paths[$2]=1; next }
  { got[$2]=$1; paths[$2]=1 }
  END { for (path in paths) if (!(path in want) || !(path in got) || want[path] != got[path]) print path }' \
  "$EXPECTED_TREE" "$ACTUAL_TREE" | sort > "$TREE_MISMATCHES"
if [[ -s "$TREE_MISMATCHES" ]]; then
  while IFS= read -r p; do echo "   TREE DIFF  $p" >&2; done < "$TREE_MISMATCHES"
  fail "gh-pages tree differs from the local build"
fi
echo "   $CHECKED/$CHECKED files plus .nojekyll match $PUBLISHED_SHA"

# Pages' API is the source of truth for asynchronous build completion; matching
# an older successful build caused stale live bytes to look current in the past.
POLL_INTERVAL="${WCUPEDIA_POLL_INTERVAL:-10}"
POLL_TIMEOUT="${WCUPEDIA_POLL_TIMEOUT:-600}"
case "$POLL_INTERVAL" in *[!0-9]*|"") fail "Pages poll interval must be whole seconds" ;; esac
case "$POLL_TIMEOUT" in *[!0-9]*|"") fail "Pages poll timeout must be whole seconds" ;; esac
echo "== waiting for Pages to build $PUBLISHED_SHA (up to $POLL_TIMEOUT s)"
POLL_START="$(date +%s)"
while :; do
  if ! BUILD_ROW="$("$GH_CMD" api "repos/$REPO_SLUG/pages/builds/latest" --jq '[.status, .commit] | @tsv')"; then
    fail "gh could not read the latest Pages build for $REPO_SLUG"
  fi
  BUILD_STATUS="$(printf '%s\n' "$BUILD_ROW" | awk -F '\t' 'NR == 1 { print $1 }')"
  BUILD_SHA="$(printf '%s\n' "$BUILD_ROW" | awk -F '\t' 'NR == 1 { print $2 }')"
  echo "   Pages status=${BUILD_STATUS:-unknown} commit=${BUILD_SHA:-unknown}"
  if [[ "$BUILD_STATUS" == "built" && "$BUILD_SHA" == "$PUBLISHED_SHA" ]]; then break; fi
  if [[ "$BUILD_STATUS" == "errored" && "$BUILD_SHA" == "$PUBLISHED_SHA" ]]; then
    fail "Pages reported errored for $PUBLISHED_SHA"
  fi
  POLL_NOW="$(date +%s)"
  if [[ $((POLL_NOW-POLL_START)) -ge $POLL_TIMEOUT ]]; then
    fail "Pages did not report built for $PUBLISHED_SHA within $POLL_TIMEOUT s"
  fi
  sleep "$POLL_INTERVAL"
done

RETRY_DELAYS=( ${WCUPEDIA_RETRY_DELAYS:-5 15 45 90} )
RETRY_AFTER_CAP="${WCUPEDIA_RETRY_AFTER_CAP:-90}"
case "$RETRY_AFTER_CAP" in *[!0-9]*|"") fail "Retry-After cap must be whole seconds" ;; esac
is_refused_code() { [[ "$1" == "000" || "$1" == "429" || "$1" == 5?? ]]; }

# A refused request is retried because 429 and transient origin failures say
# nothing about the deployed bytes. Numeric Retry-After wins, but is capped so
# a bad intermediary cannot stall a deploy indefinitely.
fetch_live() {
  local path="$1" attempt=0 delay retry_after rc
  while :; do
    : > "$TMP_DIR/live-headers"
    : > "$TMP_DIR/live-body"
    if LIVE_CODE="$("$CURL_CMD" -sS -L -D "$TMP_DIR/live-headers" -o "$TMP_DIR/live-body" \
        -w '%{http_code}' -H 'Cache-Control: no-cache' "$SITE/$path")"; then rc=0; else rc=$?; fi
    [[ $rc -eq 0 && "$LIVE_CODE" =~ ^[0-9][0-9][0-9]$ ]] || LIVE_CODE=000
    is_refused_code "$LIVE_CODE" || return 0
    [[ $attempt -lt ${#RETRY_DELAYS[@]} ]] || return 0
    delay="${RETRY_DELAYS[$attempt]}"
    case "$delay" in *[!0-9]*|"") fail "retry delays must be whole seconds" ;; esac
    retry_after="$(awk 'BEGIN { IGNORECASE=1 } tolower($1) == "retry-after:" { gsub(/\r/, "", $2); value=$2 } END { print value }' "$TMP_DIR/live-headers")"
    if [[ "$retry_after" =~ ^[0-9]+$ ]]; then
      if [[ $retry_after -gt $RETRY_AFTER_CAP ]]; then delay="$RETRY_AFTER_CAP"; else delay="$retry_after"; fi
    fi
    echo "   RETRY  $path -> HTTP $LIVE_CODE (${delay}s)"
    sleep "$delay"
    attempt=$((attempt+1))
  done
}

SAMPLES=( index.html js/version.js data/fifa-ranking.json assets/flags/jp.svg assets/flags/es.svg )
# Sample paths are asserted against FILES because a typo here would make a 404
# look like a host problem instead of a verifier configuration error.
for sample in "${SAMPLES[@]}"; do
  FOUND=0
  for f in "${FILES[@]}"; do [[ "$f" == "$sample" ]] && FOUND=1; done
  [[ $FOUND -eq 1 ]] || fail "live sample is not in the allowlist: $sample"
done

echo "== checking ${#SAMPLES[@]} live samples at $SITE"
DIFFS=0
REFUSED=0
SAMPLE_MATCHES=0
for p in "${SAMPLES[@]}"; do
  fetch_live "$p"
  if is_refused_code "$LIVE_CODE"; then
    echo "   REFUSED  $p -> HTTP $LIVE_CODE"
    REFUSED=$((REFUSED+1))
  elif [[ "$LIVE_CODE" != "200" ]]; then
    echo "   DIFF  $p -> HTTP $LIVE_CODE"
    DIFFS=$((DIFFS+1))
  else
    WANT_HASH="$(shasum -a 256 "public/$p" | awk '{ print $1 }')"
    GOT_HASH="$(shasum -a 256 "$TMP_DIR/live-body" | awk '{ print $1 }')"
    if [[ "$WANT_HASH" != "$GOT_HASH" ]]; then
      # One fresh retry catches an edge that briefly serves the previous bytes.
      fetch_live "$p"
      if is_refused_code "$LIVE_CODE"; then
        echo "   REFUSED  $p -> HTTP $LIVE_CODE"
        REFUSED=$((REFUSED+1))
      elif [[ "$LIVE_CODE" == "200" ]]; then
        GOT_HASH="$(shasum -a 256 "$TMP_DIR/live-body" | awk '{ print $1 }')"
        if [[ "$WANT_HASH" == "$GOT_HASH" ]]; then
          echo "   MATCH  $p"
          SAMPLE_MATCHES=$((SAMPLE_MATCHES+1))
        else
          echo "   DIFF  $p"
          DIFFS=$((DIFFS+1))
        fi
      else
        echo "   DIFF  $p -> HTTP $LIVE_CODE"
        DIFFS=$((DIFFS+1))
      fi
    else
      echo "   MATCH  $p"
      SAMPLE_MATCHES=$((SAMPLE_MATCHES+1))
    fi
  fi
done

# --- 5. Prove the unpublished paths are not served --------------------------
# The same refusal handling prevents the 2026-11-19 429 incident from turning
# all 11 probes into false LEAKs; only a final non-transient non-404 is a leak.
UNPUBLISHED=( README.md LICENSE DATA-LICENSE.md .gitignore scripts/deploy.sh \
  tools/build-data.mjs tools/lib/players-ja.mjs tests/run.mjs \
  tests/golden/facts.json curated/teams.json public/index.html )
echo "== confirming ${#UNPUBLISHED[@]} unpublished paths are not reachable"
LEAKS=0
for p in "${UNPUBLISHED[@]}"; do
  fetch_live "$p"
  if [[ "$LIVE_CODE" == "404" ]]; then
    echo "   404   $p"
  elif is_refused_code "$LIVE_CODE"; then
    echo "   REFUSED  $p -> HTTP $LIVE_CODE"
    REFUSED=$((REFUSED+1))
  else
    echo "   LEAK  $p -> HTTP $LIVE_CODE"
    LEAKS=$((LEAKS+1))
  fi
done

# --- 6. Print exactly one final outcome -------------------------------------
# Exit 3 is reserved for an inconclusive rate-limited live check: the Git tree
# is proven, but release procedures must not tag without the success prefix.
echo
if [[ $DIFFS -gt 0 || $LEAKS -gt 0 ]]; then
  fail "$DIFFS live sample(s) differ, $LEAKS unpublished path(s) reachable"
fi
if [[ $REFUSED -gt 0 ]]; then
  echo "DEPLOY UNVERIFIED (rate-limited): $REFUSED live request(s) still refused after retries; the gh-pages tree matches the build, but the live site was not confirmed. Do not tag." >&2
  exit 3
fi
SHA7="$(printf '%.7s' "$PUBLISHED_SHA")"
echo "Deploy verified: $CHECKED/$CHECKED files match the gh-pages tree, Pages built $SHA7, $SAMPLE_MATCHES/${#SAMPLES[@]} live samples match, 0 unpublished paths reachable."
echo "$SITE/"
