#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = resolve(REPO_ROOT, ".env");
const VENV_UVICORN = resolve(REPO_ROOT, "services/api/.venv/bin/uvicorn");
const B2_ENV_CONTRACT = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "config/b2-env-contract.json"), "utf8"),
);

// Required minimum versions. Bump as upstream support shifts.
const REQUIRED_NODE_MAJOR = 20;
const REQUIRED_PNPM_MAJOR = 9;
const REQUIRED_PYTHON_MINOR = 11; // 3.11+

const REQUIRED_B2_VARS = B2_ENV_CONTRACT.required;
const LEGACY_B2_ENV_ALIASES = B2_ENV_CONTRACT.legacyAliases;
const REQUIRED_OPENAI_VARS = ["OPENAI_API_KEY"];
const PLACEHOLDERS = new Set([
  "your_b2_region",
  "your_application_key_id",
  "your_key_id",
  "your_b2_endpoint",
  "your_application_key",
  "your-bucket-name",
  "your_openai_api_key",
]);

const PORTS_TO_CHECK = [{ port: 3000, name: "Next.js dev server" }];

const failures = [];
const warnings = [];

function fail(msg, fix) {
  failures.push({ msg, fix });
}

function warn(msg, fix) {
  warnings.push({ msg, fix });
}

function tryExec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function parseSemver(s) {
  const match = s.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

// ----- Tool versions -----

function checkNode() {
  const v = parseSemver(process.version);
  if (!v || v.major < REQUIRED_NODE_MAJOR) {
    fail(
      `Node ${process.version} is too old (need >= ${REQUIRED_NODE_MAJOR}.0.0)`,
      `Install a current Node via nvm/fnm: \`nvm install ${REQUIRED_NODE_MAJOR}\``,
    );
  }
}

function checkPnpm() {
  const out = tryExec("pnpm --version");
  if (!out) {
    fail("pnpm is not installed", "Install via corepack: `corepack enable && corepack prepare pnpm@latest --activate`");
    return;
  }
  const v = parseSemver(out);
  if (!v || v.major < REQUIRED_PNPM_MAJOR) {
    fail(
      `pnpm ${out} is too old (need >= ${REQUIRED_PNPM_MAJOR})`,
      `Run: \`corepack prepare pnpm@latest --activate\``,
    );
  }
}

function checkPython() {
  const candidates = [
    "python3",
    "python3.13",
    "python3.12",
    "python3.11",
    "python",
  ];
  for (const bin of candidates) {
    const out = tryExec(`${bin} --version`);
    if (!out) continue;
    const v = parseSemver(out);
    if (v && v.major >= 3 && v.minor >= REQUIRED_PYTHON_MINOR) return; // good
  }
  const found = candidates.map((b) => tryExec(`${b} --version`)).find(Boolean);
  if (found) {
    fail(
      `${found} is too old (need >= 3.${REQUIRED_PYTHON_MINOR})`,
      `Install Python 3.${REQUIRED_PYTHON_MINOR}+ via Homebrew (\`brew install python@3.12\`) or pyenv (\`pyenv install 3.${REQUIRED_PYTHON_MINOR}\`)`,
    );
  } else {
    fail(
      "Python is not on PATH",
      `Install Python 3.${REQUIRED_PYTHON_MINOR}+ from https://python.org, via Homebrew (\`brew install python@3.12\`), or pyenv`,
    );
  }
}

// ----- Project state -----

function checkVenv() {
  if (!existsSync(VENV_UVICORN)) {
    fail(
      "Backend virtualenv not set up (services/api/.venv/bin/uvicorn missing)",
      "Run: `cd services/api && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && cd ../..`",
    );
  }
}

function parseEnvFile(path) {
  const out = {};
  const text = readFileSync(path, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function legacyNamesFor(standardName) {
  return Object.entries(LEGACY_B2_ENV_ALIASES)
    .filter(([, target]) => target === standardName)
    .map(([legacy]) => legacy);
}

function requiredB2Value(env, name) {
  if (env[name]) return env[name];
  for (const legacyName of legacyNamesFor(name)) {
    if (env[legacyName]) return env[legacyName];
  }
  return "";
}

function checkEnv() {
  if (!existsSync(ENV_FILE)) {
    fail(
      ".env is missing at the repo root",
      "Run: `cp .env.example .env`, then fill in your B2 credentials",
    );
    return;
  }
  const env = parseEnvFile(ENV_FILE);
  const missing = REQUIRED_B2_VARS.filter((k) => !requiredB2Value(env, k));
  if (missing.length > 0) {
    fail(
      `.env is missing required B2 variables: ${missing.join(", ")}`,
      "See .env.example for the standard names; legacy aliases are accepted only during migration",
    );
  }
  const placeholders = REQUIRED_B2_VARS.filter((k) => {
    const value = requiredB2Value(env, k);
    return value && PLACEHOLDERS.has(value);
  });
  if (placeholders.length > 0) {
    fail(
      `.env still has placeholder values: ${placeholders.join(", ")}`,
      "Edit .env and replace placeholders with your real B2 credentials (https://secure.backblaze.com/app_keys.htm?utm_source=github&utm_medium=referral&utm_campaign=ai_artifacts&utm_content=b2ai-gpt-realtime-translate-live-event-interpreter)",
    );
  }
  const usedLegacy = [];
  const staleLegacy = [];
  for (const [legacyName, standardName] of Object.entries(LEGACY_B2_ENV_ALIASES)) {
    if (!env[legacyName]) continue;
    if (standardName && !env[standardName]) {
      usedLegacy.push(`${legacyName} -> ${standardName}`);
    } else {
      staleLegacy.push(legacyName);
    }
  }
  if (usedLegacy.length > 0) {
    warn(
      `Legacy B2 variables are in use: ${usedLegacy.join(", ")}`,
      "Add the standard B2 variables, deploy compatible code, then remove legacy aliases",
    );
  }
  if (staleLegacy.length > 0) {
    warn(
      `Stale legacy B2 variables are present and ignored: ${staleLegacy.join(", ")}`,
      "Remove these after all deployed instances read the standard B2 variables",
    );
  }
  const openaiMissing = REQUIRED_OPENAI_VARS.filter((k) => !env[k]);
  if (openaiMissing.length > 0) {
    fail(
      `.env is missing required OpenAI variables: ${openaiMissing.join(", ")}`,
      "Add OPENAI_API_KEY to .env — get one at https://platform.openai.com/api-keys. The live-interpretation feature needs it; the events explorer and /files work without it.",
    );
  }
  const openaiPlaceholders = REQUIRED_OPENAI_VARS.filter(
    (k) => env[k] && PLACEHOLDERS.has(env[k]),
  );
  if (openaiPlaceholders.length > 0) {
    fail(
      `.env still has placeholder OpenAI values: ${openaiPlaceholders.join(", ")}`,
      "Edit .env and replace `your_openai_api_key` with a real key from https://platform.openai.com/api-keys",
    );
  }
}

// ----- Network -----

function isPortBoundOn(port, host) {
  return new Promise((res) => {
    const server = createServer();
    server.once("error", (err) => res(err.code === "EADDRINUSE"));
    server.once("listening", () => server.close(() => res(false)));
    server.listen(port, host);
  });
}

async function checkPort({ port, name }) {
  const [v4, v6] = await Promise.all([
    isPortBoundOn(port, "0.0.0.0"),
    isPortBoundOn(port, "::"),
  ]);
  if (v4 || v6) {
    warn(
      `Port ${port} (${name}) is already in use`,
      `ok — \`pnpm dev\` will pick the next free port automatically. ` +
        `To inspect what's on it: \`lsof -nP -iTCP:${port} -sTCP:LISTEN\`.`,
    );
  }
}

// ----- Run -----

async function main() {
  checkNode();
  checkPnpm();
  checkPython();
  checkVenv();
  checkEnv();
  await Promise.all(PORTS_TO_CHECK.map(checkPort));

  if (failures.length === 0 && warnings.length === 0) {
    console.log("✓ doctor: environment looks good");
    return;
  }

  if (warnings.length > 0) {
    console.error("\n⚠  Warnings:");
    for (const { msg, fix } of warnings) {
      console.error(`  - ${msg}`);
      console.error(`    fix: ${fix}`);
    }
  }

  if (failures.length > 0) {
    console.error("\n✗ Errors:");
    for (const { msg, fix } of failures) {
      console.error(`  - ${msg}`);
      console.error(`    fix: ${fix}`);
    }
    console.error("");
    process.exit(1);
  }

  console.error("\nProceeding despite warnings.\n");
}

main();
