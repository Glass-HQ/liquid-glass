import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function assertPatchVersion(version) {
  if (typeof version !== 'string' || !/^0\.0\.[1-9]\d*$/.test(version)) {
    throw new Error(`Release version must stay in 0.0.x, starting at 0.0.1; received ${JSON.stringify(version)}.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assertPatchVersion(version);
  console.log(`Version policy passed: ${version}`);
}
