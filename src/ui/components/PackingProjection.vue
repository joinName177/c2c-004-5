<script setup lang="ts">
import { computed } from 'vue';
import type { CheckStatus, PackingItem, PackingPlan, Suitcase } from '../../core/models';
const props = defineProps<{ plan: PackingPlan; suitcase: Suitcase; items: PackingItem[]; view: 'top'|'side'; selectedId?: string; checks?: Record<string, CheckStatus> | null }>();
const emit = defineEmits<{ select: [id: string] }>();
const colors = ['#df6d45', '#507d68', '#d8a84e', '#5978a7', '#9d6a83', '#6d7d86'];
const itemIndex = computed(() => new Map(props.items.map((item, index) => [item.id, index])));
const STATUS_SYMBOLS: Record<CheckStatus, string> = { pending: '·', packed: '✓', removed: '↩' };
function styleFor(itemId: string, x: number, y: number, length: number, width: number) {
  const maxY = props.view === 'top' ? props.suitcase.width : props.suitcase.height;
  return { left: `${x / props.suitcase.length * 100}%`, top: `${y / maxY * 100}%`, width: `${length / props.suitcase.length * 100}%`, height: `${width / maxY * 100}%`, background: colors[(itemIndex.value.get(itemId) ?? 0) % colors.length] };
}
function statusOf(itemId: string): CheckStatus { return props.checks?.[itemId] ?? 'pending'; }
</script>

<template>
  <div class="projection-card">
    <header><span>{{ view === 'top' ? 'TOP VIEW' : 'SIDE VIEW' }}</span><b>{{ view === 'top' ? '俯视图' : '侧视图' }}</b></header>
    <div class="projection" :class="view">
      <button v-for="(placement, index) in plan.placements" :key="placement.itemId" type="button" :data-item-id="placement.itemId" :class="[{ selected: placement.itemId === selectedId }, checks ? `check-${statusOf(placement.itemId)}` : '']" :style="styleFor(placement.itemId, placement.x, view === 'top' ? placement.y : placement.z, placement.dimensions.length, view === 'top' ? placement.dimensions.width : placement.dimensions.height)" @click="emit('select', placement.itemId)"><span>{{ index + 1 }}</span><i v-if="checks" class="status-badge" :class="statusOf(placement.itemId)">{{ STATUS_SYMBOLS[statusOf(placement.itemId)] }}</i></button>
    </div>
    <p v-if="checks" class="projection-legend">✓ 已放入 · ↩ 临时取出 · · 待准备</p>
  </div>
</template>
