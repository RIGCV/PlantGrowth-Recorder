<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
const props = defineProps({
  document: Object,
  page: Number,
  scale: { default: 1.5 },
  lazy: Boolean,
});
const host = ref(),
  visible = ref(!props.lazy),
  error = ref('');
let observer,
  renderTask,
  version = 0;
async function render() {
  if (!visible.value || !host.value || !props.document) return;
  const current = ++version;
  error.value = '';
  renderTask?.cancel();
  try {
    const page = await props.document.getPage(props.page);
    if (current !== version) return;
    const viewport = page.getViewport({ scale: props.scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.setAttribute('aria-label', `PDF 第 ${props.page} 页`);
    canvas.setAttribute('role', 'img');
    renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
    await renderTask.promise;
    if (current === version && host.value) host.value.replaceChildren(canvas);
  } catch (e) {
    if (current === version && e.name !== 'RenderingCancelledException')
      error.value = '页面渲染失败，请刷新预览。';
  }
}
watch(() => [props.document, props.page, props.scale, visible.value], render);
onMounted(() => {
  if (props.lazy) {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          visible.value = true;
          observer.disconnect();
        }
      },
      { rootMargin: '150px' },
    );
    observer.observe(host.value);
  } else render();
});
onBeforeUnmount(() => {
  version++;
  renderTask?.cancel();
  observer?.disconnect();
});
</script>
<template>
  <div class="pdf-canvas-wrap">
    <div ref="host" class="pdf-canvas" />
    <p v-if="error" class="error-text">{{ error }}</p>
  </div>
</template>
