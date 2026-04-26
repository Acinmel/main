import { BadRequestException } from '@nestjs/common';
import { assertUrlSafeForServerFetch } from './url-safety.util';

function expectBlocked(url: string) {
  expect(() => assertUrlSafeForServerFetch(new URL(url))).toThrow(BadRequestException);
}

function expectAllowed(url: string) {
  expect(() => assertUrlSafeForServerFetch(new URL(url))).not.toThrow();
}

describe('assertUrlSafeForServerFetch', () => {
  it('blocks localhost', () => {
    expectBlocked('http://localhost/foo');
    expectBlocked('http://foo.localhost/bar');
  });

  it('blocks IPv4 loopback and private', () => {
    expectBlocked('http://127.0.0.1/x');
    expectBlocked('http://192.168.1.1/x');
    expectBlocked('http://10.0.0.1/x');
  });

  it('blocks IPv6 loopback and ULA / link-local', () => {
    expectBlocked('http://[::1]/x');
    expectBlocked('http://[fd00::1]/x');
    expectBlocked('http://[fe80::1]/x');
  });

  it('blocks IPv4-mapped IPv6 for private IPv4', () => {
    expectBlocked('http://[::ffff:127.0.0.1]/x');
    expectBlocked('http://[::ffff:192.168.0.1]/x');
  });

  it('allows IPv4-mapped IPv6 for public IPv4', () => {
    expectAllowed('http://[::ffff:8.8.8.8]/x');
  });

  it('allows typical public hostnames', () => {
    expectAllowed('https://www.example.com/path');
    expectAllowed('https://v.douyin.com/abc/');
  });

  it('allows global unicast IPv6 literal', () => {
    expectAllowed('http://[2001:4860:4860::8888]/dns');
  });
});
