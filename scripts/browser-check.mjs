/**
 * 端到端检查：npm run test:browser。先启动 Vite 开发服务，默认地址为 127.0.0.1:5188。
 * 脚本在 Node 运行，Playwright 启动独立测试浏览器；page.evaluate 内的函数才运行在网页中。
 * 默认需安装 Google Chrome；BROWSER_CHANNEL=chromium 可切换到已安装的 Playwright Chromium。
 * 需要开发环境的 window.__atlas 和 Vite 模块路径，不可直接指向 dist/preview 运行此脚本。
 * 测试合成资产与截图写入 test-results，不接触用户模型；finally 保证断言失败时也关闭浏览器。
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import validator from 'gltf-validator';
import { anatomy } from '../src/content.js';

// 1. 创建浏览器与固定视口，收集未捕获异常。BASE_URL 只改变测试地址，不负责启动服务。
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:5188';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL === 'chromium' ? undefined : process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', error => errors.push(error.message));
const report = { date: new Date().toISOString(), browser: browser.version(), viewport: '1440x1000, DPR 1', formats: [] };
/**
 * 将当前三维画面缩到 80×80 并读取 RGBA 像素：colored 粗查模型不是空白，hash 比较画面变化。
 * 这是视觉启发式，不是严格图像相似度算法或医学正确性测试；不能据此证明每个细节都正确。
 */
async function pixels() {
  return page.evaluate(() => {
    const viewer = window.__atlas;
    viewer.renderer.render(viewer.scene, viewer.camera);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
    const context = canvas.getContext('2d');
    context.drawImage(viewer.renderer.domElement, 0, 0, 80, 80);
    const data = context.getImageData(0, 0, 80, 80).data;
    let hash = 0;
    let colored = 0;
    // RGBA 每四个值一像素；按固定权重累积无符号整数，同时统计颜色通道差异明显的像素。
    for (let index = 0; index < data.length; index += 4) {
      hash = (hash * 31 + data[index] + data[index + 1] * 3 + data[index + 2] * 7) >>> 0;
      if (Math.max(data[index], data[index + 1], data[index + 2]) - Math.min(data[index], data[index + 1], data[index + 2]) > 25) colored += 1;
    }
    return { hash, colored };
  });
}

