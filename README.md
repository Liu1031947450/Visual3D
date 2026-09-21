# OCULUS · 眼球解剖图谱

基于 Three.js 的分层眼球展示，默认加载 `public/models/eye.glb`，核心交互参照 `webgl_clipping_intersection`。Vite + JavaScript，无后端。

## 新手从哪里开始

先阅读 [项目结构与新手入门](public/docs/项目结构与新手入门.md)，其中按“需要什么 → 做什么 → 得到什么”解释启动、渲染、剖切、图文联动和文件导入，并提供调试练习、修改定位表和验证步骤。

推荐顺序：`package.json` → `index.html` → `src/main.js` 中的 `new EyeViewer` → `src/viewer.js` 的构造函数与渲染循环 → `src/eye.js` / `src/content.js` → `src/import-model.js` → 测试脚本。

源码已补充分步中文注释，CSS 已按规则和属性换行；无需先读完全部 HTML 模板和几何参数。`package.json` 不支持注释，其字段和命令在入门文档中解释。不要从 `node_modules/`、`dist/` 或测试生成资产开始分析业务代码。

## 运行

```bash
npm ci
npm run dev -- --host 127.0.0.1 --port 5188 --strictPort
```

打开 `http://127.0.0.1:5188/`。Node.js 22.12+，推荐与已验证的 Node 22 系列保持一致。依赖版本见 lockfile。

## 操作

- 鼠标左键拖动旋转，滚轮缩放，右键拖动平移；触摸设备单指旋转、双指缩放/平移。
- 三个轴独立剖切，交集/并集切换，显示平面；完整模型、局部剖切、内置模型分层展开。
- 选择结构联动图文，隐藏/显示图层，模型透明度、线框、自动旋转、相机重置及 PNG 截图。
- 内置九个结构均有标注，桌面/手机自动避让；关闭标注、隐藏图层、锚点被剖切或移出视野时对应标签隐藏。外部模型不套用内置标注。
- Canvas 获得键盘焦点后，方向键旋转，`+` / `-` 缩放；其余控件支持标准键盘焦点操作。
- 导入未压缩 GLB，或同时选择 glTF/OBJ 主文件与其全部配套文件。总大小最多 100 MB，不上传服务器。
- GLB/glTF 动画可以选择与播放/暂停。格式限制详见文档。

## 交付文档

- [3D模型数据导出规范](public/docs/3D模型数据导出规范.md)
- [建模需求与协作流程](public/docs/建模需求与协作流程.md)
- [技术验证报告](public/docs/技术验证报告.md)

三份文档也可以在网站内阅读和下载。

## 默认眼球 GLB

- 资产文件：`public/models/eye.glb`，包含当前眼球的九个组织分组、16 个材质和两张内嵌贴图。
- 加载链路：`src/main.js` 的 `initializeViewer()` → `src/eye.js` 的 `loadEye()` → `GLTFLoader` → `EyeViewer`。页面启动和“恢复示意模型”均读取 GLB，不再现场生成眼球。
- 生成器保留在 `scripts/eye-source.js`，仅供开发时执行 `npm run export:eye` 重新导出；该命令会覆盖 `public/models/eye.glb`，不要用它覆盖后续收到的专业模型。需要系统 Chrome，或设置 `BROWSER_CHANNEL=chromium` 使用已安装的 Playwright Chromium。
- 后续与建模人员沟通：交付未压缩 GLB，贴图内嵌，九个组织独立分组。普通文件可以用“导入模型”预览；直接替换默认 GLB 还必须符合[默认资产对接约定](public/docs/3D模型数据导出规范.md#默认资产对接约定)，不能只更改扩展名或文件名。

GLB 加载失败会显示错误及重新加载入口，不会悄悄回退到程序生成模型；文档入口仍可用。

## 验证与构建

```bash
npm test
# 先运行开发服务；默认使用机器上已安装的 Google Chrome
npm run test:browser
npm run build
npm run preview -- --port 4188
```

浏览器测试覆盖画布像素、桌面/移动布局、相机交互、剖切、图层、截图、文档、GLB/glTF/OBJ 的真实导出与导入及失败回退。截图、合成测试资产和原始性能数据生成在 `test-results/`。

## 重要边界

内置眼球由原程序化模型预先导出为 GLB，页面加载文件；二维示意图仍在本地绘制。无第三方模型授权负担，但没有经过医学审核。结构厚度、血管和光学效果为示意。剖切不生成实体封口；未配置 Draco/Meshopt/KTX2 解码器；没有运行时 LOD。外部模型不启用内置分层展开。不能用于临床诊断或精密测量。

## 部署

### GitHub Pages

在线地址：<https://liu1031947450.github.io/Visual3D/>。

`.github/workflows/deploy.yml` 在推送 `main` 后自动安装依赖、检查、构建并发布 `dist/`。首次需要在仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。也可在 **Actions → Deploy GitHub Pages → Run workflow** 手动重新部署。

工作流根据 Pages 的实际路径设置 Vite `base`；首页链接和文档请求使用 `import.meta.env.BASE_URL`，因此不会误请求站点根目录。无需配置个人 Token 或上传 `node_modules/`。

本地模拟 GitHub Pages 的子目录部署：

```bash
npm run build -- --base=/Visual3D/
npm run test:deploy
```

测试脚本会自行启动/关闭预览服务，检查桌面/手机的模型像素、九个标注、文档和首页跳转。需要系统 Chrome；CI 使用 Playwright Chromium。`BASE_URL=https://liu1031947450.github.io/Visual3D/ npm run test:deploy` 可检查真实线上站点。

### 其他静态托管

`npm run build` 的 `dist/` 可部署到静态托管。字体默认请求 Google Fonts，网络受限时回退到系统字体；正式内网部署可自托管字体。

如另需部署到 Vercel，强烈建议先安装 CLI：`npm i -g vercel`，以便使用 `vercel deploy`、`vercel logs` 和后续需要时的 `vercel env pull`。当前项目无需环境变量，未创建 Vercel 项目。
