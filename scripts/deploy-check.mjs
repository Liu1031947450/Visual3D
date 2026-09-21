/**
 * 生产部署冒烟检查：先按子目录 build，再运行 npm run test:deploy。
 * 默认自行启动/关闭 Vite preview；BASE_URL 可指向线上地址，不依赖开发环境 __atlas。
 * DEPLOY_BASE 与构建的 --base 必须一致；本仓库默认部署前缀为 /Visual3D/。
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium } from 'playwright';

const base = process.env.DEPLOY_BASE || '/Visual3D/';
let server;
let browser;
try {
  if (!process.env.BASE_URL) server = await preview({ base, preview: { host: '127.0.0.1', port: 4188, strictPort: false, open: false } });
  const url = process.env.BASE_URL || server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL === 'chromium' ? undefined : process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir('test-results', { recursive: true });
  const eyeResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/models/eye.glb'));
  const response = await page.goto(url);
  assert.equal(response.status(), 200, 'site must load');
  const homepage = new URL(url);
  const eyeAsset = await eyeResponse;
  assert.equal(eyeAsset.status(), 200, 'eye GLB must load');
  assert.equal(new URL(eyeAsset.url()).pathname, `${homepage.pathname}models/eye.glb`, 'model URL preserves deployment prefix');
  assert.equal(new URL(await page.locator('.brand').getAttribute('href'), homepage).pathname, homepage.pathname, 'home link preserves deployment prefix');

  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#home').click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-hotspot]')].filter(element => element.getClientRects().length).length === 9);
    // 缩小后读取像素，确认 Three.js 确实绘制了模型，不只是页面控件加载成功。
    const colored = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
      const context = canvas.getContext('2d');
      context.drawImage(document.querySelector('#scene > canvas'), 0, 0, 80, 80);
      const data = context.getImageData(0, 0, 80, 80).data;
      let count = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (Math.max(data[index], data[index + 1], data[index + 2]) - Math.min(data[index], data[index + 1], data[index + 2]) > 25) count += 1;
      }
      return count;
    });
    assert(colored > 120, `${name} must show a nonblank model`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} must not overflow`);
    await page.locator('[data-hotspot="lens"]').click();
    assert.equal(await page.locator('#part-name').textContent(), '晶状体');
    await page.screenshot({ path: `test-results/deploy-${name}.png`, fullPage: true });
  }

  // 手机导航会隐藏部分入口，恢复桌面宽度后逐一检查正文和下载路径。
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const name of ['export', 'collaboration', 'report']) {
    await page.locator(`[data-doc="${name}"]`).first().click();
    await page.waitForSelector('#document-content h1');
    const documentURL = new URL(await page.locator('#download-doc').getAttribute('href'), homepage);
    assert(documentURL.pathname.startsWith(`${homepage.pathname}docs/`), 'documents preserve deployment prefix');
    const documentResponse = await page.request.get(documentURL.href);
    assert.equal(documentResponse.status(), 200);
    assert.match(await documentResponse.text(), /^# /);
    await page.locator('#close-docs').click();
  }
  await page.locator('.brand').click();
  await page.waitForSelector('[data-hotspot="lens"]:visible');
  assert.equal(new URL(page.url()).pathname, homepage.pathname, 'home navigation returns to this project');
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log(`PASS: ${url} - desktop/mobile 3D pixels, nine labels, selection, documents and home navigation.`);
} finally {
  await browser?.close();
  await server?.close();
}
