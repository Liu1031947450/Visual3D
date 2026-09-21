/**
 * 内容层：九种结构的静态科普数据 + 右侧二维示意图，不负责三维渲染。
 * anatomy 可直接被 Node 读取；drawDiagram 需要浏览器 HTMLCanvasElement 的 2D context。
 * id 同时连接 eye.js 的分组、Viewer 的拾取结果和 main.js 的图层，不要只在一处重命名。
 * name/english/category/description/function/relation 用于图文，number 用于顺序展示，
 * color 用于 UI 色块（不是三维材质的唯一配色源）；feature 当前保留在数据中，尚未展示。
 */
export const anatomy = [
  { id: 'sclera', name: '巩膜', english: 'Sclera', color: '#dadad1', category: '外层 · 纤维膜', description: '坚韧的纤维性外壳，构成眼球壁的大部分。它维持眼球的形态，并为眼外肌提供附着位置。', function: '保护眼球内部组织，维持外形。', relation: '前方与角膜相连，内侧邻接脉络膜。', feature: '不透明纤维组织', number: '01' },
  { id: 'cornea', name: '角膜', english: 'Cornea', color: '#a6cdd3', category: '外层 · 透明组织', description: '位于眼球最前方的透明组织，是光线进入眼内的第一道窗口。它的曲率参与光线的折射。', function: '透过和折射光线，同时保护眼前部。', relation: '周边与巩膜连续，后方为前房。', feature: '透明、无血管', number: '02' },
  { id: 'iris', name: '虹膜', english: 'Iris', color: '#8e9567', category: '中层 · 葡萄膜', description: '位于角膜后方的环状组织，中央开口是瞳孔。其色素和纤维纹理形成眼睛可见的颜色。', function: '通过改变瞳孔大小调节入眼光量。', relation: '位于晶状体前方，与睫状体相接。', feature: '放射状纤维纹理', number: '03' },
  { id: 'ciliary', name: '睫状体', english: 'Ciliary body', color: '#be8a76', category: '中层 · 葡萄膜', description: '位于虹膜根部后方的环状组织。睫状肌与连接晶状体的悬韧带共同参与眼睛的调节。', function: '参与调节晶状体形态并生成房水。', relation: '前接虹膜，后接脉络膜。', feature: '环状褶皱结构', number: '04' },
  { id: 'choroid', name: '脉络膜', english: 'Choroid', color: '#b96b57', category: '中层 · 血管膜', description: '富含血管与色素的组织层，位于巩膜和视网膜之间，为外层视网膜提供营养支持。', function: '供给营养，并吸收眼内散射光。', relation: '外邻巩膜，内邻视网膜。', feature: '富含血管及色素', number: '05' },
  { id: 'lens', name: '晶状体', english: 'Lens', color: '#b4d7d6', category: '屈光介质 · 透明组织', description: '位于虹膜后方的透明双凸结构。其形态可在调节过程中发生变化，使不同距离的物体聚焦。', function: '与角膜共同将光线聚焦到视网膜。', relation: '通过悬韧带与睫状体相连。', feature: '透明双凸结构', number: '06' },
  { id: 'retina', name: '视网膜', english: 'Retina', color: '#db9675', category: '内层 · 感光组织', description: '覆盖眼球内壁的精细感光组织。视杆细胞和视锥细胞将光信号转化为神经信号，开启视觉的形成过程。', function: '感知光线，将光信号转化为神经信号。', relation: '外侧邻接脉络膜，内侧面向玻璃体。', feature: '感光细胞与神经组织', number: '07' },
  { id: 'vitreous', name: '玻璃体', english: 'Vitreous body', color: '#b6d9dc', category: '屈光介质 · 凝胶组织', description: '填充晶状体后方大部分眼内空间的透明凝胶状组织，光线经过它到达视网膜。', function: '透过光线，参与维持眼球内部结构。', relation: '前方为晶状体，周围邻接视网膜。', feature: '透明凝胶状组织', number: '08' },
  { id: 'nerve', name: '视神经', english: 'Optic nerve', color: '#d3ad72', category: '神经组织 · 传导通路', description: '由视网膜神经节细胞的轴突汇集而成，从眼球后方离开，将视觉信息传递到脑内。', function: '将视网膜产生的神经信号传向大脑。', relation: '在眼底视神经盘处与视网膜连接。', feature: '成束神经纤维', number: '09' },
];

