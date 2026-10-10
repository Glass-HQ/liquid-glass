import { expect, test } from "bun:test";
import { finishRetainedExit, retainLatestExit } from "./exit-handoff.js";

test("an entering replacement completes only its own parent's outgoing submenu", () => {
  const parent = {} as Element, other = {} as Element;
  const finished: string[] = [];
  const release = retainLatestExit(parent, () => finished.push("old"));
  const releaseOther = retainLatestExit(other, () => finished.push("other"));
  finishRetainedExit(parent);
  finishRetainedExit(parent);
  expect(finished).toEqual(["old"]);
  const releaseNext = retainLatestExit(parent, () => finished.push("next"));
  release();
  finishRetainedExit(parent);
  expect(finished).toEqual(["old", "next"]);
  releaseNext(); releaseOther();
});

test("rapid sibling changes retain the latest exit and finish only superseded siblings", () => {
  const parent = {} as Element, other = {} as Element;
  const finished: string[] = [];
  const releaseA = retainLatestExit(parent, () => finished.push("a"));
  const releaseOther = retainLatestExit(other, () => finished.push("other"));
  const releaseB = retainLatestExit(parent, () => { finished.push("b"); releaseB(); });
  expect(finished).toEqual(["a"]);
  releaseA(); // Disposing an older popup must not release its replacement.
  const releaseC = retainLatestExit(parent, () => finished.push("c"));
  expect(finished).toEqual(["a", "b"]);
  releaseC(); releaseOther();
  const releaseD = retainLatestExit(parent, () => finished.push("d"));
  expect(finished).toEqual(["a", "b"]);
  releaseD();
});
