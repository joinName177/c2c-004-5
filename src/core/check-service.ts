import type {
  CheckEntry,
  CheckFingerprint,
  CheckSession,
  CheckStatus,
  Dimensions,
  PackingItem,
  PackingPlan,
  PlanMode,
} from './models';

export const CHECK_STATUS_LABELS: Record<CheckStatus, string> = { pending: '待准备', packed: '已放入', removed: '临时取出' };

export interface ReconcileReport {
  planId: PlanMode;
  kept: Array<{ itemId: string; name: string; status: CheckStatus }>;
  invalidated: Array<{ itemId: string; name: string; reason: string }>;
  dropped: Array<{ itemId: string; name: string }>;
  added: Array<{ itemId: string; name: string }>;
}

export interface CheckSummary {
  total: number;
  packed: number;
  removed: number;
  pending: number;
  missingMustHave: PackingItem[];
  canComplete: boolean;
}

function sameDimensions(a: Dimensions, b: Dimensions): boolean {
  return a.length === b.length && a.width === b.width && a.height === b.height;
}

export function fingerprintOf(item: PackingItem, plan: PackingPlan): CheckFingerprint {
  const placement = plan.placements.find((p) => p.itemId === item.id) ?? null;
  return {
    dimensions: { length: item.length, width: item.width, height: item.height },
    placement: placement
      ? { x: placement.x, y: placement.y, z: placement.z, dimensions: { ...placement.dimensions } }
      : null,
  };
}

export function sameFingerprint(a: CheckFingerprint, b: CheckFingerprint): boolean {
  if (!sameDimensions(a.dimensions, b.dimensions)) return false;
  if (a.placement === null || b.placement === null) return a.placement === b.placement;
  return a.placement.x === b.placement.x && a.placement.y === b.placement.y && a.placement.z === b.placement.z
    && sameDimensions(a.placement.dimensions, b.placement.dimensions);
}

export function createCheckSession(plan: PackingPlan, items: PackingItem[]): CheckSession {
  return {
    planId: plan.id,
    completed: false,
    entries: items.map((item) => ({ itemId: item.id, name: item.name, status: 'pending', fingerprint: null })),
  };
}

export function canMarkPacked(itemId: string, plan: PackingPlan): boolean {
  return plan.placements.some((placement) => placement.itemId === itemId);
}

export function setEntryStatus(session: CheckSession, item: PackingItem, plan: PackingPlan, status: CheckStatus): CheckSession {
  if (status === 'packed' && !canMarkPacked(item.id, plan)) return session;
  const entry: CheckEntry = {
    itemId: item.id,
    name: item.name,
    status,
    fingerprint: status === 'pending' ? null : fingerprintOf(item, plan),
  };
  const entries = [...session.entries];
  const index = entries.findIndex((candidate) => candidate.itemId === item.id);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  return { ...session, entries, completed: false };
}

function invalidReason(previous: CheckFingerprint | null, current: CheckFingerprint): string {
  if (!previous || !sameDimensions(previous.dimensions, current.dimensions)) return '物品尺寸已修改';
  if (current.placement === null) return '当前方案未装入';
  return '摆放位置已变化';
}

export function reconcileCheckSession(session: CheckSession, plan: PackingPlan, items: PackingItem[]): { session: CheckSession; report: ReconcileReport } {
  const byId = new Map(items.map((item) => [item.id, item]));
  const report: ReconcileReport = { planId: plan.id, kept: [], invalidated: [], dropped: [], added: [] };
  const entries: CheckEntry[] = [];

  for (const entry of session.entries) {
    const item = byId.get(entry.itemId);
    if (!item) {
      report.dropped.push({ itemId: entry.itemId, name: entry.name });
      continue;
    }
    if (entry.status === 'pending') {
      entries.push({ ...entry, name: item.name });
      continue;
    }
    const current = fingerprintOf(item, plan);
    if (entry.fingerprint && sameFingerprint(entry.fingerprint, current)) {
      entries.push({ ...entry, name: item.name });
      report.kept.push({ itemId: item.id, name: item.name, status: entry.status });
      continue;
    }
    entries.push({ itemId: item.id, name: item.name, status: 'pending', fingerprint: null });
    report.invalidated.push({ itemId: item.id, name: item.name, reason: invalidReason(entry.fingerprint, current) });
  }

  for (const item of items) {
    if (!session.entries.some((entry) => entry.itemId === item.id)) {
      entries.push({ itemId: item.id, name: item.name, status: 'pending', fingerprint: null });
      report.added.push({ itemId: item.id, name: item.name });
    }
  }

  const changed = report.invalidated.length + report.dropped.length + report.added.length > 0;
  return { session: { planId: plan.id, entries, completed: changed ? false : session.completed }, report };
}

export function summarizeCheck(session: CheckSession, items: PackingItem[]): CheckSummary {
  const statusById = new Map(session.entries.map((entry) => [entry.itemId, entry.status]));
  let packed = 0;
  let removed = 0;
  let pending = 0;
  const missingMustHave: PackingItem[] = [];
  for (const item of items) {
    const status = statusById.get(item.id) ?? 'pending';
    if (status === 'packed') packed += 1;
    else if (status === 'removed') removed += 1;
    else pending += 1;
    if (item.mustHave && status !== 'packed') missingMustHave.push(item);
  }
  return {
    total: items.length,
    packed,
    removed,
    pending,
    missingMustHave,
    canComplete: items.length > 0 && pending === 0 && missingMustHave.length === 0,
  };
}

export function tryCompleteCheck(session: CheckSession, items: PackingItem[]): { ok: boolean; session: CheckSession; blockers: string[] } {
  const summary = summarizeCheck(session, items);
  if (summary.canComplete) return { ok: true, session: { ...session, completed: true }, blockers: [] };
  const blockers: string[] = [];
  if (summary.missingMustHave.length) blockers.push(`必带物品未放入：${summary.missingMustHave.map((item) => item.name).join('、')}`);
  if (summary.pending > 0) blockers.push(`仍有 ${summary.pending} 件物品待准备`);
  if (summary.total === 0) blockers.push('清单为空');
  return { ok: false, session, blockers };
}
