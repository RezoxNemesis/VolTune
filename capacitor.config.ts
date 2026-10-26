import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.voltune.app",
  appName: "VolTune",
  webDir: "dist",
  backgroundColor: "#0C1220",
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    // The page reads env(safe-area-inset-*), so let it draw edge to edge.
    SystemBars: { insetsHandling: "css", initialViewportFitValueHint: "cover", style: "DEFAULT" },
  },
};

export default config;
