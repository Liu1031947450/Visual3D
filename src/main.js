/**
 * 页面入口，由 index.html 的 module 脚本加载；Vite 负责处理 CSS 和 npm 依赖。
 * 阅读顺序：页面骨架 -> selectPart/renderLayers -> new EyeViewer -> 各控件事件 -> 模型导入 -> 文档。
 * 本文件负责“用户操作如何触发三维行为、结果如何回到 UI”，不负责构造几何或解析文件格式。
 * 需要浏览器 DOM；页面文字使用 content.js / model.entries，三维能力使用 viewer.js。
 */
import './style.css';
import { createIcons, Eye, Box, ScanLine, Layers3, RotateCcw, Maximize2, Focus, Plus, Minus, Play, Pause, Camera, Upload, ArrowUpRight, ArrowRight, X, ChevronRight, SlidersHorizontal, Info, Check, Download, BookOpen, Move3d, Grid3x3, Tags, CheckCheck, FileText, LoaderCircle } from 'lucide';
import { marked } from 'marked';
import { anatomy, drawDiagram } from './content.js';
import { EyeViewer } from './viewer.js';
import { loadModel } from './import-model.js';
import { createEye, eyeAnnotations } from './eye.js';

// 1. 声明需要的图标。icon()/tool() 只生成占位 HTML，真正的 SVG 由 refreshIcons() 替换。
// tool 的 id 用来绑定事件，aria-label 提供无障碍名称，data-tooltip 交给 CSS 显示悬浮提示。
const iconSet = { Eye, Box, ScanLine, Layers3, RotateCcw, Maximize2, Focus, Plus, Minus, Play, Pause, Camera, Upload, ArrowUpRight, ArrowRight, X, ChevronRight, SlidersHorizontal, Info, Check, Download, BookOpen, Move3d, Grid3x3, Tags, CheckCheck, FileText, LoaderCircle };
const icon = name => `<i data-lucide="${name}"></i>`;
const tool = (id, symbol, label, extra = '') => `<button id="${id}" class="icon-button" type="button" aria-label="${label}" data-tooltip="${label}" ${extra}>${icon(symbol)}</button>`;
const app = document.querySelector('#app');
/**
 * 2. 先一次性写入页面骨架，再查询元素/创建 Viewer，避免绑定到不存在的 DOM。
 * 模板定位表：
 * - .site-header / .page-heading：导航、导入按钮和当前模型名称。
 * - #scene：三维 Canvas 的父容器，Viewer 稍后插入 Canvas；工具栏和热点是叠加的 HTML。
 * - #hotspots：按 eyeAnnotations 生成全部标签，anatomy 提供名称，Viewer 逐帧定位和显隐。
 * - #layers：renderLayers() 动态填充；data-part/data-visibility 分别对应选择与显隐。
 * - data-mode：whole / section / exploded；data-plane、data-axis 的 0/1/2 对应 X/Y/Z。
 * - .inspector：结构文字、二维示意图、剖切与动画控件，不属于 WebGL 画布。
 * - #model-files：隐藏的原生多文件选择器；accept 是文件选择提示，真正校验在 validateFiles()。
 * - #docs-dialog / #toast：文档模态框和短时消息。模板只含受控内容，导入名称另用 textContent。
 */
