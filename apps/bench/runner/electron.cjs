// The smallest Electron app: one default window on the bench page.
const { app, BrowserWindow } = require("electron");
const [url, profile, width, height] = process.argv.slice(2);
app.setPath("userData", profile);
app.whenReady().then(() => new BrowserWindow({ width: Number(width), height: Number(height), x: 0, y: 30 }).loadURL(url));
app.on("window-all-closed", () => app.quit());
