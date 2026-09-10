import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import {
  clone,
  dateRange,
  sortedRecords,
  tokens,
  parseProject,
  MAX_FILE,
  MAX_BACKUP,
  makeProject,
  validateTemplate,
} from './model.js'
import { isValidDate } from '../utils/dateParser.js'
import { dataBytes, readDataUrl } from './files.js'

const W = 595.28,
  H = 841.89
const fontCache = new Map()
export async function getFontBytes(family = 'sans') {
  if (!fontCache.has(family))
    fontCache.set(
      family,
      (async () => {
        const file = family === 'serif' ? 'JournalSerif-Regular.ttf' : 'JournalSans-Regular.ttf'
        const response = await fetch(`${import.meta.env?.BASE_URL || '/'}fonts/${file}`)
        if (!response.ok) throw new Error('中文字体加载失败，请检查网络后重试。')
        return new Uint8Array(await response.arrayBuffer())
      })().catch((e) => {
        fontCache.delete(family)
        throw e
      }),
    )
  return fontCache.get(family)
}
const color = (hex) =>
  rgb(
    ...hex
      .slice(1)
      .match(/../g)
      .map((v) => parseInt(v, 16) / 255),
  )

export function wrapText(text, font, size, width) {
  const lines = []
  const widths = new Map()
  for (const paragraph of String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n')) {
    let line = '',
      length = 0
    for (const ch of paragraph) {
      if (!widths.has(ch)) widths.set(ch, font.widthOfTextAtSize(ch, size))
      const w = widths.get(ch)
      if (length + w > width && line) {
        lines.push(line)
        line = ''
        length = 0
      }
      line += ch
      length += w
    }
    lines.push(line)
  }
  return lines
}