app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="${import.meta.env.BASE_URL}" aria-label="OCULUS 首页"><span class="brand-mark">${icon('eye')}</span><span>OCULUS<span class="brand-sub">解剖视界</span></span></a>
    <nav aria-label="主导航"><button class="nav-item active" data-nav="explore">三维探索</button><button class="nav-item" data-doc="export">模型数据规范</button><button class="nav-item" data-doc="collaboration">协作与验证</button></nav>
    <div class="header-end"><span class="version">EXPERIMENTAL · 01</span><button class="button import-button" id="import">${icon('upload')}<span>导入模型</span></button></div>
  </header>
  <main>
    <section class="page-heading">
      <div><div class="eyebrow"><span></span> HUMAN EYE ATLAS</div><h1>眼球解剖图谱 <span class="title-divider">/</span> <span class="title-secondary">从表面，看见内部</span></h1></div>
      <div class="heading-meta"><span class="model-badge">${icon('box')}<span id="model-name">标准眼球模型</span></span><span id="model-caption">程序化解剖示意 · v1.0</span></div>
    </section>
    <div class="workspace">
      <section class="viewer-column" aria-label="模型工作区">
        <div class="scene" id="scene">
          <div class="scene-top"><div class="scene-title"><span class="live-dot"></span>实时视图 <span class="scene-kind" id="scene-kind">透视</span></div><div class="segmented" aria-label="展示模式"><button data-mode="whole">${icon('box')}<span>完整模型</span></button><button class="active" data-mode="section" aria-pressed="true">${icon('scan-line')}<span>局部剖切</span></button><button data-mode="exploded">${icon('layers-3')}<span>分层展开</span></button></div>${tool('fullscreen', 'maximize-2', '全屏显示')}</div>
          <div class="left-tools"><div class="vertical-tools">${tool('home', 'rotate-ccw', '重置视角')}${tool('front', 'focus', '正面视角')}${tool('wireframe', 'grid-3x3', '线框显示', 'aria-pressed="false"')}<span class="tool-divider"></span>${tool('labels', 'tags', '结构标注', 'aria-pressed="true"')}${tool('layers-toggle', 'layers-3', '结构图层', 'aria-pressed="true"')}</div></div>
          <div class="layers-panel" id="layers-panel"><div class="panel-title">解剖结构 <span id="layer-count">09</span></div><div id="layers"></div><button class="show-all" id="show-all">${icon('check-check')}显示全部结构</button></div>
          <div id="hotspots">${eyeAnnotations.map(({ id, side }) => { const name = anatomy.find(entry => entry.id === id).name; return `<button class="hotspot ${side}" data-hotspot="${id}" aria-label="查看${name}" hidden><span class="hotspot-point"></span><span class="hotspot-line"></span><span class="hotspot-label">${name}</span></button>`; }).join('')}</div>
          <div class="scene-note"><span class="note-index">01 — 09</span><span id="scene-note-text">成人右眼 · 结构示意</span></div>
          <div class="bottom-tools"><div class="zoom-tools">${tool('zoom-out', 'minus', '缩小')}<span id="zoom-value">100%</span>${tool('zoom-in', 'plus', '放大')}</div><span class="tool-divider"></span>${tool('rotate', 'play', '自动旋转', 'aria-pressed="false"')}${tool('snapshot', 'camera', '保存模型截图')}<span class="tool-divider"></span><button class="view-button" id="side">${icon('move-3d')}<span>右侧视图</span></button></div>
          <div class="orientation" aria-hidden="true"><span class="axis axis-y">Y</span><span class="axis axis-x">X</span><span class="axis axis-z">Z</span><span class="axis-origin"></span></div>
          <div id="viewer-error" class="viewer-error" hidden><h2>三维视图暂不可用</h2><p></p><button class="button" onclick="location.reload()">重新加载</button></div>
        </div>
        <div class="viewer-status"><div><span class="status-dot"></span><span id="render-status">WebGL 2.0</span><span class="status-divider"></span><span id="fps">加载中</span><span class="status-divider"></span><span id="triangles">—</span></div><span class="coordinate-label">Y-UP <span>·</span> PERSPECTIVE</span></div>
      </section>
      <aside class="inspector" aria-label="结构信息与剖切设置">
        <div class="inspector-heading"><span>${icon('info')}结构信息</span><span class="selected-count" id="selected-count">07 / 09</span></div>
        <section class="structure-info"><div class="structure-title"><div><h2 id="part-name">视网膜</h2><p id="part-english">Retina</p></div><span class="structure-swatch" id="part-swatch"></span></div><span class="category" id="part-category">内层 · 感光组织</span><p class="description" id="part-description"></p><figure class="diagram"><canvas id="anatomy-diagram" role="img" aria-label="眼球横断面示意，选中结构以绿色标记"></canvas><figcaption><span>眼球横断面</span><span>SCHEMATIC</span></figcaption></figure><dl class="part-facts"><div><dt>主要功能</dt><dd id="part-function"></dd></div><div><dt>相邻结构</dt><dd id="part-relation"></dd></div></dl><button class="text-button" id="next-part">下一个结构 ${icon('arrow-right')}</button></section>
        <section class="clipping-panel"><div class="section-heading"><h3>${icon('sliders-horizontal')}剖切设置</h3><button class="icon-button small" id="reset-clipping" aria-label="重置剖切设置" data-tooltip="重置剖切">${icon('rotate-ccw')}</button></div><div class="clipping-body" id="clipping-body"><div class="toggle-row"><label for="intersection">交集剖切<span class="mini-tag">INTERSECTION</span></label><input id="intersection" class="switch" type="checkbox" checked /></div><div class="axis-sliders">${['X', 'Y', 'Z'].map((axis, index) => `<div class="axis-control"><label class="axis-checkbox axis-${axis.toLowerCase()}" title="启用 ${axis} 轴剖切"><input type="checkbox" data-axis="${index}" checked /><span>${axis}</span></label><input type="range" min="-1.6" max="1.6" step="0.01" value="0" data-plane="${index}" aria-label="${axis} 轴剖切位置" /><output id="plane-value-${index}">0.00</output></div>`).join('')}</div><div class="toggle-row subtle"><label for="helpers">显示剖切平面</label><input id="helpers" class="switch" type="checkbox" /></div></div><div class="opacity-row"><label for="opacity">模型不透明度</label><output id="opacity-value">100%</output></div><input id="opacity" class="opacity-slider" type="range" min="10" max="100" step="1" value="100" aria-label="模型不透明度" /><div id="animation-panel" class="animation-panel" hidden><button id="animation-toggle" class="button">${icon('play')}播放动画</button><select id="animation-select" aria-label="模型动画"></select></div></section>
        <button class="data-link" data-doc="export"><span class="document-icon">${icon('file-text')}</span><span><strong>模型数据导出规范</strong><small>格式、材质与交付标准</small></span>${icon('arrow-up-right')}</button>
      </aside>
    </div>
    <footer><span>OCULUS <span class="footer-separator">/</span> 让复杂结构，清晰可见。</span><span>解剖示意模型，仅用于技术演示，非临床用途。<button data-doc="report">技术验证报告 ${icon('arrow-up-right')}</button></span></footer>
  </main>
  <input id="model-files" type="file" accept=".glb,.gltf,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp" multiple hidden />
  <dialog id="docs-dialog"><div class="dialog-top"><div>${icon('book-open')}<strong>项目交付文档</strong></div>${tool('close-docs', 'x', '关闭文档')}</div><div class="doc-tabs"><button data-doc-tab="export">数据导出规范</button><button data-doc-tab="collaboration">建模协作指南</button><button data-doc-tab="report">技术验证报告</button></div><article id="document-content"></article><div class="dialog-bottom"><span>OCULUS / TECHNICAL DOCUMENTATION</span><a class="button" id="download-doc" download>${icon('download')}下载 Markdown</a></div></dialog>
  <div id="toast" class="toast" role="status" hidden></div>
