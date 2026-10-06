<script setup lang="ts">
import { computed } from 'vue';
import { CHECK_STATUS_LABELS, checkProgress, statusOf, type Reconciliation } from '../../core/check-service';
import type { CheckSession, CheckStatus, PackingItem, PackingPlan, Placement } from '../../core/models';

const props = defineProps<{
  session: CheckSession | null;
  plan: PackingPlan;
  items: PackingItem[];
  reconciliation: Reconciliation | null;
  stale: boolean;
}>();
const emit = defineEmits<{
  (e: 'start'): void;
  (e: 'set-status', itemId: string, status: CheckStatus): void;
  (e: 'apply'): void;
  (e: 'finish'): void;
  (e: 'cancel'): void;
}>();

interface PlacedRow { item: PackingItem; placement: Placement; position: number; status: CheckStatus }

const labels = CHECK_STATUS_LABELS;
const byId = computed(() => new Map(props.items.map((item) => [item.id, item])));
const placedRows = computed<PlacedRow[]>(() => props.plan.placements.flatMap((placement, index) => {
  const item = byId.value.get(placement.itemId);
  return item ? [{ item, placement, position: index + 1, status: statusOf(props.session, item.id) }] : [];
}));
const summary = computed(() => (props.session ? checkProgress(props.session, props.plan, props.items) : null));
const packedPercent = computed(() => {
  const value = summary.value;
  return value && value.plannedCount ? (value.packedCount / value.plannedCount) * 100 : 0;
});
const finishedLabel = computed(() => (props.session?.finishedAt ? new Date(props.session.finishedAt).toLocaleString() : ''));
</script>

<template>
  <section class="panel check-panel" data-testid="check-panel">
    <div class="section-title">
      <div><span>04 / DEPARTURE CHECK</span><h2>出发前装箱核对</h2></div>
      <b v-if="summary">{{ summary.packedCount }}/{{ summary.plannedCount }} 已放入</b>
      <b v-else>未开始</b>
    </div>

    <div v-if="!session" class="check-intro">
      <p>图上装得下，不代表东西已经放进箱子。确认「{{ plan.name }}」后，逐项核对实际装箱。</p>
      <button type="button" class="primary" data-testid="start-check" :disabled="stale" @click="emit('start')">开始核对</button>
      <p v-if="stale" class="check-hint">方案待更新，请先重新计算。</p>
    </div>

    <template v-else>
      <div v-if="reconciliation" class="reconcile-box" data-testid="reconcile-box">
        <p class="reconcile-title">方案已变更，请确认旧核对结果的沿用范围：</p>
        <ul class="reconcile-list">
          <li v-for="entry in reconciliation.kept" :key="`kept-${entry.itemId}`" class="kept">
            <strong>{{ entry.name }}</strong><span>未变动，保留「{{ labels[entry.status] }}」</span>
          </li>
          <li v-for="entry in reconciliation.changed" :key="`changed-${entry.itemId}`" class="changed">
            <strong>{{ entry.name }}</strong><span>尺寸或位置已变，原为「{{ labels[entry.status] }}」，需重新确认</span>
          </li>
          <li v-for="entry in reconciliation.removed" :key="`removed-${entry.itemId}`" class="removed">
            <strong>{{ entry.name }}</strong><span>不再装入，移除「{{ labels[entry.status] }}」记录</span>
          </li>
          <li v-for="entry in reconciliation.added" :key="`added-${entry.itemId}`" class="added">
            <strong>{{ entry.name }}</strong><span>新装入，记为待准备</span>
          </li>
        </ul>
        <button type="button" class="primary" data-testid="apply-reconcile" @click="emit('apply')">按当前方案继续核对</button>
      </div>

      <template v-else>
        <div class="check-progress">
          <div class="check-bar"><i :style="{ width: `${packedPercent}%` }"></i></div>
          <div class="check-counts">
            <span data-testid="count-packed">已放入 <b>{{ summary?.packedCount }}</b></span>
            <span>临时取出 <b>{{ summary?.outCount }}</b></span>
            <span>待准备 <b>{{ summary?.pendingCount }}</b></span>
          </div>
        </div>

        <p v-if="session.finishedAt" class="check-done">✓ 已于 {{ finishedLabel }} 完成全部核对</p>
        <p v-else-if="summary && summary.missingMustHave.length" class="check-warning">必带遗漏：{{ summary.missingMustHave.map((item) => item.name).join('、') }} 未放入，无法宣布完成。</p>

        <ul class="check-list">
          <li v-for="row in placedRows" :key="row.item.id" class="check-row" :data-status="row.status">
            <span class="check-pos">#{{ row.position }}</span>
            <div class="check-copy">
              <strong>{{ row.item.name }}</strong>
              <span>{{ row.item.length }}×{{ row.item.width }}×{{ row.item.height }} cm · {{ row.item.weight }} kg<template v-if="row.item.mustHave"> · 必带</template></span>
            </div>
            <div class="check-actions">
              <button type="button" class="btn-pending" :class="{ active: row.status === 'pending' }" :data-testid="`check-pending-${row.item.id}`" @click="emit('set-status', row.item.id, 'pending')">待准备</button>
              <button type="button" class="btn-packed" :class="{ active: row.status === 'packed' }" :data-testid="`check-packed-${row.item.id}`" @click="emit('set-status', row.item.id, 'packed')">已放入</button>
              <button type="button" class="btn-out" :class="{ active: row.status === 'out' }" :data-testid="`check-out-${row.item.id}`" @click="emit('set-status', row.item.id, 'out')">临时取出</button>
            </div>
          </li>
          <li v-for="entry in plan.unplaced" :key="`unplaced-${entry.item.id}`" class="check-row unplaced">
            <span class="check-pos">×</span>
            <div class="check-copy">
              <strong>{{ entry.item.name }}</strong>
              <span>未装入当前方案 · {{ entry.reason }}<template v-if="entry.item.mustHave"> · 必带</template></span>
            </div>
            <span class="check-unplaced-tag">不能记为已放入</span>
          </li>
        </ul>

        <footer class="check-footer">
          <button type="button" class="primary" data-testid="finish-check" :disabled="Boolean(session.finishedAt)" @click="emit('finish')">宣布全部完成</button>
          <button type="button" data-testid="cancel-check" @click="emit('cancel')">结束核对</button>
        </footer>
      </template>
    </template>
  </section>
</template>
