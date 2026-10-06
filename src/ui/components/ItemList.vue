<script setup lang="ts">
import { reactive, ref } from 'vue';
import { CHECK_STATUS_LABELS } from '../../core/check-service';
import type { CheckStatus, PackingItem } from '../../core/models';

const props = defineProps<{ items: PackingItem[]; checks?: Record<string, CheckStatus> | null }>();
const emit = defineEmits<{ remove: [id: string]; toggle: [id: string, mustHave: boolean]; update: [id: string, patch: Partial<PackingItem>] }>();

const editingId = ref('');
const draft = reactive({ length: 0, width: 0, height: 0, weight: 0 });

function startEdit(item: PackingItem) {
  editingId.value = item.id;
  Object.assign(draft, { length: item.length, width: item.width, height: item.height, weight: item.weight });
}
function saveEdit() {
  emit('update', editingId.value, { ...draft });
  editingId.value = '';
}
</script>

<template>
  <div class="item-list">
    <article v-for="item in props.items" :key="item.id" class="item-row">
      <div class="item-icon">{{ item.category.slice(0, 1) }}</div>
      <div class="item-copy">
        <strong>{{ item.name }}<span v-if="checks" class="check-chip" :class="checks[item.id] ?? 'pending'" :data-testid="`chip-${item.id}`">{{ CHECK_STATUS_LABELS[checks[item.id] ?? 'pending'] }}</span></strong>
        <span>{{ item.length }}×{{ item.width }}×{{ item.height }} cm · {{ item.weight }} kg</span>
      </div>
      <button class="must-button" :class="{ checked: item.mustHave }" type="button" @click="emit('toggle', item.id, !item.mustHave)">{{ item.mustHave ? '必带' : '可选' }}</button>
      <b class="priority">P{{ item.priority }}</b>
      <button class="icon-button edit-button" type="button" :aria-label="`编辑 ${item.name}`" @click="startEdit(item)">✎</button>
      <button class="icon-button" type="button" :aria-label="`删除 ${item.name}`" @click="emit('remove', item.id)">×</button>
      <form v-if="editingId === item.id" class="item-edit" :data-testid="`edit-${item.id}`" @submit.prevent="saveEdit">
        <label>长<input v-model.number="draft.length" type="number" min="1" step="0.5" aria-label="编辑长度" /></label>
        <label>宽<input v-model.number="draft.width" type="number" min="1" step="0.5" aria-label="编辑宽度" /></label>
        <label>高<input v-model.number="draft.height" type="number" min="1" step="0.5" aria-label="编辑高度" /></label>
        <label>重量<input v-model.number="draft.weight" type="number" min="0.1" step="0.1" aria-label="编辑重量" /></label>
        <button type="submit" :data-testid="`save-${item.id}`">保存</button>
        <button type="button" @click="editingId = ''">取消</button>
      </form>
    </article>
  </div>
</template>
