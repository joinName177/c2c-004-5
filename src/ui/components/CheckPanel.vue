<script setup lang="ts">
import { computed } from 'vue';
import { CHECK_STATUS_LABELS, type CheckSummary, type ReconcileReport } from '../../core/check-service';
import type { CheckSession, CheckStatus, PackingItem, PackingPlan } from '../../core/models';

const props = defineProps<{
  session: CheckSession | null;
  items: PackingItem[];
  plan: PackingPlan;
  summary: CheckSummary | null;
  report: ReconcileReport | null;
  isStale: boolean;
}>();
const emit = defineEmits<{
  start: [];
  cancel: [];
  setStatus: [id: string, status: CheckStatus];
  complete: [];
  dismissReport: [];
}>();

const STATUS_ORDER: CheckStatus[] = ['pending', 'packed', 'removed'];
const statusLabel = (status: CheckStatus) => CHECK_STATUS_LABELS[status];

const rows = computed(() => {
  if (!props.session) return [];
  const statusById = new Map(props.session.entries.map((entry) => [entry.itemId, entry.status]));
  const positionById = new Map(props.plan.placements.map((placement, index) => [placement.itemId, index + 1]));
  return props.items
    .map((item) => {
      const position = positionById.get(item.id);
      return {
        item,
        status: statusById.get(item.id) ?? ('pending' as CheckStatus),
        placed: position !== undefined,
        position: position !== undefined ? `#${position}` : '未装入',
      };
    })
    .sort((a, b) => Number(b.placed) - Number(a.placed) || (a.placed && b.placed ? Number(a.position.slice(1)) - Number(b.position.slice(1)) : 0));
});

const blockers = computed(() => {
  if (!props.session || !props.summary || props.session.completed) return '';
  const parts: string[] = [];
  if (props.isStale) parts.push('方案待更新，请先重新计算');
  if (props.summary.missingMustHave.length) parts.push(`必带未放入：${props.summary.missingMustHave.map((item) => item.name).join('、')}`);
  if (props.summary.pending > 0) parts.push(`待准备 ${props.summary.pending} 件`);
  return parts.join(' · ');
});

const canDeclare = computed(() => Boolean(props.session && props.summary?.canComplete && !props.isStale && !props.session.completed));
</script>

<template>
  <section class="panel check-panel" data-testid="check-panel">
    <div class="section-title">
      <div><span>04 / PRE-DEPARTURE CHECK</span><h2>出发前实际装箱核对</h2></div>
      <b v-if="session && summary">{{ summary.packed }}/{{ summary.total }} 已放入</b>
    </div>

    <div v-if="!session" class="check-intro">
      <p>图上装得下，不代表东西已经放进箱子。确认当前方案后，在这里逐项记录真实装箱状态。</p>
      <button type="button" class="primary" data-testid="start-check" :disabled="isStale" @click="emit('start')">开始出发前核对</button>
      <p v-if="isStale" class="check-hint">方案待更新，请先点击「智能装箱」重新计算。</p>
    </div>

    <template v-else>
      <div v-if="report" class="check-report" data-testid="check-report">
        <header><strong>物品或方案已变更，旧核对结果逐项复核</strong><button type="button" aria-label="关闭复核结果" @click="emit('dismissReport')">×</button></header>
        <p v-if="report.kept.length" class="kept">沿用 {{ report.kept.length }} 项：{{ report.kept.map((entry) => `${entry.name}（${statusLabel(entry.status)}）`).join('、') }}</p>
        <p v-if="report.invalidated.length" class="invalid">需重新确认：{{ report.invalidated.map((entry) => `${entry.name}（${entry.reason}）`).join('、') }}</p>
        <p v-if="report.dropped.length" class="dropped">已移除物品：{{ report.dropped.map((entry) => entry.name).join('、') }}</p>
        <p v-if="report.added.length" class="added">新加入待准备：{{ report.added.map((entry) => entry.name).join('、') }}</p>
      </div>

      <div class="check-progress" data-testid="check-progress">
        <span><b>{{ summary?.packed }}</b>已放入</span>
        <span><b>{{ summary?.removed }}</b>临时取出</span>
        <span><b>{{ summary?.pending }}</b>待准备</span>
      </div>

      <ul class="check-list">
        <li v-for="row in rows" :key="row.item.id" :data-check-item="row.item.id" :class="[row.status, { missing: row.item.mustHave && row.status !== 'packed' }]">
          <span class="check-pos" :class="{ unplaced: !row.placed }">{{ row.position }}</span>
          <div class="check-copy"><strong>{{ row.item.name }}</strong><span>{{ row.item.mustHave ? '必带' : '可选' }} · {{ row.item.weight }} kg</span></div>
          <div class="check-actions">
            <button
              v-for="status in STATUS_ORDER"
              :key="status"
              type="button"
              :class="{ active: row.status === status }"
              :disabled="status === 'packed' && !row.placed"
              :data-testid="`check-${status}-${row.item.id}`"
              @click="emit('setStatus', row.item.id, status)"
            >{{ statusLabel(status) }}</button>
          </div>
        </li>
      </ul>

      <footer class="check-footer">
        <p v-if="session.completed" class="check-done" data-testid="check-done">✓ 全部装箱完成，可以安心出发</p>
        <p v-else-if="blockers" class="check-blockers" data-testid="check-blockers">{{ blockers }}</p>
        <div class="check-footer-actions">
          <button type="button" class="primary" data-testid="complete-check" :disabled="!canDeclare" @click="emit('complete')">宣布全部完成</button>
          <button type="button" data-testid="cancel-check" @click="emit('cancel')">放弃核对</button>
        </div>
      </footer>
    </template>
  </section>
</template>
