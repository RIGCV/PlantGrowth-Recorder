import { isValidDate, today } from '../utils/dateParser.js'
export const FORMAT = 'plantgrowth-project'
export const VERSION = 3
export const uid = () => globalThis.crypto.randomUUID()
export const clone = (value) => JSON.parse(JSON.stringify(value))
export const MAX_FILE = 50 * 1024 * 1024
export const MAX_BACKUP = 150 * 1024 * 1024
export const PRESETS = [
  {
    id: 'field',
    name: '自然手记',
    accent: '#245947',
    fontSize: 12,
    titleSize: 27,
    columns: 1,
    imageHeight: 300,
  },
  {
    id: 'lab',
    name: '实验档案',
    accent: '#284661',
    fontSize: 11,
    titleSize: 24,
    columns: 2,
    imageHeight: 230,
  },
  {
    id: 'minimal',
    name: '极简日志',
    accent: '#343b3c',
    fontSize: 12,
    titleSize: 25,
    columns: 1,
    imageHeight: 320,
  },
]
export function makeTemplate(preset = PRESETS[0]) {
  return {
    ...preset,
    textColor: '#273432',
    font: 'sans',
    lineHeight: 1.8,
    margin: 48,
    gap: 20,
    border: false,
    showCover: true,
    showHeader: true,
    header: '{project}',
    showFooter: true,
    footer: '{date}',
    pageNumbers: true,
    pageNumberText: '第 {page} 页',
    dailyTitle: '{date} 生长记录',
    descriptionLabel: '观察笔记',
    photosLabel: '影像记录',
    deviceLabel: '拍摄信息',
    modules: [
      { key: 'photos', label: '影像记录', visible: true },
      { key: 'description', label: '观察笔记', visible: true },
      { key: 'device', label: '拍摄信息', visible: true },
      { key: 'fields', label: '补充记录', visible: true },
    ],
  }
}
export function makeRecord(date = today()) {
  return {
    id: uid(),
    date,
    title: '',
    description: '',
    device: '',
    parameters: '',
    photos: [],
    fields: [],
    template: null,
  }
}
export function makeProject(name = '未命名观察项目') {
  const now = new Date().toISOString()
  return {
    format: FORMAT,
    version: VERSION,
    id: uid(),
    name,
    plant: '',
    observer: '',
    createdAt: now,
    updatedAt: now,
    cover: {
      title: '植物生长观察记录',
      subtitle: '',
      summary: '',
      image: null,
      periodAuto: true,
      period: '',
      updatedAuto: true,
      updated: '',
      format: '图文观察记录',
      footer: '',
      fields: [],
      modules: [
        { key: 'title', label: '标题与副标题', visible: true },
        { key: 'dates', label: '观察时间', visible: true },
        { key: 'image', label: '封面照片', visible: true },
        { key: 'summary', label: '项目说明', visible: true },
        { key: 'fields', label: '项目信息', visible: true },
      ],
    },
    template: makeTemplate(),
    records: [makeRecord()],
    trash: [],
    basePdf: null,
  }
}
export const sortedRecords = (project) =>
  [...project.records].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
