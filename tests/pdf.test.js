import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { makeProject, makeRecord, parseProject } from '../src/core/model.js'
import { buildDocument } from '../src/core/pdf.js'
const fontBytes = {
  sans: await readFile(new URL('../public/fonts/JournalSans-Regular.ttf', import.meta.url)),
}

test('字体子集的实际像素与完整字体一致，不能只通过文字提取判断', async () => {
  const pixels = []
  for (const subset of [false, true]) {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const font = await doc.embedFont(fontBytes.sans, { subset })
    doc
      .addPage([600, 140])
      .drawText('未命名观察项目 2026-09-10 生长记录', { x: 20, y: 70, size: 22, font })
    const task = getDocument({ data: await doc.save() })
    const pdf = await task.promise
    try {
      const page = await pdf.getPage(1),
        viewport = page.getViewport({ scale: 1 }),
        canvas = createCanvas(viewport.width, viewport.height),
        ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise
      pixels.push(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
    } finally {
      await task.destroy()
    }
  }
  let mismatches = 0
  for (let i = 0; i < pixels[0].length; i++)
    if (Math.abs(pixels[0][i] - pixels[1][i]) > 5) mismatches++
  assert.ok(mismatches / pixels[0].length < 0.001, `字形渲染不一致：${mismatches} 像素通道`)
})

test('真实中文文字、分页、完整项目附件与回收站隐私', async () => {
  const p = makeProject('测试植物观察')
  p.observer = '观察者甲'
  p.cover.title = '可编辑的植物封面'
  p.cover.summary = '项目说明可以自定义。'
  p.records[0].date = '2026-09-10'
  p.records[0].description = '新叶正在展开，株高二十五厘米。保留中文与换行。\n'.repeat(100)
  p.records[0].fields = [{ id: 'height', label: '株高', value: '25 cm' }]
  p.trash = [{ ...makeRecord('2026-01-01'), description: '已删除的私密笔记' }]
  const result = await buildDocument(p, { fontBytes, includeProject: true })
  assert.ok(result.pages.length > 3, '长文应该自动续页')
  for (const page of result.pages)
    for (const region of page.regions) {
      assert.ok(region.y >= 0)
      assert.ok(region.y + region.height < 810, JSON.stringify(region))
    }
  const pdf = await getDocument({ data: result.bytes.slice(), isEvalSupported: false }).promise
  try {
    let text = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      text += (await (await pdf.getPage(i)).getTextContent()).items.map((t) => t.str).join('')
    }
    assert.match(text, /可编辑的植物封面/)
    assert.match(text, /株高/)
    assert.match(text, /25 cm/)
    assert.ok(!text.includes('iQOO'))
    assert.equal((text.match(/新叶正在展开/g) || []).length, 100, '分页不能丢文字')
    const attachments = await pdf.getAttachments()
    const a = [...attachments.values()].find((a) => a.filename === 'project.plantgrowth.json')
    assert.ok(a)
    const content = await pdf.getAttachmentContent('project.plantgrowth.json')
    const restored = parseProject(new TextDecoder().decode(content))
    assert.equal(restored.records[0].description, p.records[0].description)
    assert.equal(restored.trash.length, 0)
    await mkdir('tmp/qa', { recursive: true })
    await writeFile('tmp/qa/long-document.pdf', result.bytes)
  } finally {
    await pdf.loadingTask.destroy()
  }
})
test('追加保留原页面，重复导出不会重复追加', async () => {
  const original = await PDFDocument.create()
  original.addPage([300, 400])
  const oldBytes = await original.save()
  const p = makeProject('追加测试')
  p.template.showCover = false
  p.basePdf = {
    name: 'original.pdf',
    data: 'data:application/pdf;base64,' + Buffer.from(oldBytes).toString('base64'),
    pageCount: 1,
    dates: ['2026-09-01'],
    source: 'external',
  }
  p.records[0].date = '2026-09-02'
  p.records[0].description = '新增记录'
  const a = await buildDocument(p, { fontBytes, includeProject: true })
  const b = await buildDocument(p, { fontBytes })
  assert.equal(a.pages.length, 2)
  assert.equal(b.pages.length, 2)
  const doc = await PDFDocument.load(a.bytes)
  assert.equal(doc.getPage(0).getWidth(), 300)
  assert.equal(doc.getPage(0).getHeight(), 400)
})
test('移除栏目和修改模板后，PDF不保留写死的标题', async () => {
  const p = makeProject()
  p.template.showCover = false
  p.records[0].date = '2026-09-01'
  p.records[0].description = '今日笔记'
  p.records[0].device = '自定义相机'
  p.template.descriptionLabel = '生长变化'
  p.template.modules.find((m) => m.key === 'device').visible = false
  const result = await buildDocument(p, { fontBytes })
  const pdf = await getDocument({ data: result.bytes.slice() }).promise
  try {
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((t) => t.str).join('')
    assert.match(text, /生长变化/)
    assert.ok(!text.includes('自定义相机'))
    assert.ok(!(await pdf.getAttachments()))
  } finally {
    await pdf.loadingTask.destroy()
  }
})
