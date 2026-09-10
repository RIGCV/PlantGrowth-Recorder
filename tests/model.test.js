import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidDate, parseImageDate } from '../src/utils/dateParser.js'
import {
  makeProject,
  makeRecord,
  parseProject,
  validateProject,
  duplicateDate,
  sortedRecords,
  makeTemplate,
  validateTemplate,
  dateRange,
  tokens,
  moveItem,
} from '../src/core/model.js'

test('真实日期校验包含闰年、月份边界和格式', () => {
  for (const date of ['2024-02-29', '2026-09-01', '2000-02-29'])
    assert.equal(isValidDate(date), true)
  for (const date of [
    '2026-02-29',
    '2026-02-30',
    '2026-13-32',
    '2026-00-01',
    '1900-02-29',
    '2026-9-1',
    'invalid',
    '',
  ])
    assert.equal(isValidDate(date), false)
})
test('文件日期支持多种格式且不强制命名', () => {
  assert.equal(parseImageDate('260901.jpg').date, '2026-09-01')
  assert.equal(parseImageDate('IMG_20260901_091000.jpg').date, '2026-09-01')
  assert.equal(parseImageDate('plant_2026-09-01.png').date, '2026-09-01')
  assert.equal(parseImageDate('261332.jpg'), null)
  assert.equal(parseImageDate('我的植物.jpg'), null)
})
test('历史补录按日期排序，重复日期不能静默导出', () => {
  const p = makeProject()
  p.records = [makeRecord('2026-09-10'), makeRecord('2026-09-01')]
  assert.deepEqual(
    sortedRecords(p).map((r) => r.date),
    ['2026-09-01', '2026-09-10'],
  )
  assert.equal(duplicateDate(p, '2026-09-01').id, p.records[1].id)
  p.records.push(makeRecord('2026-09-01'))
  assert.match(validateProject(p).join(''), /重复/)
})
test('项目完整往返恢复模板、文案、字段和回收站', () => {
  const p = makeProject('向日葵观察')
  p.cover.title = '自定义封面'
  p.cover.fields.push({ id: 'field', label: '实验编号', value: 'A-17' })
  p.records[0].description = '中文观察\n第二段'
  p.records[0].template = makeTemplate()
  p.records[0].template.accent = '#123456'
  p.trash.push(makeRecord('2025-01-01'))
  assert.deepEqual(parseProject(JSON.stringify(p)), p)
})
test('导入拒绝损坏、未知版本、危险图片和非法布局', () => {
  assert.throws(() => parseProject('{'), /无法读取/)
  const p = makeProject()
  p.version = 99
  assert.throws(() => parseProject(JSON.stringify(p)), /版本/)
  p.version = 3
  p.template.fontSize = 0
  assert.throws(() => parseProject(JSON.stringify(p)), /超出范围/)
  p.template.fontSize = 12
  p.records[0].photos = [{ id: 'x', data: 'javascript:alert(1)', width: 2, height: 2 }]
  assert.throws(() => parseProject(JSON.stringify(p)), /照片/)
})
test('每条记录可以独立调整模板，不污染全局配置', () => {
  const p = makeProject()
  p.records[0].template = structuredClone(p.template)
  p.records[0].template.fontSize = 18
  assert.equal(p.template.fontSize, 12)
  validateTemplate(p.records[0].template)
})
test('模板模块必须完整且唯一', () => {
  const t = makeTemplate()
  t.modules[1].key = 'photos'
  assert.throws(() => validateTemplate(t), /模块/)
})
test('原始PDF日期参与范围和重复检查', () => {
  const p = makeProject()
  p.records = [makeRecord('2026-09-10')]
  p.basePdf = { dates: ['2026-09-01', '2026-09-05'] }
  assert.deepEqual(dateRange(p), { first: '2026-09-01', last: '2026-09-10', count: 3 })
  assert.equal(duplicateDate(p, '2026-09-05'), true)
})
test('变量替换不执行用户输入，模块移动保持数据', () => {
  const p = makeProject('<script>')
  assert.equal(tokens('{project} {date} {page}', p, '2026-09-01', 3), '<script> 2026-09-01 3')
  const list = ['a', 'b', 'c']
  moveItem(list, 0, -1)
  assert.deepEqual(list, ['a', 'b', 'c'])
  moveItem(list, 2, -1)
  assert.deepEqual(list, ['a', 'c', 'b'])
})
