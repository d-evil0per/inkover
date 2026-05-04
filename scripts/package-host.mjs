import { spawn } from "node:child_process";

function getDefaultPlatformArgs() {
  switch (process.platform) {
    case "win32":
      return ["--win"];
    case "darwin":
      return ["--mac"];
    default:
      return ["--linux"];
  }
}

const forwardedArgs = process.argv.slice(2);
const hasPlatformArg = forwardedArgs.some((arg) =>
  ["--win", "--mac", "--linux", "-m", "-w", "-l", "-mwl"].includes(arg)
);
const defaultPlatformArgs = hasPlatformArg ? [] : getDefaultPlatformArgs();
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const env = { ...process.env };

if (
  process.platform === "win32" &&
  !env.INKOVER_WINDOWS_LOCAL_BUILD &&
  defaultPlatformArgs.includes("--win")
) {
  env.INKOVER_WINDOWS_LOCAL_BUILD = "1";
}

const child = spawn(
  command,
  [
    "electron-builder",
    "--config",
    "electron-builder.config.cjs",
    ...defaultPlatformArgs,
    ...forwardedArgs
  ],
  {
    stdio: "inherit",
    env,
    shell: process.platform === "win32"
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});