`;
// 3. 模板中的图标占位符首次转换为 SVG；后续按钮 innerHTML 变化也需要再次调用。
const refreshIcons = () => createIcons({ icons: iconSet, attrs: { 'stroke-width': 1.7 } });
refreshIcons();
const select = selector => document.querySelector(selector);
let viewer;
let toastTimer;
/** 显示操作结果；清除上一条消息的计时器，避免旧计时器提前隐藏新消息。 */
function notify(message, error = false) {
  const toast = select('#toast'); toast.textContent = message; toast.hidden = false; toast.classList.toggle('error', error);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 8000 : 3500);
}
/**
 * 4. 结构联动的统一入口，图层点击、三维射线拾取、热点和“下一个结构”都调用这里。
 * 需要 Viewer 已就绪，id 来自当前 model.entries；不能始终去静态 anatomy 查找导入网格。
 * 先让 Viewer 高亮材质，再更新文字/色块/按钮状态，最后重画内置结构的二维图。
 */
function selectPart(id) {
  const entry = viewer.model.entries.find(item => item.id === id);
  if (!entry) return;
  viewer.select(id);
  for (const key of ['name', 'english', 'category', 'description', 'function', 'relation']) select(`#part-${key}`).textContent = entry[key];
  select('#part-swatch').style.background = entry.color;
  select('#selected-count').textContent = `${entry.number} / ${String(viewer.model.entries.length).padStart(2, '0')}`;
  document.querySelectorAll('[data-part]').forEach(button => { button.classList.toggle('selected', button.dataset.part === id); button.setAttribute('aria-pressed', button.dataset.part === id); });
  document.querySelectorAll('[data-hotspot]').forEach(button => button.classList.toggle('selected', button.dataset.hotspot === id));
  // 固定示意图不是对任意导入文件的截图；导入模型时隐藏，避免错配真实结构。
  select('.diagram').hidden = !viewer.model.procedural;
  if (viewer.model.procedural) drawDiagram(select('#anatomy-diagram'), id);
}
/**
 * 5. 从当前模型重建图层列表；模型替换后必须调用，否则列表还会指向旧对象。
 * entries 提供名称和颜色，groups.get(id) 提供真正的 Three.js 分组/网格；两处 id 必须一致。
 */
