<script setup>
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
  defineAsyncComponent,
} from 'vue';
import { ElDialog, ElMessage, ElMessageBox } from 'element-plus';
import AppIcon from './components/AppIcon.vue';
import FieldList from './components/FieldList.vue';
import ModuleOrder from './components/ModuleOrder.vue';
import PhotoEditor from './components/PhotoEditor.vue';
import TemplateEditor from './components/TemplateEditor.vue';
import {
  makeProject,
  makeRecord,
  clone,
  uid,
  dateRange,
  sortedRecords,
  duplicateDate,
  parseProject,
  validateProject,
  filename,
  MAX_BACKUP,
} from './core/model.js';
import {
  listProjects,
  saveProject,
  listTemplates,
  getSetting,
  setSetting,
  storageInfo,
  requestPersistence,
} from './core/storage.js';
import { today, isValidDate, parseImageDate } from './utils/dateParser.js';
import { download, formatBytes } from './core/files.js';
import { generatePdf } from './core/pdfClient.js';
const DocumentPreview = defineAsyncComponent(() => import('./components/DocumentPreview.vue'));

const projects = ref([]),
  project = ref(null),
  personal = ref([]),
  view = ref('record'),
  recordId = ref(''),
  mobilePane = ref('edit');
const loading = ref(true),
  fatal = ref(''),
  saving = ref(false),
  saveError = ref(''),
  dirty = ref(false),
  busy = ref(false),
  photoBusy = ref(false),
  busyLabel = ref(''),
  busyPercent = ref(0),
  readOnly = ref(false);
const createOpen = ref(false),
  createName = ref(''),
  createPlant = ref(''),
  createObserver = ref('');
const addOpen = ref(false),
  addDate = ref(today()),
  helpOpen = ref(false),
  storageOpen = ref(false),
  storage = ref({}),
  showArchived = ref(false);
const exportOpen = ref(false),
  exportResult = ref(null),
  exportName = ref(''),
  exportQuality = ref('standard'),
  includeProject = ref(true),
  exportSnapshot = ref(null);
const importInput = ref(),
  pdfInput = ref(),
  pendingImport = ref(null),
  importOpen = ref(false),
  identifiedDates = ref(''),
  importType = ref(''),
  importError = ref('');
const scope = ref('project'),
  pageCount = ref(0),
  search = ref(''),
  historyVersion = ref(0);
let saveTimer,
  saveChain = Promise.resolve(),
  revision = 0,
  disposed = false,
  releaseLock,
  undo = [],
  redo = [],
  historyMuted = false;
