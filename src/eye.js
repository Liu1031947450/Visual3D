/**
 * 内置眼球资产：读取 public/models/eye.glb，生成器仅保留在 scripts/eye-source.js 中用于重新导出。
 * loadEye() 在浏览器中调用；返回值与 import-model.js 的 loadModel() 使用同一结构。
 * 坐标和组织厚度为展示参数，前方朝 +Z；不是毫米标定或经过医学审核的模型。
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { anatomy } from './content.js';

/**
 * 内置九个结构的标注锚点，坐标相对于各结构分组；名称统一从 anatomy 读取。
 * 页面标签和 Viewer 共用此表，避免只补了 HTML 或三维坐标而漏掉另一端。
 * side 决定标签排在哪一侧，不代表模型的临床左右；导入模型不套用这些固定位置。
 */
export const eyeAnnotations = [
  { id: 'sclera', position: [-1.28, 0.74, 0.47], side: 'left' },
  { id: 'cornea', position: [-0.3, 0.3, 1.71], side: 'left' },
  { id: 'iris', position: [-0.52, -0.36, 1.25], side: 'left' },
  { id: 'ciliary', position: [-0.77, -0.25, 1.08], side: 'left' },
  { id: 'choroid', position: [1.27, 0.77, -0.34], side: 'right' },
  { id: 'lens', position: [-0.25, -0.2, 1.1], side: 'left' },
  { id: 'retina', position: [0.95, 0.98, -0.55], side: 'right' },
  { id: 'vitreous', position: [0.87, -0.94, 0.6], side: 'right' },
  { id: 'nerve', position: [0.61, -0.31, -2.38], side: 'right' },
];

export async function loadEye(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  try {
    const groups = new Map();
    const materials = [];
    for (const entry of anatomy) {
      const group = root.getObjectByName(entry.id);
      if (!group || group.isMesh) throw new Error(`眼球 GLB 缺少结构分组：${entry.id}`);
      let meshCount = 0;
      group.traverse(object => {
        if (!object.isMesh) return;
        meshCount += 1;
        object.userData.part = entry.id;
        materials.push(...[].concat(object.material));
      });
      if (!meshCount) throw new Error(`眼球 GLB 的结构分组为空：${entry.id}`);
      groups.set(entry.id, group);
    }
    return { root, groups, materials, entries: anatomy, builtin: true, animations: gltf.animations, animationRoot: root, filename: 'eye.glb' };
  } catch (error) {
    disposeModel({ root });
    throw error;
  }
}

/**
 * 从 model.root 遍历并释放模型几何、材质和纹理；移出场景本身不会自动释放 GPU 资源。
 * 由 replaceModel() 及导入失败分支调用；不处理相机、环境贴图等 viewer 级长期资源。
 */
export function disposeModel(model) {
  // 多个材质可能共享同一张纹理，用 Set 去重，避免重复释放。
  const textures = new Set();
  const materials = new Set();
  model.root.traverse(object => {
    object.geometry?.dispose();
    for (const material of object.material ? [].concat(object.material) : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  // 若贴图源是 ImageBitmap，可先 close；普通 Canvas/Image 没有此方法，用可选调用跳过。
  textures.forEach(texture => { texture.source?.data?.close?.(); texture.dispose(); });
  materials.forEach(material => material.dispose());
}
