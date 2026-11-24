import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { createDownloadGuard, clientIp } from './download-guard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3001);
const FILE_DATA_PATH = path.resolve(process.env.FILE_DATA_PATH || path.join(__dirname, '../frontend/file_data.json'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const LOG_PATH = path.join(DATA_DIR, 'download.log');
const DOWNLOAD_BASE_URL = (process.env.DOWNLOAD_BASE_URL || '/downloads').replace(/\/$/, '');
const ALLOW_EMPTY_REFERER = String(process.env.ALLOW_EMPTY_REFERER || 'false').toLowerCase() === 'true';
const SITE_ORIGINS = (process.env.SITE_ORIGINS || 'http://localhost:8080,http://127.0.0.1:8080')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

fs.mkdirSync(DATA_DIR, { recursive: true });
const guard = createDownloadGuard({ dataDir: DATA_DIR, fileRoot: process.env.FILE_ROOT || path.dirname(FILE_DATA_PATH),
  ipBytes: 0,
  siteBytes: Number(process.env.DOWNLOAD_SITE_DAILY_GIB || 20) * 2 ** 30 });

function loadFileData() {
  const raw = fs.readFileSync(FILE_DATA_PATH, 'utf8');
  const json = JSON.parse(raw);
  const files = new Map();

  for (const [category, list] of Object.entries(json)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item.url !== 'string') continue;
      const url = normalizePublicPath(item.url);
      files.set(url, {
        title: item.title || path.basename(url),
        category: item.category || category,
        source: item.source || '',
        classify: item.classify || '',
        size: item.size || '',
        file: url,
      });
    }
  }

  return files;
}