function renderLayers() {
  const list = select('#layers'); list.replaceChildren();
  for (const entry of viewer.model.entries) {
    const row = document.createElement('div'); row.className = 'layer-row';
    const button = document.createElement('button'); button.dataset.part = entry.id; button.className = 'layer-name';
    const swatch = document.createElement('span'); swatch.className = 'layer-swatch'; swatch.style.background = entry.color;
    // 名称可能来自本地模型，用 textContent 显示，不能把它当作 HTML 执行。
    const name = document.createElement('span'); name.textContent = entry.name;
    button.append(swatch, name); button.addEventListener('click', () => selectPart(entry.id));
    const visibility = document.createElement('input'); visibility.type = 'checkbox'; visibility.checked = true; visibility.className = 'layer-visibility';
    visibility.setAttribute('aria-label', `显示${entry.name}`); visibility.dataset.visibility = entry.id;
    // 选择结构与隐藏结构是两件事：这里仅改 Object3D.visible，不改变当前选择或删除资源。
    visibility.addEventListener('change', () => { viewer.model.groups.get(entry.id).visible = visibility.checked; row.classList.toggle('is-hidden', !visibility.checked); });
    row.append(button, visibility); list.append(row);
  }
  select('#layer-count').textContent = String(viewer.model.entries.length).padStart(2, '0');
}
// 6. 连接页面与三维层：传入容器、选择回调、统计回调，Viewer 内部负责建场景和渲染循环。
try {
  viewer = new EyeViewer(select('#scene'), selectPart, stats => {
    select('#fps').textContent = `${stats.fps} FPS`;
    select('#triangles').textContent = `${(stats.triangles / 1000).toFixed(1)}k 三角面`;
    // 百分数按观察距离估算，仅是 UI 相对缩放值，不是相机焦距或医学测量倍率。
    select('#zoom-value').textContent = `${Math.round((viewer.container.clientWidth < 600 ? 11.27 : 7.6) / viewer.camera.position.distanceTo(viewer.controls.target) * 100)}%`;
  });
  renderLayers(); selectPart('retina');
  if (matchMedia('(max-width: 560px)').matches) { select('#layers-panel').hidden = true; select('#layers-toggle').setAttribute('aria-pressed', false); }
  // 仅开发环境暴露调试入口，供控制台和浏览器测试观察；生产构建没有 window.__atlas。
  if (import.meta.env.DEV) window.__atlas = viewer;
} catch (error) {
  // 初始化失败时显示提示并禁用依赖三维对象的控件，文档入口仍保留。
  select('#viewer-error').hidden = false;
  select('#viewer-error p').textContent = '无法初始化 WebGL 2。请使用支持硬件加速的现代浏览器。';
  select('#render-status').textContent = 'WebGL 不可用';
  document.querySelectorAll('.workspace button:not([data-doc]), .workspace input, #import').forEach(control => { control.disabled = true; });
  console.error(error);
}
/** 7. 页面级模式切换：除 Viewer 状态，还要同步按钮和剖切控件的可用性。 */
function setMode(mode) {
  if (!viewer) return;
  viewer.setMode(mode);
  document.querySelectorAll('[data-mode]').forEach(button => { button.classList.toggle('active', button.dataset.mode === mode); button.setAttribute('aria-pressed', button.dataset.mode === mode); });
  select('#clipping-body').classList.toggle('inactive', mode !== 'section');
  select('#clipping-body').querySelectorAll('input').forEach(input => { input.disabled = mode !== 'section'; });
}
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
document.querySelectorAll('[data-hotspot]').forEach(button => button.addEventListener('click', () => selectPart(button.dataset.hotspot)));

