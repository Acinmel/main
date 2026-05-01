/**
 * Docker 上线前冒烟：宿主端口与经 Nginx 的 /api 链路。
 *
 * 用法（根目录已 `docker compose up -d`，服务健康后）：
 *   npm --prefix backend run test:e2e:deploy
 *
 * 环境变量（可选）：
 *   E2E_WEB_BASE      默认 http://127.0.0.1:${WEB_PORT:-8080}
 *   E2E_MYSQL_HOST    默认 127.0.0.1
 *   E2E_MYSQL_PORT    默认 ${MYSQL_HOST_PORT:-3306}
 *
 * 未设置 E2E_DEPLOY=1 时整文件跳过（避免日常 `npm run test:e2e` 依赖外网端口）。
 */

import * as net from 'net';

const deployEnabled = process.env.E2E_DEPLOY === '1';

if (deployEnabled) {
  jest.setTimeout(120_000);
}

function webBase(): string {
  const explicit = process.env.E2E_WEB_BASE?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const port = process.env.WEB_PORT?.trim() || '8080';
  return `http://127.0.0.1:${port}`;
}

function mysqlPort(): number {
  const p = process.env.E2E_MYSQL_PORT ?? process.env.MYSQL_HOST_PORT ?? '3306';
  return parseInt(p, 10) || 3306;
}

function mysqlHost(): string {
  return process.env.E2E_MYSQL_HOST?.trim() || '127.0.0.1';
}

function tcpReachable(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port, timeout: timeoutMs }, () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
    s.on('timeout', () => {
      s.destroy();
      resolve(false);
    });
  });
}

/** 与 docker-compose 中 api 健康检查一致：仅需 HTTP 成功 */
async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${url} → ${res.status} ${res.statusText} ${t.slice(0, 200)}`);
  }
  return res;
}

(deployEnabled ? describe : describe.skip)(
  'Deploy smoke（Docker 端口与 Nginx→API）',
  () => {
    const base = webBase();

    it('Web：GET / 返回 SPA（含 #app）', async () => {
      const res = await fetchOk(`${base}/`);
      const html = await res.text();
      expect(res.headers.get('content-type') || '').toMatch(/text\/html/i);
      expect(html).toMatch(/id=["']app["']/);
    });

    it('Web：GET /admin 回退到 SPA（上线后直开管理后台）', async () => {
      const res = await fetchOk(`${base}/admin`);
      const html = await res.text();
      expect(html).toMatch(/id=["']app["']/);
    });

    it('Nginx：GET /api 重定向到 /api/', async () => {
      const res = await fetch(`${base}/api`, { redirect: 'manual' });
      expect([301, 302, 307, 308]).toContain(res.status);
      const loc = res.headers.get('location') || '';
      expect(loc).toMatch(/\/api\/?$/);
    });

    it('经 Nginx 访问 API 根路径（与 api 容器健康检查一致）', async () => {
      const res = await fetchOk(`${base}/api/`);
      const text = await res.text();
      expect(text).toContain('Hello World');
    });

    it('经 Nginx /api/v1/auth/me 无 Token 返回 401', async () => {
      const res = await fetch(`${base}/api/v1/auth/me`);
      expect(res.status).toBe(401);
    });

    it('经 Nginx 完成注册 → /me（全链路 JSON）', async () => {
      const email = `e2edeploy${Date.now()}@smoke.local`;
      const password = 'DeploySmoke12';

      const reg = await fetch(`${base}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      expect([200, 201]).toContain(reg.status);
      const regJson = (await reg.json()) as { token?: string };
      expect(regJson.token).toBeTruthy();
      const token = regJson.token as string;

      const me = await fetchOk(`${base}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const meJson = (await me.json()) as { user?: { email?: string } };
      expect(meJson.user?.email).toBe(email.toLowerCase());
    });

    it('MySQL：映射端口可 TCP 连通', async () => {
      const ok = await tcpReachable(mysqlHost(), mysqlPort(), 5000);
      expect(ok).toBe(true);
    });
  },
);
