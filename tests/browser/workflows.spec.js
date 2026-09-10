import { test, expect } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { makeProject, parseProject } from '../../src/core/model.js'

async function newProject(page, name = '测试观察项目') {
  await page.goto('/')
  await page.getByRole('button', { name: '新建观察项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建观察项目' })
  await dialog.getByLabel('项目名称', { exact: true }).fill(name)
  await dialog.getByLabel('植物名称').fill('番茄')
  await dialog.getByLabel('观察者').fill('测试观察者')
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click()
  await expect(page.getByRole('heading', { name: '记录这一天' })).toBeVisible()
}
async function backup(page) {
  const promise = page.waitForEvent('download')
  await page.getByRole('button', { name: '备份项目', exact: true }).click()
  const file = await promise
  return {
    path: await file.path(),
    project: parseProject(await readFile(await file.path(), 'utf8')),
  }
}
const fixture = () => {
  const canvas = createCanvas(800, 500)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#dce5dc'
  ctx.fillRect(0, 0, 800, 500)
  ctx.fillStyle = '#315943'
  ctx.fillRect(150, 80, 250, 330)
  ctx.fillStyle = '#acb889'
  ctx.fillRect(420, 170, 230, 240)
  return {
    name: 'normal-camera-file.png',
    mimeType: 'image/png',
    buffer: canvas.toBuffer('image/png'),
  }
}

test('桌面：新建、编辑、照片、自动保存恢复、PDF与项目双向恢复', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await newProject(page, '窗边番茄观察')
  await page
    .getByLabel('观察笔记内容')
    .fill('第一片真叶完全展开。株高 12 cm。\n浇水 80 mL，叶色正常。')
  await page.locator('input[aria-label="选择照片"]').setInputFiles(fixture())
  await expect(page.getByLabel('照片图注')).toBeVisible()
  await page.getByLabel('照片图注').fill('正面观察')
  await expect(page.locator('.paper canvas')).toBeVisible({ timeout: 60000 })
  await expect(page.locator('.save-status')).toContainText('已保存到本机')
  await page.screenshot({ path: 'tmp/qa/workspace-desktop.png', fullPage: true })
  await page.getByRole('button', { name: '封面编辑', exact: true }).click()
  await page.getByLabel('封面标题', { exact: true }).fill('番茄生长档案 · 自定义封面')
  await page.getByLabel('封面项目说明').fill('记录窗边番茄的生长变化。')
  await page.locator('input[aria-label="选择照片"]').setInputFiles(fixture())
  await expect(page.getByLabel('照片图注')).toBeVisible()
  const first = await backup(page)
  expect(first.project.cover.title).toBe('番茄生长档案 · 自定义封面')
  expect(first.project.cover.image.width).toBe(800)
  expect(first.project.records[0].photos).toHaveLength(1)
  await expect(page.locator('.save-status')).toContainText('已保存到本机')
  await page.reload()
  await expect(page.getByLabel('观察笔记内容')).toHaveValue(
    '第一片真叶完全展开。株高 12 cm。\n浇水 80 mL，叶色正常。',
  )
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
  const exportDialog = page.getByRole('dialog', { name: '导出 PDF', exact: true })
  await expect(exportDialog.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled({
    timeout: 60000,
  })
  await expect(exportDialog.locator('.paper canvas')).toBeVisible({ timeout: 60000 })
  await page.screenshot({ path: 'tmp/qa/export-desktop.png', fullPage: true })
  const downloadPromise = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: '下载 PDF', exact: true }).click()
  const download = await downloadPromise,
    pdfPath = await download.path()
  const bytes = await readFile(pdfPath)
  const task = getDocument({ data: new Uint8Array(bytes) })
  const pdf = await task.promise
  expect(pdf.numPages).toBe(2)
  const attachments = await pdf.getAttachments()
  expect([...attachments.values()][0].filename).toBe('project.plantgrowth.json')
  const text = (await (await pdf.getPage(2)).getTextContent()).items.map((x) => x.str).join('')
  expect(text).toContain('第一片真叶完全展开')
  await task.destroy()
  await exportDialog.getByRole('button', { name: '返回编辑' }).click()
  await page.getByRole('button', { name: '返回项目列表' }).click()
  await page
    .locator('input[aria-label="导入已有 PDF"]')
    .setInputFiles({ name: '恢复测试.pdf', mimeType: 'application/pdf', buffer: bytes })
  await expect(page.getByRole('heading', { name: '发现可编辑的项目数据' })).toBeVisible({
    timeout: 60000,
  })
  await page.getByRole('button', { name: '导入并打开项目' }).click()
  await expect(page.getByLabel('观察笔记内容')).toHaveValue(/第一片真叶/)
  expect((await backup(page)).project.cover.title).toBe('番茄生长档案 · 自定义封面')
  expect(errors).toEqual([])
})

