<script setup>
import { moveItem } from '../core/model.js';
import AppIcon from './AppIcon.vue';
defineProps({ modules: Array });
</script>
<template>
  <div class="module-list">
    <div v-for="(module, i) in modules" :key="module.key" class="module-row">
      <label class="check-label"
        ><input type="checkbox" v-model="module.visible" />{{ module.label }}</label
      >
      <div class="inline">
        <button
          type="button"
          class="icon-btn"
          :disabled="i === 0"
          @click="moveItem(modules, i, -1)"
          :aria-label="`上移${module.label}`"
        >
          <AppIcon name="up" :size="16" /></button
        ><button
          type="button"
          class="icon-btn"
          :disabled="i === modules.length - 1"
          @click="moveItem(modules, i, 1)"
          :aria-label="`下移${module.label}`"
        >
          <AppIcon name="down" :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>
