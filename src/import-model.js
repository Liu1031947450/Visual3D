/**
 * 本地模型适配层：接收文件选择器的 FileList，解析成与 loadEye() 相同的模型结构。
 * validateFiles 只依赖 name/size，可在 Node 单测；loadModel 需要浏览器 File、Blob URL 和图片解码。
 * 这里只解析并返回模型，不删除旧模型、不更新 DOM；成功后由 main.js 调用 replaceModel。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { anatomy } from './content.js';
import { disposeModel } from './eye.js';

/**
 * 输入文件数组，返回唯一的 GLB/glTF/OBJ 主文件；缺主文件、重复主文件、超限或重名时抛错。
 * 这是入场检查，不是完整的格式验证；实际数据合法性由 Loader 和独立的 Khronos 校验确认。
 */
export function validateFiles(files) {
  if (!files.length) throw new Error('请选择模型文件。');
  if (files.reduce((size, file) => size + file.size, 0) > 50 * 1024 * 1024) throw new Error('文件总大小不能超过 50 MB，请先优化模型与贴图。');
  const roots = files.filter(file => /\.(glb|gltf|obj)$/i.test(file.name));
  if (roots.length !== 1) throw new Error('每次请选择一个 GLB、glTF 或 OBJ 主文件，以及它的配套文件。');
  // 后续按文件名映射附件，故不允许不同目录出现同名资源，否则无法确定该用哪一个。
  const names = new Set();
  for (const file of files) {
    if (names.has(file.name)) throw new Error(`存在重名文件 ${file.name}，请使用唯一文件名。`);
    names.add(file.name);
  }
  return roots[0];
}

/**
 * 输入 FileList 或 File 数组，异步返回 model 对象，失败则抛出可显示给用户的 Error。
 * 支持未配置额外解码器也能解析的 GLB/glTF，以及静态 OBJ + 至多一个引用 MTL。
 * 需同时选择主文件、bin、材质库和贴图；当前不是 ZIP 解压器，也不是目录递归上传器。
 */
