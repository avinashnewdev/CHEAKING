const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

// H.265 hardware decode try karne ke flags (jahan GPU support kare wahan seedha chalega)
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
} catch (e) { ffmpegPath = null; }

const convDir = () => {
  const d = path.join(app.getPath('userData'), 'converted');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

const jobs = new Map();

ipcMain.handle('aurora:begin', (e, { name, size, mtime, isVideo }) => {
  const key = crypto.createHash('md5').update(`${name}|${size}|${mtime}`).digest('hex');
  const out = path.join(convDir(), key + (isVideo ? '.mp4' : '.m4a'));
  if (fs.existsSync(out)) return { cached: true, url: pathToFileURL(out).href };
  const src = path.join(convDir(), key + '.src');
  fs.writeFileSync(src, Buffer.alloc(0));
  jobs.set(key, { src, out });
  return { cached: false, id: key };
});

ipcMain.handle('aurora:write', (e, { id, data }) => {
  const j = jobs.get(id);
  if (!j) throw new Error('job nahi mila');
  fs.appendFileSync(j.src, Buffer.from(data));
  return true;
});

ipcMain.handle('aurora:convert', (e, { id, isVideo }) => new Promise((resolve, reject) => {
  const j = jobs.get(id);
  if (!j) return reject(new Error('job nahi mila'));
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return reject(new Error('ffmpeg mila nahi'));
  const tmpOut = j.out + '.part.' + (isVideo ? 'mp4' : 'm4a');
  const args = isVideo
    ? ['-y', '-i', j.src, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast',
       '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-movflags', '+faststart', tmpOut]
    : ['-y', '-i', j.src, '-vn', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', tmpOut];
  const p = spawn(ffmpegPath, args, { windowsHide: true });
  let dur = 0, log = '';
  const toSec = (s) => { const m = s.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; };
  p.stderr.on('data', (b) => {
    const s = b.toString(); log = (log + s).slice(-2000);
    const d = s.match(/Duration:\s*([\d:.]+)/); if (d) dur = toSec(d[1]);
    const t = s.match(/time=([\d:.]+)/);
    if (t && dur) e.sender.send('aurora:progress', Math.min(99, Math.round(toSec(t[1]) / dur * 100)));
  });
  p.on('error', (err) => reject(err));
  p.on('close', (code) => {
    try { fs.unlinkSync(j.src); } catch (x) {}
    jobs.delete(id);
    if (code === 0 && fs.existsSync(tmpOut)) {
      fs.renameSync(tmpOut, j.out);
      resolve({ url: pathToFileURL(j.out).href });
    } else {
      try { fs.unlinkSync(tmpOut); } catch (x) {}
      reject(new Error('ffmpeg fail: ' + log.split('\n').slice(-3).join(' ')));
    }
  });
}));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 400, minHeight: 600,
    backgroundColor: '#0A0B10',
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
