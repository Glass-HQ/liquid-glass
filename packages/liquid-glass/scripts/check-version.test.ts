import { expect, test } from 'bun:test';
import { assertPatchVersion } from './check-version.mjs';

test('allows patches beyond single and double digits', () => {
  for (const version of ['0.0.1', '0.0.2', '0.0.10', '0.0.100']) {
    expect(() => assertPatchVersion(version)).not.toThrow();
  }
});

test('rejects other release lines and noncanonical versions', () => {
  for (const version of ['0.0.0', '0.1.0', '0.2.0', '1.0.0', '0.0.01', '0.0.1-beta.1', '0.0.1+build', 'v0.0.1', '0.01', '', null]) {
    expect(() => assertPatchVersion(version)).toThrow();
  }
});