export async function buildDocument(project, options = {}) {
  const p = clone(project)
  const progress = options.progress || (() => {})
  progress('准备中文字体', 5)
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const fonts = new Map()
  const families = new Set([
    p.template.font,
    ...p.records.map((r) => r.template?.font).filter(Boolean),
  ])
  for (const family of families)
    fonts.set(
      family,
      await doc.embedFont(options.fontBytes?.[family] || (await getFontBytes(family)), {
        subset: true,
      }),
    )
  const metadata = [],
    warnings = new Set(),
    imageCache = new Map()
  if (p.basePdf) {
    progress('保留原始 PDF 页面', 15)
    const original = await PDFDocument.load(dataBytes(p.basePdf.data))
    if (original.getPageCount() > 500) throw new Error('已有 PDF 超过 500 页，请拆分后导入。')
    const pages = await doc.copyPages(original, original.getPageIndices())
    pages.forEach((page, i) => {
      doc.addPage(page)
      metadata.push({ kind: 'original', label: `原文 ${i + 1}`, recordId: null, regions: [] })
    })
  }
  const supported = new Map()
  function clean(text, font) {
    if (!supported.has(font)) supported.set(font, new Set(font.getCharacterSet()))
    const chars = supported.get(font)
    return [...String(text ?? '')]
      .map((c) => {
        if ('\n\r\t'.includes(c)) return c
        if (chars.has(c.codePointAt(0))) return c
        warnings.add('部分特殊符号或表情不在中文字体中，已用 □ 标示，请检查预览。')
        return '□'
      })
      .join('')
  }
  async function embed(photo) {
    if (!imageCache.has(photo.data)) {
      let data = photo.data
      let compactBytes
      if (options.quality === 'compact' && typeof createImageBitmap !== 'undefined') {
        const bitmap = await createImageBitmap(new Blob([dataBytes(data)]))
        try {
          const ratio = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
          const canvas =
            typeof OffscreenCanvas !== 'undefined'
              ? new OffscreenCanvas(1, 1)
              : document.createElement('canvas')
          canvas.width = Math.round(bitmap.width * ratio)
          canvas.height = Math.round(bitmap.height * ratio)
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          if (canvas.convertToBlob)
            compactBytes = await (
              await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 })
            ).arrayBuffer()
          else data = canvas.toDataURL('image/jpeg', 0.75)
        } finally {
          bitmap.close()
        }
      }
      imageCache.set(
        photo.data,
        compactBytes
          ? await doc.embedJpg(compactBytes)
          : data.startsWith('data:image/png')
            ? await doc.embedPng(dataBytes(data))
            : await doc.embedJpg(dataBytes(data)),
      )
    }
    return imageCache.get(photo.data)
  }
  let page, meta, y, bottom, template, font, date, recordId, kind, continued, margin, width
  const range = dateRange(p)
  function draw(text, x, top, size, tone = template.textColor) {
    page.drawText(clean(text, font), { x, y: H - top - size, size, font, color: color(tone) })
  }
  function decorate() {
    const n = doc.getPageCount()
    let top = margin
    if (template.showHeader && template.header) {
      const header = wrapText(clean(tokens(template.header, p, date, n), font), font, 9, width)
      header.forEach((line, i) => draw(line, margin, top + i * 13, 9, template.accent))
      top += header.length * 13 + 14
      page.drawLine({
        start: { x: margin, y: H - top },
        end: { x: W - margin, y: H - top },
        thickness: 0.7,
        color: color(template.accent),
      })
      top += 20
    }
    const footerText = kind === 'cover' ? p.cover.footer : template.footer
    const footer =
      template.showFooter && footerText
        ? wrapText(clean(tokens(footerText, p, date, n), font), font, 9, width * 0.68)
        : []
    const number = template.pageNumbers
      ? wrapText(clean(tokens(template.pageNumberText, p, date, n), font), font, 9, width * 0.28)
      : []
    const footerHeight = Math.max(footer.length, number.length) * 13
    bottom = H - margin - footerHeight - 18
    footer.forEach((line, i) => draw(line, margin, bottom + 20 + i * 13, 9))
    number.forEach((line, i) =>
      draw(line, W - margin - font.widthOfTextAtSize(line, 9), bottom + 20 + i * 13, 9),
    )
    y = top
  }
  function newPage() {
    if (metadata.length >= 1500) throw new Error('文档超过 1500 页，请分成多个项目。')
    page = doc.addPage([W, H])
    meta = {
      kind,
      recordId,
      label:
        kind === 'cover'
          ? continued
            ? '封面 · 续页'
            : '封面'
          : `${date}${continued ? ' · 续页' : ''}`,
      regions: [],
    }
    metadata.push(meta)
    decorate()
    continued = true
  }
  function ensure(height) {
    if (y + height > bottom && y > margin + 100) newPage()
  }
  function region(field, start, end, x = margin, w = width) {
    meta.regions.push({ field, x, y: start, width: w, height: Math.max(18, end - start) })
  }
  function paragraph(
    text,
    {
      size = template.fontSize,
      tone = template.textColor,
      field,
      after = template.gap,
      heading = false,
    } = {},
  ) {
    if (!String(text || '').trim()) return
    const lines = wrapText(clean(text, font), font, size, width)
    const lineHeight = size * (heading ? 1.5 : template.lineHeight)
    ensure(
      lineHeight * Math.min(lines.length, 2) +
        (heading ? template.fontSize * template.lineHeight : 0),
    )
    let start = y
    for (const line of lines) {
      if (y + lineHeight > bottom) {
        if (field && y > start) region(field, start, y)
        newPage()
        start = y
      }
      draw(line, margin, y, size, tone)
      y += lineHeight
    }
    if (field) region(field, start, y)
    y += after
  }
  function heading(text, field) {
    paragraph(text, {
      size: template.fontSize + 2,
      tone: template.accent,
      field,
      heading: true,
      after: 10,
    })
  }
  async function photos(list, field, columns = template.columns, height = template.imageHeight) {
    if (!list.length) return
    for (let index = 0; index < list.length; index += columns) {
      const row = list.slice(index, index + columns),
        gap = 12,
        cellWidth = (width - gap * (columns - 1)) / columns
      ensure(height + 24)
      const start = y
      for (let j = 0; j < row.length; j++) {
        const image = await embed(row[j])
        const scale = Math.min(cellWidth / image.width, height / image.height)
        const iw = image.width * scale,
          ih = image.height * scale,
          left = margin + j * (cellWidth + gap)
        if (template.border)
          page.drawRectangle({
            x: left,
            y: H - y - height,
            width: cellWidth,
            height,
            borderWidth: 0.7,
            borderColor: color(template.accent),
          })
        page.drawImage(image, {
          x: left + (cellWidth - iw) / 2,
          y: H - y - (height + ih) / 2,
          width: iw,
          height: ih,
        })
      }
      y += height
      region(field, start, y)
      y += 10
      for (let j = 0; j < row.length; j++)
        if (row[j].caption) paragraph(row[j].caption, { size: 10, field, after: 8 })
      y += template.gap
    }
  }
  async function fields(list, field) {
    for (const item of list) {
      if (!item.label.trim() && !item.value.trim()) continue
      heading(item.label, field)
      paragraph(item.value, { field })
    }
  }
  function startSection(t, type, id, d) {
    validateTemplate(t)
    template = t
    font = fonts.get(t.font)
    margin = t.margin
    width = W - 2 * margin
    kind = type
    recordId = id
    date = d
    continued = false
    newPage()
  }
  if (p.template.showCover && !p.basePdf) {
    startSection(p.template, 'cover', null, range.last)
    for (const module of p.cover.modules.filter((m) => m.visible)) {
      switch (module.key) {
        case 'title':
          paragraph(p.cover.title, {
            size: template.titleSize + 4,
            tone: template.accent,
            field: 'cover.title',
            heading: true,
            after: 14,
          })
          paragraph(p.cover.subtitle, { size: template.fontSize + 2, field: 'cover.subtitle' })
          break
        case 'dates':
          paragraph(
            p.cover.periodAuto
              ? range.first
                ? `观察时间：${range.first} — ${range.last}`
                : ''
              : p.cover.period,
            { size: 11, field: 'cover.period', after: 7 },
          )
          paragraph(
            p.cover.updatedAuto ? (range.last ? `最后更新：${range.last}` : '') : p.cover.updated,
            { size: 11, field: 'cover.updated', after: 7 },
          )
          paragraph(p.cover.format, { size: 11, field: 'cover.format' })
          break
        case 'image':
          if (p.cover.image)
            await photos([p.cover.image], 'cover.image', 1, Math.min(template.imageHeight, 300))
          break
        case 'summary':
          paragraph(p.cover.summary, { field: 'cover.summary' })
          break
        case 'fields':
          if (p.plant) paragraph(p.plant, { field: 'plant', after: 7 })
          if (p.observer) paragraph(p.observer, { field: 'observer', after: 7 })
          await fields(p.cover.fields, 'cover.fields')
          break
      }
    }
  }
  const records = sortedRecords(p)
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    progress(
      `排版记录 ${i + 1} / ${records.length}`,
      20 + Math.round((65 * (i + 1)) / Math.max(1, records.length)),
    )
    startSection(record.template || p.template, 'record', record.id, record.date)
    paragraph(record.title || tokens(template.dailyTitle, p, date), {
      size: template.titleSize,
      tone: template.accent,
      heading: true,
      field: 'title',
    })
    for (const module of template.modules.filter((m) => m.visible)) {
      switch (module.key) {
        case 'photos':
          if (record.photos.length) {
            ensure(template.imageHeight + 60)
            heading(template.photosLabel, 'photos')
            await photos(record.photos, 'photos')
          }
          break
        case 'description':
          if (record.description) {
            heading(template.descriptionLabel, 'description')
            paragraph(record.description, { field: 'description' })
          }
          break
        case 'device':
          if (record.device || record.parameters) {
            heading(template.deviceLabel, 'device')
            paragraph([record.device, record.parameters].filter(Boolean).join('  |  '), {
              field: 'device',
            })
          }
          break
        case 'fields':
          await fields(record.fields, 'fields')
          break
      }
    }
  }
  if (!doc.getPageCount()) throw new Error('请添加记录或启用封面后再生成 PDF。')
  doc.setTitle(p.cover.title || p.name)
  doc.setAuthor(p.observer || '')
  doc.setCreator('生长手记')
  doc.setProducer('PlantGrowth Recorder 1.0')
  doc.setSubject(
    'PLANT_GROWTH_RECORDER_V3:' +
      JSON.stringify({
        version: 3,
        dates: [...new Set([...(p.basePdf?.dates || []), ...records.map((r) => r.date)])].sort(),
        firstDate: range.first,
        lastDate: range.last,
      }),
  )
  if (options.includeProject) {
    progress('保存可编辑项目附件', 90)
    p.trash = []
    delete p.deletedAt
    const bytes = new TextEncoder().encode(JSON.stringify(p))
    if (bytes.length > MAX_BACKUP)
      throw new Error('可编辑附件超过 150 MB，请取消附带项目数据或拆分项目。')
    await doc.attach(bytes, 'project.plantgrowth.json', {
      mimeType: 'application/json',
      description: '生长手记可编辑项目（含照片与文字）',
    })
  }
  progress('生成 PDF', 95)
  const bytes = await doc.save()
  progress('完成', 100)
  return { bytes, pages: metadata, warnings: [...warnings] }
}