/**
 * 在传入的二维 Canvas 上重绘横断面示意，selected 是内置 anatomy 的 id，无返回值。
 * 这是固定示意画法，不从 WebGL 读取像素，也不会随着三维相机和剖切滑块一起改变。
 * 画布内部固定 640×380，页面中的视觉大小由 CSS 决定；每次绘制都会清空并重置画布状态。
 */
export function drawDiagram(canvas, selected = 'retina') {
  const context = canvas.getContext('2d');
  canvas.width = 640;
  canvas.height = 380;
  context.fillStyle = '#f2f5f3';
  context.fillRect(0, 0, 640, 380);
  // 1. 保存绘图状态，把原点移到图中心并略微旋转，后续坐标可围绕眼球中心书写。
  context.save();
  context.translate(310, 190);
  context.rotate(-0.2);
  context.lineCap = 'round';
  // 2. 先画后方视神经，再叠加三圈组织边界；选中结构使用强调色，非选中保留组织色。
  context.strokeStyle = selected === 'nerve' ? '#127a6d' : '#d6b98c';
  context.lineWidth = 38;
  context.beginPath(); context.moveTo(-129, 0); context.lineTo(-207, 24); context.stroke();
  for (const [radius, color, width, part] of [[132, '#dddcd2', 16, 'sclera'], [118, '#a56855', 12, 'choroid'], [108, '#df9e7d', 10, 'retina']]) {
    context.beginPath(); context.arc(0, 0, radius, 0.68, Math.PI * 2 - 0.68);
    context.strokeStyle = selected === part ? '#127a6d' : color;
    context.lineWidth = width; context.stroke();
  }
  // 3. 内部扇形表示玻璃体，前方依次补角膜弧线、晶状体椭圆和留有开口的虹膜。
  context.fillStyle = selected === 'vitreous' ? '#b6dcd7' : '#e1ebdf';
  context.beginPath(); context.arc(0, 0, 102, 0.69, Math.PI * 2 - 0.69); context.closePath(); context.fill();
  context.strokeStyle = selected === 'cornea' ? '#127a6d' : '#9cbfc1'; context.lineWidth = 6;
  context.beginPath(); context.ellipse(103, 0, 52, 89, 0, -Math.PI / 2, Math.PI / 2); context.stroke();
  context.fillStyle = selected === 'lens' ? '#60a79b' : '#bdd8d5';
  context.beginPath(); context.ellipse(82, 0, 22, 58, 0, 0, Math.PI * 2); context.fill();
  context.strokeStyle = selected === 'iris' ? '#127a6d' : '#969168'; context.lineWidth = 9;
  context.beginPath(); context.moveTo(116, -74); context.lineTo(116, -27); context.moveTo(116, 27); context.lineTo(116, 74); context.stroke();
  // 4. 上下两个椭圆表示睫状体，贝塞尔曲线表示内侧血管，只用于结构定位示意。
  context.fillStyle = selected === 'ciliary' ? '#127a6d' : '#bd8c78';
  for (const sign of [-1, 1]) { context.beginPath(); context.ellipse(76, sign * 86, 22, 13, sign * 0.4, 0, Math.PI * 2); context.fill(); }
  context.strokeStyle = '#c98775'; context.lineWidth = 2.5;
  for (let branch = 0; branch < 6; branch += 1) {
    const endAngle = 1.45 + branch * 0.69;
    context.beginPath(); context.moveTo(-94, 0); context.quadraticCurveTo(-40, Math.sin(endAngle) * 45, Math.cos(endAngle) * 94, Math.sin(endAngle) * 94); context.stroke();
  }
  // 5. 恢复绘图状态，避免后续绘制意外继承这里的平移、旋转和画笔设置。
  context.restore();
}
