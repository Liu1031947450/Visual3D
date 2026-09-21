/**
 * 三维展示层：负责相机、光照、模型生命周期、剖切和逐帧渲染。
 * main.js 创建唯一的 EyeViewer；本文件不生成侧栏，借助回调把选择和统计交回页面。
 * 运行需要浏览器 DOM、可用的 WebGL 2，以及有实际宽高的容器；不能直接在 Node 中实例化。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { disposeModel, eyeAnnotations } from './eye.js';

export class EyeViewer {
  /**
   * @param {HTMLElement} container 承载三维 Canvas 与 HTML 标注的 #scene。
   * @param {Function} onSelect 接收结构 id，由 main.js 的 selectPart 更新图文。
   * @param {Function} onStats 接收 { fps, triangles, calls }，每个统计周期更新状态栏。
   */
  constructor(container, model, onSelect, onStats) {
    this.container = container;
    this.onSelect = onSelect;

    // 1. Scene 是三维对象的容器；背景与雾影响显示，不改变模型本身的材质数据。
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#eff3f0');
    this.scene.fog = new THREE.Fog('#eff3f0', 11, 22);
    // 2. Renderer 把场景绘制到 Canvas。保留绘图缓冲用于 PNG 导出，像素比上限 2 控制开销。
    // localClippingEnabled 是材质局部剖切的总开关；仅设置 Plane 而不开它不会产生切口。
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.93;
    this.renderer.domElement.setAttribute('aria-label', '交互式三维眼球模型');
    this.renderer.domElement.setAttribute('tabindex', '0');
    container.prepend(this.renderer.domElement);

    // 3. 透视相机决定“从哪里看”；初始宽高比 1 会在 resize() 中换成实际比例。
    // OrbitControls 复用 Three.js 的旋转、缩放、平移逻辑；阻尼需要每帧 update 才能持续收敛。
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3.4;
    this.controls.maxDistance = 14;
    this.controls.maxPolarAngle = Math.PI * 0.92;
    this.controls.autoRotateSpeed = 0.8;

    // 4. 环境纹理为物理材质提供反射。PMREM 预处理不同粗糙度所需的环境光信息。
    // 保留生成结果 this.environment；临时房间和生成器用完即可释放，不能提前释放结果纹理。
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = new RoomEnvironment();
    this.environment = pmrem.fromScene(environment, 0.04);
    this.scene.environment = this.environment.texture;
    environment.dispose(); pmrem.dispose();

    // 半球光补充整体明暗，两个方向光塑造体积；曝光与这些光强需要一起比较调整。
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b3b5a7', 1.25));
    const keyLight = new THREE.DirectionalLight('#fffcf4', 2);
    keyLight.position.set(-3, 6, 7); this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight('#dbeae4', 0.7);
    fillLight.position.set(5, 2, -4); this.scene.add(fillLight);

    // 5. 网格提供方向参照；下方的径向渐变平面只是接触阴影示意，不是实时阴影贴图。
    this.grid = new THREE.GridHelper(50, 100, '#bbcfc4', '#d2ddd5');
    this.grid.position.y = -1.88;
    this.grid.material.transparent = true; this.grid.material.opacity = 0.28;
    this.scene.add(this.grid);
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const context = shadowCanvas.getContext('2d');
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, '#526c4936'); gradient.addColorStop(0.5, '#526c491b'); gradient.addColorStop(1, '#526c4900');
    context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.87; this.scene.add(shadow);

    // 6. 平面方程为 normal.dot(point) + constant = 0，负距离的一侧参与剖切。
    // 默认法线为 -X/-Y/-Z、constant 为 0，因此交集模式裁掉 x>0 且 y>0 且 z>0 的区域。
    // helpers 只是可视化平面的位置，不负责生成切口或封口。
    this.planes = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)];
    this.helpers = new THREE.Group();
    this.planes.forEach((plane, index) => this.helpers.add(new THREE.PlaneHelper(plane, 4.2, ['#c48076', '#71a389', '#6c98bc'][index])));
    this.helpers.visible = false; this.scene.add(this.helpers);

    // 7. state 保存展示设置；model 保存实际 Three.js 对象，两者不是自动双向绑定的。
    // 调整 state 后，有些操作还要调用 applyClipping()/setOpacity()，页面控件由 main.js 同步。
    this.state = { mode: 'section', intersection: true, axes: [true, true, true], helpers: false, labels: true, wireframe: false, opacity: 1 };
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.model = model;
    this.scene.add(this.model.root);

    // 克隆各组初始位置，切换展开模式时始终从基准位置计算，避免重复点击导致偏移累加。
    this.basePositions = new Map([...this.model.groups].map(([id, group]) => [id, group.position.clone()]));
    this.applyClipping(); this.resetCamera();
    // 8. 与页面共用完整锚点表，并缓存标签节点；不是自动识别任意导入模型的标注。
    this.annotations = eyeAnnotations.map(annotation => ({
      ...annotation,
      element: container.querySelector(`[data-hotspot="${annotation.id}"]`),
    }));

    // 9. 观察容器尺寸而非仅监听窗口，侧栏布局改变或进入全屏也能同步 Canvas 和相机。
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    // 10. 抬起位置与按下位置相差不超过 5px 才当作点击，避免转动模型时误选结构。
    let pointerDown;
    this.renderer.domElement.addEventListener('pointerdown', event => { pointerDown = [event.clientX, event.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', event => {
      if (!pointerDown || Math.hypot(event.clientX - pointerDown[0], event.clientY - pointerDown[1]) > 5) return;
      const bounds = this.renderer.domElement.getBoundingClientRect();

      // 页面像素先转为 [-1, 1] 的标准化设备坐标，Y 轴需反向，再从相机发射拾取射线。
      this.pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObject(this.model.root).find(intersection => {
        // 射线检测的是完整几何，不会自动遵循材质剖切；必须补查父级可见性和切面。
        // 跳过内置角膜/玻璃体，便于点到内部；导入模型的 import-* id 不使用这两个名称。
        let current = intersection.object;
        while (current) { if (!current.visible) return false; current = current.parent; }
        return !this.isClipped(intersection.point) && intersection.object.userData.part && !['cornea', 'vitreous'].includes(intersection.object.userData.part);
      });
      if (hit) this.onSelect(hit.object.userData.part);
    });

    // 11. Canvas 可通过 Tab 获得焦点；方向键改变球坐标角度，+/- 改变观察距离。
    // makeSafe 避开球坐标两极的退化角度，模型本身不随键盘操作改变位置。
    this.renderer.domElement.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(event.key)) {
        event.preventDefault();
        if (['+', '-', '='].includes(event.key)) this.zoom(event.key === '-' ? 1.15 : 0.87);
        else {
          const offset = this.camera.position.clone().sub(this.controls.target);
          const spherical = new THREE.Spherical().setFromVector3(offset);
          spherical.theta += event.key === 'ArrowLeft' ? -0.12 : event.key === 'ArrowRight' ? 0.12 : 0;
          spherical.phi += event.key === 'ArrowUp' ? -0.12 : event.key === 'ArrowDown' ? 0.12 : 0;
          spherical.makeSafe();
          this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
        }
      }
    });

    // 12. 图形上下文失效时通知页面展示错误。当前要求刷新恢复，不实现自动重建整个场景。
    this.renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      container.dispatchEvent(new CustomEvent('viewer-error', { detail: '图形上下文已丢失，请刷新页面重新加载模型。' }));
    });
    let previous = performance.now();
    let sampleStart = previous;
    let frameCount = 0;

    // 13. 每帧依次推进相机 -> 推进已启用的动画 -> 渲染 -> 更新 HTML 标注 -> 采样统计。
    // 毫秒差换算成秒，并限制最大步长，避免切换后台后一次推进很远；后台页跳过实际绘制。
    this.renderer.setAnimationLoop(now => {
      const delta = Math.min((now - previous) / 1000, 0.1); previous = now;
      if (document.hidden) return;
      this.controls.update(delta);
      if (this.animationPlaying) this.mixer?.update(delta);
      this.renderer.render(this.scene, this.camera);
      this.updateAnnotations();
      frameCount += 1;
      // FPS 是时间窗口内的渲染循环次数；triangles/calls 包含辅助对象，不等于原始文件面数。
      if (now - sampleStart >= 1000) {
        this.stats = { fps: Math.round(frameCount * 1000 / (now - sampleStart)), triangles: this.renderer.info.render.triangles, calls: this.renderer.info.render.calls };
        onStats(this.stats); frameCount = 0; sampleStart = now;
      }
    });
  }

  /** 容器尺寸变化后，同时更新透视投影比例与绘图缓冲尺寸，避免模型拉伸。 */
  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /** 预设视角只重置相机和观察目标，不重置切面、可见性或自动旋转开关。 */
  resetCamera(direction = 'perspective') {
    this.controls.target.set(0, -0.08, -0.12);
    const mobile = this.container.clientWidth < 600;
    this.camera.position.set(...(direction === 'front' ? [0, 0, mobile ? 10 : 7.4] : direction === 'side' ? [8, 0.4, 0] : mobile ? [5.5, 3.5, 9] : [3.7, 2.5, 6]));
    this.controls.update();
  }

  /** factor < 1 拉近、> 1 拉远；沿相机到 target 的方向移动，并遵守 Controls 的距离边界。 */
  zoom(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance));
    this.camera.position.copy(this.controls.target).add(offset); this.controls.update();
  }

  /**
   * 将当前模式和启用轴同步到所有模型材质。需要已有 model.materials 和 this.planes。
   * 材质保存的是 Plane 对象引用，因此 main.js 直接改 constant 后，下一帧就会用新值。
   * 切换启用平面或交集模式则要重新应用配置；needsUpdate 通知渲染器更新材质程序。
   */
  applyClipping() {
    const planes = this.state.mode === 'section' ? this.planes.filter((plane, index) => this.state.axes[index]) : [];
    this.model.materials.forEach(material => {
      material.clippingPlanes = planes;
      material.clipIntersection = this.state.intersection;
      material.clipShadows = true;
      material.needsUpdate = true;
    });
    this.helpers.visible = this.state.helpers && this.state.mode === 'section';
    this.helpers.children.forEach((helper, index) => { helper.visible = this.state.axes[index]; });
  }

  /**
   * 输入世界空间点，返回该点是否应被裁掉，用于点击过滤和标注隐藏。
   * 必须与材质保持同一规则：交集用 every，并集用 some；零个启用平面时不得裁掉一切。
   * 这是 CPU 侧的辅助判断，实际画面仍由 GPU 的材质剖切处理。
   */
  isClipped(point) {
    if (this.state.mode !== 'section') return false;
    const distances = this.planes.filter((plane, index) => this.state.axes[index]).map(plane => plane.distanceToPoint(point) < 0);
    return distances.length > 0 && (this.state.intersection ? distances.every(Boolean) : distances.some(Boolean));
  }

  /**
   * mode 来自页面的 whole/section/exploded。展开使用内置结构的手工偏移，不切割几何。
   * 先恢复初始位置再偏移；未知导入模型不套用内置位移表，避免破坏其层级关系。
   */
  setMode(mode) {
    this.state.mode = mode;
    const directions = { sclera: [0, 0, -0.75], choroid: [0, 0, -0.25], retina: [0, 0, 0.2], cornea: [0, 0, 2.05], iris: [0, 0, 1.6], ciliary: [0, 0, 0.65], lens: [0, 0, 1], vitreous: [0, 0, 0.25], nerve: [0, 0, -1.05] };
    this.model.groups.forEach((group, id) => {
      group.position.copy(this.basePositions.get(id));
      if (mode === 'exploded' && this.model.builtin) group.position.add(new THREE.Vector3(...directions[id]));
    });
    this.applyClipping();
    if (mode === 'exploded') { this.resetCamera(); this.zoom(1.25); }
  }

  /** 根据 groups 中的 id 更新选中材质，图文更新由调用者 selectPart() 完成。 */
  select(id) {
    this.selected = id;
    this.model.groups.forEach((group, key) => group.traverse(object => {
      for (const material of object.material ? [].concat(object.material) : []) {
        if (!material.emissive) continue;
        // 先存原始自发光色再叠加选中色，取消选择时恢复原色，不把导入材质一律重置为黑色。
        if (!material.userData.originalEmissive) material.userData.originalEmissive = material.emissive.clone();
        material.emissive.copy(material.userData.originalEmissive);
        if (key === id) material.emissive.add(new THREE.Color('#13261c'));
      }
    }));
  }

  /**
   * value 为 0~1 的显示倍率，页面把百分数除以 100 后传入。
   * 与每个材质的原始透明度相乘，恢复到 100% 时角膜仍保留自身的低透明度设定。
   */
  setOpacity(value) {
    this.state.opacity = value;
    this.model.materials.forEach(material => {
      if (!material.userData.originalSurface) material.userData.originalSurface = { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite };
      const original = material.userData.originalSurface;
      material.opacity = original.opacity * value;
      material.transparent = value < 1 || original.transparent;
      // 淡化时不写深度，减少透明表面挡住后续绘制的情况；这并不能解决所有透明排序问题。
      material.depthWrite = value < 1 ? false : original.depthWrite;
      material.needsUpdate = true;
    });
  }

  /** 每帧把三维方向和锚点投影到二维页面；标注是 HTML，并不是 Three.js 文字网格。 */
  updateAnnotations() {
    // 相机旋转的逆变换把世界 XYZ 轴转到观察者坐标系，再写入右下角轴标的 CSS 参数。
    const inverseRotation = this.camera.quaternion.clone().invert();
    [['x', 1, 0, 0], ['y', 0, 1, 0], ['z', 0, 0, 1]].forEach(([axis, horizontal, vertical, depth]) => {
      const element = document.querySelector(`.orientation .axis-${axis}`);
      if (!element) return;
      const direction = new THREE.Vector3(horizontal, vertical, depth).applyQuaternion(inverseRotation);
      element.style.left = `${31 + direction.x * 25}px`;
      element.style.top = `${30 - direction.y * 25}px`;
      element.style.setProperty('--axis-length', `${Math.hypot(direction.x, direction.y) * 25}px`);
      element.style.setProperty('--axis-angle', `${Math.atan2(direction.y, -direction.x)}rad`);
    });
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const projected = [];
    this.annotations.forEach(annotation => {
      const { element } = annotation;
      if (!element) return;
      const group = this.model.groups.get(annotation.id);
      const world = new THREE.Vector3(...annotation.position).add(group?.position || new THREE.Vector3());
      // 内置分组仅有展开位移，可直接相加；导入模型的旋转/缩放层级不适用这组固定锚点。
      const position = world.clone().project(this.camera);
      // 锚点离开视锥或被剖切时隐藏；仅接近画布边缘不再隐藏，标签会被限制在画布内。
      // 未做其他网格遮挡检测；完整模式下可用标注选择内部结构。
      const visible = this.state.labels && this.model.builtin && group?.visible && !this.isClipped(world) && position.z >= -1 && position.z <= 1 && Math.abs(position.x) <= 1 && Math.abs(position.y) <= 1;
      element.hidden = !visible;
      if (visible) projected.push({ ...annotation, anchorX: (position.x * 0.5 + 0.5) * width, anchorY: (-position.y * 0.5 + 0.5) * height });
    });

    // 标签按左右两列和投影高度排列，给左侧工具/图层及底部工具留出空间。
    // ponytail: 九个固定标注按列顺序推开；若扩展到大量标注，再引入通用碰撞布局。
    // 锚点不移动，用独立连线连接排版后的标签。
    const leftEdge = Math.max(12, ...['.left-tools', '#layers-panel'].map(selector => {
      const panel = this.container.querySelector(selector);
      return panel?.offsetWidth ? panel.offsetLeft + panel.offsetWidth + 12 : 12;
    }));
    for (const side of ['left', 'right']) {
      const column = projected.filter(annotation => annotation.side === side).sort((first, second) => first.anchorY - second.anchorY);
      if (!column.length) continue;
      const labelWidth = column[0].element.offsetWidth;
      const labelHeight = column[0].element.offsetHeight;
      const spacing = labelHeight + 8;
      const outerAnchor = side === 'left' ? Math.min(...column.map(annotation => annotation.anchorX)) : Math.max(...column.map(annotation => annotation.anchorX));
      const labelX = side === 'left'
        ? THREE.MathUtils.clamp(outerAnchor - labelWidth - 28, leftEdge, Math.max(leftEdge, width / 2 - labelWidth - 12))
        : THREE.MathUtils.clamp(outerAnchor + 28, Math.max(width / 2 + 12, leftEdge + labelWidth + 12), width - labelWidth - 12);
      let nextTop = 80;
      column.forEach((annotation, index) => {
        const { element, anchorX, anchorY } = annotation;
        const top = THREE.MathUtils.clamp(anchorY - labelHeight / 2, nextTop, height - 96 - labelHeight - (column.length - index - 1) * spacing);
        nextTop = top + spacing;
        element.style.left = `${labelX}px`;
        element.style.top = `${top}px`;
        const startX = side === 'left' ? labelWidth : 0;
        const deltaX = anchorX - labelX - startX;
        const deltaY = anchorY - top - labelHeight / 2;
        element.style.setProperty('--anchor-x', `${anchorX - labelX}px`);
        element.style.setProperty('--anchor-y', `${anchorY - top}px`);
        element.style.setProperty('--line-start', `${startX}px`);
        element.style.setProperty('--line-length', `${Math.hypot(deltaX, deltaY)}px`);
        element.style.setProperty('--line-angle', `${Math.atan2(deltaY, deltaX)}rad`);
      });
    }
  }

  /**
   * 接收 loadEye()/loadModel() 统一返回的模型对象；调用者必须先确认新模型加载成功。
   * 清旧动作和旧模型资源 -> 装入新模型 -> 记录基准位置 -> 准备动画 -> 恢复默认观察方式。
   * 页面图层列表由 main.js 重建；切面常量、启用轴等设置没有在此重置。
   */
  replaceModel(model) {
    this.mixer?.stopAllAction();
    if (this.mixer) this.mixer.uncacheRoot(this.model.animationRoot);
    this.scene.remove(this.model.root); disposeModel(this.model);
    this.model = model; this.scene.add(model.root);
    this.basePositions = new Map([...model.groups].map(([id, group]) => [id, group.position.clone()]));
    this.mixer = model.animations.length ? new THREE.AnimationMixer(model.animationRoot) : null;
    this.animationPlaying = false;
    // play() 激活动作，但 animationPlaying=false 时循环不推进 mixer，所以导入后不会自动播放。
    if (this.mixer) this.mixer.clipAction(model.animations[0]).play();
    this.state.wireframe = false; this.setOpacity(1); this.setMode('section'); this.resetCamera();
  }

  /** 先渲染当前状态，再下载 WebGL Canvas 的 PNG；HTML 工具栏、标注和右侧图文不在截图内。 */
  screenshot() {
    this.renderer.render(this.scene, this.camera);
    const link = document.createElement('a');
    link.download = `oculus-${this.state.mode}.png`;
    link.href = this.renderer.domElement.toDataURL('image/png'); link.click();
  }
}
