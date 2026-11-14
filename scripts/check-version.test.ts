import { expect, test } from "bun:test";
import { assertPackagesAt, versionFromTag } from "./check-version.ts";

test("reads the version from a release tag", () => {
  for (const version of ["0.0.3", "0.1.0", "1.0.0", "1.2.3-beta.1"]) {
    expect(versionFromTag(`liquid-glass@${version}`)).toBe(version);
  }
});

test("rejects tags of other names and malformed versions", () => {
  for (const tag of [
    "0.0.3",
    "v0.0.3",
    "editor@0.0.3",
    "liquid-glass@v0.0.3",
    "liquid-glass@0.0",
    "liquid-glass@",
    "liquid-glass@0.0.3+build",
  ]) {
    expect(() => versionFromTag(tag)).toThrow();
  }
});

test("requires every public package at the tag's version", () => {
  expect(() =>
    assertPackagesAt("0.0.3", [{ name: "@glass-sdk/liquid-glass", version: "0.0.3" }]),
  ).not.toThrow();
  expect(() =>
    assertPackagesAt("0.0.3", [{ name: "@glass-sdk/liquid-glass", version: "0.0.2" }]),
  ).toThrow("@glass-sdk/liquid-glass@0.0.2");
});
