/**
 * 最快的逻辑检查：npm test，直接运行在 Node 中，不启动服务器、浏览器或 WebGL。
 * 使用内置 assert；断言失败会抛错并以非零状态退出，适合先检查输入边界和剖切数学规则。
 * 这里导入 EyeViewer 但不实例化，因此不会执行 constructor 中依赖 document 的代码。
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { validateFiles } from '../src/import-model.js';
import { EyeViewer } from '../src/viewer.js';
import { anatomy } from '../src/content.js';
import { eyeAnnotations } from '../src/eye.js';

// 1. validateFiles 只读 name/size，用最小对象代替真实 File；这不验证二进制内容是否正确。
const file = (name, size = 1024) => ({ name, size });
assert.equal(validateFiles([file('eye.glb')]).name, 'eye.glb');
assert.equal(validateFiles([file('eye.gltf'), file('eye.bin'), file('iris.png')]).name, 'eye.gltf');
assert.equal(validateFiles([file('EYE.OBJ'), file('eye.mtl')]).name, 'EYE.OBJ');
// 2. 验证空列表、未知格式、多个主文件、超过体积上限和同名附件都被拒绝。
assert.throws(() => validateFiles([]), /请选择/);
assert.throws(() => validateFiles([file('eye.fbx')]), /主文件/);
assert.throws(() => validateFiles([file('first.glb'), file('second.obj')]), /主文件/);
assert.throws(() => validateFiles([file('eye.glb', 51 * 1024 * 1024)]), /50 MB/);
assert.throws(() => validateFiles([file('eye.gltf'), file('iris.png'), file('iris.png')]), /重名/);
// 3. 图层、几何和信息靠 id 关联；当前九个结构应有九个不同 id。
assert.equal(new Set(anatomy.map(entry => entry.id)).size, 9);
// 每个结构必须恰好有一个标注，且提供可投影的三维坐标和明确的布局方向。
assert.deepEqual(eyeAnnotations.map(entry => entry.id).sort(), anatomy.map(entry => entry.id).sort());
for (const annotation of eyeAnnotations) {
  assert.equal(annotation.position.length, 3);
  assert(annotation.position.every(Number.isFinite));
  assert(['left', 'right'].includes(annotation.side));
}

// 4. 仅准备 isClipped 所需的 state 和 planes，避免为了验证数学判断创建完整 Viewer。
const viewer = {
  state: { mode: 'section', axes: [true, true, true], intersection: true },
  planes: [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)],
};
// call 把最小 viewer 对象作为 this，执行生产代码的方法，而不是在测试里另写一套算法。
const clipped = point => EyeViewer.prototype.isClipped.call(viewer, new THREE.Vector3(...point));
// 交集：点必须同时处于三个平面的负侧才裁掉。对 -X/-Y/-Z 法线，这里对应三个正坐标。
assert.equal(clipped([1, 1, 1]), true);
assert.equal(clipped([1, -1, 1]), false);
assert(eyeAnnotations.every(annotation => !clipped(annotation.position)), 'all built-in annotations survive default clipping');
// 并集：任何一个启用平面的负侧都被裁掉；全部负坐标的点在当前配置下保留。
viewer.state.intersection = false;
assert.equal(clipped([1, -1, 1]), true);
assert.equal(clipped([-1, -1, -1]), false);
// 5. 全轴关闭不裁切；只开 X 并把边界移到 x=1.5 时，x=1 应保留。
viewer.state.axes = [false, false, false];
assert.equal(clipped([1, 1, 1]), false);
viewer.state.axes = [true, false, false];
viewer.planes[0].constant = 1.5;
assert.equal(clipped([1, 1, 1]), false);
// 6. 完整模式即使保留之前的剖切参数，也不能继续裁掉模型。
viewer.state.mode = 'whole';
assert.equal(clipped([2, 2, 2]), false);
console.log('PASS: file limits, companion files, complete anatomy annotations, clipping intersection/union/disabled axes/offsets/whole mode.');
