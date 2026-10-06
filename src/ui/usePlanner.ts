import { computed, reactive, ref } from 'vue';
import { createSampleSnapshot } from '../core/sample-data';
import { generatePlans } from '../core/plan-service';
import { detectRisks } from '../core/risk-engine';
import {
  canMarkPacked,
  createCheckSession,
  reconcileCheckSession,
  setEntryStatus,
  summarizeCheck,
  tryCompleteCheck,
  type ReconcileReport,
} from '../core/check-service';
import type { CheckSession, CheckStatus, PackingItem, PackingSnapshot, PlanMode, Suitcase } from '../core/models';
import type { PlannerRepository } from '../ports/planner-repository.port';
import type { PrintPort } from '../ports/print.port';

export interface PlannerDependencies { repository: PlannerRepository; printPort: PrintPort }

type PersistedSnapshot = Omit<PackingSnapshot, 'check'> & { check?: CheckSession | null };

export function usePlanner({ repository, printPort }: PlannerDependencies) {
  const loaded = repository.load();
  const persisted = loaded.value as PersistedSnapshot;
  const state = reactive<PackingSnapshot>({ ...persisted, check: persisted.check ?? null });
  const notice = ref(loaded.warning ?? '');
  const isStale = ref(false);
  const plans = ref(generatePlans(state.suitcase, state.items));
  const currentPlan = computed(() => plans.value[state.selectedPlan]);
  const risks = computed(() => detectRisks(currentPlan.value, state.suitcase, state.items));
  const checkReport = ref<ReconcileReport | null>(null);
  const checkSummary = computed(() => (state.check ? summarizeCheck(state.check, state.items) : null));

  const save = () => repository.save(JSON.parse(JSON.stringify(state)) as PackingSnapshot);
  const markStale = () => { isStale.value = true; save(); };

  function reconcileCheck() {
    if (!state.check) return;
    const { session, report } = reconcileCheckSession(state.check, currentPlan.value, state.items);
    state.check = session;
    if (report.invalidated.length || report.dropped.length || report.added.length) checkReport.value = report;
  }

  function addItem(item: PackingItem) { state.items.push(item); reconcileCheck(); markStale(); }
  function updateItem(id: string, patch: Partial<PackingItem>) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index >= 0) state.items[index] = { ...state.items[index], ...patch } as PackingItem;
    reconcileCheck();
    markStale();
  }
  function removeItem(id: string) { state.items = state.items.filter((item) => item.id !== id); reconcileCheck(); markStale(); }
  function updateSuitcase(patch: Partial<Suitcase>) { Object.assign(state.suitcase, patch); markStale(); }
  function regenerate() {
    plans.value = generatePlans(state.suitcase, state.items);
    isStale.value = false;
    reconcileCheck();
    notice.value = state.check ? '方案已重新计算，核对进度已按物品逐项复核' : '三套方案已重新计算';
    save();
  }
  function selectPlan(mode: PlanMode) { state.selectedPlan = mode; reconcileCheck(); save(); }
  function resetSample() {
    const sample = createSampleSnapshot();
    Object.assign(state, sample);
    plans.value = generatePlans(state.suitcase, state.items);
    isStale.value = false;
    checkReport.value = null;
    notice.value = '已恢复登机箱示例';
    save();
  }

  function startCheck() {
    if (state.check) return;
    if (isStale.value) { notice.value = '方案待更新，请先重新计算再开始核对'; return; }
    state.check = createCheckSession(currentPlan.value, state.items);
    checkReport.value = null;
    notice.value = '出发前核对已开始，请按实际装箱逐项确认';
    save();
  }
  function cancelCheck() {
    if (!state.check) return;
    state.check = null;
    checkReport.value = null;
    notice.value = '已放弃本次核对';
    save();
  }
  function setItemCheck(itemId: string, status: CheckStatus) {
    if (!state.check) return;
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (status === 'packed' && !canMarkPacked(itemId, currentPlan.value)) {
      notice.value = '只有当前方案装入的物品才能记为已放入';
      return;
    }
    state.check = setEntryStatus(state.check, item, currentPlan.value, status);
    save();
  }
  function declareComplete() {
    if (!state.check) return;
    if (isStale.value) { notice.value = '方案待更新，请重新计算并复核后再宣布完成'; return; }
    const result = tryCompleteCheck(state.check, state.items);
    if (!result.ok) { notice.value = `无法宣布全部完成：${result.blockers.join('；')}`; return; }
    state.check = result.session;
    notice.value = '出发前核对全部完成，可以安心出发';
    save();
  }
  function dismissCheckReport() { checkReport.value = null; }

  return {
    state, notice, isStale, plans, currentPlan, risks, checkReport, checkSummary,
    addItem, updateItem, removeItem, updateSuitcase, regenerate, selectPlan, resetSample,
    startCheck, cancelCheck, setItemCheck, declareComplete, dismissCheckReport,
    print: () => printPort.print(),
  };
}