// 8. 连续拖动滑块触发 input；值本来是字符串，转 Number 后写入对应 Plane.constant。
// Plane 已被材质引用，Viewer 的下一帧直接读取新值；此处不重建眼球，也不做几何布尔运算。
document.querySelectorAll('[data-plane]').forEach(input => input.addEventListener('input', () => {
  viewer.planes[Number(input.dataset.plane)].constant = Number(input.value);
  select(`#plane-value-${input.dataset.plane}`).value = Number(input.value).toFixed(2);
}));
// 启用轴或改变交集规则会改变材质配置，必须重新调用 applyClipping；辅助平面也统一在其中同步。
document.querySelectorAll('[data-axis]').forEach(input => input.addEventListener('change', () => { viewer.state.axes[Number(input.dataset.axis)] = input.checked; viewer.applyClipping(); }));
select('#intersection').addEventListener('change', event => { viewer.state.intersection = event.target.checked; viewer.applyClipping(); });
select('#helpers').addEventListener('change', event => { viewer.state.helpers = event.target.checked; viewer.applyClipping(); });
// 页面使用 10~100 的百分数，材质方法接收 0~1 的倍率。
select('#opacity').addEventListener('input', event => { viewer.setOpacity(Number(event.target.value) / 100); select('#opacity-value').value = `${event.target.value}%`; });
// 重置时主动派发原有 input/change 事件，复用同一条状态更新链，避免只改控件外观。
select('#reset-clipping').addEventListener('click', () => {
  document.querySelectorAll('[data-plane]').forEach(input => { input.value = 0; input.dispatchEvent(new Event('input')); });
  document.querySelectorAll('[data-axis]').forEach(input => { input.checked = true; input.dispatchEvent(new Event('change')); });
  select('#intersection').checked = true; viewer.state.intersection = true;
  select('#helpers').checked = false; viewer.state.helpers = false; viewer.applyClipping();
});

