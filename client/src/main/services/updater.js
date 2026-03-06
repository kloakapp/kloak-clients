const { app, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const GITHUB_REPO = "kloakapp/kloak-clients";
const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_REPO}`;

function isNewerVersion(remote, local) {
  const r = remote.replace(/^v/, "").split(".").map(Number);
  const l = local.replace(/^v/, "").split(".").map(Number);

  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

async function fetchLatestGitHubReleaseOrTag() {
  const releaseResponse = await fetch(`${GITHUB_API_BASE}/releases/latest`);

  if (releaseResponse.ok) {
    const release = await releaseResponse.json();
    return {
      version: release.tag_name,
      url: release.html_url,
      assets: release.assets || [],
      source: "release",
    };
  }

  if (releaseResponse.status !== 404) {
    throw new Error(
      `GitHub latest release lookup failed with status ${releaseResponse.status}`,
    );
  }

  const tagsResponse = await fetch(`${GITHUB_API_BASE}/tags`);
  if (!tagsResponse.ok) {
    throw new Error(
      `GitHub tag lookup failed with status ${tagsResponse.status}`,
    );
  }

  const tags = await tagsResponse.json();
  const latestTag = tags[0];
  if (!latestTag?.name) {
    throw new Error("No GitHub releases or tags found");
  }

  return {
    version: latestTag.name,
    url: `https://github.com/${GITHUB_REPO}/tree/${latestTag.name}`,
    assets: [],
    source: "tag",
  };
}

async function checkForCustomUpdate(event) {
  try {
    const currentVersion = app.getVersion();
    const latest = await fetchLatestGitHubReleaseOrTag();

    if (latest.version) {
      if (isNewerVersion(latest.version, currentVersion)) {
        event.reply("update-status", {
          available: true,
          url: latest.url,
          version: latest.version,
          source: latest.source,
          downloadable: latest.assets.length > 0,
        });
        return;
      }
    }

    event.reply("update-status", { available: false });
  } catch (err) {
    console.error("Update check failed", err);
    event.reply("update-status", { available: false, error: true });
  }
}

async function triggerDebugUpdate(event) {
  try {
    const latest = await fetchLatestGitHubReleaseOrTag();

    if (latest.version) {
      event.reply("update-status", {
        available: true,
        url: latest.url,
        version: latest.version,
        source: latest.source,
        downloadable: latest.assets.length > 0,
      });
    }
  } catch (err) {
    console.error("Debug update check failed", err);
  }
}

async function downloadUpdate(event, { version, platform }) {
  try {
    const isWin = platform === "win32";
    const assetExtension = isWin ? ".exe" : ".AppImage";

    const latest = await fetchLatestGitHubReleaseOrTag();
    if (latest.source !== "release") {
      throw new Error(
        "Latest GitHub version is a tag, not a published release. Auto-download requires GitHub release assets.",
      );
    }

    const asset = latest.assets.find((a) =>
      a.name.endsWith(assetExtension),
    );
    if (!asset) {
      throw new Error(`No ${assetExtension} asset found in release ${version}`);
    }

    const url = asset.browser_download_url;
    const fileName = asset.name;
    const tempDir = app.getPath("temp");
    const downloadPath = path.join(tempDir, fileName);

    console.log(`[Updater] Downloading update from ${url} to ${downloadPath}`);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    event.reply("update-progress", {
      progress: 0,
      status: "Starting download...",
    });

    const contentLength = response.headers.get("content-length");
    let downloaded = 0;
    const reader = response.body.getReader();
    const writer = fs.createWriteStream(downloadPath);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      downloaded += value.length;
      writer.write(value);

      if (contentLength) {
        const progress = Math.round((downloaded / contentLength) * 100);
        event.reply("update-progress", { progress, status: "Downloading..." });
      }
    }

    writer.end();

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    event.reply("update-progress", {
      progress: 100,
      status: "Ready to install",
    });

    global.pendingUpdatePath = downloadPath;

    // Platform-specific prep
    if (!isWin) {
      const currentAppImage = process.env.APPIMAGE;
      if (currentAppImage) {
        fs.chmodSync(downloadPath, 0o755);
        global.currentAppImage = currentAppImage;
      } else {
        throw new Error(
          "APPIMAGE environment variable not found. Are you running from an AppImage?",
        );
      }
    }
  } catch (err) {
    console.error("[Updater] Download failed", err);
    event.reply("update-progress", { error: err.message });
  }
}

function installAndRestart() {
  const isWin = process.platform === "win32";
  const updatePath = global.pendingUpdatePath;

  if (!updatePath || !fs.existsSync(updatePath)) {
    console.error("[Updater] No update found to install");
    return;
  }

  if (isWin) {
    try {
      // Write a temp .vbs script that runs completely hidden (no cmd window).
      const vbsContent = [
        'Set WshShell = CreateObject("WScript.Shell")',
        "WScript.Sleep 3000",
        `WshShell.Run """${updatePath.replace(/\\/g, "\\\\")}""" & " /S", 0, True`,
        `Set fso = CreateObject("Scripting.FileSystemObject")`,
        `If fso.FileExists("${updatePath.replace(/\\/g, "\\\\")}") Then fso.DeleteFile "${updatePath.replace(/\\/g, "\\\\")}"`,
        'WshShell.Run """%LOCALAPPDATA%\\Programs\\kloak-client\\Kloak.exe""", 1, False',
        "fso.DeleteFile WScript.ScriptFullName",
      ].join("\r\n");

      const vbsPath = path.join(app.getPath("temp"), "kloak-update.vbs");
      fs.writeFileSync(vbsPath, vbsContent);

      console.log("[Updater] Spawning hidden Windows update script:", vbsPath);
      spawn("wscript.exe", [vbsPath], {
        detached: true,
        stdio: "ignore",
      }).unref();

      app.exit(0);
    } catch (err) {
      console.error("[Updater] Failed to launch Windows update script", err);
    }
  } else {
    const currentAppImage = global.currentAppImage;
    if (currentAppImage) {
      try {
        // The running AppImage is FUSE-mounted and can't be overwritten in-place.
        // Spawn a detached bash script that waits for us to exit, then replaces & relaunches.
        const pid = process.pid;
        const script = `
          while kill -0 ${pid} 2>/dev/null; do sleep 0.5; done
          sleep 1
          mv -f "${updatePath}" "${currentAppImage}" || cp -f "${updatePath}" "${currentAppImage}"
          chmod +x "${currentAppImage}"
          "${currentAppImage}" &
        `;

        console.log("[Updater] Spawning update script for PID:", pid);
        spawn("bash", ["-c", script], {
          detached: true,
          stdio: "ignore",
        }).unref();

        app.exit(0);
      } catch (err) {
        console.error("[Updater] Failed to launch update script", err);
      }
    }
  }
}

module.exports = {
  checkForCustomUpdate,
  downloadUpdate,
  installAndRestart,
  triggerDebugUpdate,
};
