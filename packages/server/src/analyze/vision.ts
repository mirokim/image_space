/**
 * 이미지 분석 — 로컬 Claude CLI 기반(Anthropic API 미사용, 키 불필요).
 *
 * `claude -p --output-format json --json-schema <택소노미>` 로 헤드리스 호출하고,
 * 응답의 `structured_output`(스키마 검증된 객체)을 zod 로 재검증한다.
 * CLI 미설치/실패/MOCK_ANALYSIS=1 이면 이미지 해시 기반 결정론적 목업으로 폴백.
 */
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  SCALAR_DIMENSIONS,
  CATEGORICAL_DIMENSIONS,
  buildAnalysisSchema,
  type AnalysisResult,
} from '@imgspace/shared';
import { config } from '../config.js';

const schema = buildAnalysisSchema();

/**
 * 출력 JSON 형식 명세(프롬프트용). CLI 의 --json-schema strict 모드는 이 큰 택소노미에서
 * 재시도 끝에 실패하는 일이 잦아, 프롬프트로 형식을 지정하고 .result 를 직접 파싱한다.
 */
function schemaSpec(): string {
  const scalars = SCALAR_DIMENSIONS.map(
    (d) => `    "${d.key}": 0~1,   // ${d.label}: 0=${d.low}, 1=${d.high}`,
  ).join('\n');
  const cats = CATEGORICAL_DIMENSIONS.map(
    (d) => `    "${d.key}": "${d.options.map((o) => o.value).join(' | ')}",   // ${d.label}`,
  ).join('\n');
  return `{
  "caption": "이미지 한 줄 설명(한국어, 30자 내외)",
  "scores": {
${scalars}
  },
  "labels": {
${cats}
  }
}`;
}

function instruction(imagePath: string): string {
  return (
    `이미지 파일 ${imagePath} 를 Read 도구로 연 뒤 분석하라.\n` +
    '아래 형식의 JSON 객체 하나만 출력하라 — 다른 텍스트·코드펜스 금지. ' +
    'scores 는 0~1 숫자, labels 는 보기 중 정확히 하나(value)로 채운다. ' +
    '주관을 배제하고 시각적 근거에 따라 일관되게 평가하라.\n\n' +
    schemaSpec()
  );
}

interface CliResult {
  is_error?: boolean;
  result?: string;
}

/** CLI 텍스트 응답에서 JSON 객체를 추출(코드펜스/잡텍스트 허용). */
function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1]!.trim();
  if (!t.startsWith('{')) {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
  }
  return JSON.parse(t);
}

/**
 * Claude CLI 실행 방법 해석. Windows 셸 shim(.cmd) execFile 문제를 피하려고
 * 가능하면 `node <cli.js>` 로 직접 호출한다.
 *  1) CLAUDE_CLI 환경변수(.js 경로 또는 바이너리) 우선
 *  2) 공통 npm 전역 위치의 cli.js 탐색
 *  3) PATH 의 claude 바이너리 폴백(win 은 shell)
 */