// 9. 相机与输出工具：重置/正面/右侧改变观察位置，缩放沿视线移动，截图只导出三维 Canvas。
select('#home').addEventListener('click', () => { viewer.resetCamera(); select('#scene-kind').textContent = '透视'; });
select('#front').addEventListener('click', () => { viewer.resetCamera('front'); select('#scene-kind').textContent = '正面'; });
select('#side').addEventListener('click', () => { viewer.resetCamera('side'); select('#scene-kind').textContent = '右侧'; });
select('#zoom-in').addEventListener('click', () => viewer.zoom(0.85));
select('#zoom-out').addEventListener('click', () => viewer.zoom(1.17));
select('#snapshot').addEventListener('click', () => { viewer.screenshot(); notify('模型截图已保存为 PNG'); });
// 自动旋转是 OrbitControls 的相机动作，与导入 GLB 内的 AnimationMixer 动画相互独立。
select('#rotate').addEventListener('click', event => {
  viewer.controls.autoRotate = !viewer.controls.autoRotate;
  event.currentTarget.setAttribute('aria-pressed', viewer.controls.autoRotate);
  event.currentTarget.innerHTML = icon(viewer.controls.autoRotate ? 'pause' : 'play'); refreshIcons();
});
// 线框修改材质；标注开关由逐帧 updateAnnotations 读取；图层面板开关只隐藏 HTML 面板。
select('#wireframe').addEventListener('click', event => {
  viewer.state.wireframe = !viewer.state.wireframe;
  viewer.model.materials.forEach(material => { material.wireframe = viewer.state.wireframe; });
  event.currentTarget.setAttribute('aria-pressed', viewer.state.wireframe);
});
select('#labels').addEventListener('click', event => { viewer.state.labels = !viewer.state.labels; event.currentTarget.setAttribute('aria-pressed', viewer.state.labels); });
select('#layers-toggle').addEventListener('click', event => { const panel = select('#layers-panel'); panel.hidden = !panel.hidden; event.currentTarget.setAttribute('aria-pressed', !panel.hidden); });
// “全部显示”仍走复选框事件；“下一个结构”用取模运算在列表末尾回到第一项。
select('#show-all').addEventListener('click', () => document.querySelectorAll('[data-visibility]').forEach(input => { input.checked = true; input.dispatchEvent(new Event('change')); }));
select('#next-part').addEventListener('click', () => { const entries = viewer.model.entries; selectPart(entries[(entries.findIndex(entry => entry.id === viewer.selected) + 1) % entries.length].id); });
// Fullscreen API 必须由用户操作触发，也可能被浏览器拒绝；失败时给提示，不假设永远可用。
select('#fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else if (select('.viewer-column').requestFullscreen) await select('.viewer-column').requestFullscreen(); else notify('当前浏览器不支持全屏显示。', true); }
  catch { notify('浏览器未允许进入全屏。', true); }
});
select('#scene').addEventListener('viewer-error', event => { select('#viewer-error').hidden = false; select('#viewer-error p').textContent = event.detail; });

// 10. 本地导入入口：按钮打开原生文件选择器，FileList 随 change 事件交给 loadModel。
// 解析期间禁用按钮防止重复导入；不发起模型上传请求，也不需要后台接口。
select('#import').addEventListener('click', () => select('#model-files').click());
select('#model-files').addEventListener('change', async event => {
  if (!event.target.files.length || !viewer) return;
  const button = select('#import'); button.disabled = true; button.innerHTML = `${icon('loader-circle')}<span>读取模型</span>`; refreshIcons();
  try {
    // 先完整解析成功再替换模型，因此格式/资源校验失败时原来的模型仍在场景中。
    const model = await loadModel(event.target.files);
    viewer.replaceModel(model); renderLayers(); selectPart(model.entries[0].id); setMode('section');
    select('#model-name').textContent = model.filename;
    select('#model-caption').textContent = `${(model.bytes / 1024 / 1024).toFixed(2)} MB · 本地模型`;
    select('#scene-note-text').textContent = '本地导入 · 自适应显示';
    // 展开位置只对内置九组定义，未知模型不套用；其他 UI 数值同步 Viewer 的替换后状态。
    select('[data-mode="exploded"]').disabled = true;
    select('#opacity').value = 100; select('#opacity-value').value = '100%'; select('#wireframe').setAttribute('aria-pressed', false);
    // 按文件携带的 AnimationClip 生成选项，没有动画就隐藏面板；默认只准备，不自动推进时间。
    select('#animation-panel').hidden = !model.animations.length;
    const animationSelect = select('#animation-select'); animationSelect.replaceChildren();
    model.animations.forEach((animation, index) => { const option = document.createElement('option'); option.value = index; option.textContent = animation.name || `动画 ${index + 1}`; animationSelect.append(option); });
    select('#animation-toggle').innerHTML = `${icon('play')}播放动画`; refreshIcons();
    notify(`已导入 ${model.filename}，${model.entries.length} 个网格，耗时 ${Math.round(model.importMs)} ms`);
    // 保留一次性的恢复入口，重新生成内置模型并重建图层，不必刷新整个页面。
    if (!select('#restore-demo')) {
      const restore = document.createElement('button'); restore.id = 'restore-demo'; restore.className = 'text-button'; restore.textContent = '恢复示意模型';
      restore.addEventListener('click', () => {
        viewer.replaceModel(createEye()); renderLayers(); selectPart('retina'); setMode('section');
        select('#model-name').textContent = '标准眼球模型'; select('#model-caption').textContent = '程序化解剖示意 · v1.0';
        select('#scene-note-text').textContent = '成人右眼 · 结构示意'; select('[data-mode="exploded"]').disabled = false;
        select('#animation-panel').hidden = true; select('#opacity').value = 100; select('#opacity-value').value = '100%';
        select('#wireframe').setAttribute('aria-pressed', false); restore.remove();
      });
      select('.heading-meta').append(restore);
    }
  } catch (error) { notify(`导入失败：${error.message}`, true); }
  // 清空 input.value 使用户修正后能再次选择同名文件；无论成败都恢复导入按钮。
  finally { button.disabled = false; button.innerHTML = `${icon('upload')}<span>导入模型</span>`; refreshIcons(); event.target.value = ''; }
});

