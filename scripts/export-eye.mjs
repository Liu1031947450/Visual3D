import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import validator from 'gltf-validator';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
let browser;
try {
  server.middlewares.use('/export-eye', (request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Eye GLB export</title>');
  });
  await server.listen();
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL === 'chromium' ? undefined : process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto(`${server.resolvedUrls.local[0]}export-eye`);
  const encoded = await page.evaluate(async () => {
    const { createEye } = await import('/scripts/eye-source.js');
    const { disposeModel } = await import('/src/eye.js');
    const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
    const model = createEye();
    try {
      let meshIndex = 0;
      model.root.traverse(object => {
        if (object.isMesh) object.name = `${object.userData.part}_mesh_${++meshIndex}`;
      });
      const data = await new GLTFExporter().parseAsync(model.root, { binary: true, onlyVisible: false });
      let binary = '';
      for (const byte of new Uint8Array(data)) binary += String.fromCharCode(byte);
      return btoa(binary);
    } finally { disposeModel(model); }
  });
  const data = Buffer.from(encoded, 'base64');
  const validation = await validator.validateBytes(new Uint8Array(data), { uri: 'eye.glb' });
  assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues.messages));
  await mkdir('public/models', { recursive: true });
  await writeFile('public/models/eye.glb', data);
  console.log(`Exported public/models/eye.glb (${data.length} bytes; ${validation.issues.numErrors} errors, ${validation.issues.numWarnings} warnings).`);
} finally {
  await browser?.close();
  await server.close();
}
