const isWindowsLocalBuild = process.env.INKOVER_WINDOWS_LOCAL_BUILD === "1";

const appDescription =
  "InkOver is a cross-platform desktop annotation tool for live demos, reviews, support sessions, and quick markups.";

module.exports = {
  appId: "io.inkover.app",
  productName: "InkOver",
  executableName: "InkOver",
  artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
  copyright: "Copyright © 2026 InkOver",
  compression: "maximum",
  asar: true,
  publish: [
    {
      provider: "github",
      owner: "d-evil0per",
      repo: "inkover"
    }
  ],
  directories: {
    output: "release"
  },
  files: ["dist/**/*", "assets/**/*", "package.json"],
  mac: {
    target: ["dmg", "zip"],
    category: "public.app-category.graphics-design",
    icon: "assets/icon.icns",
    hardenedRuntime: true,
    entitlements: "assets/entitlements.mac.plist",
    entitlementsInherit: "assets/entitlements.mac.plist",
    darkModeSupport: true
  },
  win: {
    icon: "assets/icon.ico",
    legalTrademarks: "InkOver",
    requestedExecutionLevel: "asInvoker",
    signAndEditExecutable: !isWindowsLocalBuild,
    target: [{ target: "nsis", arch: ["x64"] }]
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: "always",
    createStartMenuShortcut: true,
    shortcutName: "InkOver",
    uninstallDisplayName: "InkOver",
    runAfterFinish: false
  },
  linux: {
    icon: "assets/icon.png",
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] }
    ],
    category: "Graphics",
    executableName: "inkover",
    maintainer: "InkOver Contributors",
    vendor: "InkOver",
    synopsis: "Desktop screen annotation and markup tool",
    description: appDescription,
    desktop: {
      entry: {
        Comment: "Screen annotation tool for demos, reviews, support, and quick markups",
        Categories: "Graphics;Utility;",
        Keywords: "annotation;screen;presentation;recording;whiteboard;",
        StartupNotify: "true"
      }
    }
  },
  deb: {
    packageCategory: "graphics",
    priority: "optional"
  }
};