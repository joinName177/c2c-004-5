import { describe, expect, it } from 'vitest';
import {
  applyReconciliation,
  canMarkPacked,
  checkProgress,
  hasReconciliationChanges,
  reconcileSession,
  setItemStatus,
  startCheckSession,
  statusOf,
} from '../check-service';
import type { PackingItem, PackingPlan, Placement } from '../models';

const item = (id: string, overrides: Partial<PackingItem> = {}): PackingItem => ({
  id, name: `物品-${id}`, category: '衣物', length: 4, width: 2, height: 2, weight: 1, priority: 1, mustHave: false, ...overrides,
});
const placement = (itemId: string, overrides: Partial<Placement> = {}): Placement => ({
  itemId, x: 0, y: 0, z: 0, dimensions: { length: 4, width: 2, height: 2 }, ...overrides,
});
const plan = (placements: Placement[], overrides: Partial<PackingPlan> = {}): PackingPlan => ({
  id: 'comfort', name: '舒适版', placements, unplaced: [], totalWeight: 0, usedVolume: 0, capacityRatio: 0, ...overrides,
});

describe('startCheckSession', () => {
  it('captures a placement baseline for the confirmed plan', () => {
    const items = [item('a'), item('b')];
    const session = startCheckSession(plan([placement('a'), placement('b', { x: 5 })]), items, '2026-10-06T08:00:00.000Z');
    expect(session.planMode).toBe('comfort');
    expect(Object.keys(session.baseline).sort()).toEqual(['a', 'b']);
    expect(session.baseline.b.placement.x).toBe(5);
    expect(session.baseline.b.itemDimensions).toEqual({ length: 4, width: 2, height: 2 });
    expect(session.startedAt).toBe('2026-10-06T08:00:00.000Z');
    expect(statusOf(session, 'a')).toBe('pending');
  });
});

describe('setItemStatus', () => {
  it('only allows packed for items placed in the current plan', () => {
    const current = plan([placement('a')]);
    const session = startCheckSession(current, [item('a'), item('b')]);
    expect(canMarkPacked(current, 'b')).toBe(false);
    expect(setItemStatus(session, current, 'b', 'packed')).toBe(session);
    expect(statusOf(setItemStatus(session, current, 'b', 'out'), 'b')).toBe('out');
  });

  it('is idempotent: repeated confirmations never double count', () => {
    const current = plan([placement('a')]);
    let session = startCheckSession(current, [item('a')]);
    session = setItemStatus(session, current, 'a', 'packed');
    const again = setItemStatus(session, current, 'a', 'packed');
    expect(again).toBe(session);
    expect(checkProgress(again, current, [item('a')]).packedCount).toBe(1);
  });

  it('clears the finished flag when a status changes again', () => {
    const current = plan([placement('a')]);
    let session = startCheckSession(current, [item('a')]);
    session = { ...setItemStatus(session, current, 'a', 'packed'), finishedAt: '2026-10-06T09:00:00.000Z' };
    expect(setItemStatus(session, current, 'a', 'out').finishedAt).toBeUndefined();
  });
});

describe('reconcileSession', () => {
  const items = [item('keep'), item('move'), item('resize'), item('drop')];
  const before = plan([placement('keep'), placement('move'), placement('resize'), placement('drop')]);
  const afterItems = [item('keep'), item('move'), item('resize', { length: 6 }), item('new')];
  const after = plan([
    placement('keep'),
    placement('move', { x: 8 }),
    placement('resize', { dimensions: { length: 6, width: 2, height: 2 } }),
    placement('new'),
  ]);

  function sessionWithHistory() {
    let session = startCheckSession(before, items);
    session = setItemStatus(session, before, 'keep', 'packed');
    session = setItemStatus(session, before, 'move', 'packed');
    session = setItemStatus(session, before, 'drop', 'out');
    return session;
  }

  it('diffs by item identity: kept, changed, removed and added', () => {
    const diff = reconcileSession(sessionWithHistory(), after, afterItems);
    expect(diff.kept.map((entry) => entry.itemId)).toEqual(['keep']);
    expect(diff.changed.map((entry) => entry.itemId).sort()).toEqual(['move', 'resize']);
    expect(diff.removed.map((entry) => entry.itemId)).toEqual(['drop']);
    expect(diff.added.map((entry) => entry.itemId)).toEqual(['new']);
    expect(diff.changed.find((entry) => entry.itemId === 'move')?.status).toBe('packed');
    expect(hasReconciliationChanges(diff)).toBe(true);
  });

  it('reports no changes when the plan still matches the baseline', () => {
    const diff = reconcileSession(sessionWithHistory(), before, items);
    expect(hasReconciliationChanges(diff)).toBe(false);
    expect(diff.kept).toHaveLength(4);
  });

  it('migrates statuses: unchanged keep, changed reset, removed dropped', () => {
    const migrated = applyReconciliation(sessionWithHistory(), after, afterItems);
    expect(statusOf(migrated, 'keep')).toBe('packed');
    expect(statusOf(migrated, 'move')).toBe('pending');
    expect(statusOf(migrated, 'resize')).toBe('pending');
    expect(migrated.statuses.drop).toBeUndefined();
    expect(Object.keys(migrated.baseline).sort()).toEqual(['keep', 'move', 'new', 'resize']);
    expect(migrated.finishedAt).toBeUndefined();
  });

  it('applying twice is a no-op and leaves nothing to reconfirm', () => {
    const migrated = applyReconciliation(sessionWithHistory(), after, afterItems);
    const twice = applyReconciliation(migrated, after, afterItems);
    expect(twice.statuses).toEqual(migrated.statuses);
    expect(hasReconciliationChanges(reconcileSession(migrated, after, afterItems))).toBe(false);
  });
});

describe('checkProgress', () => {
  it('blocks completion while a must-have item is not packed', () => {
    const items = [item('a', { mustHave: true }), item('b', { mustHave: true }), item('c')];
    const current = plan([placement('a'), placement('c')], { unplaced: [{ item: items[1], reason: '没有可用的连续空间' }] });
    let session = startCheckSession(current, items);
    session = setItemStatus(session, current, 'a', 'packed');
    session = setItemStatus(session, current, 'c', 'packed');
    const progress = checkProgress(session, current, items);
    expect(progress.packedCount).toBe(2);
    expect(progress.canFinish).toBe(false);
    expect(progress.missingMustHave.map((entry) => entry.id)).toEqual(['b']);
  });

  it('allows completion when every must-have is packed, optional leftovers aside', () => {
    const items = [item('a', { mustHave: true }), item('b', { mustHave: true }), item('c')];
    const current = plan([placement('a'), placement('b'), placement('c')]);
    let session = startCheckSession(current, items);
    session = setItemStatus(session, current, 'a', 'packed');
    session = setItemStatus(session, current, 'b', 'packed');
    const progress = checkProgress(session, current, items);
    expect(progress.canFinish).toBe(true);
    expect(progress.pendingCount).toBe(1);
  });
});