test('日期冲突、补录、回收站恢复和模板作用范围', async ({ page }) => {
  await newProject(page)
  await page.getByLabel('观察日期', { exact: true }).fill('2026-09-10')
  await page.getByLabel('页面标题').click()
  await page.getByLabel('观察笔记内容').fill('后一天')
  await page.getByRole('button', { name: '添加观察记录', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加观察记录' })
  await dialog.getByLabel('观察日期').fill('2026-09-01')
  await dialog.getByRole('button', { name: '添加记录', exact: true }).click()
  await page.getByLabel('观察笔记内容').fill('第一天')
  expect((await backup(page)).project.records).toHaveLength(2)
  await page.getByRole('button', { name: '添加观察记录', exact: true }).click()
  await dialog.getByLabel('观察日期').fill('2026-09-01')
  await dialog.getByRole('button', { name: '打开已有记录' }).click()
  expect((await backup(page)).project.records).toHaveLength(2)
  await page.getByRole('button', { name: '单独调整这一条的排版' }).click()
  await page.getByLabel('正文字号', { exact: true }).fill('15')
  await page.getByLabel('标题字号').click()
  let p = (await backup(page)).project
  expect(p.template.fontSize).toBe(12)
  expect(p.records.find((r) => r.date === '2026-09-01').template.fontSize).toBe(15)
  await page
    .getByRole('button', { name: /2026-09-01/ })
    .first()
    .click()
  await page.getByRole('button', { name: '删除当前记录' }).click()
  await page.getByRole('button', { name: '移入回收站', exact: true }).click()
  await page.getByRole('button', { name: '项目信息', exact: true }).click()
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  p = (await backup(page)).project
  expect(p.records).toHaveLength(2)
  expect(p.trash).toHaveLength(0)
})

test('外部 PDF 保留页面、校正日期、追加与重复导出', async ({ page }) => {
  const original = await PDFDocument.create()
  original.addPage([300, 400])
  const bytes = await original.save()
  await page.goto('/')
  await page.locator('input[aria-label="导入已有 PDF"]').setInputFiles({
    name: '外部记录.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  })
  await page.getByLabel('已有记录日期').fill('2026-09-01')
  await page.getByRole('button', { name: '导入并打开项目' }).click()
  await expect(page.getByRole('heading', { name: '已有 PDF', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '添加新记录', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加观察记录' })
  await dialog.getByLabel('观察日期').fill('2026-09-02')
  await dialog.getByRole('button', { name: '添加记录', exact: true }).click()
  await page.getByLabel('观察笔记内容').fill('追加的新内容')
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
  const exp = page.getByRole('dialog', { name: '导出 PDF', exact: true })
  await expect(exp.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled({
    timeout: 60000,
  })
  const promise = page.waitForEvent('download')
  await exp.getByRole('button', { name: '下载 PDF', exact: true }).click()
  const d = await promise
  const doc = await PDFDocument.load(await readFile(await d.path()))
  expect(doc.getPageCount()).toBe(2)
  expect(doc.getPage(0).getWidth()).toBe(300)
  await exp.getByRole('button', { name: '返回编辑' }).click()
  expect((await backup(page)).project.records).toHaveLength(1)
})

test('手机：无横向溢出，能够编辑与预览', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.screenshot({ path: 'tmp/qa/library-mobile.png', fullPage: true })
  await newProject(page, '手机端观察')
  await page.getByLabel('观察笔记内容').fill('在手机上记录的生长变化。')
  await expect(page.locator('.save-status')).toContainText('已保存到本机')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: 'tmp/qa/editor-mobile.png', fullPage: true })
  await page.getByRole('button', { name: /文档预览/ }).click()
  await expect(page.locator('.paper canvas')).toBeVisible({ timeout: 60000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: 'tmp/qa/preview-mobile.png', fullPage: true })
})

test('损坏文件有错误反馈，不覆盖当前项目；多标签页保护', async ({ page, context }) => {
  await newProject(page, '数据保护测试')
  await page.getByLabel('观察笔记内容').fill('应保留的内容')
  await page
    .locator('input[aria-label="导入项目备份"]')
    .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') })
  await expect(
    page.getByText('无法读取项目文件，请选择有效的 .plantgrowth.json 备份。'),
  ).toBeVisible()
  await expect(page.getByLabel('观察笔记内容')).toHaveValue('应保留的内容')
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByText(/另一个标签页正在编辑/)).toBeVisible()
  await expect(second.getByLabel('观察笔记内容')).toBeDisabled()
  await second.close()
})

test('照片旋转裁剪、撤销重做、宋体与轻量导出', async ({ page }) => {
  await newProject(page, '照片与模板验证')
  await page.locator('input[aria-label="选择照片"]').setInputFiles(fixture())
  await expect(page.locator('.photo-item')).toHaveCount(1)
  await page.getByRole('button', { name: '旋转', exact: true }).click()
  await expect(page.getByRole('button', { name: '旋转', exact: true })).toBeEnabled()
  expect((await backup(page)).project.records[0].photos[0].width).toBe(500)
  await page.getByRole('button', { name: '裁剪', exact: true }).click()
  const crop = page.getByRole('dialog', { name: '裁剪照片' })
  await crop.getByRole('slider', { name: /宽度/ }).focus()
  await crop.getByRole('slider', { name: /宽度/ }).press('Home')
  await crop.getByRole('button', { name: '应用裁剪' }).click()
  await expect(crop).not.toBeVisible()
  expect((await backup(page)).project.records[0].photos[0].width).toBe(50)
  await page.getByRole('button', { name: '移除照片', exact: true }).click()
  await expect(page.locator('.photo-item')).toHaveCount(0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.photo-item')).toHaveCount(1)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(page.locator('.photo-item')).toHaveCount(0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByLabel('观察笔记内容').fill('宋体的中文排版与图片压缩测试。')
  await page.getByRole('button', { name: '模板与排版', exact: true }).click()
  await page.getByRole('combobox', { name: '字体', exact: true }).selectOption('serif')
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导出 PDF', exact: true })
  await expect(dialog.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled({
    timeout: 60000,
  })
  await dialog.getByLabel('图片质量').selectOption('compact')
  await dialog.getByLabel('附带可编辑项目').uncheck()
  await dialog.getByRole('button', { name: '生成导出预览', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled({
    timeout: 60000,
  })
  const promise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '下载 PDF', exact: true }).click()
  const task = getDocument({ data: new Uint8Array(await readFile(await (await promise).path())) })
  const pdf = await task.promise
  expect(await pdf.getAttachments()).toBeNull()
  const text = (await (await pdf.getPage(2)).getTextContent()).items.map((x) => x.str).join('')
  expect(text).toContain('宋体的中文排版')
  await task.destroy()
})
