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
      // No node integration in the renderer - the page is plain web code.
      nodeIntegration: false,
      contextIsolation: true,
      // Audio is the whole point; disable autoplay restrictions so the
      // visualiser starts producing without a user-gesture-per-source.
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  // navigator.mediaDevices.getDisplayMedia in Electron triggers a source
  // picker. Intercept it and return the system / entire-screen source so
  // the user does not have to pick a window each session - matches the
  // Android "Entire screen" pin behaviour.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      const screenSource = sources[0];
      if (!screenSource) {
        callback({});
        return;
      }
      // Audio: "loopback" pulls system audio mix on Windows; on macOS/Linux
      // Electron will fall back to no audio if the platform does not
      // support loopback. The desktop README documents this limitation.
      callback({ video: screenSource, audio: "loopback" });
    }).catch(() => callback({}));
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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