let resolvedCli: { cmd: string; pre: string[]; shell: boolean } | null = null;
function resolveCli() {
  if (resolvedCli) return resolvedCli;
  const override = process.env.CLAUDE_CLI;
  if (override) {
    resolvedCli = override.endsWith('.js')
      ? { cmd: process.execPath, pre: [override], shell: false }
      : { cmd: override, pre: [], shell: override.endsWith('.cmd') };
    return resolvedCli;
  }
  const rel = path.join('node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  const dirs: string[] = [];
  if (process.platform === 'win32') {
    if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm', rel));
    if (process.env.npm_config_prefix) dirs.push(path.join(process.env.npm_config_prefix, rel));
  } else {
    for (const p of ['/usr/local', '/usr', process.env.npm_config_prefix, process.env.HOME && path.join(process.env.HOME, '.npm-global'), '/opt/homebrew'])
      if (p) dirs.push(path.join(p, 'lib', rel));
  }
  const cliJs = dirs.find((d) => existsSync(d));
  resolvedCli = cliJs
    ? { cmd: process.execPath, pre: [cliJs], shell: false }
    : { cmd: process.platform === 'win32' ? 'claude.cmd' : 'claude', pre: [], shell: process.platform === 'win32' };
  return resolvedCli;
}

/** Claude CLI 헤드리스 호출 → structured_output. */
function classifyViaCli(imagePath: string, blobsDir: string): Promise<AnalysisResult> {
  const cliArgs = [
    '-p',
    '--model', config.visionModel,
    '--output-format', 'json',
    '--add-dir', blobsDir,
    '--allowedTools', 'Read',
    '--no-session-persistence',
    instruction(imagePath),
  ];
  // 중첩 세션 가드 회피(개발 중 Claude Code 안에서 띄울 때) + 깨끗한 환경.
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const { cmd, pre, shell } = resolveCli();
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      [...pre, ...cliArgs],
      { env, timeout: config.cliTimeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, shell },
      (err, stdout) => {
        if (err) return reject(err);
        let parsed: CliResult;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          return reject(new Error('CLI 출력 JSON 파싱 실패'));
        }
        if (parsed.is_error || !parsed.result) {
          return reject(new Error(`CLI 분석 실패: ${parsed.result ?? 'no result'}`));
        }
        try {
          resolve(schema.parse(extractJson(parsed.result)));
        } catch (e) {
          reject(new Error(`구조화 파싱 실패: ${e instanceof Error ? e.message : e}`));
        }
      },
    );
    // -p 모드가 stdin(파이프) EOF 를 기다리며 멈추지 않도록 즉시 닫는다.
    child.stdin?.end();
  });
}

/**
 * 목업 분석 — 이미지 바이트 sha256 에서 결정론적 점수/라벨.
 * CLI 미설치/오프라인/실패 폴백. 같은 이미지 → 항상 같은 결과.
 */
function mockAnalysis(buf: Buffer): AnalysisResult {
  const h = createHash('sha256').update(buf).digest();
  let i = 0;
  const next = () => {
    const v = ((h[i % h.length]! << 8) | h[(i + 1) % h.length]!) / 65535;
    i += 2;
    return Math.round(v * 100) / 100;
  };
  const scores: Record<string, number> = {};
  for (const d of SCALAR_DIMENSIONS) scores[d.key] = next();
  const labels: Record<string, string> = {};
  for (const d of CATEGORICAL_DIMENSIONS) {
    const idx = h[i++ % h.length]! % d.options.length;
    labels[d.key] = d.options[idx]!.value;
  }
  const fmt = CATEGORICAL_DIMENSIONS.find((d) => d.key === 'format');
  const fmtLabel = fmt?.options.find((o) => o.value === labels['format'])?.label ?? '이미지';
  return schema.parse({ caption: `${fmtLabel} (목업 분석)`, scores, labels });
}

let cliWarned = false;

/**
 * 이미지 1장 분석. imagePath=절대경로, blobsDir=CLI 가 읽도록 허용할 디렉터리.
 * 기본은 Claude CLI, 실패하면 목업으로 폴백(파이프라인이 죽지 않게).
 */
export async function analyzeImage(imagePath: string, blobsDir: string): Promise<AnalysisResult> {
  if (config.mockAnalysis) return mockAnalysis(readFileSync(imagePath));
  try {
    return await classifyViaCli(imagePath, blobsDir);
  } catch (err) {
    if (!cliWarned) {
      cliWarned = true;
      console.warn(
        `[vision] Claude CLI 분석 실패 → 목업 폴백. (${err instanceof Error ? err.message : err})\n` +
          '         CLI 설치/로그인 확인: `claude --version`, `claude /login`.',
      );
    }
    return mockAnalysis(readFileSync(imagePath));
  }
}
