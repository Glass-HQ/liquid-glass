// What the operating system charged, read from outside the browser. A page
// cannot time its own filters: Safari and Firefox render them after the frame
// callback returns, so only process counters see the whole cost.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const seconds = (time) => time.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);

/** Every process: pid, parent, resident memory in MB, CPU seconds used so far, command line. */
export async function processes() {
  const { stdout } = await exec("ps", ["-A", "-ww", "-o", "pid=,ppid=,rss=,time=,args="], { maxBuffer: 1 << 26 });
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    return match ? [{ pid: +match[1], parent: +match[2], memory: +match[3] / 1024, cpu: seconds(match[4]), command: match[5] }] : [];
  });
}
/** GPU time every process on the machine has used, in ms. Browsers hand their
 * drawing to other processes (Safari to WindowServer), so only the machine
 * total is trustworthy; the idle phase of each run is its baseline. Apple GPUs only. */
export async function gpuTime() {
  if (process.platform !== "darwin") return undefined;
  try {
    const { stdout } = await exec("ioreg", ["-r", "-c", "AGXDeviceUserClient", "-l", "-w0"], { maxBuffer: 1 << 26, timeout: 2000 });
    let total = 0;
    for (const match of stdout.matchAll(/"accumulatedGPUTime"=(\d+)/g)) total += Number(match[1]);
    return total / 1e6;
  } catch { return undefined; }
}
/** CPU seconds and memory of one browser, split by what each process does. */
export async function snapshot(browser) {
  const time = performance.now();
  const [list, gpu] = await Promise.all([processes(), gpuTime()]);
  const groups = {};
  let memory = 0;
  for (const [process, group] of browser.classify(list)) {
    groups[group] = (groups[group] ?? 0) + process.cpu;
    if (group !== "system") memory += process.memory;
  }
  return { time, groups, memory, gpu };
}
/** What happened between two snapshots: CPU ms per group, GPU ms, seconds. */
export function between(start, end) {
  const cpu = {};
  for (const group of Object.keys(end.groups)) cpu[group] = Math.max(0, Math.round((end.groups[group] - (start.groups[group] ?? 0)) * 1000));
  return { seconds: (end.time - start.time) / 1000, cpu, gpu: end.gpu === undefined || start.gpu === undefined ? undefined : end.gpu - start.gpu };
}