const records = computed(() => (project.value ? sortedRecords(project.value) : []));
const record = computed(() => project.value?.records.find((r) => r.id === recordId.value));
const range = computed(() => (project.value ? dateRange(project.value) : {}));
const visibleProjects = computed(() =>
  projects.value
    .filter((p) => !!p.deletedAt === showArchived.value)
    .filter((p) => `${p.name} ${p.plant}`.toLowerCase().includes(search.value.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
);
const target = computed(() =>
  view.value === 'cover' ? 'cover' : view.value === 'original' ? 'original' : recordId.value,
);
const activeTemplate = computed(() =>
  scope.value === 'record' && record.value
    ? record.value.template || project.value.template
    : project.value?.template,
);
const coverPhotos = computed(() => (project.value?.cover.image ? [project.value.cover.image] : []));
const isWorking = computed(() => busy.value || photoBusy.value);
const canUndo = computed(() => {
  historyVersion.value;
  return undo.length > 0;
});
const canRedo = computed(() => {
  historyVersion.value;
  return redo.length > 0;
});
const statusText = computed(() =>
  readOnly.value
    ? '只读标签页'
    : saveError.value
      ? '保存失败'
      : saving.value
        ? '正在保存…'
        : dirty.value
          ? '等待保存…'
          : '已保存到本机',
);

function report(error) {
  ElMessage.error(error?.message || String(error));
}
function remember(event) {
  if (event?.target?.closest?.('button[aria-label="撤销"], button[aria-label="重做"]')) return;
  if (!project.value || historyMuted || readOnly.value) return;
  const text = JSON.stringify(project.value);
  if (undo.at(-1) !== text) {
    undo.push(text);
    if (undo.length > (text.length > 10e6 ? 3 : 10)) undo.shift();
    redo = [];
    historyVersion.value++;
  }
}
function restoreHistory(direction) {
  if (!project.value || readOnly.value) return;
  const current = JSON.stringify(project.value);
  if (direction === 'undo') {
    while (undo.at(-1) === current) undo.pop();
    if (!undo.length) return;
    redo.push(current);
    project.value = JSON.parse(undo.pop());
  } else {
    if (!redo.length) return;
    undo.push(current);
    project.value = JSON.parse(redo.pop());
  }
  historyVersion.value++;
  if (!record.value) recordId.value = project.value.records[0]?.id || '';
}
async function flush() {
  clearTimeout(saveTimer);
  if (!project.value || !dirty.value || readOnly.value) return saveChain;
  const current = revision,
    snapshot = clone(project.value);
  snapshot.updatedAt = new Date().toISOString();
  saving.value = true;
  const job = saveChain.catch(() => {}).then(() => saveProject(snapshot));
  saveChain = job;
  try {
    await job;
    const index = projects.value.findIndex((p) => p.id === snapshot.id);
    if (index >= 0) projects.value.splice(index, 1, snapshot);
    else projects.value.push(snapshot);
    if (current === revision) {
      dirty.value = false;
      saveError.value = '';
    }
  } catch (e) {
    saveError.value =
      e.name === 'QuotaExceededError'
        ? '本机存储空间不足，请立即备份并清理空间。'
        : `保存失败：${e.message}`;
    throw e;
  } finally {
    saving.value = false;
  }
}
watch(
  project,
  () => {
    if (loading.value || historyMuted || !project.value || readOnly.value) return;
    revision++;
    dirty.value = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flush().catch(() => {}), 700);
  },
  { deep: true },
);
async function activate(p) {
  if (dirty.value) {
    try {
      await flush();
    } catch (e) {
      report(new Error('当前项目尚未保存，请先下载备份，再切换项目。'));
      return;
    }
  }
  historyMuted = true;
  project.value = clone(p);
  recordId.value = p.records[0]?.id || '';
  view.value = p.records.length ? 'record' : p.basePdf ? 'original' : 'cover';
  scope.value = 'project';
  mobilePane.value = 'edit';
  pageCount.value = 0;
  undo = [JSON.stringify(p)];
  redo = [];
  historyVersion.value++;
  await nextTick();
  historyMuted = false;
  dirty.value = false;
  saveError.value = '';
  setSetting('lastProject', p.id).catch(() => {});
}
async function toLibrary() {
  if (dirty.value) {
    try {
      await flush();
    } catch {
      report(new Error('保存失败，请先备份项目。'));
      return;
    }
  }
  historyMuted = true;
  project.value = null;
  await nextTick();
  historyMuted = false;
  await setSetting('lastProject', null).catch(() => {});
}
async function create() {
  if (!createName.value.trim()) return;
  const p = makeProject(createName.value.trim());
  p.plant = createPlant.value.trim();
  p.observer = createObserver.value.trim();
  if (p.plant) p.cover.subtitle = p.plant;
  try {
    await saveProject(p);
    projects.value.push(p);
    await activate(p);
    createOpen.value = false;
    createName.value = '';
    createPlant.value = '';
    createObserver.value = '';
  } catch (e) {
    report(e);
  }
}
function selectRecord(id) {
  recordId.value = id;
  view.value = 'record';
  scope.value = 'project';
  mobilePane.value = 'edit';
}
function openAdd() {
  addDate.value = today();
  addOpen.value = true;
}
function addRecord() {
  if (!isValidDate(addDate.value)) {
    report(new Error('请选择有效的日期（1900—2199 年）。'));
    return;
  }
  const exists = duplicateDate(project.value, addDate.value);
  if (exists) {
    if (typeof exists === 'object') {
      selectRecord(exists.id);
      addOpen.value = false;
      ElMessage.info('已打开该日期的记录，可继续添加照片或文字。');
    } else report(new Error('原 PDF 已包含此日期。原页面不能直接修改，请选择其他日期。'));
    return;
  }
  if (project.value.records.length >= 1000) {
    report(new Error('一个项目最多 1000 条记录，请新建项目。'));
    return;
  }
  if (project.value.basePdf && project.value.basePdf.dates.at(-1) > addDate.value) {
    report(new Error('导入的原 PDF 会保持原顺序，新增日期须晚于已识别的最后日期。'));
    return;
  }
  remember();
  const r = makeRecord(addDate.value);
  project.value.records.push(r);
  selectRecord(r.id);
  addOpen.value = false;
}
async function changeDate(event) {
  const date = event.target.value,
    current = record.value;
  if (!isValidDate(date)) {
    event.target.value = current.date;
    report(new Error('请选择真实有效的日期。'));
    return;
  }
  const exists = duplicateDate(project.value, date, current.id);
  if (exists) {
    event.target.value = current.date;
    if (typeof exists !== 'object') {
      report(new Error('原 PDF 已包含此日期，不能重复添加。'));
      return;
    }
    if (
      exists.photos.length + current.photos.length > 30 ||
      exists.fields.length + current.fields.length > 50 ||
      exists.description.length + current.description.length > 49998
    ) {
      report(new Error('合并后的照片、字段或文字超过限制，请先整理内容。'));
      return;
    }
    try {
      await ElMessageBox.confirm(
        `将当前记录的照片、文字和字段合并到 ${date}，原记录会放入回收站。`,
        '该日期已有记录',
        { confirmButtonText: '合并记录', cancelButtonText: '取消' },
      );
      remember();
      exists.description = [exists.description, current.description].filter(Boolean).join('\n\n');
      exists.photos.push(...clone(current.photos).map((p) => ({ ...p, id: uid() })));
      exists.fields.push(...clone(current.fields).map((f) => ({ ...f, id: uid() })));
      exists.device = [exists.device, current.device].filter(Boolean).join(' / ');
      exists.parameters = [exists.parameters, current.parameters].filter(Boolean).join(' / ');
      if (!exists.title) exists.title = current.title;
      project.value.records = project.value.records.filter((r) => r.id !== current.id);
      project.value.trash.push(clone(current));
      selectRecord(exists.id);
    } catch {}
    return;
  }
  if (project.value.basePdf?.dates.at(-1) > date) {
    event.target.value = current.date;
    report(new Error('新增记录日期须晚于原 PDF 的最后日期。'));
    return;
  }
  remember();
  current.date = date;
}
async function deleteRecord() {
  if (!record.value) return;
  try {
    await ElMessageBox.confirm(
      `${record.value.date} 的记录将移入回收站，之后可以恢复。`,
      '移除记录',
      { confirmButtonText: '移入回收站', cancelButtonText: '取消' },
    );
    remember();
    project.value.trash.push(clone(record.value));
    project.value.records = project.value.records.filter((r) => r.id !== recordId.value);
    recordId.value = project.value.records[0]?.id || '';
    if (!recordId.value) view.value = 'project';
  } catch {}
}
function restoreRecord(r) {
  if (duplicateDate(project.value, r.date)) {
    report(new Error('已有相同日期的记录，请先更改现有日期再恢复。'));
    return;
  }
  remember();
  project.value.records.push(r);
  project.value.trash = project.value.trash.filter((x) => x.id !== r.id);
  selectRecord(r.id);
}
async function archive(p) {
  try {
    await ElMessageBox.confirm(`“${p.name}”将移入已归档项目，可随时恢复。`, '归档项目', {
      confirmButtonText: '归档',
      cancelButtonText: '取消',
    });
    const changed = { ...clone(p), deletedAt: new Date().toISOString() };
    await saveProject(changed);
    projects.value.splice(
      projects.value.findIndex((x) => x.id === p.id),
      1,
      changed,
    );
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') report(e);
  }
}
async function unarchive(p) {
  const changed = clone(p);
  delete changed.deletedAt;
  try {
    await saveProject(changed);
    projects.value.splice(
      projects.value.findIndex((x) => x.id === p.id),
      1,
      changed,
    );
  } catch (e) {
    report(e);
  }
}
function applyTemplate(t) {
  remember();
  if (scope.value === 'record' && record.value) record.value.template = clone(t);
  else project.value.template = clone(t);
}
function changeScope() {
  if (scope.value === 'record' && record.value && !record.value.template) {
    remember();
    record.value.template = clone(project.value.template);
  }
}
function dateFromFile(name) {
  const result = parseImageDate(name);
  if (result && record.value?.date !== result.date)
    ElMessage.info(`文件名日期为 ${result.date}，可在记录日期中手动调整。`);
}
function coverChange() {
  const list = coverPhotos.value;
  project.value.cover.image = list[0] || null;
}
function previewSelect(data) {
  if (data.kind === 'cover') {
    view.value = 'cover';
  } else if (data.recordId) {
    selectRecord(data.recordId);
  }
  mobilePane.value = 'edit';
  nextTick(() => {
    const key = data.field.replace('cover.', '');
    document.getElementById(`field-${key}`)?.focus();
    document
      .getElementById(`section-${key}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}
async function backup() {
  if (!project.value) return;
  const text = JSON.stringify(project.value, null, 2);
  if (new Blob([text]).size > MAX_BACKUP) {
    report(new Error('项目备份超过 150 MB，请先拆分项目。'));
    return;
  }
  download(text, `${filename(project.value.name)}.plantgrowth.json`, 'application/json');
  setSetting(`backup:${project.value.id}`, new Date().toISOString()).catch(() => {});
  ElMessage.success('已下载项目备份，可在另一台设备导入恢复。');
}
async function importFile(event, pdf = false) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (dirty.value) {
    try {
      await flush();
    } catch {
      report(new Error('当前项目未保存，请先备份后再导入。'));
      return;
    }
  }
  busy.value = true;
  busyLabel.value = pdf ? '正在读取 PDF' : '正在读取项目备份';
  busyPercent.value = 0;
  try {
    let result;
    if (pdf) {
      const { inspectPdf } = await import('./core/pdf.js');
      result = await inspectPdf(file, (message, percent) => {
        busyLabel.value = message;
        busyPercent.value = percent;
      });
    } else {
      if (file.size > MAX_BACKUP) throw new Error('项目备份不能超过 150 MB。');
      result = { type: 'editable', project: parseProject(await file.text()) };
    }
    pendingImport.value = result;
    importType.value = result.type;
    identifiedDates.value = (result.project.basePdf?.dates || []).join(', ');
    importError.value = '';
    importOpen.value = true;
  } catch (e) {
    report(e);
  } finally {
    busy.value = false;
  }
}
async function finishImport() {
  const p = clone(pendingImport.value.project);
  if (p.basePdf) {
    const dates = identifiedDates.value.split(/[,，\s]+/).filter(Boolean);
    if (dates.some((d) => !isValidDate(d))) {
      importError.value = '请按 YYYY-MM-DD 填写有效日期，以逗号分隔。';
      return;
    }
    p.basePdf.dates = [...new Set(dates)].sort();
  }
  p.id = uid();
  delete p.deletedAt;
  p.updatedAt = new Date().toISOString();
  if (projects.value.some((x) => x.name === p.name)) p.name += '（导入副本）';
  try {
    await saveProject(p);
    projects.value.push(p);
    await activate(p);
    importOpen.value = false;
    pendingImport.value = null;
    ElMessage.success(
      p.basePdf ? '原 PDF 已载入，可以添加新记录。' : '项目已恢复，所有记录与模板均可继续编辑。',
    );
  } catch (e) {
    report(e);
  }
}
async function openExport() {
  const errors = validateProject(project.value);
  if (errors.length) {
    report(new Error(errors.join('\n')));
    return;
  }
  try {
    await flush();
  } catch {
    report(new Error('本机保存失败，仍可导出 PDF；请同时下载项目备份。'));
  }
  exportName.value = filename(project.value.name) + '.pdf';
  exportSnapshot.value = clone(project.value);
  exportResult.value = null;
  exportOpen.value = true;
  await prepareExport();
}
async function prepareExport() {
  if (busy.value) return;
  busy.value = true;
  busyLabel.value = '正在生成导出文件';
  busyPercent.value = 0;
  try {
    exportResult.value = await generatePdf(
      exportSnapshot.value,
      { includeProject: includeProject.value, quality: exportQuality.value },
      (p) => {
        busyLabel.value = p.message;
        busyPercent.value = p.percent;
      },
    );
  } catch (e) {
    exportResult.value = null;
    report(e);
  } finally {
    busy.value = false;
  }
}
function downloadExport() {
  if (!exportResult.value) return;
  download(
    exportResult.value.bytes,
    filename(exportName.value.replace(/\.pdf$/i, '')) + '.pdf',
    'application/pdf',
  );
  ElMessage.success('PDF 已下载。当前项目已保留，可直接继续添加下一条记录。');
}
async function showStorage() {
  storage.value = await storageInfo();
  storageOpen.value = true;
}
async function persistStorage() {
  storage.value.persisted = await requestPersistence();
  ElMessage.info(
    storage.value.persisted
      ? '浏览器已启用持久存储。'
      : '浏览器暂未授予持久存储，请定期下载项目备份。',
  );
}
function beforeUnload(e) {
  if (dirty.value || isWorking.value) {
    e.preventDefault();
    e.returnValue = '';
    flush().catch(() => {});
  }
}
function keydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    flush().catch(report);
  }
}
async function initialize() {
  loading.value = true;
  fatal.value = '';
  try {
    projects.value = await listProjects();
    personal.value = await listTemplates();
    if (navigator.locks) {
      navigator.locks
        .request('plantgrowth-editor', { ifAvailable: true }, (lock) => {
          if (!lock) {
            readOnly.value = true;
            return;
          }
          return new Promise((resolve) => (releaseLock = resolve));
        })
        .catch(() => {});
    }
    const last = await getSetting('lastProject');
    const recent = projects.value.find((p) => p.id === last && !p.deletedAt);
    if (recent) await activate(recent);
  } catch (e) {
    fatal.value = `本机存储无法打开：${e.message}。请允许浏览器存储后重试。`;
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  initialize();
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('keydown', keydown);
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(saveTimer);
  releaseLock?.();
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('keydown', keydown);
});
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <button class="brand" @click="toLibrary" :disabled="isWorking">
        <span class="brand-mark"><AppIcon name="book" :size="22" /></span
        ><span>生长手记<small>PLANT JOURNAL</small></span>
      </button>
      <div class="header-context">{{ project ? '观察工作台' : '我的观察项目' }}</div>
      <div class="header-actions">
        <button class="text-btn" @click="showStorage">
          <AppIcon name="shield" :size="17" /><span>本机存储</span></button
        ><button class="icon-btn" @click="helpOpen = true" aria-label="使用帮助">
          <AppIcon name="help" />
        </button>
      </div>
    </header>
    <input
      ref="importInput"
      class="sr-only"
      type="file"
      accept=".json,.plantgrowth"
      @change="importFile($event, false)"
      tabindex="-1"
      aria-label="导入项目备份"
    />
    <input
      ref="pdfInput"
      class="sr-only"
      type="file"
      accept="application/pdf,.pdf"
      @change="importFile($event, true)"
      tabindex="-1"
      aria-label="导入已有 PDF"
    />
    <div v-if="readOnly" class="global-notice">
      另一个标签页正在编辑。为防止互相覆盖，此页只读；关闭其他编辑页后刷新可继续编辑。
    </div>
    <div v-if="loading" class="app-loading" role="status">正在打开本机项目…</div>
    <div v-else-if="fatal" class="app-loading">
      <p class="error-text">{{ fatal }}</p>
      <button class="btn" @click="initialize">重试</button>
    </div>
    <main v-else-if="!project" class="library">
      <div class="library-heading">
        <div>
          <p class="eyebrow">观察 · 整理 · 留存</p>
          <h1>每一次生长，都有迹可循。</h1>
          <p class="muted">用照片和文字，积累一份属于你的植物观察档案。</p>
        </div>
        <button class="btn primary" :disabled="readOnly || isWorking" @click="createOpen = true">
          <AppIcon name="plus" :size="18" />新建观察项目
        </button>
      </div>
      <div class="entry-grid">
        <button class="entry-card" :disabled="readOnly || isWorking" @click="createOpen = true">
          <AppIcon name="plus" :size="24" /><strong>从今天开始</strong
          ><span>创建项目，写下第一条观察记录</span><AppIcon name="arrow" :size="18" /></button
        ><button class="entry-card" :disabled="readOnly || isWorking" @click="importInput.click()">
          <AppIcon name="archive" :size="24" /><strong>继续已有项目</strong
          ><span>导入备份，恢复照片、文字和模板</span><AppIcon name="arrow" :size="18" /></button
        ><button class="entry-card" :disabled="readOnly || isWorking" @click="pdfInput.click()">
          <AppIcon name="file" :size="24" /><strong>追加已有 PDF</strong
          ><span>先查看原文，再添加新的记录</span><AppIcon name="arrow" :size="18" />
        </button>
      </div>
      <div class="library-controls">
        <div class="inline">
          <h2>{{ showArchived ? '已归档项目' : '最近项目' }}</h2>
          <span class="count-pill">{{ visibleProjects.length }}</span>
        </div>
        <div class="inline">
          <input
            class="search-input"
            v-model="search"
            aria-label="搜索项目"
            placeholder="搜索项目或植物"
          /><button class="text-btn" @click="showArchived = !showArchived">
            {{ showArchived ? '返回最近项目' : '查看归档' }}
          </button>
        </div>
      </div>
      <div v-if="!visibleProjects.length" class="empty-library">
        <AppIcon name="book" :size="34" />
        <h3>
          {{ search ? '没有找到相关项目' : showArchived ? '暂无归档项目' : '还没有观察项目' }}
        </h3>
        <p>
          {{
            search
              ? '试试其他项目名称或植物名称。'
              : '新建项目或导入已有文件，记录会自动保存在这台设备。'
          }}
        </p>
      </div>
      <div v-else class="project-grid">
        <article v-for="p in visibleProjects" :key="p.id" class="project-card">
          <button class="project-open" @click="activate(p)" :disabled="isWorking">
            <div
              class="project-cover"
              :class="{ 'has-photo': p.cover.image || p.records.find((r) => r.photos.length) }"
            >
              <img
                v-if="p.cover.image || p.records.find((r) => r.photos.length)"
                :src="p.cover.image?.data || p.records.find((r) => r.photos.length).photos[0].data"
                :alt="p.plant || p.name"
              /><template v-else
                ><span class="project-initial">{{ (p.plant || p.name).slice(0, 1) }}</span
                ><span>OBSERVATION JOURNAL</span></template
              ><span class="project-label">{{ p.basePdf ? 'PDF 续记' : '观察档案' }}</span>
            </div>
            <div class="project-info">
              <h3>{{ p.name }}</h3>
              <p>{{ p.plant || '未填写植物名称' }} · {{ p.records.length }} 条记录</p>
              <small
                >{{ dateRange(p).first || '尚无日期'
                }}{{ dateRange(p).last ? ' — ' + dateRange(p).last : '' }}</small
              >
            </div>
          </button>
          <div class="project-card-footer">
            <span>更新于 {{ new Date(p.updatedAt).toLocaleDateString('zh-CN') }}</span
            ><button
              class="icon-btn"
              v-if="!showArchived"
              :disabled="readOnly"
              @click="archive(p)"
              aria-label="归档项目"
            >
              <AppIcon name="archive" :size="17" /></button
            ><button v-else class="text-btn" :disabled="readOnly" @click="unarchive(p)">
              恢复项目
            </button>
          </div>
        </article>
      </div>
      <div class="library-note">
        <AppIcon name="shield" :size="19" />
        <p>照片和文字仅在本机处理与保存。更换设备或清理浏览器前，请下载项目备份。</p>
        <button class="text-btn" @click="helpOpen = true">
          了解使用方式<AppIcon name="arrow" :size="15" />
        </button>
      </div>
    </main>
    <main v-else class="workspace" @focusin="remember" @pointerdown="remember">
      <div class="project-toolbar">
        <div class="project-heading">
          <button
            class="icon-btn"
            @click="toLibrary"
            :disabled="isWorking"
            aria-label="返回项目列表"
          >
            <AppIcon name="back" />
          </button>
          <div>
            <h1>{{ project.name }}</h1>
            <div class="project-meta">
              <span>{{ project.plant || '植物观察' }}</span
              ><span>{{ records.length }} 条记录</span
              ><span class="save-status" :class="{ error: saveError }"
                ><span
                  class="status-dot"
                  :class="{ pending: dirty || saving, error: saveError }"
                />{{ statusText }}</span
              >
            </div>
          </div>
        </div>
        <div class="project-actions">
          <button
            class="icon-btn"
            :disabled="readOnly || isWorking || !canUndo"
            @click.stop="restoreHistory('undo')"
            aria-label="撤销"
            title="撤销"
          >
            <AppIcon name="rotate" :size="18" /></button
          ><button
            class="icon-btn redo-btn"
            :disabled="readOnly || isWorking || !canRedo"
            @click.stop="restoreHistory('redo')"
            aria-label="重做"
            title="重做"
          >
            <AppIcon name="rotate" :size="18" /></button
          ><button class="btn" @click="backup">
            <AppIcon name="archive" :size="17" /><span>备份项目</span></button
          ><button class="btn primary" @click="openExport" :disabled="isWorking">
            <AppIcon name="download" :size="17" /><span>导出 PDF</span>
          </button>
        </div>
      </div>
      <div v-if="saveError" class="global-notice error" role="alert">
        {{ saveError }} <button class="text-btn" @click="flush().catch(report)">重新保存</button
        ><button class="text-btn" @click="backup">立即备份</button>
      </div>
      <div class="mobile-switch">
        <button :class="{ active: mobilePane === 'edit' }" @click="mobilePane = 'edit'">
          编辑记录</button
        ><button :class="{ active: mobilePane === 'preview' }" @click="mobilePane = 'preview'">
          文档预览 · {{ pageCount }} 页
        </button>
      </div>
      <div class="workspace-body" :class="{ 'show-preview': mobilePane === 'preview' }">
        <aside class="project-sidebar">
          <nav aria-label="项目导航">
            <button :class="{ active: view === 'project' }" @click="view = 'project'">
              <AppIcon name="grid" :size="18" />项目信息</button
            ><button
              v-if="!project.basePdf"
              :class="{ active: view === 'cover' }"
              @click="view = 'cover'"
            >
              <AppIcon name="book" :size="18" />封面编辑</button
            ><button
              v-if="project.basePdf"
              :class="{ active: view === 'original' }"
              @click="view = 'original'"
            >
              <AppIcon name="file" :size="18" />原始 PDF<span>{{
                project.basePdf.pageCount
              }}</span></button
            ><button :class="{ active: view === 'template' }" @click="view = 'template'">
              <AppIcon name="settings" :size="18" />模板与排版
            </button>
          </nav>
          <div class="record-nav-heading">
            <span>观察记录</span
            ><button
              class="icon-btn"
              @click="openAdd"
              :disabled="readOnly || isWorking"
              aria-label="添加观察记录"
            >
              <AppIcon name="plus" :size="18" />
            </button>
          </div>
          <div class="record-nav">
            <button
              v-for="r in records"
              :key="r.id"
              :class="{ active: view === 'record' && recordId === r.id }"
              @click="selectRecord(r.id)"
              :disabled="photoBusy"
            >
              <span class="record-dot" /><span
                ><strong>{{ r.date }}</strong
                ><small
                  >{{ r.title || r.description.slice(0, 16) || '待填写观察'
                  }}{{ r.photos.length ? ' · ' + r.photos.length + ' 图' : '' }}</small
                ></span
              >
            </button>
            <p v-if="!records.length" class="hint empty-record">点击 + 添加新的观察记录</p>
          </div>
          <button class="sidebar-add" @click="openAdd" :disabled="readOnly || isWorking">
            <AppIcon name="plus" :size="17" />添加记录 / 补录
          </button>
          <div class="sidebar-bottom">
            <AppIcon name="shield" :size="16" /><span>自动保存到当前浏览器</span>
          </div>
        </aside>
        <div class="editor-panel">
          <fieldset :disabled="readOnly || isWorking" class="editor-fieldset">
            <template v-if="view === 'record' && record"
              ><div class="editor-title">
                <div>
                  <p class="eyebrow">DAILY OBSERVATION</p>
                  <h2>记录这一天</h2>
                </div>
                <button class="icon-btn danger" @click="deleteRecord" aria-label="删除当前记录">
                  <AppIcon name="trash" :size="19" />
                </button>
              </div>
              <section class="editor-section">
                <div class="form-grid">
                  <label class="field"
                    >观察日期<input
                      type="date"
                      :value="record.date"
                      min="1900-01-01"
                      max="2199-12-31"
                      @change="changeDate" /></label
                  ><label class="field"
                    >记录状态<span class="field-readonly">{{
                      record.photos.length || record.description ? '已记录' : '待补充内容'
                    }}</span></label
                  >
                </div>
                <label class="field"
                  >页面标题<span class="optional">可选</span
                  ><input
                    id="field-title"
                    v-model="record.title"
                    placeholder="留空使用模板中的日期标题"
                    maxlength="500"
                /></label>
              </section>
              <section class="editor-section" id="section-photos">
                <div class="section-heading">
                  <h3>观察照片</h3>
                  <span class="hint">{{ record.photos.length }} / 30</span>
                </div>
                <PhotoEditor
                  :key="record.id"
                  :photos="record.photos"
                  @busy="photoBusy = $event"
                  @file-date="dateFromFile"
                />
              </section>
              <section class="editor-section" id="section-description">
                <div class="section-heading">
                  <h3>观察笔记</h3>
                  <span class="hint">{{ record.description.length }} 字</span>
                </div>
                <label class="field"
                  ><span class="sr-only">观察笔记内容</span
                  ><textarea
                    id="field-description"
                    v-model="record.description"
                    rows="8"
                    maxlength="50000"
                    placeholder="今天有哪些变化？可以记录新叶、株高、颜色、浇水或环境变化。"
                  />
                </label>
                <p class="hint">内容较长时会自动续页，无需手动控制字数。</p>
              </section>
              <section class="editor-section" id="section-device">
                <h3>拍摄信息<span class="optional">可选</span></h3>
                <label class="field"
                  >设备<input
                    id="field-device"
                    v-model="record.device"
                    maxlength="500"
                    placeholder="自行填写设备型号" /></label
                ><label class="field"
                  >拍摄参数<input
                    v-model="record.parameters"
                    maxlength="500"
                    placeholder="例如焦距、光圈、拍摄条件"
                /></label>
              </section>
              <section class="editor-section" id="section-fields">
                <h3>补充记录</h3>
                <FieldList :fields="record.fields" />
              </section>
              <div class="editor-section">
                <button
                  class="text-btn"
                  @click="
                    view = 'template';
                    scope = 'record';
                    changeScope();
                  "
                >
                  <AppIcon name="settings" :size="16" />单独调整这一条的排版
                </button>
                <p v-if="record.template" class="hint">此记录使用独立模板，不随项目模板变化。</p>
              </div></template
            >
            <template v-else-if="view === 'cover'"
              ><div class="editor-title">
                <div>
                  <p class="eyebrow">COVER PAGE</p>
                  <h2>编辑封面</h2>
                </div>
              </div>
              <section class="editor-section">
                <label class="check-label"
                  ><input type="checkbox" v-model="project.template.showCover" />生成封面页</label
                ><label class="field"
                  >封面标题<input
                    id="field-title"
                    v-model="project.cover.title"
                    maxlength="500" /></label
                ><label class="field"
                  >副标题<input
                    id="field-subtitle"
                    v-model="project.cover.subtitle"
                    maxlength="500"
                    placeholder="例如植物品种、观察主题"
                /></label>
              </section>
              <section class="editor-section">
                <h3>观察时间</h3>
                <label class="check-label"
                  ><input
                    type="checkbox"
                    v-model="project.cover.periodAuto"
                  />根据记录自动计算观察时间</label
                ><label class="field"
                  ><span class="sr-only">观察时间文案</span
                  ><input
                    id="field-period"
                    v-model="project.cover.period"
                    :disabled="project.cover.periodAuto"
                    :placeholder="
                      project.cover.periodAuto
                        ? `${range.first || '起始日期'} — ${range.last || '结束日期'}`
                        : '自定义观察时间文案，留空隐藏'
                    "
                    maxlength="500" /></label
                ><label class="check-label"
                  ><input
                    type="checkbox"
                    v-model="project.cover.updatedAuto"
                  />自动显示最后记录日期</label
                ><label class="field"
                  ><span class="sr-only">最后更新文案</span
                  ><input
                    id="field-updated"
                    v-model="project.cover.updated"
                    :disabled="project.cover.updatedAuto"
                    :placeholder="
                      project.cover.updatedAuto ? range.last : '自定义最后更新文案，留空隐藏'
                    "
                    maxlength="500" /></label
                ><label class="field"
                  >记录形式<input
                    id="field-format"
                    v-model="project.cover.format"
                    maxlength="500"
                    placeholder="留空隐藏"
                /></label>
              </section>
              <section class="editor-section" id="section-image">
                <h3>封面照片</h3>
                <PhotoEditor
                  :photos="coverPhotos"
                  single
                  @change="coverChange"
                  @busy="photoBusy = $event"
                /><button
                  v-if="project.cover.image"
                  class="text-btn"
                  @click="project.cover.image = null"
                >
                  移除封面照片
                </button>
              </section>
              <section class="editor-section">
                <h3>项目说明</h3>
                <label class="field"
                  ><span class="sr-only">封面项目说明</span
                  ><textarea
                    id="field-summary"
                    v-model="project.cover.summary"
                    rows="5"
                    maxlength="50000"
                    placeholder="填写观察目的、背景或一段序言，留空隐藏。"
                  /></label
                ><label class="field"
                  >封面页脚<input
                    v-model="project.cover.footer"
                    maxlength="200"
                    placeholder="例如学校、实验室或自定义落款"
                /></label>
              </section>
              <section class="editor-section" id="section-fields">
                <h3>封面自定义字段</h3>
                <FieldList :fields="project.cover.fields" />
              </section>
              <section class="editor-section">
                <h3>封面模块顺序</h3>
                <ModuleOrder :modules="project.cover.modules" /></section
            ></template>
            <template v-else-if="view === 'template'"
              ><div class="editor-title">
                <div>
                  <p class="eyebrow">DOCUMENT DESIGN</p>
                  <h2>模板与排版</h2>
                </div>
              </div>
              <section class="editor-section scope-section">
                <label class="field"
                  >修改作用范围<select v-model="scope" @change="changeScope">
                    <option value="project">整个项目（使用独立模板的记录除外）</option>
                    <option v-if="record" value="record">仅 {{ record.date }} 这条记录</option>
                  </select></label
                ><button
                  v-if="scope === 'record' && record?.template"
                  class="text-btn"
                  @click="
                    record.template = null;
                    scope = 'project';
                  "
                >
                  恢复跟随项目模板
                </button>
              </section>
              <TemplateEditor
                :template="activeTemplate"
                :personal="personal"
                :scope="scope"
                @replace="applyTemplate"
                @templates-changed="personal = $event"
            /></template>
            <template v-else-if="view === 'original'"
              ><div class="editor-title">
                <div>
                  <p class="eyebrow">IMPORTED DOCUMENT</p>
                  <h2>已有 PDF</h2>
                </div>
              </div>
              <section class="editor-section">
                <div class="source-file">
                  <AppIcon name="file" :size="34" /><strong>{{ project.basePdf.name }}</strong
                  ><span
                    >{{ project.basePdf.pageCount }} 页 ·
                    {{ project.basePdf.source === 'legacy' ? '旧版生长记录' : '外部 PDF' }}</span
                  >
                </div>
                <p class="body-note">
                  右侧可逐页查看原文。原页面将完整保留，新记录会追加到文档末尾。
                </p>
                <div class="notice">
                  此文件不包含完整编辑数据，无法恢复历史页面中的文字和模板。原封面不会被覆盖；后续请同时保存项目备份。
                </div>
                <dl class="source-details">
                  <dt>识别到的日期</dt>
                  <dd>{{ project.basePdf.dates.join('、') || '未识别到日期' }}</dd>
                  <dt>本次新增</dt>
                  <dd>{{ records.length }} 条记录</dd>
                </dl>
                <button class="btn primary full" @click="openAdd">
                  <AppIcon name="plus" :size="18" />添加新记录
                </button>
              </section></template
            >
            <template v-else
              ><div class="editor-title">
                <div>
                  <p class="eyebrow">PROJECT DETAILS</p>
                  <h2>项目信息</h2>
                </div>
              </div>
              <section class="editor-section">
                <label class="field">项目名称<input v-model="project.name" maxlength="200" /></label
                ><label class="field"
                  >植物名称<input
                    id="field-plant"
                    v-model="project.plant"
                    maxlength="200"
                    placeholder="例如龟背竹、向日葵" /></label
                ><label class="field"
                  >观察者<input
                    id="field-observer"
                    v-model="project.observer"
                    maxlength="200"
                    placeholder="可选"
                /></label>
                <div class="project-summary">
                  <div>
                    <strong>{{ records.length }}</strong
                    ><span>条观察记录</span>
                  </div>
                  <div>
                    <strong>{{ project.records.reduce((n, r) => n + r.photos.length, 0) }}</strong
                    ><span>张记录照片</span>
                  </div>
                  <div>
                    <strong>{{ pageCount }}</strong
                    ><span>页文档</span>
                  </div>
                </div>
                <p class="hint">
                  {{ range.first ? `${range.first} — ${range.last}` : '添加记录后显示观察时间' }}
                </p>
              </section>
              <section class="editor-section">
                <h3>数据与备份</h3>
                <p class="body-note">
                  编辑自动保存到当前浏览器。项目备份包含照片、文字、模板及回收站记录，可导入恢复。
                </p>
                <button class="btn full" @click="backup">
                  <AppIcon name="archive" :size="17" />下载项目备份
                </button>
              </section>
              <section class="editor-section">
                <h3>
                  记录回收站<span class="optional">{{ project.trash.length }} 条</span>
                </h3>
                <p v-if="!project.trash.length" class="hint">删除的记录会保留在这里。</p>
                <div v-for="r in project.trash" :key="r.id" class="trash-row">
                  <span
                    >{{ r.date
                    }}<small>{{ r.photos.length }} 图 · {{ r.description.length }} 字</small></span
                  ><button class="text-btn" @click="restoreRecord(r)">恢复</button>
                </div>
              </section></template
            >
          </fieldset>
        </div>
        <div class="preview-panel">
          <DocumentPreview
            :project="project"
            :target="target"
            @select="previewSelect"
            @ready="pageCount = $event.pages"
          />
        </div>
      </div>
    </main>

    <ElDialog v-model="createOpen" title="新建观察项目" width="480px" :close-on-click-modal="false"
      ><form @submit.prevent="create">
        <label class="field"
          >项目名称<input
            v-model="createName"
            autofocus
            maxlength="200"
            placeholder="例如：窗边的龟背竹"
            required
        /></label>
        <div class="form-grid">
          <label class="field"
            >植物名称<span class="optional">可选</span
            ><input v-model="createPlant" maxlength="200" placeholder="品种或名称" /></label
          ><label class="field"
            >观察者<span class="optional">可选</span
            ><input v-model="createObserver" maxlength="200" placeholder="你的名字"
          /></label>
        </div>
        <p class="hint">创建后可随时修改，内容会自动保存在本机。</p>
        <div class="dialog-actions">
          <button type="button" class="btn" @click="createOpen = false">取消</button
          ><button class="btn primary" type="submit" :disabled="!createName.trim() || readOnly">
            创建项目
          </button>
        </div>
      </form></ElDialog
    >
    <ElDialog v-model="addOpen" title="添加观察记录" width="440px"
      ><form @submit.prevent="addRecord">
        <label class="field"
          >观察日期<input type="date" v-model="addDate" min="1900-01-01" max="2199-12-31" required
        /></label>
        <p class="hint">可以补录过去的日期。相同日期会打开已有记录，照片可继续添加。</p>
        <div class="dialog-actions">
          <button type="button" class="btn" @click="addOpen = false">取消</button
          ><button class="btn primary" type="submit">
            {{ project && duplicateDate(project, addDate) ? '打开已有记录' : '添加记录' }}
          </button>
        </div>
      </form></ElDialog
    >
    <ElDialog v-model="importOpen" title="确认导入内容" width="600px" :close-on-click-modal="false"
      ><template v-if="pendingImport"
        ><div class="import-result">
          <AppIcon :name="importType === 'editable' ? 'check' : 'file'" :size="30" />
          <h3>
            {{ importType === 'editable' ? '发现可编辑的项目数据' : '原 PDF 将作为保留页面导入' }}
          </h3>
          <p>
            {{ pendingImport.project.name }} ·
            {{ pendingImport.pageCount ? pendingImport.pageCount + ' 页 · ' : ''
            }}{{ pendingImport.project.records.length }} 条可编辑记录
          </p>
        </div>
        <p class="body-note">
          {{
            importType === 'editable'
              ? '照片、文字和模板将完整恢复。导入会创建一个副本，不会覆盖本机已有项目。'
              : '请先核对日期。原文中的所有日期都可能被识别，包括正文提及的日期；请移除不属于记录的日期。'
          }}
        </p>
        <template v-if="pendingImport.project.basePdf"
          ><label class="field"
            >已有记录日期<textarea
              v-model="identifiedDates"
              rows="4"
              placeholder="例如 2026-09-01, 2026-09-02；无法确定时可留空"
            />
          </label>
          <div class="notice">
            {{
              identifiedDates
                ? '仅对这些日期进行重复检查。'
                : '未识别到日期，无法自动判断原 PDF 是否已有相同记录。'
            }}
            原封面与历史内容会保持原样。
          </div></template
        >
        <p v-if="importError" class="error-text" role="alert">{{ importError }}</p></template
      ><template #footer
        ><button
          class="btn"
          @click="
            importOpen = false;
            pendingImport = null;
          "
        >
          取消</button
        ><button class="btn primary" @click="finishImport" :disabled="readOnly">
          导入并打开项目
        </button></template
      ></ElDialog
    >
    <ElDialog
      v-model="exportOpen"
      title="导出 PDF"
      width="min(1200px, 96vw)"
      class="export-dialog"
      :close-on-click-modal="false"
      :close-on-press-escape="!busy"
      :show-close="!busy"
      destroy-on-close
      ><div class="export-layout">
        <div class="export-settings">
          <label class="field">文件名称<input v-model="exportName" maxlength="100" /></label
          ><label class="field"
            >图片质量<select v-model="exportQuality" :disabled="busy" @change="exportResult = null">
              <option value="standard">高清 · 保留导入质量</option>
              <option value="compact">轻量 · 压缩图片</option>
            </select></label
          ><label class="check-label"
            ><input
              type="checkbox"
              v-model="includeProject"
              :disabled="busy"
              @change="exportResult = null"
            />附带可编辑项目</label
          >
          <p class="hint">
            包含照片、文字和原
            PDF，重新导入可继续编辑。回收站内容不会附带。分享给他人时，可取消此项以仅分享页面。
          </p>
          <button class="btn full" @click="prepareExport" :disabled="busy">
            {{ busy ? '正在生成…' : exportResult ? '重新生成预览' : '生成导出预览' }}
          </button>
          <p v-if="exportResult" class="export-size">
            {{ exportResult.pages.length }} 页 · {{ formatBytes(exportResult.bytes.length) }}
          </p>
          <div v-if="busy" role="status" class="export-progress">
            <progress :value="busyPercent" max="100" />
            <p>{{ busyLabel }}…</p>
          </div>
          <div class="notice">
            下载内容与右侧预览一致。日后新增记录可直接在当前项目中继续，无需反复导入 PDF。
          </div>
        </div>
        <div class="export-preview">
          <DocumentPreview v-if="exportResult" :result="exportResult" :editable="false" />
          <div v-else class="preview-placeholder">
            <AppIcon name="file" :size="36" />
            <p>{{ busy ? '正在生成最终 PDF…' : '生成预览后即可下载' }}</p>
          </div>
        </div>
      </div>
      <template #footer
        ><button class="btn" :disabled="busy" @click="exportOpen = false">返回编辑</button
        ><button
          class="btn primary"
          :disabled="busy || !exportResult || !exportName.trim()"
          @click="downloadExport"
        >
          <AppIcon name="download" :size="17" />下载 PDF
        </button></template
      ></ElDialog
    >
    <ElDialog v-model="helpOpen" title="使用生长手记" width="640px"
      ><div class="help-content">
        <h3>第一次使用</h3>
        <p>
          新建一个植物观察项目，添加照片与文字。右侧实时显示文档效果，点击文档中的内容可定位编辑项。
        </p>
        <h3>继续记录与补录</h3>
        <p>
          在项目中添加日期，记录会自动排序。同一天可添加多张照片。换图、改字后自动保存，无需点击保存按钮。
        </p>
        <h3>模板与封面</h3>
        <p>
          封面文案、设备信息、栏目和页脚都可自定义。模板支持字号、颜色、图片布局、模块顺序；可单独设置某一条记录。
        </p>
        <h3>已有 PDF</h3>
        <p>
          附带可编辑项目的新版 PDF 能恢复历史记录。旧版或外部 PDF
          保留原页面，再追加新内容；无法自动恢复其历史文字。加密文件需先解密。
        </p>
        <h3>保存与隐私</h3>
        <p>
          数据存储在当前浏览器，照片不会上传到服务器。清理网站数据、使用隐私窗口或更换浏览器可能失去本机记录。请定期下载项目备份，特别是在更新网站地址或更换设备之前。
        </p>
        <h3>容量与兼容性</h3>
        <p>
          照片：JPG、PNG、WebP，每张最多 20 MB、5000 万像素；导入时最长边缩至 2400 像素。同日最多 30
          图，每项目最多 1000 条记录；原 PDF 最多 50 MB、500 页；项目备份最多 150
          MB。建议使用较新版本的 Chrome、Edge、Firefox 或 Safari。
        </p>
        <p class="hint">
          PDF 使用开源 Noto CJK 字体。<a href="/fonts/OFL.txt" target="_blank" rel="noopener"
            >字体许可</a
          >
          · <a href="/fonts/OFL-Serif.txt" target="_blank" rel="noopener">宋体许可</a>
        </p>
      </div></ElDialog
    >
    <ElDialog v-model="storageOpen" title="本机存储与备份" width="500px"
      ><div class="storage-summary">
        <AppIcon name="shield" :size="30" />
        <h3>你的记录保存在这台设备</h3>
        <p>
          当前网站已用 {{ formatBytes(storage.usage || 0)
          }}{{ storage.quota ? ' / 可用配额 ' + formatBytes(storage.quota) : '' }}
        </p>
        <span class="badge">{{ storage.persisted ? '已启用持久存储' : '浏览器默认存储' }}</span>
      </div>
      <p class="body-note">
        持久存储可降低浏览器自动回收数据的可能性，但手动清理网站数据仍会删除记录。项目备份是独立的恢复副本。
      </p>
      <template #footer
        ><button v-if="!storage.persisted" class="btn" @click="persistStorage">申请持久存储</button
        ><button v-if="project" class="btn primary" @click="backup">下载当前项目备份</button
        ><button v-else class="btn primary" @click="storageOpen = false">知道了</button></template
      ></ElDialog
    >
    <div v-if="busy && !exportOpen" class="busy-overlay" role="status" aria-live="polite">
      <div>
        <span class="spinner" /><strong>{{ busyLabel }}</strong
        ><progress :value="busyPercent" max="100" /><span>文件只在本机处理，请稍候</span>
      </div>
    </div>
  </div>
</template>
