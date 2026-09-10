# 生长手记 · PlantGrowth Recorder

本地优先的植物观察工作台。Vue 3 + Vite，静态部署，无账号、无后台、无照片上传。

## 开发与检查

需要 Node.js 22.12+ 和 npm。

```sh
npm ci
npm run dev
npm test
npx playwright install chromium firefox webkit
npm run test:e2e
npm run build
npm run preview
```

`npm test` 检查日期、数据恢复、中文 PDF、字形像素一致性、长文分页和旧文档追加。`npm run test:e2e` 在独立的 Chromium、Firefox、WebKit 环境检查新建、照片、自动保存、导出再导入、旧 PDF、日期冲突、裁剪旋转、撤销重做和手机尺寸。测试不会读取真实用户数据，截图在 `tmp/qa/`，失败记录在 `test-results/`。可用 `npm run test:e2e -- --project=chromium` 单独运行一个引擎。

## 第一版功能

- 多项目、日期排序、历史补录、同日多图、图注、照片旋转/裁剪/排序。
- 独立项目封面、任意文案和自定义字段、模块隐藏/排序。
- 三种默认模板、自定义字号/字体/颜色/间距/图片布局、个人模板、单条记录独立模板。
- IndexedDB 自动保存、保存失败反馈、多标签页编辑锁、项目备份与恢复、项目归档、记录回收站。
- Worker 内生成真实文字 PDF，中文可搜索复制，长文自动续页，PDF.js 实际文件预览、缩略图、缩放和点击定位编辑。
- PDF 导出支持附带可编辑项目。新版文件恢复全部活动记录与模板；旧版/外部 PDF 原页保留，新增记录追加末尾。原文件始终不覆盖。
- 手机编辑/预览切换、错误与处理进度、帮助和存储说明。

## 数据和文件边界

项目格式为 `plantgrowth-project`，版本 `3`。备份扩展名 `.plantgrowth.json`。包含原图的处理后版本、全部记录、模板、原始 PDF 及回收站；PDF 中的项目附件不包含回收站，且可以关闭。

照片在导入时剥离 EXIF，缩到最长边 2400 像素，转换为 JPEG。每张最多 20 MB、5000 万像素；每条记录最多 30 图；项目最多 1000 条活动记录。导入 PDF 最多 50 MB / 500 页，项目备份最多 150 MB，生成文档最多 1500 页。

同一浏览器与网站域名绑定本机数据。清理网站数据、隐私窗口关闭、更换浏览器或域名时必须依靠项目文件迁移。申请持久存储不能替代备份。网站不会将用户照片、记录或 PDF 上传到任何服务器。字体是同源静态资源。

历史 PDF 无法保证还原为可编辑元素。外部 PDF 的日期只是候选识别，导入时必须核对；未识别日期不代表原文没有日期。原始 PDF 的封面和页码保持原样；追加页使用新模板。

## 代码结构

- `src/core/model.js`：项目模型、模板、校验和排序。
- `src/core/storage.js`：IndexedDB 事务、项目与模板保存。
- `src/core/files.js`：照片处理、导出下载。
- `src/core/pdf.js`：共享 PDF 排版、分页、附件、导入检查。
- `src/core/pdf.worker.js` / `pdfClient.js`：后台生成与进度。
- `src/core/pdfjs.js`：唯一 PDF.js Worker 配置与加载生命周期。
- `src/components/DocumentPreview.vue`：基于真实 PDF 的实时预览和编辑定位。
- `src/components/PhotoEditor.vue` / `TemplateEditor.vue`：图片与模板编辑。
- `src/App.vue`：工作台、项目切换、自动保存及操作流程。

## 部署与发布

详见 [部署指南](docs/DEPLOYMENT.md)、[验收说明](docs/ACCEPTANCE.md)。静态输出目录为 `dist`，只发布该目录，勿发布备份文件或测试目录。Sites 项目关联保存在 `.openai/hosting.json`，不含凭据。

## 字体

PDF 字体源自 Google Noto Sans SC / Noto Serif SC，SIL OFL 1.1，许可证在 `public/fonts/`。派生文件命名为 JournalSans / JournalSerif，固定为 400 字重，保留完整 Unicode 映射与轮廓，移除本系统不使用的复杂排版表并转换为 TrueType。PDF 导出按所用字符再次子集化，不需访问外部字体服务。

可用 `scripts/prepare-fonts.py` 从 Google Fonts 官方仓库的 `ofl/notosanssc/NotoSansSC[wght].ttf` 和 `ofl/notoserifsc/NotoSerifSC[wght].ttf` 重建。先将源文件放在 `tmp/fonts/`，再运行脚本；需要 Python `fonttools`。表情或字体不支持的特殊符号会以方框显示，并在预览中提示。
