import type {
  CheckBaselineEntry,
  CheckSession,
  CheckStatus,
  Dimensions,
  PackingItem,
  PackingPlan,
  Placement,
} from './models';

export const CHECK_STATUS_LABELS: Record<CheckStatus, string> = {
  pending: '待准备',
  packed: '已放入',
  out: '临时取出',
};

const pickDimensions = ({ length, width, height }: Dimensions): Dimensions => ({ length, width, height });

function snapshotPlacement(placement: Placement): Placement {
  return { itemId: placement.itemId, x: placement.x, y: placement.y, z: placement.z, dimensions: { ...placement.dimensions } };
}

function snapshotBaseline(plan: PackingPlan, items: PackingItem[]): Record<string, CheckBaselineEntry> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const baseline: Record<string, CheckBaselineEntry> = {};
  for (const placement of plan.placements) {
    const item = byId.get(placement.itemId);
    baseline[placement.itemId] = {
      name: item?.name ?? placement.itemId,
      placement: snapshotPlacement(placement),
      itemDimensions: item ? pickDimensions(item) : { ...placement.dimensions },
    };
  }
  return baseline;
}

export function startCheckSession(plan: PackingPlan, items: PackingItem[], startedAt = new Date().toISOString()): CheckSession {
  return { planMode: plan.id, baseline: snapshotBaseline(plan, items), statuses: {}, startedAt };
}

export function statusOf(session: CheckSession | null | undefined, itemId: string): CheckStatus {
  return session?.statuses[itemId] ?? 'pending';
}

export function canMarkPacked(plan: PackingPlan, itemId: string): boolean {
  return plan.placements.some((placement) => placement.itemId === itemId);
}

export function setItemStatus(session: CheckSession, plan: PackingPlan, itemId: string, status: CheckStatus): CheckSession {
  if (status === 'packed' && !canMarkPacked(plan, itemId)) return session;
  if (statusOf(session, itemId) === status) return session;
  return { ...session, statuses: { ...session.statuses, [itemId]: status }, finishedAt: undefined };
}

export interface ReconciliationEntry {
  itemId: string;
  name: string;
  status: CheckStatus;
}

export interface Reconciliation {
  kept: ReconciliationEntry[];
  changed: ReconciliationEntry[];
  removed: ReconciliationEntry[];
  added: Array<{ itemId: string; name: string }>;
}

function sameDimensions(a: Dimensions, b: Dimensions): boolean {
  return a.length === b.length && a.width === b.width && a.height === b.height;
}

function samePlacement(a: Placement, b: Placement): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z && sameDimensions(a.dimensions, b.dimensions);
}

export function reconcileSession(session: CheckSession, plan: PackingPlan, items: PackingItem[]): Reconciliation {
  const byId = new Map(items.map((item) => [item.id, item]));
  const placedNow = new Map(plan.placements.map((placement) => [placement.itemId, placement]));
  const result: Reconciliation = { kept: [], changed: [], removed: [], added: [] };

  for (const [itemId, entry] of Object.entries(session.baseline)) {
    const status = statusOf(session, itemId);
    const item = byId.get(itemId);
    const placement = placedNow.get(itemId);
    if (!item || !placement) {
      result.removed.push({ itemId, name: entry.name, status });
      continue;
    }
    const changed = !sameDimensions(entry.itemDimensions, item) || !samePlacement(entry.placement, placement);
    result[changed ? 'changed' : 'kept'].push({ itemId, name: item.name, status });
  }

  for (const placement of plan.placements) {
    if (!(placement.itemId in session.baseline)) {
      result.added.push({ itemId: placement.itemId, name: byId.get(placement.itemId)?.name ?? placement.itemId });
    }
  }
  return result;
}

export function hasReconciliationChanges(reconciliation: Reconciliation): boolean {
  return reconciliation.changed.length > 0 || reconciliation.removed.length > 0 || reconciliation.added.length > 0;
}

export function applyReconciliation(session: CheckSession, plan: PackingPlan, items: PackingItem[]): CheckSession {
  const reconciliation = reconcileSession(session, plan, items);
  const statuses: Record<string, CheckStatus> = {};
  for (const entry of reconciliation.kept) {
    if (entry.status !== 'pending') statuses[entry.itemId] = entry.status;
  }
  return { ...session, planMode: plan.id, baseline: snapshotBaseline(plan, items), statuses, finishedAt: undefined };
}

export interface CheckProgress {
  plannedCount: number;
  packedCount: number;
  outCount: number;
  pendingCount: number;
  missingMustHave: PackingItem[];
  canFinish: boolean;
}

export function checkProgress(session: CheckSession, plan: PackingPlan, items: PackingItem[]): CheckProgress {
  let packedCount = 0;
  let outCount = 0;
  let pendingCount = 0;
  for (const placement of plan.placements) {
    const status = statusOf(session, placement.itemId);
    if (status === 'packed') packedCount += 1;
    else if (status === 'out') outCount += 1;
    else pendingCount += 1;
  }
  const missingMustHave = items.filter((item) => item.mustHave && statusOf(session, item.id) !== 'packed');
  return {
    plannedCount: plan.placements.length,
    packedCount,
    outCount,
    pendingCount,
    missingMustHave,
    canFinish: missingMustHave.length === 0,
  };
}
