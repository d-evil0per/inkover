import { join } from "path";

export const APP_ID = "io.inkover.app";

export function getWindowIconPath(): string {
  if (process.platform === "darwin") {
    return "";
  }

  const iconFileName = process.platform === "win32" ? "icon.ico" : "icon.png";
  return join(__dirname, "..", "..", "assets", iconFileName);
}