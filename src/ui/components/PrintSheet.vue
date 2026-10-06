<script setup lang="ts">
import { computed } from 'vue';
import { CHECK_STATUS_LABELS, checkProgress, statusOf } from '../../core/check-service';
import type { CheckSession, PackingItem, PackingPlan, Risk, Suitcase } from '../../core/models';

const props = defineProps<{ suitcase: Suitcase; items: PackingItem[]; plan: PackingPlan; risks: Risk[]; session?: CheckSession | null }>();

const positions = computed(() => new Map(props.plan.placements.map((placement, index) => [placement.itemId, index + 1])));
const summary = computed(() => (props.session ? checkProgress(props.session, props.plan, props.items) : null));
const finishedLabel = computed(() => (props.session?.finishedAt ? new Date(props.session.finishedAt).toLocaleString() : ''));
function statusText(itemId: string): string {
  if (!props.session) return '';
  return positions.value.has(itemId) ? CHECK_STATUS_LABELS[statusOf(props.session, itemId)] : '未装入';
}
</script>

<template>
  <section class="print-sheet">
    <h1>行李箱空间规划单</h1>
    <p>{{ suitcase.length }} × {{ suitcase.width }} × {{ suitcase.height }} cm · 限重 {{ suitcase.maxWeight }} kg</p>
    <h2>{{ plan.name }}</h2>
    <ol>
      <li v-for="item in items" :key="item.id">{{ positions.has(item.id) ? `□ 位 #${positions.get(item.id)}` : '× 未装入' }} {{ item.name }} — {{ item.weight }} kg<template v-if="session"> · 核对：{{ statusText(item.id) }}</template></li>
    </ol>
    <template v-if="session && summary">
      <h3>装箱核对</h3>
      <p>已放入 {{ summary.packedCount }}/{{ summary.plannedCount }} 件 · 临时取出 {{ summary.outCount }} 件 · 待准备 {{ summary.pendingCount }} 件</p>
      <p v-if="session.finishedAt">✓ 核对完成于 {{ finishedLabel }}</p>
      <p v-else-if="summary.missingMustHave.length">必带遗漏：{{ summary.missingMustHave.map((item) => item.name).join('、') }}</p>
    </template>
    <h3>风险提示</h3>
    <p v-for="risk in risks" :key="risk.id">{{ risk.title }}：{{ risk.message }}</p>
  </section>
</template>
