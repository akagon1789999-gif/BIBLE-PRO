const { execFileSync } = require("child_process");
const path = require("path");

// electron-builder skips signing entirely when no paid Developer ID
// certificate is found (see the "skipped macOS application code signing"
// build log line) — but a completely unsigned binary can leave macOS's
// microphone/camera TCC authorization in a broken state (permission shows
// granted in System Settings, but access silently fails anyway). A free
// ad-hoc signature (no certificate needed) is enough for TCC to properly
// attribute and persist the grant.
module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
};
