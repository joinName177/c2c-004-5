<script setup lang="ts">
import { computed } from 'vue';
import { CHECK_STATUS_LABELS, statusOf } from '../../core/check-service';
import type { CheckSession, PackingItem } from '../../core/models';

const props = defineProps<{ items: PackingItem[]; session?: CheckSession | null; placedIds?: string[] }>();
const emit = defineEmits<{ remove: [id: string]; toggle: [id: string, mustHave: boolean] }>();

const positions = computed(() => new Map((props.placedIds ?? []).map((id, index) => [id, index + 1])));
function badge(itemId: string): string {
  if (!props.session) return '';
  return positions.value.has(itemId) ? CHECK_STATUS_LABELS[statusOf(props.session, itemId)] : '未装入';
}
function badgeClass(itemId: string): string {
  if (!props.session) return '';
  return positions.value.has(itemId) ? statusOf(props.session, itemId) : 'unplaced';
}
</script>

<template>
  <div class="item-list">
    <article v-for="item in items" :key="item.id" class="item-row">
      <div class="item-icon">{{ item.category.slice(0, 1) }}</div>
      <div class="item-copy">
        <strong>{{ item.name }}<em v-if="session" class="check-badge" :class="badgeClass(item.id)">{{ badge(item.id) }}</em></strong>
        <span>{{ item.length }}×{{ item.width }}×{{ item.height }} cm · {{ item.weight }} kg<template v-if="session && positions.has(item.id)"> · 位 #{{ positions.get(item.id) }}</template></span>
      </div>
      <button class="must-button" :class="{ checked: item.mustHave }" type="button" @click="emit('toggle', item.id, !item.mustHave)">{{ item.mustHave ? '必带' : '可选' }}</button>
      <b class="priority">P{{ item.priority }}</b>
      <button class="icon-button" type="button" :aria-label="`删除 ${item.name}`" @click="emit('remove', item.id)">×</button>
    </article>
  </div>
</template>