function loadStats() {
  if (!fs.existsSync(STATS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveStats(stats) {
  const tmpPath = `${STATS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(stats, null, 2), 'utf8');
  fs.renameSync(tmpPath, STATS_PATH);
}

function normalizePublicPath(input) {
  if (typeof input !== 'string') throw new Error('invalid file path');
  const decoded = decodeURIComponent(input).replace(/\\/g, '/').trim();
  if (!decoded || decoded.startsWith('/') || decoded.includes('\0')) throw new Error('invalid file path');

  const normalized = path.posix.normalize(decoded);
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('invalid file path');
  }
  return normalized;
}

function encodePublicPath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

function getClientIp(req) {
  return clientIp(req);
}

function isAllowedReferer(req) {
  const referer = req.headers.referer || '';
  if (!referer) return ALLOW_EMPTY_REFERER;

  try {
    const origin = new URL(referer).origin;
    return SITE_ORIGINS.includes(origin);
  } catch {
    return false;
  }
}

function getCorsHeaders(req) {
  const origin = req.headers.origin;
  if (origin && SITE_ORIGINS.includes(origin)) {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      vary: 'Origin',
    };
  }
  return {};
}

function sendJson(req, res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...getCorsHeaders(req),
  });
  res.end(JSON.stringify(payload));
}

function sendText(req, res, statusCode, text) {
  res.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...getCorsHeaders(req),
  });
  res.end(text);
}

// A slow disk must not retain an unbounded queue of request metadata.
let pendingLogs = 0;
function logDownload(entry) {
  pendingLogs += 1;
  fs.appendFile(LOG_PATH, JSON.stringify(entry) + '\n', err => {
    pendingLogs -= 1;
    if (err) console.error('write download log failed:', err);
  });
}

let files = loadFileData();
let stats = loadStats();
let lastReload = 0;
let hotCache = null;

for (const file of files.keys()) {
  if (!stats[file]) stats[file] = { downloads: 0, lastDownloadedAt: null };
}
saveStats(stats);

function getHotItems(limit) {
  if (hotCache && hotCache.expires > Date.now()) return hotCache.items.slice(0, limit);
  const items = [...files.entries()]
    .map(([file, meta]) => ({
      ...meta,
      downloads: stats[file]?.downloads || 0,
      lastDownloadedAt: stats[file]?.lastDownloadedAt || null,
    }))
    .filter(item => item.downloads > 0)
    .sort((a, b) => b.downloads - a.downloads || String(b.lastDownloadedAt).localeCompare(String(a.lastDownloadedAt)))
    .slice(0, 50);
  hotCache = { expires: Date.now() + 5000, items };
  return items.slice(0, limit);
}

const server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
  if ((req.url || '').length > 4096) {
    sendJson(req, res, 414, { ok: false, message: 'URI Too Long' });
    return;
  }
  let requestUrl;
  try { requestUrl = new URL(req.url || '/', 'http://localhost'); }
  catch { sendJson(req, res, 400, { ok: false, message: 'invalid URL' }); return; }

  if (requestUrl.pathname.startsWith('/downloads/')) {
    if (!['GET', 'HEAD'].includes(req.method)) { sendJson(req, res, 405, { ok: false }); return; }
    const auth = guard.authorize(requestUrl, getClientIp(req), req.headers.range, req.headers['if-range'], req.method === 'HEAD');
    if (auth.status !== 200) {
      if (auth.status === 416) res.setHeader('Content-Range', `bytes */${auth.size}`);
      if (auth.quota) res.setHeader('Retry-After', String(Math.ceil((86400000 - (Date.now() + 28800000) % 86400000) / 1000)));
      const message = auth.quota ? '站点今日下载额度已用完，请明天再试。' :
        ({ 403: '下载链接已失效或不适用于当前网络，请回到网站重新点击下载。',
           404: '文件不存在，请回到网站选择其他资料。', 416: '下载范围无效，请重新开始下载。',
           503: '下载暂时不可用，请稍后重试。' }[auth.status] || '下载暂时不可用。');
      sendText(req, res, auth.status, message);
      return;
    }
    res.writeHead(200, { 'X-Accel-Redirect': auth.redirect, 'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    res.end();
    return;
  }

  if (/^\/(Handout|PDFFiles)\//.test(requestUrl.pathname)) {
    let file;
    try { file = decodeURIComponent(requestUrl.pathname.slice(1)); }
    catch { sendJson(req, res, 400, { ok: false }); return; }
    if (!files.has(file)) { sendJson(req, res, 404, { ok: false }); return; }
    res.writeHead(302, { location: `/api/download?file=${encodeURIComponent(file)}`, 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, getCorsHeaders(req));
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(req, res, 405, { ok: false, message: 'Method Not Allowed' });
    return;
  }

  if (requestUrl.pathname === '/api/health') {
    sendJson(req, res, 200, { ok: true, files: files.size });
    return;
  }

  if (requestUrl.pathname === '/api/reload') {
    if (Date.now() - lastReload < 30000) {
      sendJson(req, res, 429, { ok: false, message: 'reload cooldown' });
      return;
    }
    lastReload = Date.now();
    try {
      const nextFiles = loadFileData();
      files = nextFiles;
      hotCache = null;
    for (const file of files.keys()) {
      if (!stats[file]) stats[file] = { downloads: 0, lastDownloadedAt: null };
    }
    saveStats(stats);
    sendJson(req, res, 200, { ok: true, files: files.size });
    } catch (err) {
      console.error('reload failed:', err.message);
      sendJson(req, res, 500, { ok: false, message: 'reload failed' });
    }
    return;
  }

  if (requestUrl.pathname === '/api/hot') {
    const requested = Number(requestUrl.searchParams.get('limit') || 10);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(50, Math.floor(requested))) : 10;
    sendJson(req, res, 200, { ok: true, items: getHotItems(limit) });
    return;
  }

  if (requestUrl.pathname === '/api/stats') {
    const fileParam = requestUrl.searchParams.get('file');
    if (!fileParam) {
      const totalDownloads = Object.values(stats).reduce((sum, item) => sum + (item.downloads || 0), 0);
      sendJson(req, res, 200, { ok: true, files: files.size, totalDownloads });
      return;
    }

    try {
      const file = normalizePublicPath(fileParam);
      if (!files.has(file)) {
        sendJson(req, res, 404, { ok: false, message: 'file not found' });
        return;
      }
      sendJson(req, res, 200, { ok: true, file, ...files.get(file), ...(stats[file] || { downloads: 0 }) });
    } catch {
      sendJson(req, res, 400, { ok: false, message: 'invalid file path' });
    }
    return;
  }

  if (requestUrl.pathname === '/api/download') {
    if (pendingLogs >= 64) {
      res.setHeader('Retry-After', '5');
      sendJson(req, res, 503, { ok: false, message: 'busy, retry later' });
      return;
    }
    if (!isAllowedReferer(req)) {
      sendJson(req, res, 403, { ok: false, message: 'Forbidden: invalid referer' });
      return;
    }

    try {
      const file = normalizePublicPath(requestUrl.searchParams.get('file') || '');
      if (!files.has(file)) {
        sendJson(req, res, 404, { ok: false, message: 'file not found' });
        return;
      }

      const now = new Date().toISOString();
      stats[file] = stats[file] || { downloads: 0, lastDownloadedAt: null };
      stats[file].downloads += 1;
      stats[file].lastDownloadedAt = now;
      saveStats(stats);

      const meta = files.get(file);
      logDownload({
        time: now,
        file,
        title: meta.title,
        category: meta.category,
        source: meta.source,
        ip: getClientIp(req),
        referer: req.headers.referer || '',
        userAgent: req.headers['user-agent'] || '',
      });

      res.writeHead(302, {
        location: guard.issue(file, getClientIp(req)),
        'cache-control': 'no-store',
      });
      res.end();
    } catch {
      sendJson(req, res, 400, { ok: false, message: 'invalid file path' });
    }
    return;
  }

  sendText(req, res, 404, 'Not Found');
});

server.maxConnections = 128;
server.headersTimeout = 10000;
server.requestTimeout = 15000;
server.keepAliveTimeout = 2000;
server.setTimeout(15000, socket => socket.destroy());

server.listen(PORT, '127.0.0.1', () => {
  console.log(`download api listening on http://127.0.0.1:${PORT}`);
  console.log(`loaded ${files.size} downloadable files from ${FILE_DATA_PATH}`);
});
