# 部署、更新与回滚

## GitHub Pages

项目已包含 `.github/workflows/pages.yml`。它会在 `main` 推送后执行检查、测试、构建并发布，也可从 Actions 手动运行。构建从 Pages 设置读取实际路径，普通项目仓库、用户主页仓库和自定义域名无需分别修改源码。

1. 在 GitHub 创建空仓库，例如 `PlantGrowth-Recorder`，不要初始化 README、许可证或 `.gitignore`。GitHub Free 使用公开仓库；公开仓库会公开源代码。
2. 在本机项目目录执行以下命令，将 `YOUR_NAME` 替换为 GitHub 用户名。当前目录已经初始化 Git，无需重新初始化。

   ```powershell
   cd F:\Desktop\PlantGrowth-Recorder
   git add vite.config.js .github/workflows/pages.yml docs/DEPLOYMENT.md
   git commit -m "Add GitHub Pages deployment"
   git remote add origin https://github.com/YOUR_NAME/PlantGrowth-Recorder.git
   git push -u origin main
   ```

3. 在仓库的 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
4. 如果第一次推送发生在启用 Pages 之前，进入 **Actions → Deploy to GitHub Pages → Run workflow**，选择 `main` 并运行。
5. 成功后从部署结果或 Settings → Pages 打开实际网址，通常为 `https://YOUR_NAME.github.io/PlantGrowth-Recorder/`。

自动部署只上传 `dist`。不需要手动上传 `node_modules`、`dist` 或配置 GitHub Token。`origin` 已存在时先用 `git remote -v` 检查，确认目标后再调整；不要强制推送覆盖已有仓库。推送时按照 Git 的登录提示完成 GitHub 身份验证。

此 Pages 工作流会对外发布网站，不继承原 Sites 的仅所有者访问限制。用户数据仍仅保存在各自浏览器。切换域名前，在旧站点导出项目备份，再到新站点导入。

本地验证项目子路径：在 PowerShell 中设置 `$env:DEPLOY_BASE='/PlantGrowth-Recorder/'` 后构建和启动预览；检查完成后执行 `Remove-Item Env:DEPLOY_BASE`。常规开发和原 Sites 构建默认仍使用 `/`。

参考：[Vite 部署指南](https://vite.dev/guide/static-deploy#github-pages)、[GitHub Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 静态部署

1. 使用锁文件执行 `npm ci`。
2. 执行 `npm test`、`npm run test:e2e` 和 `npm run build`。
3. 将 `dist/` 发布到支持 HTTPS 的静态托管。无数据库、对象存储、API 密钥或服务器运行时。
4. 检查 `/`、两种 `/fonts/*.ttf`、`/assets/*.js` 和 PDF Worker 返回正确的内容及 MIME 类型。
5. 保持原有域名。本机 IndexedDB 按域名隔离；换域名前先通知用户导出项目备份。

Sites 使用 `.openai/hosting.json` 的固定项目标识和 `static.directory: dist`。新建站点默认仅站点所有者可访问。若需要公众访问，单独设置访问范围并验证生产地址。

## 缓存和安全头

- HTML 使用 `Cache-Control: no-cache`。
- 带 hash 的 `/assets/*` 可使用一年 immutable 缓存。
- 字体设置合理缓存并保留同源请求；更换字体时应变更文件名或缓存版本。
- 推荐 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Permissions-Policy: camera=(), microphone=(), geolocation=()`。
- 若使用 CSP，需允许同源脚本/Worker、`blob:` Worker、`data:`/`blob:` 图片、内联样式（组件及 PDF 预览定位需要），不需要第三方 API 域名。先在预发布验证；托管平台认证页有其自身 CSP 要求。
- 网站处理文件完全在浏览器进行；不要增加会上传用户文档内容的错误上报。当前版本在界面提示错误，未配置外部遥测。

## 发布验收

- 通过生产地址创建一次临时项目、填写中文、添加照片、刷新恢复。
- 修改模板和封面，检查实时预览，下载带项目附件的 PDF，再导入。
- 在手机上检查新增记录、输入、预览和下载。
- 访问失败时检查托管访问策略；字体失败时检查静态文件，不能改用不匹配版本的 CDN Worker。

## 回滚

发布前保存源代码提交与对应构建版本。部署异常时重新部署最近一次验证通过的版本；Sites 可部署已保存的历史版本。不要清空用户 IndexedDB。

数据格式升级时应提供显式迁移。版本 3 的项目导入会拒绝未知格式，不会猜测或覆盖旧数据。更高数据版本回滚到旧程序前，先导出项目，验证兼容性。

## 故障恢复

- 保存失败：立即导出项目备份，再解决浏览器权限或容量问题。
- 多标签页只读：关闭正在编辑的其他页，刷新当前页。
- PDF 损坏/加密：先在原软件修复或解密后重试。
- 旧 PDF 只能追加：其缺少完整源数据，无法自动还原；如有 `.plantgrowth.json` 请优先导入。
- 超大项目：按植物或观察阶段拆成多个项目。浏览器可用内存因设备不同，不将数量上限视为性能保证。