export async function inspectPdf(file, progress = () => {}) {
  if (file.size > MAX_FILE) throw new Error('PDF 不能超过 50 MB，请先拆分或压缩。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-'))
    throw new Error('这不是有效的 PDF 文件。')
  const { loadPdf } = await import('./pdfjs.js')
  let pdf
  try {
    pdf = await loadPdf(bytes)
    if (pdf.numPages > 500) throw new Error('PDF 超过 500 页，请先拆分。')
    const attachments = await pdf.getAttachments()
    const entry = [...(attachments?.entries?.() || Object.entries(attachments || {}))].find(
      ([, a]) => a.filename === 'project.plantgrowth.json',
    )
    if (entry) {
      const attachment = await pdf.getAttachmentContent(entry[0])
      if (!attachment || attachment.length > MAX_BACKUP)
        throw new Error('PDF 中的可编辑附件无效或超过 150 MB。')
      const project = parseProject(new TextDecoder().decode(attachment))
      return { type: 'editable', project, pageCount: pdf.numPages }
    }
    const metadata = await pdf.getMetadata()
    const subject = metadata.info?.Subject || ''
    let dates = [],
      source = 'external'
    for (const prefix of ['PLANT_GROWTH_RECORDER_V2:', 'PLANT_GROWTH_RECORDER_V3:']) {
      if (subject.startsWith(prefix)) {
        try {
          const meta = JSON.parse(subject.slice(prefix.length))
          if (Array.isArray(meta.dates)) {
            dates = meta.dates.filter(isValidDate)
            source = 'legacy'
          }
        } catch {
          /* Use conservative text fallback. */
        }
      }
    }
    if (source === 'external') {
      for (let i = 1; i <= pdf.numPages; i++) {
        progress(`识别原文 ${i} / ${pdf.numPages}`, Math.round((90 * i) / pdf.numPages))
        const page = await pdf.getPage(i),
          content = await page.getTextContent()
        const text = content.items.map((item) => item.str).join(' ')
        dates.push(...(text.match(/20\d{2}-\d{2}-\d{2}/g) || []).filter(isValidDate))
        page.cleanup()
      }
    }
    const project = makeProject(file.name.replace(/\.pdf$/i, ''))
    project.records = []
    project.template.showCover = false
    project.basePdf = {
      name: file.name,
      data: await readDataUrl(new Blob([bytes], { type: 'application/pdf' })),
      pageCount: pdf.numPages,
      dates: [...new Set(dates)].sort(),
      source,
    }
    return { type: source, project, pageCount: pdf.numPages }
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('此 PDF 已加密，请先解密后再导入。')
    if (error.name === 'InvalidPDFException')
      throw new Error('PDF 已损坏或格式不受支持，请重新导出后重试。')
    throw error
  } finally {
    await pdf?.loadingTask.destroy()
  }
}
