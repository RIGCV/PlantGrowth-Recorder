<script setup>
import { ref, computed } from 'vue';
import { ElDialog, ElMessage } from 'element-plus';
import { importPhoto, transformPhoto } from '../core/files.js';
import { moveItem } from '../core/model.js';
import AppIcon from './AppIcon.vue';
const props = defineProps({ photos: Array, single: Boolean });
const emit = defineEmits(['file-date', 'busy', 'change']);
const input = ref(),
  busy = ref(false),
  dragging = ref(false),
  cropPhoto = ref(null),
  cropIndex = ref(-1);
const crop = ref({ x: 0, y: 0, width: 100, height: 100 }),
  cropOpen = computed({
    get: () => !!cropPhoto.value,
    set: (v) => {
      if (!v) cropPhoto.value = null;
    },
  });
async function add(files) {
  if (busy.value) return;
  const list = [...files];
  if (!list.length) return;
  if (!props.single && props.photos.length + list.length > 30) {
    ElMessage.error('单条记录最多 30 张照片。');
    return;
  }
  busy.value = true;
  emit('busy', true);
  let count = 0;
  try {
    for (const file of props.single ? list.slice(0, 1) : list) {
      const photo = await importPhoto(file);
      if (props.single) props.photos.splice(0, props.photos.length, photo);
      else props.photos.push(photo);
      count++;
      emit('file-date', file.name);
      emit('change');
    }
    ElMessage.success(`已添加 ${count} 张照片`);
  } catch (e) {
    ElMessage.error(`${e.message}${count ? `（此前 ${count} 张已添加）` : ''}`);
  } finally {
    busy.value = false;
    emit('busy', false);
    if (input.value) input.value.value = '';
  }
}
async function rotate(i) {
  busy.value = true;
  emit('busy', true);
  try {
    props.photos.splice(i, 1, await transformPhoto(props.photos[i], 90));
    emit('change');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    busy.value = false;
    emit('busy', false);
  }
}
function openCrop(i) {
  cropIndex.value = i;
  cropPhoto.value = props.photos[i];
  crop.value = { x: 0, y: 0, width: 100, height: 100 };
}
function boundCrop() {
  crop.value.width = Math.min(crop.value.width, 100 - crop.value.x);
  crop.value.height = Math.min(crop.value.height, 100 - crop.value.y);
}
async function applyCrop() {
  busy.value = true;
  emit('busy', true);
  try {
    props.photos.splice(cropIndex.value, 1, await transformPhoto(cropPhoto.value, 0, crop.value));
    emit('change');
    cropPhoto.value = null;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    busy.value = false;
    emit('busy', false);
  }
}
</script>
<template>
  <input
    ref="input"
    class="sr-only"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    :multiple="!single"
    @change="add($event.target.files)"
    tabindex="-1"
    aria-label="选择照片"
  />
  <button
    type="button"
    class="photo-drop"
    :class="{ dragging }"
    :disabled="busy"
    @click="input.click()"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="
      dragging = false;
      add($event.dataTransfer.files);
    "
  >
    <AppIcon name="image" :size="26" /><span>{{
      busy ? '正在处理照片…' : single ? '选择或替换封面照片' : '添加照片'
    }}</span
    ><small>点击选择或拖入 · JPG / PNG / WebP · 每张 ≤ 20 MB</small>
  </button>
  <div class="photo-list">
    <article class="photo-item" v-for="(photo, i) in photos" :key="photo.id">
      <img :src="photo.data" :alt="photo.caption || photo.name" />
      <div class="photo-detail">
        <span class="filename" :title="photo.name">{{ photo.name }}</span
        ><input
          v-model="photo.caption"
          @input="emit('change')"
          aria-label="照片图注"
          placeholder="添加图注（可选）"
          maxlength="10000"
        />
        <div class="photo-actions">
          <button type="button" class="text-btn" :disabled="busy" @click="rotate(i)">
            <AppIcon name="rotate" :size="15" />旋转</button
          ><button type="button" class="text-btn" :disabled="busy" @click="openCrop(i)">
            <AppIcon name="crop" :size="15" />裁剪</button
          ><button
            type="button"
            class="icon-btn"
            :disabled="busy || i === 0"
            @click="
              moveItem(photos, i, -1);
              emit('change');
            "
            aria-label="上移照片"
          >
            <AppIcon name="up" :size="16" /></button
          ><button
            type="button"
            class="icon-btn"
            :disabled="busy || i === photos.length - 1"
            @click="
              moveItem(photos, i, 1);
              emit('change');
            "
            aria-label="下移照片"
          >
            <AppIcon name="down" :size="16" /></button
          ><button
            type="button"
            class="icon-btn danger"
            :disabled="busy"
            @click="
              photos.splice(i, 1);
              emit('change');
            "
            aria-label="移除照片"
          >
            <AppIcon name="trash" :size="16" />
          </button>
        </div>
      </div>
    </article>
  </div>
  <ElDialog
    v-model="cropOpen"
    title="裁剪照片"
    width="620px"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
  >
    <template v-if="cropPhoto"
      ><div class="crop-stage">
        <img :src="cropPhoto.data" alt="裁剪范围预览" />
        <div
          class="crop-selection"
          :style="{
            left: crop.x + '%',
            top: crop.y + '%',
            width: crop.width + '%',
            height: crop.height + '%',
          }"
        />
      </div>
      <div class="form-grid crop-controls">
        <label
          >左侧 {{ crop.x }}%<input
            type="range"
            v-model.number="crop.x"
            min="0"
            max="90"
            @input="boundCrop" /></label
        ><label
          >顶部 {{ crop.y }}%<input
            type="range"
            v-model.number="crop.y"
            min="0"
            max="90"
            @input="boundCrop" /></label
        ><label
          >宽度 {{ crop.width }}%<input
            type="range"
            v-model.number="crop.width"
            min="10"
            :max="100 - crop.x" /></label
        ><label
          >高度 {{ crop.height }}%<input
            type="range"
            v-model.number="crop.height"
            min="10"
            :max="100 - crop.y"
        /></label>
      </div>
      <p class="hint">高亮区域将被保留。裁剪后可通过编辑器的“撤销”恢复。</p></template
    >
    <template #footer
      ><button class="btn" :disabled="busy" @click="cropPhoto = null">取消</button
      ><button class="btn primary" :disabled="busy" @click="applyCrop">应用裁剪</button></template
    >
  </ElDialog>
</template>
