import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const distRoot = path.join(workspaceRoot, "dist");
const mainDir = path.join(distRoot, "main");
const preloadDir = path.join(distRoot, "preload");
const sharedDir = path.join(distRoot, "shared");
const mainEntry = path.join(mainDir, "index.js");
const preloadEntry = path.join(preloadDir, "index.js");
const electronCli = path.join(workspaceRoot, "node_modules", "electron", "cli.js");
const rendererUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
const rendererOrigin = new URL(rendererUrl);
const rendererHost = rendererOrigin.hostname;
const rendererPort = Number(rendererOrigin.port || (rendererOrigin.protocol === "https:" ? 443 : 80));
const initialCompileStartedAt = Date.now();

let electronProcess = null;
let shuttingDown = false;
let restartTimer = null;
let launchGeneration = 0;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileIsFresh(filePath, minMtimeMs = 0) {
  if (!(await pathExists(filePath))) return false;
  const info = await stat(filePath);
  return info.isFile() && info.mtimeMs >= minMtimeMs;
}

function portIsReady() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: rendererHost, port: rendererPort });
    const finish = (ready) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ready);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForDevPrereqs(minFreshMtimeMs = 0) {
  while (!shuttingDown) {
    const [mainReady, preloadReady, rendererReady] = await Promise.all([
      fileIsFresh(mainEntry, minFreshMtimeMs),
      fileIsFresh(preloadEntry, minFreshMtimeMs),
      portIsReady(),
    ]);
    if (mainReady && preloadReady && rendererReady) return;
    await delay(250);
  }
}

async function terminateElectron(proc) {
  if (!proc?.pid) return;

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
    return;
  }

  proc.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => proc.once("exit", () => resolve())),
    delay(2000).then(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Ignore already-exited processes.
      }
    }),
  ]);
}

async function launchElectron(minFreshMtimeMs = 0) {
  const generation = ++launchGeneration;
  await waitForDevPrereqs(minFreshMtimeMs);
  if (shuttingDown || generation !== launchGeneration) return;

  console.log("[dev:electron] launching Electron");
  const proc = spawn(process.execPath, [electronCli, "."], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      INKOVER_DEV: "1",
      VITE_DEV_SERVER_URL: rendererUrl,
    },
    stdio: "inherit",
  });

  electronProcess = proc;
  proc.once("exit", (code, signal) => {
    if (electronProcess === proc) electronProcess = null;
    if (!shuttingDown) {
      console.log(`[dev:electron] Electron exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    }
  });
}

async function restartElectron(reason) {
  if (shuttingDown) return;

  if (electronProcess) {
    console.log(`[dev:electron] ${reason}; restarting Electron`);
    const proc = electronProcess;
    electronProcess = null;
    await terminateElectron(proc);
  }

  await launchElectron();
}

function scheduleRestart(reason) {
  if (shuttingDown) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void restartElectron(reason);
  }, 150);
}

function watchDistDir(dirPath, label) {
  return watch(dirPath, (_eventType, fileName) => {
    const file = typeof fileName === "string" ? fileName : fileName?.toString() ?? "unknown";
    if (!file.endsWith(".js") && !file.endsWith(".json") && !file.endsWith(".map")) return;
    scheduleRestart(`${label}/${file} changed`);
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  await terminateElectron(electronProcess);
  process.exit(exitCode);
}

process.on("SIGINT", () => {
  void shutdown(0);
});
process.on("SIGTERM", () => {
  void shutdown(0);
});

await Promise.all([
  mkdir(mainDir, { recursive: true }),
  mkdir(preloadDir, { recursive: true }),
  mkdir(sharedDir, { recursive: true }),
]);

const watchers = [
  watchDistDir(mainDir, "main"),
  watchDistDir(preloadDir, "preload"),
  watchDistDir(sharedDir, "shared"),
];

try {
  await launchElectron(initialCompileStartedAt);
} catch (error) {
  watchers.forEach((watcher) => watcher.close());
  throw error;
}

for (const watcher of watchers) {
  watcher.once("error", () => {
    void shutdown(1);
  });
}
