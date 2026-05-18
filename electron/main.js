// Electron entry point. Wraps the same static web app the desktop build
// serves over HTTP, but launches it as a native window backed by Electron's
// bundled Chromium. The renderer code (main.js, audio-features.js, etc.)
// is untouched - PLATFORM detection still picks "desktop" since
// window.Capacitor is absent here.

const { app, BrowserWindow, desktopCapturer, session, Menu, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#000000",
    title: "Scope",
    icon: path.join(__dirname, "..", "icon-512.png"),
    webPreferences: {
      // Renderer uses only Web APIs (navigator.mediaDevices, AudioContext,
      // AudioWorklet, WebGL via PIXI). No Electron-side IPC bridge is
      // needed, so the recommended security defaults stay on. If a future
      // change ever needs to call out to the main process, add a preload
      // script with contextBridge — do not flip these flags.
      nodeIntegration: false,
      contextIsolation: true,
      // Explicit even though local-file loads are typically trusted: keeps
      // behaviour identical to the browser build's no-gesture-needed flow.
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  win.loadFile(path.join(__dirname, "..", "index.html"));

  // App menu kept small: File > Exit, Help > Open repo.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        { role: "reload" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open project page",
          click: () => shell.openExternal("https://github.com/"),
        },
      ],
    },
  ]));
}

app.whenReady().then(() => {
  // Install the display-media request handler ONCE on the default session,
  // before any window is created. Subsequent windows from app.on("activate")
  // share defaultSession so they reuse this handler. navigator.mediaDevices
  // .getDisplayMedia in Electron would otherwise pop a per-source picker;
  // here we return the entire-screen source with loopback audio so the user
  // does not pick a source each launch (analogue of Android's "Entire
  // screen" pin). Loopback audio: Windows captures system mix; macOS and
  // Linux fall back to video-only because Electron does not currently
  // support loopback there - documented in README.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      const screenSource = sources[0];
      if (!screenSource) {
        callback({});
        return;
      }
      callback({ video: screenSource, audio: "loopback" });
    }).catch(() => callback({}));
  });
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