export function dateRange(project) {
  const dates = [...(project.basePdf?.dates || []), ...project.records.map((r) => r.date)]
    .filter(isValidDate)
    .sort()
  return { first: dates[0] || '', last: dates.at(-1) || '', count: new Set(dates).size }
}
export function duplicateDate(project, date, excludingId) {
  return (
    project.records.find((r) => r.date === date && r.id !== excludingId) ||
    (project.basePdf?.dates || []).includes(date)
  )
}
export function moveItem(list, index, offset) {
  const target = index + offset
  if (target < 0 || target >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
}
export function tokens(text, project, date = '', page = '') {
  const range = dateRange(project)
  const values = {
    project: project.name,
    plant: project.plant,
    observer: project.observer,
    date,
    page,
    first: range.first,
    last: range.last,
  }
  return String(text ?? '').replace(
    /\{(project|plant|observer|date|page|first|last)\}/g,
    (_, key) => values[key] ?? '',
  )
}
export function validateProject(project) {
  const errors = []
  if (!project.name.trim()) errors.push('请填写项目名称。')
  const seen = new Set(project.basePdf?.dates || [])
  for (const record of project.records) {
    if (!isValidDate(record.date)) errors.push('有记录的日期无效，请选择真实日期。')
    else if (seen.has(record.date)) errors.push(`${record.date} 有重复记录，请合并或修改日期。`)
    seen.add(record.date)
  }
  if (!project.records.length && !project.basePdf) errors.push('请先添加一条记录。')
  return [...new Set(errors)]
}
function assert(value, message) {
  if (!value) throw new Error(message)
}
const string = (value, max = 50000) => typeof value === 'string' && value.length <= max
function checkPhoto(photo) {
  assert(
    photo &&
      string(photo.id, 100) &&
      /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(photo.data),
    '备份中的照片格式无效。',
  )
  assert(
    photo.data.length <= 20 * 1024 * 1024 &&
      Number.isFinite(photo.width) &&
      photo.width > 0 &&
      photo.width <= 16000 &&
      Number.isFinite(photo.height) &&
      photo.height > 0 &&
      photo.height <= 16000,
    '备份中的照片尺寸或大小超出限制。',
  )
  assert(string(photo.caption || '', 10000) && string(photo.name || '', 1000), '照片说明过长。')
}
export function validateTemplate(t) {
  assert(
    t && /^#[\da-f]{6}$/i.test(t.accent) && /^#[\da-f]{6}$/i.test(t.textColor),
    '模板颜色无效。',
  )
  for (const [key, min, max] of [
    ['fontSize', 9, 20],
    ['titleSize', 18, 40],
    ['lineHeight', 1.2, 2.5],
    ['margin', 28, 80],
    ['gap', 8, 40],
    ['imageHeight', 120, 420],
    ['columns', 1, 2],
  ]) {
    assert(Number.isFinite(t[key]) && t[key] >= min && t[key] <= max, `模板参数 ${key} 超出范围。`)
  }
  assert(['sans', 'serif'].includes(t.font), '不支持的字体。')
  for (const key of [
    'header',
    'footer',
    'pageNumberText',
    'dailyTitle',
    'descriptionLabel',
    'photosLabel',
    'deviceLabel',
  ])
    assert(string(t[key], 500), '模板文案无效或过长。')
  assert(
    Array.isArray(t.modules) &&
      t.modules.length === 4 &&
      new Set(t.modules.map((m) => m.key)).size === 4 &&
      t.modules.every(
        (m) =>
          ['photos', 'description', 'device', 'fields'].includes(m.key) &&
          typeof m.visible === 'boolean',
      ),
    '模板模块无效。',
  )
  return t
}
export function parseProject(text) {
  assert(typeof text === 'string' && text.length <= MAX_BACKUP, '项目文件超过 150 MB 限制。')
  let p
  try {
    p = JSON.parse(text)
  } catch {
    throw new Error('无法读取项目文件，请选择有效的 .plantgrowth.json 备份。')
  }
  assert(
    p && p.format === FORMAT && p.version === VERSION,
    '不支持的项目文件或版本，请使用生长手记 v3 项目备份。',
  )
  assert(
    string(p.id, 100) && string(p.name, 200) && string(p.plant, 200) && string(p.observer, 200),
    '项目基本信息无效。',
  )
  assert(Array.isArray(p.records) && p.records.length <= 1000, '记录数量超出限制（最多 1000 条）。')
  validateTemplate(p.template)
  assert(
    p.cover &&
      ['title', 'subtitle', 'summary', 'period', 'updated', 'format', 'footer'].every((k) =>
        string(p.cover[k]),
      ),
    '封面信息无效。',
  )
  assert(
    Array.isArray(p.cover.modules) &&
      p.cover.modules.length === 5 &&
      new Set(p.cover.modules.map((m) => m.key)).size === 5 &&
      p.cover.modules.every(
        (m) =>
          ['title', 'dates', 'image', 'summary', 'fields'].includes(m.key) &&
          typeof m.visible === 'boolean',
      ),
    '封面模块无效。',
  )
  const checkFields = (fields) =>
    assert(
      Array.isArray(fields) &&
        fields.length <= 50 &&
        fields.every((f) => f && string(f.id, 100) && string(f.label, 200) && string(f.value)),
      '自定义字段无效。',
    )
  checkFields(p.cover.fields)
  if (p.cover.image) checkPhoto(p.cover.image)
  assert(Array.isArray(p.trash) && p.trash.length <= 1000, '回收站数据无效。')
  const ids = new Set()
  for (const r of [...p.records, ...p.trash]) {
    assert(r && string(r.id, 100) && !ids.has(r.id) && isValidDate(r.date), '记录编号或日期无效。')
    ids.add(r.id)
    assert(
      ['title', 'description', 'device', 'parameters'].every((k) => string(r[k])),
      '记录文字无效或过长。',
    )
    assert(Array.isArray(r.photos) && r.photos.length <= 30, '单条记录最多 30 张照片。')
    r.photos.forEach(checkPhoto)
    checkFields(r.fields)
    if (r.template) validateTemplate(r.template)
  }
  if (p.basePdf) {
    assert(
      /^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/.test(p.basePdf.data) &&
        p.basePdf.data.length <= MAX_FILE * 1.4,
      '原始 PDF 数据无效。',
    )
    assert(
      Number.isInteger(p.basePdf.pageCount) &&
        p.basePdf.pageCount > 0 &&
        p.basePdf.pageCount <= 500,
      '原始 PDF 页数无效。',
    )
    assert(
      Array.isArray(p.basePdf.dates) && p.basePdf.dates.every(isValidDate),
      '原始 PDF 日期无效。',
    )
    assert(string(p.basePdf.name, 1000), '原始 PDF 文件名无效。')
  }
  const errors = validateProject(p)
  assert(!errors.some((e) => e.includes('重复')), errors.join('\n'))
  return clone(p)
}
export function filename(name) {
  return (name || '植物观察记录').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100)
}
