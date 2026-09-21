import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { anatomy } from '../src/content.js';

/** 固定种子生成可重复的伪随机数，使刷新后的虹膜和血管一致，方便截图比对。 */
function randomGenerator(seed = 41) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

/** 需要 DOM 的二维 Canvas；生成基础颜色纹理，不额外创建数千条三维虹膜纤维。 */
function irisTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const context = canvas.getContext('2d');
  const random = randomGenerator();
  context.fillStyle = '#515a39';
  context.fillRect(0, 0, 1024, 1024);
  // 1. 径向渐变建立从瞳孔附近到虹膜边缘的颜色分布。
  const gradient = context.createRadialGradient(512, 512, 170, 512, 512, 510);
  gradient.addColorStop(0, '#ad883d'); gradient.addColorStop(0.25, '#9d9660');
  gradient.addColorStop(0.7, '#6e7957'); gradient.addColorStop(0.95, '#465746'); gradient.addColorStop(1, '#26392f');
  context.fillStyle = gradient; context.fillRect(0, 0, 1024, 1024);
  // 2. 贝塞尔曲线从内圈延伸到外圈；小幅随机改变长短、弯曲和明暗形成径向纹理。
  for (let fiber = 0; fiber < 2600; fiber += 1) {
    const angle = random() * Math.PI * 2;
    const start = 158 + random() * 75;
    const end = 380 + random() * 130;
    context.strokeStyle = `hsla(${48 + random() * 45}, ${18 + random() * 30}%, ${16 + random() * 56}%, ${0.25 + random() * 0.5})`;
    context.lineWidth = 0.5 + random() * 2.4;
    context.beginPath();
    context.moveTo(512 + Math.cos(angle) * start, 512 + Math.sin(angle) * start);
    context.quadraticCurveTo(512 + Math.cos(angle + 0.025) * 330, 512 + Math.sin(angle + 0.025) * 330, 512 + Math.cos(angle) * end, 512 + Math.sin(angle) * end);
    context.stroke();
  }
  // 3. 补一圈不规则色带，避免只有均匀直线；这些细节都留在一张图片内。
  context.strokeStyle = '#bd99587a'; context.lineWidth = 5;
  context.beginPath();
  for (let step = 0; step <= 360; step += 1) {
    const angle = step / 360 * Math.PI * 2;
    const radius = 245 + random() * 29;
    context.lineTo(512 + Math.cos(angle) * radius, 512 + Math.sin(angle) * radius);
  }
  context.closePath(); context.stroke();
  // 4. CanvasTexture 将像素送给材质；它是颜色图，因此声明 sRGB，而非法线等非颜色数据。
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 生成巩膜颜色图：浅色底与低对比度血丝。血丝画在二维图片上，不改变壳体轮廓。 */
function scleraTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 1024;
  const context = canvas.getContext('2d');
  const random = randomGenerator(69);
  context.fillStyle = '#eee9dd'; context.fillRect(0, 0, 2048, 1024);
  // 每条血丝从随机起点走六小段，固定种子保证外观可复现。
  for (let vein = 0; vein < 70; vein += 1) {
    let horizontal = random() * 2048;
    let vertical = random() * 1024;
    context.strokeStyle = `rgba(176, 93, 86, ${0.07 + random() * 0.14})`;
    context.lineWidth = 1 + random() * 2;
    context.beginPath(); context.moveTo(horizontal, vertical);
    for (let step = 0; step < 6; step += 1) {
      horizontal += (random() - 0.5) * 90;
      vertical -= 20 + random() * 45;
      context.lineTo(horizontal, vertical);
    }
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 生成模型，不负责放进场景或启动渲染；这些由 EyeViewer 完成。
 * 返回：root=根对象，groups=id 到可控制分组的 Map，materials=批量更新用的材质列表，
 * entries=图文数据，builtin=true 标识内置模型，animations=[] 表示没有资产动画。
 */
export function createEye() {
  const root = new THREE.Group();
  root.name = 'Eye_Root';
  const groups = new Map();
  const materials = [];
  // 1. 先按 content.js 的 id 建立九个组织分组，同一组织的多个 Mesh 一起隐藏和展开。
  for (const entry of anatomy) {
    const group = new THREE.Group();
    group.name = entry.id; group.userData.part = entry.id;
    root.add(group); groups.set(entry.id, group);
  }
  /**
   * 2. 所有部件共用的装配步骤：Geometry(形状) + Material(表面) = Mesh(可绘制对象)。
   * part 必须在 groups 中存在；properties 可覆盖默认材质；position 是组内局部坐标。
   * userData.part 把射线命中的 Mesh 连回图文 id，materials 列表供统一剖切和透明度调整。
   */
  function add(part, geometry, properties, position = [0, 0, 0]) {
    const material = new THREE.MeshPhysicalMaterial({ roughness: 0.52, side: THREE.DoubleSide, ...properties });
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = part; mesh.userData.part = part;
    mesh.position.set(...position);
    groups.get(part).add(mesh);
    return mesh;
  }
  /**
   * 3. 去掉前端球冠的球面，再把球体极轴旋转到 +Z，给虹膜/角膜留出前部开口。
   * 96×64 为曲面细分参数；本函数只做一层表面，不构造有厚度的封闭实体。
   */
  function shell(radius) {
    const geometry = new THREE.SphereGeometry(radius, 96, 64, 0, Math.PI * 2, 0.68, Math.PI - 0.68);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }
  // 不同半径形成巩膜、脉络膜和视网膜三层。DoubleSide 让内外朝向都可见，但不会补切口面。
  add('sclera', shell(1.58), { color: '#ffffff', map: scleraTexture(), roughness: 0.48, clearcoat: 0.22 });
  add('choroid', shell(1.525), { color: '#a25240', roughness: 0.67 });
  add('retina', shell(1.475), { color: '#e9a37c', roughness: 0.64 });

  // 4. 虹膜是圆环，UV 告诉每个顶点对应图片的哪个位置。
  // 把近似 [-1, 1] 的局部 XY 映射到 [0, 1]，让圆形纹理中心对准瞳孔。
  const iris = new THREE.RingGeometry(0.32, 0.994, 128, 8);
  const positions = iris.getAttribute('position');
  const uv = iris.getAttribute('uv');
  for (let index = 0; index < positions.count; index += 1) {
    uv.setXY(index, positions.getX(index) / 2 + 0.5, positions.getY(index) / 2 + 0.5);
  }
  add('iris', iris, { map: irisTexture(), roughness: 0.66, clearcoat: 0.15 }, [0, 0, 1.242]);
  add('iris', new THREE.TorusGeometry(0.326, 0.023, 10, 96), { color: '#3d3020', roughness: 0.8 }, [0, 0, 1.24]);
  // ponytail: 用暗色圆片近似瞳孔深度，不是真实光学；接入专业模型时改用经审核的孔洞和材质。
  add('iris', new THREE.CircleGeometry(0.322, 96), { color: '#08130c', roughness: 1 }, [0, 0, 1.238]);

  // 5. 角膜采用低透明度球冠；关闭深度写入以减轻对内部组织的遮挡，没有真实折射计算。
  const corneaGeometry = new THREE.SphereGeometry(1.14, 80, 40, 0, Math.PI * 2, 0, 1.06);
  corneaGeometry.rotateX(Math.PI / 2);
  add('cornea', corneaGeometry, { color: '#daefee', transparent: true, opacity: 0.1, roughness: 0.07, metalness: 0.1, clearcoat: 1, depthWrite: false }, [0, 0, 0.65]);
  // 6. 晶状体由球体沿 Z 压扁；当前是浅色实体材质，只表达轮廓，不是透明双凸透镜仿真。
  const lens = add('lens', new THREE.SphereGeometry(0.655, 64, 40), { color: '#bddedd', roughness: 0.16, metalness: 0.08, clearcoat: 1 }, [0, 0, 0.86]);
  lens.scale.z = 0.43;
  // 玻璃体只用很淡的球面提示体积，减少多层透明材质遮蔽视网膜的问题。
  const vitreous = add('vitreous', new THREE.SphereGeometry(1.425, 64, 48), { color: '#c5e7e1', transparent: true, opacity: 0.065, roughness: 0.25, depthWrite: false });
  vitreous.scale.z = 0.96;
  // 7. 睫状体由环体与沿圆周排列的褶皱组成；先变换每个几何，再合并为一个 Mesh。
  add('ciliary', new THREE.TorusGeometry(0.91, 0.12, 12, 96), { color: '#b4806b' }, [0, 0, 1.02]);
  const folds = [];
  for (let fold = 0; fold < 64; fold += 1) {
    const angle = fold / 64 * Math.PI * 2;
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    geometry.scale(0.13, 0.025, 0.075); geometry.rotateZ(angle);
    geometry.translate(Math.cos(angle) * 0.84, Math.sin(angle) * 0.84, 1.025);
    folds.push(geometry);
  }
  add('ciliary', mergeGeometries(folds), { color: '#cd9f85' });
  // 合并结果已经包含顶点数据，临时几何不再使用；同材质细节合并可减少 draw calls。
  folds.forEach(geometry => geometry.dispose());

  // 8. 用细管连接晶状体与睫状体，表达悬韧带；属于 ciliary 分组，并非独立图层。
  const fibers = [];
  for (let fiber = 0; fiber < 40; fiber += 1) {
    const angle = fiber / 40 * Math.PI * 2;
    const curve = new THREE.LineCurve3(new THREE.Vector3(Math.cos(angle) * 0.64, Math.sin(angle) * 0.64, 0.97), new THREE.Vector3(Math.cos(angle) * 0.83, Math.sin(angle) * 0.83, 1.02));
    fibers.push(new THREE.TubeGeometry(curve, 1, 0.006, 4, false));
  }
  add('ciliary', mergeGeometries(fibers), { color: '#ede4cf' });
  fibers.forEach(geometry => geometry.dispose());
  // 9. CatmullRomCurve3 用控制点生成平滑路径，TubeGeometry 沿路径形成视神经管状外观。
  const nervePath = new THREE.CatmullRomCurve3([new THREE.Vector3(0.14, -0.12, -1.42), new THREE.Vector3(0.23, -0.15, -1.84), new THREE.Vector3(0.43, -0.27, -2.2), new THREE.Vector3(0.7, -0.38, -2.53)]);
  add('nerve', new THREE.TubeGeometry(nervePath, 28, 0.19, 24, false), { color: '#d6b484', roughness: 0.76 });
  const nerveEnd = add('nerve', new THREE.SphereGeometry(0.185, 24, 16), { color: '#ead4a8' }, [0.7, -0.38, -2.53]);
  nerveEnd.scale.z = 0.5;

  // 10. 血管点按球坐标落在视网膜内侧附近：polar 控制极角，phase 控制绕轴方向。
  // 主干与分支都转成细管后合并；这是人为分布的视觉细节，不是病人生理数据。
  const bloodVessels = [];
  const random = randomGenerator(92);
  for (let branch = 0; branch < 12; branch += 1) {
    const angle = branch / 12 * Math.PI * 2;
    const points = [];
    for (let step = 0; step <= 14; step += 1) {
      const polar = 0.13 + step / 14 * (1.85 + random() * 0.16);
      const phase = angle + Math.sin(step * 0.65) * 0.07;
      points.push(new THREE.Vector3(Math.sin(polar) * Math.cos(phase), Math.sin(polar) * Math.sin(phase), -Math.cos(polar)).multiplyScalar(1.46));
    }
    bloodVessels.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 36, branch % 3 === 0 ? 0.013 : 0.009, 5, false));
    // 从主干的不同位置分出三条支管，角度稍偏向两侧，避免全部重叠为直线。
    for (let fork = 0; fork < 3; fork += 1) {
      const start = 4 + fork * 3;
      const forkPoints = [points[start]];
      for (let step = 1; step < 6; step += 1) {
        const polar = 0.13 + (start + step) / 14 * 1.92;
        const phase = angle + step * (fork % 2 ? 0.064 : -0.068);
        forkPoints.push(new THREE.Vector3(Math.sin(polar) * Math.cos(phase), Math.sin(polar) * Math.sin(phase), -Math.cos(polar)).multiplyScalar(1.458));
      }
      bloodVessels.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(forkPoints), 12, 0.004, 4, false));
    }
  }
  add('retina', mergeGeometries(bloodVessels), { color: '#ae5342', roughness: 0.76 });
  bloodVessels.forEach(geometry => geometry.dispose());
  add('retina', new THREE.SphereGeometry(0.115, 24, 16), { color: '#f1c898', roughness: 0.7 }, [0, 0, -1.435]).scale.z = 0.22;
  // 11. 返回统一模型对象；分组、材质和图文仍由同一份 id 关联，不直接操作页面 DOM。
  return { root, groups, materials, entries: anatomy, builtin: true, animations: [] };
}