export async function loadModel(fileList) {
  // 1. 先检查，再开始计时和分配 Blob URL；计时不包含用户选文件和网络下载模型的过程。
  const files = Array.from(fileList);
  const main = validateFiles(files);
  const started = performance.now();
  // 2. Blob URL 是浏览器内对 File 的临时引用，Loader 可以读取它，不会把文件上传服务器。
  const urls = new Map(files.map(file => [file.name, URL.createObjectURL(file)]));
  const manager = new THREE.LoadingManager();
  let loadedRoot;
  const pending = [];
  const resourceErrors = [];
  // 某些加载器遇到贴图错误仍可能返回场景，记录失败资源，稍后主动拒绝“缺图但成功”的结果。
  function rejectResource(message) { resourceErrors.push(message); throw new Error(message); }
  // 3. 拦截资源地址：内嵌 data/临时 blob 直接使用，远程 HTTP 拒绝，附件映射到本地文件。
  manager.setURLModifier(url => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    if (/^(https?:)?\/\//i.test(url)) return rejectResource('模型包含远程资源，请下载贴图后与模型一起选择。');
    // 只取路径最后一段再解码，因此是“唯一文件名匹配”，并非完整目录结构解析。
    const filename = decodeURIComponent(url.split('/').pop().split('?')[0]);
    if (!urls.has(filename)) return rejectResource(`缺少配套文件：${filename}。请与模型一起选择。`);
    return urls.get(filename);
  });
  manager.onError = url => resourceErrors.push(url);
  const extension = main.name.split('.').pop().toLowerCase();
  try {
    let animations = [];
    if (extension === 'obj') {
      // 4A. OBJ 是文本几何；mtllib 指明材质库，MTL 再引用图片。无 mtllib 时可按默认材质加载。
      const loader = new OBJLoader(manager);
      const source = await main.text();
      const materialFiles = [...source.matchAll(/^mtllib\s+(.+)$/gm)].map(match => match[1].trim());
      if (materialFiles.length > 1) throw new Error('当前演示每个 OBJ 支持一个 MTL，请先合并材质库。');
      if (materialFiles.length) {
        const materialFile = files.find(file => file.name === materialFiles[0].split('/').pop());
        if (!materialFile) throw new Error(`缺少材质库 ${materialFiles[0]}，请一并选择。`);
        const materials = new MTLLoader(manager).parse(await materialFile.text(), '');
        // preload 会触发异步贴图读取，必须提前挂 onLoad；只有真的启动了资源任务才等待。
        // 否则无贴图 MTL 不会触发这次等待所需的加载完成事件，Promise 可能一直挂起。
        const texturesReady = new Promise(resolve => { manager.onLoad = resolve; });
        let textureCount = 0;
        const originalStart = manager.itemStart.bind(manager);
        manager.itemStart = url => { textureCount += 1; originalStart(url); };
        materials.preload(); loader.setMaterials(materials);
        if (textureCount) pending.push(texturesReady);
      }
      loadedRoot = loader.parse(source);
      await Promise.all(pending);
      if (resourceErrors.length) throw new Error('贴图无法解码，请检查图片文件是否有效。');
    } else {
      // 4B. GLB 以二进制读取，glTF 以 JSON 文本读取；同一个 GLTFLoader 返回场景与动画列表。
      // 空基础路径配合 URLModifier 解析附件，没有配置 Draco/KTX2/Meshopt 解码器。
      const data = extension === 'glb' ? await main.arrayBuffer() : await main.text();
      const gltf = await new GLTFLoader(manager).parseAsync(data, '');
      loadedRoot = gltf.scene; animations = gltf.animations;
      if (resourceErrors.length) throw new Error(`模型资源加载失败：${resourceErrors[0]}`);
    }
    // 5. 包围盒衡量初始模型大小，拒绝空/无效尺寸；它不代表动画全过程的最大范围。
    const box = new THREE.Box3().setFromObject(loadedRoot);
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(longest) || longest <= 0) throw new Error('模型不包含可显示的几何体。');
    // 用新增的两层父组做居中和统一显示缩放，不改原始节点的动画关键帧和内部局部变换。
    // root(缩放) -> normalized(负中心位移) -> loadedRoot(原层级)；最长边显示为 3.5 个场景单位。
    const root = new THREE.Group();
    const center = box.getCenter(new THREE.Vector3());
    const normalized = new THREE.Group();
    normalized.position.copy(center).multiplyScalar(-1);
    normalized.add(loadedRoot); root.add(normalized);
    root.scale.setScalar(3.5 / longest);
    const groups = new Map();
    const materials = [];
    const entries = [];
    let meshCount = 0;
    // 6. 每个 Mesh 对应一个图层，import-* id 唯一；名称关键词仅用于选择已有科普文案。
    // groups 的值在导入路径中是 Mesh，内置路径是 Group；两者都能设置 visible 和 traverse。
    loadedRoot.traverse(object => {
      if (!object.isMesh) return;
      meshCount += 1;
      const id = `import-${meshCount}`;
      const known = anatomy.find(entry => object.name.toLowerCase().includes(entry.id));
      object.userData.part = id;
      groups.set(id, object);
      entries.push({ ...(known || { name: object.name || `部件 ${meshCount}`, english: 'Imported mesh', color: '#71968d', category: '导入模型 · 独立网格', description: '该网格来自本地模型。未通过命名识别为已知解剖结构，请以建模交付说明为准。', function: '未提供', relation: '未提供', feature: '本地模型' }), id, number: String(meshCount).padStart(2, '0') });
      // 克隆每个网格的材质，避免高亮某一网格时连带改变共享该材质的其他网格。
      // clone 保留贴图引用；贴图资源释放时由 disposeModel 的 Set 去重处理。
      object.material = [].concat(object.material).map(material => {
        const cloned = material.clone();
        materials.push(cloned); return cloned;
      });
      if (object.material.length === 1) object.material = object.material[0];
    });
    if (!meshCount) throw new Error('模型中没有可显示的网格。');
    // 7. animationRoot 保留原始加载层级，AnimationMixer 用它查找动画轨道对应的节点。
    // importMs 是热/冷状态均可能影响的本地准备耗时，不是网络首屏指标。
    return { root, groups, materials, entries, builtin: false, animations, animationRoot: loadedRoot, filename: main.name, importMs: performance.now() - started, bytes: files.reduce((total, file) => total + file.size, 0) };
  } catch (error) {
    // 8. 尽力清理已经拿到的模型根对象；加载器内部尚未返回的部分资源不在此遍历范围。
    if (loadedRoot) disposeModel({ root: loadedRoot });
    if (/DRACO|KTX2|Meshopt/i.test(error.message)) throw new Error('此文件使用压缩扩展，当前 demo 未启用对应解码器。请导出未压缩 GLB，或按导出规范配置解码器。');
    throw error;
  } finally {
    // 9. 成功或失败都撤销本函数创建的 Blob URL。它和几何/材质的 GPU dispose 是两种清理。
    urls.forEach(url => URL.revokeObjectURL(url));
  }
}
