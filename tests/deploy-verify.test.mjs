import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DEPLOY = join(ROOT, 'scripts/deploy.sh');
const SAMPLES = ['index.html', 'js/version.js', 'data/fifa-ranking.json', 'assets/flags/jp.svg', 'assets/flags/es.svg'];

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'wcupedia-deploy-verify-'));
  const publicRoot = join(root, 'public');
  const files = {
    'index.html': '<!doctype html><title>fixture</title>\n',
    'manifest.webmanifest': '{}\n',
    'css/app.css': 'body {}\n',
    'js/version.js': "export const VERSION = 'test';\n",
    'data/fifa-ranking.json': '{"fixture":true}\n',
    'data/t/2026.json': '{}\n',
    'assets/icon.png': 'png fixture\n',
    'assets/players/player.webp': 'webp fixture\n',
    'assets/flags/jp.svg': '<svg id="jp"/>\n',
    'assets/flags/es.svg': '<svg id="es"/>\n',
    'assets/flags/LICENSE-flag-icons.txt': 'fixture licence\n',
  };
  for (const [path, value] of Object.entries(files)) write(join(publicRoot, path), value);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Deploy Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'deploy-test@example.invalid'], { cwd: root });
  execFileSync('git', ['checkout', '-q', '-b', 'gh-pages'], { cwd: root });
  write(join(root, '.nojekyll'), '');
  for (const path of Object.keys(files)) write(join(root, path), readFileSync(join(publicRoot, path)));
  execFileSync('git', ['add', '.nojekyll', ...Object.keys(files)], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'fixture publish'], { cwd: root });
  return { root, publicRoot, sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() };
}

function makeStubs(root) {
  const bin = join(root, 'stubs');
  mkdirSync(bin);
  const gh = join(bin, 'gh');
  const curl = join(bin, 'curl');
  writeFileSync(gh, `#!/bin/bash
if [[ "\${1:-}" == "auth" && "\${2:-}" == "status" ]]; then exit 0; fi
if [[ "\${STUB_GH_SCENARIO}" == "errored" ]]; then
  printf 'errored\\t%s\\n' "\${STUB_SHA}"
elif [[ "\${STUB_GH_SCENARIO}" == "different" ]]; then
  printf 'built\\t0000000000000000000000000000000000000000\\n'
else
  printf 'built\\t%s\\n' "\${STUB_SHA}"
fi
`);
  writeFileSync(curl, `#!/bin/bash
headers=''
output=''
url=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -D) headers="$2"; shift 2 ;;
    -o) output="$2"; shift 2 ;;
    -w|-H) shift 2 ;;
    -sS|-L) shift ;;
    *) url="$1"; shift ;;
  esac
done
path="\${url#\${STUB_SITE}/}"
printf '%s\\n' "$path" >> "$STUB_CURL_LOG"
count=$(grep -Fxc "$path" "$STUB_CURL_LOG")
: > "$headers"
: > "$output"
code=404
if [[ -f "$STUB_PUBLIC/$path" ]]; then
  code=200
  if [[ "$STUB_CURL_SCENARIO" == "always429" ]]; then
    code=429
  elif [[ "$STUB_CURL_SCENARIO" == "recover429" && $count -le 2 ]]; then
    code=429
  fi
  if [[ "$code" == "200" ]]; then
    if [[ "$STUB_CURL_SCENARIO" == "diff" && "$path" == "index.html" ]]; then
      printf 'wrong bytes\\n' > "$output"
    else
      cp "$STUB_PUBLIC/$path" "$output"
    fi
  fi
elif [[ "$STUB_CURL_SCENARIO" == "leak" && "$path" == "README.md" ]]; then
  code=200
  printf 'leaked\\n' > "$output"
fi
if [[ "$code" == "429" ]]; then printf 'Retry-After: 0\\r\\n' > "$headers"; fi
printf '%s' "$code"
`);
  chmodSync(gh, 0o755);
  chmodSync(curl, 0o755);
  return { gh, curl };
}

