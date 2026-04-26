import { BadRequestException } from '@nestjs/common';
import { isIPv6 } from 'node:net';

/**
 * 防止 SSRF：禁止向内网 / 本机发起服务端抓取（含 IPv4、IPv6、IPv4-mapped IPv6）
 */
export function assertUrlSafeForServerFetch(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('仅允许 http/https 链接');
  }
  /** 部分环境下 IPv6 的 hostname 形如 `[::1]`，需去括号后再做 isIPv6 / 分段判断 */
  const raw = url.hostname.split('%')[0];
  const host = raw.startsWith('[') && raw.endsWith(']')
    ? raw.slice(1, -1).toLowerCase()
    : raw.toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new BadRequestException('不允许抓取本机地址');
  }

  if (isIPv6(host)) {
    assertIPv6Safe(host);
    return;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    assertIpv4OctetsPrivate(ipv4);
  }
}

/** IPv4 字面量或主机名形式的点分十进制 */
function assertIpv4OctetsPrivate(m: RegExpExecArray): void {
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) throw new BadRequestException('不允许抓取私网地址');
  if (a === 127) throw new BadRequestException('不允许抓取回环地址');
  if (a === 0) throw new BadRequestException('不允许抓取保留地址');
  if (a === 169 && b === 254) throw new BadRequestException('不允许抓取链路本地地址');
  if (a === 192 && b === 168) throw new BadRequestException('不允许抓取私网地址');
  if (a === 172 && b >= 16 && b <= 31) {
    throw new BadRequestException('不允许抓取私网地址');
  }
}

function assertIPv6Safe(host: string): void {
  if (host === '::1') {
    throw new BadRequestException('不允许抓取回环地址');
  }

  /** IPv4-mapped IPv6：::ffff:a.b.c.d（部分运行时会规范为 ::ffff:7f00:1 等双十六进制段） */
  const mappedDotted = /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(host);
  if (mappedDotted) {
    assertIpv4OctetsPrivate(mappedDotted);
    return;
  }
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
      const bits32 = ((hi & 0xffff) << 16) | (lo & 0xffff);
      const o1 = (bits32 >>> 24) & 0xff;
      const o2 = (bits32 >>> 16) & 0xff;
      const o3 = (bits32 >>> 8) & 0xff;
      const o4 = bits32 & 0xff;
      const dotted = `${o1}.${o2}.${o3}.${o4}`;
      const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(dotted);
      if (ipv4) assertIpv4OctetsPrivate(ipv4);
    }
    return;
  }

  /** ULA fc00::/7：首段常以 fc / fd 开头（fc00–fdff） */
  const firstSeg = host.split(':').filter((p) => p.length > 0)[0] ?? '';
  if (firstSeg.length >= 2) {
    const p0 = firstSeg.slice(0, 2).toLowerCase();
    if (p0 === 'fc' || p0 === 'fd') {
      throw new BadRequestException('不允许抓取私网地址');
    }
  }

  /** 链路本地 fe80::/10 */
  if (host.startsWith('fe80:')) {
    throw new BadRequestException('不允许抓取链路本地地址');
  }

  /** 已废弃 site-local fec0::/10 */
  if (host.startsWith('fec0:')) {
    throw new BadRequestException('不允许抓取保留地址');
  }
}
