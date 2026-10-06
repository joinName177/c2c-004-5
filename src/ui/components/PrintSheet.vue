<script setup lang="ts">
import { computed } from 'vue';
import { CHECK_STATUS_LABELS } from '../../core/check-service';
import type { CheckStatus, PackingItem, PackingPlan, Risk, Suitcase } from '../../core/models';

const props = defineProps<{ suitcase: Suitcase; items: PackingItem[]; plan: PackingPlan; risks: Risk[]; checks?: Record<string, CheckStatus> | null; checkCompleted?: boolean }>();

const positionById = computed(() => new Map(props.plan.placements.map((placement, index) => [placement.itemId, index + 1])));
const checkCounts = computed(() => {
  if (!props.checks) return null;
  const counts: Record<CheckStatus, number> = { pending: 0, packed: 0, removed: 0 };
  for (const item of props.items) counts[props.checks[item.id] ?? 'pending'] += 1;
  return counts;
});
</script>

<template><section class="print-sheet"><h1>行李箱空间规划单</h1><p>{{ suitcase.length }} × {{ suitcase.width }} × {{ suitcase.height }} cm · 限重 {{ suitcase.maxWeight }} kg</p><h2>{{ plan.name }}</h2><p v-if="checkCounts" class="print-check-summary">实际装箱核对：已放入 {{ checkCounts.packed }} 件 · 临时取出 {{ checkCounts.removed }} 件 · 待准备 {{ checkCounts.pending }} 件{{ checkCompleted ? ' · 已全部完成' : '' }}</p><ol><li v-for="item in items" :key="item.id">{{ positionById.has(item.id) ? `□ 规划位 #${positionById.get(item.id)}` : '× 未装入' }} {{ item.name }} — {{ item.weight }} kg<template v-if="checks"> · {{ CHECK_STATUS_LABELS[checks[item.id] ?? 'pending'] }}</template></li></ol><h3>风险提示</h3><p v-for="risk in risks" :key="risk.id">{{ risk.title }}：{{ risk.message }}</p></section></template>