// 11. 资产动画控制：播放/暂停只切换循环中的推进开关，切换动画则停止旧动作并重置新动作。
select('#animation-toggle').addEventListener('click', event => { viewer.animationPlaying = !viewer.animationPlaying; event.currentTarget.innerHTML = `${icon(viewer.animationPlaying ? 'pause' : 'play')}${viewer.animationPlaying ? '暂停动画' : '播放动画'}`; refreshIcons(); });
select('#animation-select').addEventListener('change', event => { viewer.mixer.stopAllAction(); viewer.mixer.clipAction(viewer.model.animations[Number(event.target.value)]).reset().play(); });
// 12. 文档是 public/docs 内的静态文件；BASE_URL 让本地根路径和 GitHub Pages 子目录都能访问。
const documents = { export: `${import.meta.env.BASE_URL}docs/3D模型数据导出规范.md`, collaboration: `${import.meta.env.BASE_URL}docs/建模需求与协作流程.md`, report: `${import.meta.env.BASE_URL}docs/技术验证报告.md` };
// 用浏览器原生 details/summary 包裹已存在的详情，默认折叠，节省侧栏空间。
const details = document.createElement('details');
details.className = 'part-details';
const summary = document.createElement('summary');
summary.textContent = '结构详情';
const facts = select('.part-facts');
facts.before(details); details.append(summary, facts);
let documentRequest = 0;
/**
 * 打开受控文档，依次更新标签 -> 请求 Markdown -> 转 HTML -> 显示。
 * 递增编号防止快速切换标签时，较慢的旧请求覆盖新内容；它不取消旧网络请求。
 * Marked 不替不可信 HTML 做安全清洗，因此这里只加载项目自带文件，不能直接套用到用户文稿。
 */
async function openDocument(name) {
  const request = ++documentRequest;
  const dialog = select('#docs-dialog');
  if (!dialog.open) dialog.showModal();
  document.querySelectorAll('[data-doc-tab]').forEach(button => button.classList.toggle('active', button.dataset.docTab === name));
  select('#document-content').textContent = '正在读取文档…';
  select('#download-doc').href = documents[name];
  try {
    const response = await fetch(documents[name]);
    if (!response.ok) throw new Error();
    const markdown = await response.text();
    if (request === documentRequest) { select('#document-content').innerHTML = marked.parse(markdown); select('#document-content').scrollTop = 0; }
  } catch { if (request === documentRequest) select('#document-content').textContent = '文档加载失败，请稍后重试。'; }
}
document.querySelectorAll('[data-doc]').forEach(button => button.addEventListener('click', () => openDocument(button.dataset.doc)));
document.querySelectorAll('[data-doc-tab]').forEach(button => button.addEventListener('click', () => openDocument(button.dataset.docTab)));
select('#close-docs').addEventListener('click', () => select('#docs-dialog').close());
// 点遮罩时才关闭；通过边界检查区分遮罩与 dialog 自身空白，避免在正文区域误关。
select('#docs-dialog').addEventListener('click', event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close(); } });
