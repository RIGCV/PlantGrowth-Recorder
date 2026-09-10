<script setup>
import { uid, moveItem } from '../core/model.js';
import AppIcon from './AppIcon.vue';
defineProps({ fields: Array });
</script>
<template>
  <div class="custom-fields">
    <div class="custom-field" v-for="(field, i) in fields" :key="field.id">
      <div class="inline">
        <input
          v-model="field.label"
          aria-label="自定义字段名称"
          placeholder="字段名称，例如株高"
          maxlength="200"
        /><button
          type="button"
          class="icon-btn"
          :disabled="i === 0"
          @click="moveItem(fields, i, -1)"
          aria-label="上移字段"
        >
          <AppIcon name="up" :size="16" /></button
        ><button type="button" class="icon-btn" @click="fields.splice(i, 1)" aria-label="移除字段">
          <AppIcon name="close" :size="16" />
        </button>
      </div>
      <textarea
        v-model="field.value"
        aria-label="自定义字段内容"
        placeholder="填写内容"
        rows="2"
        maxlength="50000"
      />
    </div>
    <button
      type="button"
      class="text-btn"
      :disabled="fields.length >= 50"
      @click="fields.push({ id: uid(), label: '', value: '' })"
    >
      <AppIcon name="plus" :size="16" />添加自定义字段
    </button>
  </div>
</template>
