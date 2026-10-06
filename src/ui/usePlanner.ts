import { computed, reactive, ref } from 'vue';
import { createSampleSnapshot } from '../core/sample-data';
import { generatePlans } from '../core/plan-service';
import { detectRisks } from '../core/risk-engine';
import {
  applyReconciliation,
  checkProgress,
  hasReconciliationChanges,
  reconcileSession,
  setItemStatus,
  startCheckSession,
} from '../core/check-service';
import type { CheckStatus, PackingItem, PackingSnapshot, PlanMode, Suitcase } from '../core/models';
import type { PlannerRepository } from '../ports/planner-repository.port';
import type { PrintPort } from '../ports/print.port';

export interface PlannerDependencies { repository: PlannerRepository; printPort: PrintPort }

export function usePlanner({ repository, printPort }: PlannerDependencies) {
  const loaded = repository.load();
  const state = reactive<PackingSnapshot>(loaded.value);
  const notice = ref(loaded.warning ?? '');
  const isStale = ref(false);
  const plans = ref(generatePlans(state.suitcase, state.items));
  const currentPlan = computed(() => plans.value[state.selectedPlan]);
  const risks = computed(() => detectRisks(currentPlan.value, state.suitcase, state.items));

  const save = () => repository.save(JSON.parse(JSON.stringify(state)) as PackingSnapshot);
  const markStale = () => { isStale.value = true; save(); };

  function addItem(item: PackingItem) { state.items.push(item); markStale(); }
  function updateItem(id: string, patch: Partial<PackingItem>) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index >= 0) state.items[index] = { ...state.items[index], ...patch } as PackingItem;
    markStale();
  }
  function removeItem(id: string) { state.items = state.items.filter((item) => item.id !== id); markStale(); }
  function updateSuitcase(patch: Partial<Suitcase>) { Object.assign(state.suitcase, patch); markStale(); }
  function regenerate() { plans.value = generatePlans(state.suitcase, state.items); isStale.value = false; notice.value = '三套方案已重新计算'; save(); }
  function selectPlan(mode: PlanMode) { state.selectedPlan = mode; save(); }
  function resetSample() {
    const sample = createSampleSnapshot();
    Object.assign(state, sample);
    plans.value = generatePlans(state.suitcase, state.items);
    isStale.value = false;
    notice.value = '已恢复登机箱示例';
    save();
  }

  const reconciliation = computed(() => {
    const session = state.checkSession;
    if (!session) return null;
    const diff = reconcileSession(session, currentPlan.value, state.items);
    return hasReconciliationChanges(diff) ? diff : null;
  });
  const progress = computed(() => (state.checkSession ? checkProgress(state.checkSession, currentPlan.value, state.items) : null));

  function startCheck() {
    if (isStale.value) { notice.value = '方案待更新，请先重新计算再开始核对'; return; }
    state.checkSession = startCheckSession(currentPlan.value, state.items);
    notice.value = `已按「${currentPlan.value.name}」开始装箱核对`;
    save();
  }
  function setStatus(itemId: string, status: CheckStatus) {
    const session = state.checkSession;
    if (!session || reconciliation.value) return;
    const next = setItemStatus(session, currentPlan.value, itemId, status);
    if (next !== session) { state.checkSession = next; save(); }
  }
  function applyCheckChanges() {
    const session = state.checkSession;
    if (!session) return;
    state.checkSession = applyReconciliation(session, currentPlan.value, state.items);
    notice.value = '已迁移核对进度：未变项目保留，变动项目需重新确认';
    save();
  }
  function finishCheck() {
    const session = state.checkSession;
    if (!session) return;
    if (reconciliation.value) { notice.value = '方案已变更，请先确认变更影响再继续核对'; return; }
    if (session.finishedAt) { notice.value = '核对已完成，重复确认不会重复计数'; return; }
    const summary = checkProgress(session, currentPlan.value, state.items);
    if (!summary.canFinish) {
      notice.value = `还有 ${summary.missingMustHave.length} 件必带物品未放入：${summary.missingMustHave.map((item) => item.name).join('、')}`;
      return;
    }
    state.checkSession = { ...session, finishedAt: new Date().toISOString() };
    notice.value = '必带物品全部入箱，核对完成，可以出发 ✓';
    save();
  }
  function cancelCheck() {
    if (!state.checkSession) return;
    state.checkSession = null;
    notice.value = '已结束本次装箱核对';
    save();
  }

  return {
    state, notice, isStale, plans, currentPlan, risks, reconciliation, progress,
    addItem, updateItem, removeItem, updateSuitcase, regenerate, selectPlan, resetSample,
    startCheck, setStatus, applyCheckChanges, finishCheck, cancelCheck,
    print: () => printPort.print(),
  };
}