function verify({ curlScenario = 'good', ghScenario = 'built', mismatch = false } = {}) {
  const fixture = makeRepo();
  const stubs = makeStubs(fixture.root);
  if (mismatch) write(join(fixture.publicRoot, 'index.html'), '<title>changed after publish</title>\n');
  const curlLog = join(fixture.root, 'curl.log');
  writeFileSync(curlLog, '');
  const site = 'https://stub.invalid/site';
  const result = spawnSync('bash', [DEPLOY, '--verify-only'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      WCUPEDIA_REPO_ROOT: fixture.root,
      WCUPEDIA_SITE: site,
      WCUPEDIA_GH: stubs.gh,
      WCUPEDIA_CURL: stubs.curl,
      WCUPEDIA_POLL_INTERVAL: '0',
      WCUPEDIA_POLL_TIMEOUT: '0',
      WCUPEDIA_RETRY_DELAYS: '0 0 0 0',
      WCUPEDIA_RETRY_AFTER_CAP: '0',
      STUB_SHA: fixture.sha,
      STUB_SITE: site,
      STUB_PUBLIC: fixture.publicRoot,
      STUB_CURL_LOG: curlLog,
      STUB_CURL_SCENARIO: curlScenario,
      STUB_GH_SCENARIO: ghScenario,
    },
  });
  return {
    code: result.status,
    output: `${result.stdout}${result.stderr}`,
    calls: readFileSync(curlLog, 'utf8').trim().split('\n').filter(Boolean),
  };
}

export function register(test, equal) {
  test('deploy verify-only succeeds with built Pages and exact live bytes', () => {
    const result = verify();
    equal(result.code, 0, result.output);
    equal(result.output.includes('Deploy verified:'), true, result.output);
    equal(result.calls.length, 16, 'five samples plus 11 probes');
  });

  test('deploy verify-only reports exhausted 429 responses as unverified exit 3', () => {
    const result = verify({ curlScenario: 'always429' });
    equal(result.code, 3, result.output);
    equal(result.output.includes('DEPLOY UNVERIFIED (rate-limited):'), true, result.output);
    equal(result.output.includes('Deploy verified:'), false, result.output);
    equal(result.calls.length, 36, 'five samples retried five times, plus 11 probes');
    for (const path of SAMPLES) equal(result.calls.filter((call) => call === path).length, 5, `${path} retry count`);
  });

  test('deploy verify-only recovers when 429 clears after two retries', () => {
    const result = verify({ curlScenario: 'recover429' });
    equal(result.code, 0, result.output);
    equal(result.output.includes('Deploy verified:'), true, result.output);
    for (const path of SAMPLES) equal(result.calls.filter((call) => call === path).length, 3, `${path} retry count`);
  });

  test('deploy verify-only fails when an unpublished path is reachable', () => {
    const result = verify({ curlScenario: 'leak' });
    equal(result.code, 1, result.output);
    equal(result.output.includes('LEAK  README.md -> HTTP 200'), true, result.output);
    equal(result.output.includes('DEPLOY FAILED:'), true, result.output);
  });

  test('deploy verify-only fails when a live sample has different bytes', () => {
    const result = verify({ curlScenario: 'diff' });
    equal(result.code, 1, result.output);
    equal(result.output.includes('DIFF  index.html'), true, result.output);
    equal(result.output.includes('DEPLOY FAILED:'), true, result.output);
  });

  test('deploy verify-only fails when Pages reports errored or times out on another commit', () => {
    const errored = verify({ ghScenario: 'errored' });
    equal(errored.code, 1, errored.output);
    equal(errored.output.includes('Pages reported errored'), true, errored.output);
    const different = verify({ ghScenario: 'different' });
    equal(different.code, 1, different.output);
    equal(different.output.includes('Pages did not report built'), true, different.output);
  });

  test('deploy verify-only catches a Git-tree mismatch without changing the real worktree', () => {
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    const result = verify({ mismatch: true });
    equal(result.code, 1, result.output);
    equal(result.output.includes('TREE DIFF  index.html'), true, result.output);
    equal(result.output.includes('DEPLOY FAILED:'), true, result.output);
    equal(execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }), before, 'real git status');
  });
}
