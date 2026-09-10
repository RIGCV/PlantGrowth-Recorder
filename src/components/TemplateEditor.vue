<script setup>
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { PRESETS, makeTemplate, clone, uid } from '../core/model.js';
import { saveTemplate, listTemplates } from '../core/storage.js';
import ModuleOrder from './ModuleOrder.vue';
import AppIcon from './AppIcon.vue';
const props = defineProps({ template: Object, personal: Array, scope: String });
const emit = defineEmits(['replace', 'templates-changed']);
async function savePersonal() {
  try {
    const { value } = await ElMessageBox.prompt(
      '为这套模板命名，下次可直接使用。',
      '保存个人模板',
      {
        inputPlaceholder: '例如：阳台观察',
        inputValidator: (v) => (!!v?.trim() && v.length <= 50) || '请输入 1—50 个字符',
        confirmButtonText: '保存',
        cancelButtonText: '取消',
      },
    );
    await saveTemplate({ id: uid(), name: value.trim(), template: clone(props.template) });
    emit('templates-changed', await listTemplates());
    ElMessage.success('个人模板已保存');
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message);
  }
}
async function preset(item) {
  try {
    await ElMessageBox.confirm(
      '将替换当前作用范围的样式与模块设置，记录文字和照片会保留。',
      '应用模板',
      { confirmButtonText: '应用', cancelButtonText: '取消' },
    );
    emit('replace', makeTemplate(item));
  } catch {}
}
</script>
<template>
  <section class="editor-section">
    <div class="section-heading">
      <h3>选择模板</h3>
      <span class="hint">{{ scope === 'record' ? '仅当前记录' : '整个项目' }}</span>
    </div>
    <div class="template-options">
      <button
        v-for="item in PRESETS"
        :key="item.id"
        class="template-option"
        :class="{ selected: template.id === item.id }"
        @click="preset(item)"
      >
        <span class="mini-document" :style="{ '--mini-accent': item.accent }"
          ><i /><i /><i /><i /></span
        ><span>{{ item.name }}</span>
      </button>
    </div>
    <label v-if="personal.length" class="field"
      >个人模板<select
        @change="
          emit('replace', clone(personal.find((p) => p.id === $event.target.value).template));
          $event.target.value = '';
        "
        aria-label="选择个人模板"
      >
        <option value="">选择已保存的模板</option>
        <option v-for="item in personal" :value="item.id">{{ item.name }}</option>
      </select></label
    >
  </section>
  <section class="editor-section">
    <h3>字体与颜色</h3>
    <div class="form-grid">
      <label class="field"
        >字体<select v-model="template.font">
          <option value="sans">思源风格 · 黑体</option>
          <option value="serif">书面风格 · 宋体</option>
        </select></label
      ><label class="field"
        >正文字号<input type="number" v-model.number="template.fontSize" min="9" max="20" /></label
      ><label class="field"
        >标题字号<input
          type="number"
          v-model.number="template.titleSize"
          min="18"
          max="40" /></label
      ><label class="field"
        >行距<input
          type="number"
          v-model.number="template.lineHeight"
          min="1.2"
          max="2.5"
          step=".1" /></label
      ><label class="field"
        >主题颜色
        <div class="color-control">
          <input type="color" v-model="template.accent" /><span>{{ template.accent }}</span>
        </div></label
      ><label class="field"
        >文字颜色
        <div class="color-control">
          <input type="color" v-model="template.textColor" /><span>{{ template.textColor }}</span>
        </div></label
      >
    </div>
  </section>
  <section class="editor-section">
    <h3>页面与照片</h3>
    <div class="form-grid">
      <label class="field"
        >页边距（pt）<input
          type="number"
          v-model.number="template.margin"
          min="28"
          max="80" /></label
      ><label class="field"
        >模块间距（pt）<input type="number" v-model.number="template.gap" min="8" max="40" /></label
      ><label class="field"
        >图片区域高度（pt）<input
          type="number"
          v-model.number="template.imageHeight"
          min="120"
          max="420" /></label
      ><label class="field"
        >图片布局<select v-model.number="template.columns">
          <option :value="1">每行一张</option>
          <option :value="2">每行两张</option>
        </select></label
      >
    </div>
    <label class="check-label"
      ><input type="checkbox" v-model="template.border" />显示图片边框</label
    >
  </section>
  <section class="editor-section">
    <h3>栏目文案</h3>
    <p class="hint">清空可隐藏标题。日期等自动内容可使用下方变量。</p>
    <label class="field"
      >记录页默认标题<input v-model="template.dailyTitle" maxlength="500"
    /></label>
    <div class="form-grid">
      <label class="field">照片栏目<input v-model="template.photosLabel" maxlength="500" /></label
      ><label class="field"
        >描述栏目<input v-model="template.descriptionLabel" maxlength="500"
      /></label>
    </div>
    <label class="field"
      >拍摄信息栏目<input v-model="template.deviceLabel" maxlength="500"
    /></label>
  </section>
  <section class="editor-section">
    <h3>页眉与页脚</h3>
    <label class="check-label"
      ><input type="checkbox" v-model="template.showHeader" />显示页眉</label
    ><label class="field"
      ><span class="sr-only">页眉内容</span
      ><input v-model="template.header" maxlength="200" placeholder="页眉内容" /></label
    ><label class="check-label"
      ><input type="checkbox" v-model="template.showFooter" />显示页脚</label
    ><label class="field"
      ><span class="sr-only">页脚内容</span
      ><input v-model="template.footer" maxlength="200" placeholder="页脚内容" /></label
    ><label class="check-label"
      ><input type="checkbox" v-model="template.pageNumbers" />显示页码</label
    ><label class="field"
      ><span class="sr-only">页码格式</span
      ><input v-model="template.pageNumberText" maxlength="100"
    /></label>
    <p class="token-hint">
      可用变量：{project} 项目名 · {plant} 植物 · {observer} 观察者 · {date} 日期 · {page} 页码 ·
      {first} / {last} 起止日期
    </p>
  </section>
  <section class="editor-section">
    <h3>记录页模块</h3>
    <p class="hint">调整顺序，或隐藏不需要的模块。隐藏不会删除内容。</p>
    <ModuleOrder :modules="template.modules" />
  </section>
  <div class="editor-section">
    <button class="btn full" @click="savePersonal">
      <AppIcon name="archive" :size="17" />保存为个人模板
    </button>
  </div>
</template>
