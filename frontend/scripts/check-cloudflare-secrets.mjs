import { spawnSync } from "node:child_process";

const environment = process.argv[2];
if (!environment || !/^[a-z][a-z0-9-]*$/.test(environment)) {
  console.error("Usage: node scripts/check-cloudflare-secrets.mjs <environment>");
  process.exit(2);
}

const required = [
  "CSRF_SECRET",
  "EMAIL_KEY_SECRET",
  "MISSION_SIGNING_SECRET",
  "TURNSTILE_SECRET",
];
const result = spawnSync(
  "npm",
  ["exec", "--", "wrangler", "secret", "list", "--env", environment],
  { encoding: "utf8" },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const start = result.stdout.indexOf("[");
const end = result.stdout.lastIndexOf("]");
if (start < 0 || end < start) {
  console.error(`Could not read the ${environment} Worker secret bindings.`);
  process.exit(1);
}

let bindings;
try {
  bindings = JSON.parse(result.stdout.slice(start, end + 1));
} catch {
  console.error(`Could not parse the ${environment} Worker secret bindings.`);
  process.exit(1);
}
if (!Array.isArray(bindings)) {
  console.error(`Unexpected ${environment} Worker secret binding response.`);
  process.exit(1);
}
const configured = new Set(bindings.map((binding) => binding?.name));
const missing = required.filter((name) => !configured.has(name));
if (missing.length > 0) {
  console.error(`${environment} is missing required Worker secrets: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`${environment} Worker secrets present: ${required.join(", ")}`);
