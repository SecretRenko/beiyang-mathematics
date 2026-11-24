import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';

export function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  const real = req.headers['x-real-ip'];
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) && net.isIP(real || '')) return real;
  return peer;
}

export function createDownloadGuard({ dataDir, fileRoot, ipBytes = 0, siteBytes = 20 * 2 ** 30,
                                      ttl = 1800, now = () => Date.now() }) {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!Number.isSafeInteger(ipBytes) || ipBytes < 0 || ![siteBytes, ttl].every(v => Number.isSafeInteger(v) && v > 0)) throw new Error('invalid download allowance');
  const root = fs.realpathSync(fileRoot);
  const secretPath = path.join(dataDir, 'download-token.secret');
  if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  const secret = fs.readFileSync(secretPath);
  if (secret.length !== 32) throw new Error('invalid download signing key');
  const quotaPath = path.join(dataDir, 'download-quota.json');
  let quota = { day: '', total: 0, ips: {} };
  if (fs.existsSync(quotaPath)) {
    if (fs.statSync(quotaPath).size > 2 ** 20) throw new Error('quota state exceeds limit');
    quota = JSON.parse(fs.readFileSync(quotaPath, 'utf8'));
    if (typeof quota.day !== 'string' || !Number.isSafeInteger(quota.total) || quota.total < 0 ||
        !quota.ips || Array.isArray(quota.ips) || Object.keys(quota.ips).length > 4096 ||
        Object.values(quota.ips).some(v => !Number.isSafeInteger(v) || v < 0)) throw new Error('invalid quota state');
  }
  function sign(file, ip, expires) {
    return crypto.createHmac('sha256', secret).update(JSON.stringify([file, ip, expires])).digest('hex');
  }
  function issue(file, ip) {
    const expires = Math.floor(now() / 1000) + ttl;
    const encoded = file.split('/').map(encodeURIComponent).join('/');
    return `/downloads/${encoded}?expires=${expires}&token=${sign(file, ip, expires)}`;
  }
  function authorize(url, ip, range, ifRange, head = false) {
    if (!url.pathname.startsWith('/downloads/')) return { status: 403 };
    let file;
    try { file = decodeURIComponent(url.pathname.slice('/downloads/'.length)); }
    catch { return { status: 403 }; }
    if (!/^(Handout|PDFFiles)\//.test(file) || file.includes('\\') || file.includes('\0') ||
        file.split('/').some(p => p === '..' || p === '.')) return { status: 403 };
    const expires = Number(url.searchParams.get('expires'));
    const token = url.searchParams.get('token') || '';
    if (!Number.isInteger(expires) || expires <= Math.floor(now() / 1000) ||
        expires > Math.floor(now() / 1000) + ttl || !/^[a-f0-9]{64}$/.test(token) ||
        !crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(sign(file, ip, expires), 'hex'))) return { status: 403 };
    let size;
    try {
      const physical = fs.realpathSync(path.join(root, file));
      if (!physical.startsWith(root + path.sep)) return { status: 403 };
      const stat = fs.statSync(physical);
      if (!stat.isFile()) return { status: 404 };
      size = stat.size;
    } catch { return { status: 404 }; }
    let bytes = size;
    // If-Range may cause Nginx to send the whole file: reserve that upper bound.
    if (range && !ifRange) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2]) || !size) return { status: 416, size };
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] ? (m[2] ? Math.min(size - 1, Number(m[2])) : size - 1) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || (!m[1] && Number(m[2]) === 0)) return { status: 416, size };
      bytes = end - start + 1;
    }
    if (!head) {
      const day = new Date(now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const current = quota.day === day ? quota : { day, total: 0, ips: {} };
      const used = Object.prototype.hasOwnProperty.call(current.ips, ip) ? current.ips[ip] : 0;
      if (current.total + bytes > siteBytes || (ipBytes > 0 && used + bytes > ipBytes)) return { status: 429, quota: true };
      if (ipBytes > 0 && !Object.prototype.hasOwnProperty.call(current.ips, ip) && Object.keys(current.ips).length >= 4096) return { status: 503 };
      const next = { day, total: current.total + bytes, ips: ipBytes > 0 ? { ...current.ips, [ip]: used + bytes } : {} };
      // Persist before allowing Nginx to send; simultaneous requests cannot overspend.
      try {
        fs.writeFileSync(quotaPath + '.tmp', JSON.stringify(next), { mode: 0o600 });
        fs.renameSync(quotaPath + '.tmp', quotaPath);
      } catch { return { status: 503 }; }
      quota = next;
    }
    return { status: 200, redirect: '/_protected_files/' + file.split('/').map(encodeURIComponent).join('/') };
  }
  return { issue, authorize };
}
