// Rasterise build/icon.svg into the app icons with Electron (no extra deps).
//   npx electron scripts/make-icon.cjs
// Outputs: build/icon.png (1024), build/icons/<size>x<size>.png, build/icon.ico
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const svg = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf8');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

async function render(win, size) {
  win.setContentSize(size, size);
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block">
    </body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((r) => setTimeout(r, 150));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  return image.resize({ width: size, height: size, quality: 'best' }).toPNG();
}

/** ICO container holding PNG-compressed entries (supported since Windows Vista). */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const pngs = new Map();
  for (const size of [...new Set([...PNG_SIZES, ...ICO_SIZES])].sort((a, b) => a - b)) {
    pngs.set(size, await render(win, size));
  }
  fs.mkdirSync(path.join(buildDir, 'icons'), { recursive: true });
  for (const size of PNG_SIZES) {
    fs.writeFileSync(path.join(buildDir, 'icons', `${size}x${size}.png`), pngs.get(size));
  }
  fs.writeFileSync(path.join(buildDir, 'icon.png'), pngs.get(1024));
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIco(ICO_SIZES.map((size) => ({ size, png: pngs.get(size) }))));
  console.log('icons written to', buildDir);
  app.quit();
});