/** 检查真实可见的标签，而非仅数 DOM；同时防止标签互相遮挡、盖住工具或越出画布。 */
async function checkAnnotations(expectedIds = anatomy.map(entry => entry.id)) {
  await page.waitForFunction(count => [...document.querySelectorAll('[data-hotspot]')].filter(element => element.getClientRects().length).length === count, expectedIds.length);
  // 等待下一帧布局，覆盖 ResizeObserver 和显隐切换后的坐标更新。
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const { scene, labels, tools } = await page.evaluate(() => ({
    scene: document.querySelector('#scene').getBoundingClientRect().toJSON(),
    labels: [...document.querySelectorAll('[data-hotspot]')].filter(element => element.getClientRects().length).map(element => ({ id: element.dataset.hotspot, ...element.getBoundingClientRect().toJSON() })),
    tools: [...document.querySelectorAll('.left-tools, #layers-panel, .bottom-tools, .scene-top')].filter(element => element.getClientRects().length).map(element => element.getBoundingClientRect().toJSON()),
  }));
  assert.deepEqual(labels.map(label => label.id).sort(), [...expectedIds].sort(), 'visible annotations match structures');
  const overlaps = (first, second) => first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
  labels.forEach((label, index) => {
    assert(label.width > 0 && label.height > 0, `${label.id} has a visible label`);
    assert(label.left >= scene.left && label.right <= scene.right && label.top >= scene.top && label.bottom <= scene.bottom, `${label.id} stays within the scene`);
    assert(!labels.slice(index + 1).some(other => overlaps(label, other)), `${label.id} must not overlap another label`);
    assert(!tools.some(tool => overlaps(label, tool)), `${label.id} must not overlap controls`);
  });
}
try {
  // 2. 等待 Viewer 真正完成统计采样，检查标题、非空画布并保存桌面截图和渲染设备信息。
  await page.goto(baseURL);
  await page.waitForFunction(() => Boolean(window.__atlas?.stats));
  assert.match(await page.title(), /OCULUS/);
  const first = await pixels(); assert(first.colored > 300, '3D model must have a substantial nonblank region');
  report.initial = await page.evaluate(() => {
    const viewer = window.__atlas;
    const context = viewer.renderer.getContext();
    const extension = context.getExtension('WEBGL_debug_renderer_info');
    return { ...viewer.stats, renderer: extension ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable' };
  });
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await checkAnnotations();
  for (const id of ['cornea', 'ciliary', 'choroid', 'lens', 'vitreous']) {
    await page.locator(`[data-hotspot="${id}"]`).click();
    assert.equal(await page.locator('#part-name').textContent(), anatomy.find(entry => entry.id === id).name);
  }
  await page.locator('[data-hotspot="retina"]').click();
  await page.locator('#labels').click(); await checkAnnotations([]);
  await page.locator('#labels').click(); await checkAnnotations();

  // 3. 通过实际控件检查模式、X 切面、交集规则和辅助平面；同时比较画布变化，而非只看 DOM。
  await page.locator('[data-mode="whole"]').click();
  await checkAnnotations();
  assert.notEqual((await pixels()).hash, first.hash, 'whole and section views must differ');
  await page.locator('[data-mode="section"]').click();
  await page.locator('[data-plane="0"]').evaluate(input => { input.value = '0.75'; input.dispatchEvent(new Event('input')); });
  assert.equal(await page.locator('#plane-value-0').textContent(), '0.75');
  assert.notEqual((await pixels()).hash, first.hash, 'moving a clipping plane must change rendered pixels');
  await page.locator('[data-plane="0"]').evaluate(input => { input.value = '-0.6'; input.dispatchEvent(new Event('input')); });
  await checkAnnotations(anatomy.filter(entry => entry.id !== 'cornea').map(entry => entry.id));
  await page.locator('#intersection').uncheck();
  assert.equal(await page.evaluate(() => window.__atlas.model.materials.every(material => !material.clipIntersection)), true);
  await checkAnnotations([]);
  await page.locator('#reset-clipping').click();
  await checkAnnotations();
  await page.locator('#helpers').check();
  assert.equal(await page.evaluate(() => window.__atlas.helpers.visible), true);
  await page.locator('#helpers').uncheck();

  // 4. 图文选择、图层显隐、透明度和展开位置必须与三维状态一致。
  await page.locator('[data-part="iris"]').click();
  assert.equal(await page.locator('#part-name').textContent(), '虹膜');
  await page.locator('[data-visibility="sclera"]').uncheck();
  assert.equal(await page.evaluate(() => window.__atlas.model.groups.get('sclera').visible), false);
  await checkAnnotations(anatomy.filter(entry => entry.id !== 'sclera').map(entry => entry.id));
  await page.locator('#show-all').click();
  await checkAnnotations();
  await page.locator('#opacity').evaluate(input => { input.value = '65'; input.dispatchEvent(new Event('input')); });
  assert.equal(await page.locator('#opacity-value').textContent(), '65%');
  await page.locator('#opacity').evaluate(input => { input.value = '100'; input.dispatchEvent(new Event('input')); });
  await page.locator('[data-mode="exploded"]').click();
  assert.equal(await page.evaluate(() => window.__atlas.model.groups.get('cornea').position.z > 2), true);
  await checkAnnotations();
  await page.screenshot({ path: 'test-results/exploded.png', fullPage: true });
  await page.locator('[data-mode="section"]').click();
  await page.locator('#home').click();

  // 5. 模拟左键拖动旋转和右键拖动平移，断言相机/target 确实变化；再查缩放与自动旋转。
  const position = await page.evaluate(() => window.__atlas.camera.position.toArray());
  const bounds = await page.locator('#scene > canvas').boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.4);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.45, { steps: 12 }); await page.mouse.up();
  assert.notDeepEqual(await page.evaluate(() => window.__atlas.camera.position.toArray()), position, 'drag rotates camera');
  await checkAnnotations();
  const target = await page.evaluate(() => window.__atlas.controls.target.toArray());
  await page.mouse.down({ button: 'right' }); await page.mouse.move(bounds.x + bounds.width * 0.67, bounds.y + bounds.height * 0.5, { steps: 8 }); await page.mouse.up({ button: 'right' });
  assert.notDeepEqual(await page.evaluate(() => window.__atlas.controls.target.toArray()), target, 'right drag pans camera');
  const distance = await page.evaluate(() => window.__atlas.camera.position.distanceTo(window.__atlas.controls.target));
  await page.locator('#zoom-in').click();
  assert(await page.evaluate(() => window.__atlas.camera.position.distanceTo(window.__atlas.controls.target)) < distance, 'zoom button moves camera closer');
  await page.locator('#home').click();
  await page.locator('#rotate').click();
  const rotation = (await pixels()).hash;
  await page.waitForFunction(previous => window.__atlas.camera.position.x !== previous, await page.evaluate(() => window.__atlas.camera.position.x));
  assert.notEqual((await pixels()).hash, rotation, 'automatic rotation changes canvas');
  await page.locator('#rotate').click();
  const downloadEvent = page.waitForEvent('download'); await page.locator('#snapshot').click();
  // 6. 必须先监听 download 再点击，避免错过下载事件；保存实际 PNG 用于人工复核。
  const download = await downloadEvent; assert.match(download.suggestedFilename(), /\.png$/);
  await download.saveAs('test-results/model.png');
  // 文档以出现 h1 和正文为完成信号，而不是用固定延时猜测请求已结束。
  for (const document of ['export', 'collaboration', 'report']) {
    await page.locator(`[data-doc="${document}"]`).first().click();
    await page.waitForSelector('#document-content h1');
    assert((await page.locator('#document-content').textContent()).length > 500);
    await page.locator('#close-docs').click();
  }

  // 7. 在浏览器内生成同一份测试几何、32×32 贴图和位移动画，不依赖用户提供的模型。
  // 这些导入路径由当前 Vite 开发服务提供，不是供生产代码使用的正式 URL。
  const fixtures = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
    const { OBJExporter } = await import('/node_modules/three/examples/jsm/exporters/OBJExporter.js');
    const root = new THREE.Group();
    const textureCanvas = document.createElement('canvas'); textureCanvas.width = textureCanvas.height = 32;
    const context = textureCanvas.getContext('2d'); context.fillStyle = '#d2ad79'; context.fillRect(0, 0, 32, 32); context.fillStyle = '#a48553'; context.fillRect(0, 0, 16, 16);
    const texture = new THREE.CanvasTexture(textureCanvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.65 }); material.name = 'Surface';
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.5, 64, 40), material); sphere.name = 'sclera'; root.add(sphere);
    const lensMaterial = new THREE.MeshStandardMaterial({ color: '#82b9b0', roughness: 0.25 }); lensMaterial.name = 'LensSurface';
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.7, 48, 32), lensMaterial); lens.name = 'lens'; lens.position.z = 1.3; lens.scale.z = 0.4; root.add(lens);
    // 轨道名称 lens.position 要匹配网格名称；时间为秒，三个位置关键帧构成一段往返运动。
    const animation = new THREE.AnimationClip('LensMotion', 2, [new THREE.VectorKeyframeTrack('lens.position', [0, 1, 2], [0, 0, 1.3, 0, 0, 1.6, 0, 0, 1.3])]);
    const exporter = new GLTFExporter();
    const glb = await exporter.parseAsync(root, { binary: true, animations: [animation] });
    const gltf = await exporter.parseAsync(root, { animations: [animation] });
    // 页面和 Node 通过可序列化值交换数据，用 base64 传二进制；这不是应用正式的上传协议。
    const encode = data => { const bytes = new Uint8Array(data); let encoded = ''; for (const byte of bytes) encoded += String.fromCharCode(byte); return btoa(encoded); };
    // GLB 保持内嵌资源；glTF 拆出 bin/PNG，以覆盖附件映射路径。OBJ 另配一个基础 MTL。
    const binary = gltf.buffers[0].uri.split(',')[1]; gltf.buffers[0].uri = 'fixture.bin';
    const image = gltf.images[0].uri.split(',')[1]; gltf.images[0].uri = 'fixture.png';
    const obj = `mtllib fixture.mtl\n${new OBJExporter().parse(root)}`;
    return {
      glb: [{ name: 'fixture.glb', base64: encode(glb) }],
      gltf: [{ name: 'fixture.gltf', text: JSON.stringify(gltf) }, { name: 'fixture.bin', base64: binary }, { name: 'fixture.png', base64: image }],
      obj: [{ name: 'fixture.obj', text: obj }, { name: 'fixture.mtl', text: 'newmtl Surface\nKd 1 1 1\nmap_Kd fixture.png\nnewmtl LensSurface\nKd 0.51 0.73 0.69\n' }, { name: 'fixture.png', base64: image }],
    };
  });

  // 8. 三种格式先落盘，GLB/glTF 用官方 Validator 校验，再经真实文件输入框走生产导入逻辑。
  for (const [format, files] of Object.entries(fixtures)) {
    const payloads = files.map(file => ({ name: file.name, mimeType: 'application/octet-stream', buffer: file.base64 ? Buffer.from(file.base64, 'base64') : Buffer.from(file.text) }));
    for (const file of payloads) await writeFile(`test-results/${file.name}`, file.buffer);
    let validation;
    if (format !== 'obj') {
      // 提供 externalResourceFunction，确保分离 glTF 的 bin/图片也被校验，而非只检查 JSON。
      validation = await validator.validateBytes(new Uint8Array(payloads[0].buffer), { uri: files[0].name, externalResourceFunction: async uri => {
        const resource = payloads.find(file => file.name === decodeURIComponent(uri));
        if (!resource) throw new Error(`Missing fixture resource: ${uri}`);
        return new Uint8Array(resource.buffer);
      } });
      await writeFile(`test-results/${format}.validation.json`, JSON.stringify(validation, null, 2));
      assert.equal(validation.issues.numErrors, 0, `${format} fixture must pass Khronos validation`);
    }
    await page.locator('#model-files').setInputFiles(payloads);
    await page.waitForFunction(name => window.__atlas.model.filename === name, files[0].name);
    assert.equal(await page.locator('#layers .layer-row').count(), 2);
    assert.equal(await page.locator('[data-mode="exploded"]').isDisabled(), true);
    await checkAnnotations([]);
    await page.locator('[data-mode="whole"]').click();
    assert((await pixels()).colored > 100, `${format} must render nonblank`);
    if (format !== 'obj') {
      // 当前验证的是代表性的节点位移动画，不自动覆盖复杂骨骼、morph 或全部扩展。
      assert.equal(await page.locator('#animation-panel').isVisible(), true);
      await page.locator('#animation-toggle').click();
      await page.waitForFunction(() => window.__atlas.mixer.time > 0.1);
      await page.locator('#animation-toggle').click();
    }
    // 9. 性能采样：同页热环境重复解析五次取中位数，每次测量后释放临时模型。
    // 不包含网络下载、初次 JS 加载或完整首帧成本；三种格式材质表达也并非完全等价。
    const measurement = await page.evaluate(async fixtureFiles => {
      const { loadModel } = await import('/src/import-model.js');
      const { disposeModel } = await import('/src/eye.js');
      const files = fixtureFiles.map(file => new File([file.base64 ? Uint8Array.from(atob(file.base64), character => character.charCodeAt(0)) : file.text], file.name));
      const samples = [];
      for (let iteration = 0; iteration < 5; iteration += 1) { const model = await loadModel(files); samples.push(model.importMs); disposeModel(model); }
      // rAF 的 60 个间隔是浏览器帧调度指标，不是 GPU 专用计时器或实体手机测量。
      const frameTimes = [];
      let previous;
      await new Promise(resolve => {
        const frame = timestamp => { if (previous !== undefined) frameTimes.push(timestamp - previous); previous = timestamp; if (frameTimes.length < 60) requestAnimationFrame(frame); else resolve(); }; requestAnimationFrame(frame);
      });
      samples.sort((left, right) => left - right);
      return { bytes: files.reduce((sum, file) => sum + file.size, 0), parseMsMedian: Number(samples[2].toFixed(2)), parseSamplesMs: samples.map(sample => Number(sample.toFixed(2))), frameMsMean: Number((frameTimes.reduce((sum, time) => sum + time, 0) / frameTimes.length).toFixed(2)), triangles: window.__atlas.renderer.info.render.triangles, calls: window.__atlas.renderer.info.render.calls, animations: window.__atlas.model.animations.length };
    }, files);
    report.formats.push({ format, ...measurement, validatorErrors: validation?.issues.numErrors, validatorWarnings: validation?.issues.numWarnings });
  }

  // 10. 损坏主文件和缺附件必须失败，并保留当前模型；另检查缺 MTL/贴图及远程资源拒绝。
  const previousName = await page.locator('#model-name').textContent();
  await page.locator('#model-files').setInputFiles([{ name: 'invalid.glb', mimeType: 'application/octet-stream', buffer: Buffer.from('not a model') }]);
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('导入失败'));
  assert.equal(await page.locator('#model-name').textContent(), previousName, 'failed import preserves current model');
  await page.locator('#model-files').setInputFiles([{ name: 'missing.gltf', mimeType: 'application/json', buffer: Buffer.from(fixtures.gltf[0].text) }]);
  await page.waitForFunction(() => document.querySelector('#import').disabled === false);
  assert.equal(await page.locator('#model-name').textContent(), previousName, 'missing companion files preserve current model');
  const invalidResources = await page.evaluate(async fixtures => {
    const { loadModel } = await import('/src/import-model.js');
    const makeFiles = entries => entries.map(file => new File([file.base64 ? Uint8Array.from(atob(file.base64), character => character.charCodeAt(0)) : file.text], file.name));
    const remoteGltf = JSON.parse(fixtures.gltf[0].text); remoteGltf.images[0].uri = 'https://example.invalid/private-texture.png';
    const cases = [
      fixtures.obj.filter(file => !file.name.endsWith('.mtl')),
      fixtures.obj.filter(file => !file.name.endsWith('.png')),
      fixtures.gltf.filter(file => !file.name.endsWith('.png')),
      [{ name: 'remote.gltf', text: JSON.stringify(remoteGltf) }, fixtures.gltf[1]],
    ];
    const messages = [];
    for (const entries of cases) { try { await loadModel(makeFiles(entries)); messages.push('unexpected success'); } catch (error) { messages.push(error.message); } }
    return messages;
  }, fixtures);
  assert(invalidResources.every(message => message !== 'unexpected success'), 'missing materials, textures and remote references must be rejected');

  // 11. 恢复示意模型，用移动视口检查非空画布、无横向溢出和图层选择。
  // 改视口不是实体手机测试，不证明 iOS/Android GPU 性能或完整触摸手势兼容。
  await page.locator('#restore-demo').click();
  await page.locator('#home').click();
  await checkAnnotations();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload(); await page.waitForFunction(() => Boolean(window.__atlas?.stats));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile must not overflow horizontally');
  assert((await pixels()).colored > 120, 'mobile 3D model must be visible');
  await checkAnnotations();
  await page.locator('[data-hotspot="lens"]').click();
  assert.equal(await page.locator('#part-name').textContent(), '晶状体');
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.locator('#layers-toggle').click(); await page.locator('[data-part="lens"]').click();
  assert.equal(await page.locator('#part-name').textContent(), '晶状体');
  await checkAnnotations();
  await page.locator('#layers-toggle').click();
  for (const width of [320, 360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#home').click();
    await checkAnnotations();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no overflow at ${width}px`);
    await page.locator('#layers-toggle').click();
    await checkAnnotations();
    await page.locator('#side').click();
    // 窄屏侧视可能让锚点离开画面；用 Three.js 视锥独立判定，不强行要求仍显示九个。
    const inView = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const viewer = window.__atlas;
      viewer.camera.updateMatrixWorld();
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(viewer.camera.projectionMatrix, viewer.camera.matrixWorldInverse));
      return viewer.annotations.filter(annotation => frustum.containsPoint(viewer.model.groups.get(annotation.id).localToWorld(new THREE.Vector3(...annotation.position)))).map(annotation => annotation.id);
    });
    await checkAnnotations(inView);
    await page.locator('#layers-toggle').click();
  }
  // 12. 汇总前确认无未捕获 pageerror；主动测试坏文件时出现的预期 Loader 错误日志不等同于 pageerror。
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  report.checks = ['desktop/mobile nonblank pixels', 'all nine annotations, selection, nonoverlapping layout and visibility rules', 'clipping intersection/union/offsets', 'layer visibility and selection', 'opacity', 'exploded view', 'orbit/pan/zoom/rotation', 'PNG download', 'all three documents', 'GLB embedded texture and animation', 'glTF external bin and texture', 'OBJ+MTL texture', 'failed import preserves model', 'missing materials/textures and remote references rejected', 'responsive widths 320/360/390/768/1280/1440'];
  await writeFile('test-results/verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
// 无论哪一条断言失败都关闭本次创建的浏览器；开发服务器由调用者管理，不在这里关闭。
} finally { await browser.close(); }
