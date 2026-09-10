<script setup>
import { ref, shallowRef, watch, onBeforeUnmount, computed } from 'vue';
import { generatePdf } from '../core/pdfClient.js';
import { loadPdf } from '../core/pdfjs.js';
import { clone } from '../core/model.js';
import PdfCanvas from './PdfCanvas.vue';
import AppIcon from './AppIcon.vue';
const props = defineProps({
  project: Object,
  target: String,
  result: Object,
  editable: { default: true },
});
const emit = defineEmits(['select', 'ready']);
const pdf = shallowRef(),
  pages = ref([]),
  selected = ref(1),
  busy = ref(false),
  progress = ref('准备预览'),
  percent = ref(0),
  error = ref(''),
  warnings = ref([]),
  zoom = ref('fit'),
  clickEdit = ref(true);
let timer,
  running = false,
  revision = 0,
  disposed = false;
const active = computed(() => pages.value[selected.value - 1]);
async function show(result, current) {
  const next = await loadPdf(result.bytes);
  if (disposed || current !== revision) {
    await next.loadingTask.destroy();
    return;
  }
  const old = pdf.value;
  pdf.value = next;
  pages.value = result.pages;
  warnings.value = result.warnings || [];
  selected.value = Math.min(Math.max(1, selected.value), pages.value.length);
  locate();
  emit('ready', { pages: pages.value.length, warnings: warnings.value });
  // Old canvases cancel on prop change before their PDF is released.
  setTimeout(() => old?.loadingTask.destroy(), 100);
}
async function build() {
  if (running || disposed || (!props.project && !props.result)) return;
  running = true;
  busy.value = true;
  const current = revision;
  error.value = '';
  try {
    const result =
      props.result ||
      (await generatePdf(clone(props.project), {}, (p) => {
        progress.value = p.message;
        percent.value = p.percent;
      }));
    if (current === revision) await show(result, current);
  } catch (e) {
    if (current === revision) error.value = e.message;
  } finally {
    running = false;
    if (current !== revision && !disposed) {
      build();
    } else busy.value = false;
  }
}
function schedule() {
  revision++;
  busy.value = true;
  clearTimeout(timer);
  timer = setTimeout(build, 650);
}
function locate() {
  const index = pages.value.findIndex((p) =>
    props.target === 'cover'
      ? p.kind === 'cover'
      : props.target === 'original'
        ? p.kind === 'original'
        : p.recordId === props.target,
  );
  if (index >= 0) selected.value = index + 1;
}
watch(() => props.project, schedule, { deep: true, immediate: true });
watch(() => props.result, schedule);
watch(() => props.target, locate);
function selectPage(n) {
  selected.value = n;
}
function choose(field) {
  if (!props.editable) return;
  emit('select', { recordId: active.value?.recordId, kind: active.value?.kind, field });
}
onBeforeUnmount(() => {
  disposed = true;
  revision++;
  clearTimeout(timer);
  pdf.value?.loadingTask.destroy();
});
</script>
<template>
  <section class="document-preview" aria-label="PDF 实时预览">
    <div class="preview-toolbar">
      <div class="inline">
        <span class="status-dot" :class="{ pending: busy }" /><strong>{{
          result ? '导出预览' : '实时预览'
        }}</strong
        ><span class="muted preview-count">{{ pages.length }} 页</span>
      </div>
      <div class="inline">
        <select v-model="zoom" aria-label="预览缩放">
          <option value="fit">适合宽度</option>
          <option value="0.75">75%</option>
          <option value="1">100%</option>
          <option value="1.25">125%</option></select
        ><button class="icon-btn" @click="schedule" :disabled="busy" aria-label="刷新预览">
          <AppIcon name="rotate" :size="17" />
        </button>
      </div>
    </div>
    <div v-if="busy" class="preview-progress" role="status">
      <div :style="{ width: percent + '%' }" />
      <span>{{ progress }}…</span>
    </div>
    <div v-if="error" class="preview-error" role="alert">
      <AppIcon name="file" :size="30" />
      <p>{{ error }}</p>
      <button class="btn" @click="schedule">重试预览</button>
    </div>
    <div v-else class="preview-body">
      <nav class="page-rail" aria-label="文档页面">
        <button
          v-for="(item, i) in pages"
          :key="i"
          class="page-thumb"
          :class="{ active: selected === i + 1 }"
          @click="selectPage(i + 1)"
          :aria-label="`查看第 ${i + 1} 页：${item.label}`"
          :aria-current="selected === i + 1 ? 'page' : undefined"
        >
          <PdfCanvas v-if="pdf" :document="pdf" :page="i + 1" :scale="0.16" lazy /><span
            >{{ i + 1 }} ·
            {{ item.kind === 'original' ? '原文' : item.kind === 'cover' ? '封面' : '记录' }}</span
          >
        </button>
      </nav>
      <div class="paper-stage">
        <div v-if="!pdf" class="preview-placeholder">
          <AppIcon name="file" :size="38" />
          <p>正在准备文档</p>
          <span>首次加载中文字体可能需要几秒</span>
        </div>
        <div
          v-else
          class="paper"
          :style="{ width: zoom === 'fit' ? 'min(100%, 680px)' : 595.28 * Number(zoom) + 'px' }"
        >
          <PdfCanvas :document="pdf" :page="selected" :scale="1.7" />
          <div v-if="editable && clickEdit && !busy" class="edit-regions">
            <button
              v-for="(region, i) in active?.regions || []"
              :key="i"
              :style="{
                left: (region.x / 595.28) * 100 + '%',
                top: (region.y / 841.89) * 100 + '%',
                width: (region.width / 595.28) * 100 + '%',
                height: (region.height / 841.89) * 100 + '%',
              }"
              @click="choose(region.field)"
              :aria-label="`编辑${region.field}`"
              title="点击编辑此处"
            />
          </div>
        </div>
      </div>
    </div>
    <div v-if="warnings.length" class="preview-warning" role="status">{{ warnings.join(' ') }}</div>
    <div class="preview-footer">
      <span>{{
        active?.kind === 'original'
          ? '原始页面 · 保持原样'
          : editable
            ? '点击文档内容，定位到对应编辑项'
            : '请核对内容与分页后下载'
      }}</span>
      <div class="inline">
        <button class="icon-btn" :disabled="selected <= 1" @click="selected--" aria-label="上一页">
          <AppIcon name="back" :size="15" /></button
        ><span>{{ pages.length ? selected : 0 }} / {{ pages.length }}</span
        ><button
          class="icon-btn"
          :disabled="selected >= pages.length"
          @click="selected++"
          aria-label="下一页"
        >
          <AppIcon name="arrow" :size="15" />
        </button>
      </div>
    </div>
  </section>
</template>
