import { describe, expect, it } from 'vitest';
import {
  canMarkPacked,
  createCheckSession,
  fingerprintOf,
  reconcileCheckSession,
  setEntryStatus,
  summarizeCheck,
  tryCompleteCheck,
} from '../check-service';
import type { PackingItem, PackingPlan } from '../models';

const item = (id: string, overrides: Partial<PackingItem> = {}): PackingItem => ({
  id, name: `物品${id}`, category: '衣物', length: 10, width: 10, height: 10, weight: 1, priority: 2, mustHave: false, ...overrides,
});

const planWith = (placements: Array<{ itemId: string; x?: number; y?: number; z?: number }>, mode: PackingPlan['id'] = 'comfort'): PackingPlan => ({
  id: mode,
  name: '舒适版',
  placements: placements.map((p) => ({ itemId: p.itemId, x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0, dimensions: { length: 10, width: 10, height: 10 } })),
  unplaced: [],
  totalWeight: placements.length,
  usedVolume: placements.length * 1000,
  capacityRatio: 0.5,
});

describe('check-service', () => {
  it('starts a session with every item pending', () => {
    const items = [item('a'), item('b')];
    const session = createCheckSession(planWith([{ itemId: 'a' }]), items);
    expect(session.planId).toBe('comfort');
    expect(session.completed).toBe(false);
    expect(session.entries.map((entry) => entry.status)).toEqual(['pending', 'pending']);
  });

  it('only allows items placed in the current plan to be marked packed', () => {
    const items = [item('a'), item('b')];
    const plan = planWith([{ itemId: 'a' }]);
    const session = createCheckSession(plan, items);
    expect(canMarkPacked('b', plan)).toBe(false);
    const rejected = setEntryStatus(session, items[1], plan, 'packed');
    expect(rejected.entries.find((entry) => entry.itemId === 'b')?.status).toBe('pending');
    const accepted = setEntryStatus(session, items[0], plan, 'packed');
    expect(accepted.entries.find((entry) => entry.itemId === 'a')?.status).toBe('packed');
  });

  it('keeps a single entry per item so repeated confirmation never double counts', () => {
    const items = [item('a')];
    const plan = planWith([{ itemId: 'a' }]);
    let session = createCheckSession(plan, items);
    session = setEntryStatus(session, items[0], plan, 'packed');
    session = setEntryStatus(session, items[0], plan, 'packed');
    session = setEntryStatus(session, items[0], plan, 'packed');
    expect(session.entries).toHaveLength(1);
    expect(summarizeCheck(session, items).packed).toBe(1);
  });

  it('carries over untouched entries and only invalidates items whose dimensions changed', () => {
    const items = [item('a'), item('b'), item('c')];
    const plan = planWith([{ itemId: 'a' }, { itemId: 'b', x: 10 }, { itemId: 'c', x: 20 }]);
    let session = createCheckSession(plan, items);
    for (const current of items) session = setEntryStatus(session, current, plan, 'packed');

    const edited = [item('a'), item('b'), { ...item('c'), length: 12 }];
    const { session: next, report } = reconcileCheckSession(session, plan, edited);
    expect(report.kept.map((entry) => entry.itemId).sort()).toEqual(['a', 'b']);
    expect(report.invalidated).toEqual([{ itemId: 'c', name: '物品c', reason: '物品尺寸已修改' }]);
    expect(next.entries.find((entry) => entry.itemId === 'c')?.status).toBe('pending');
    expect(next.entries.find((entry) => entry.itemId === 'a')?.status).toBe('packed');
    expect(next.completed).toBe(false);
  });

  it('invalidates entries whose placement moved after a plan switch', () => {
    const items = [item('a')];
    const before = planWith([{ itemId: 'a', x: 0 }], 'minimal');
    let session = createCheckSession(before, items);
    session = setEntryStatus(session, items[0], before, 'packed');

    const moved = planWith([{ itemId: 'a', x: 10 }], 'shopping');
    const { session: next, report } = reconcileCheckSession(session, moved, items);
    expect(report.invalidated[0]).toMatchObject({ itemId: 'a', reason: '摆放位置已变化' });
    expect(next.planId).toBe('shopping');
    expect(next.entries[0].status).toBe('pending');
  });

  it('invalidates packed entries when the item is no longer placed in the plan', () => {
    const items = [item('a')];
    const plan = planWith([{ itemId: 'a' }]);
    let session = createCheckSession(plan, items);
    session = setEntryStatus(session, items[0], plan, 'packed');

    const { report, session: next } = reconcileCheckSession(session, planWith([]), items);
    expect(report.invalidated[0]).toMatchObject({ itemId: 'a', reason: '当前方案未装入' });
    expect(next.entries[0].status).toBe('pending');
  });

  it('drops deleted items by identity and reports their last known name', () => {
    const items = [item('a'), item('b', { name: '旧相机' })];
    const plan = planWith([{ itemId: 'a' }, { itemId: 'b', x: 10 }]);
    let session = createCheckSession(plan, items);
    session = setEntryStatus(session, items[1], plan, 'packed');

    const { session: next, report } = reconcileCheckSession(session, plan, [items[0]]);
    expect(report.dropped).toEqual([{ itemId: 'b', name: '旧相机' }]);
    expect(next.entries.map((entry) => entry.itemId)).toEqual(['a']);
  });

  it('adds newly added items as pending without touching confirmed entries', () => {
    const items = [item('a')];
    const plan = planWith([{ itemId: 'a' }]);
    let session = createCheckSession(plan, items);
    session = setEntryStatus(session, items[0], plan, 'packed');

    const grown = [...items, item('b', { name: '新物品' })];
    const { session: next, report } = reconcileCheckSession(session, plan, grown);
    expect(report.added).toEqual([{ itemId: 'b', name: '新物品' }]);
    expect(report.kept).toEqual([{ itemId: 'a', name: '物品a', status: 'packed' }]);
    expect(next.entries.find((entry) => entry.itemId === 'b')?.status).toBe('pending');
    expect(next.entries.find((entry) => entry.itemId === 'a')?.status).toBe('packed');
  });

  it('blocks completion while must-have items are not packed', () => {
    const items = [item('a', { mustHave: true, name: '护照' }), item('b')];
    const plan = planWith([{ itemId: 'a' }, { itemId: 'b', x: 10 }]);
    let session = createCheckSession(plan, items);
    session = setEntryStatus(session, items[1], plan, 'removed');

    const blocked = tryCompleteCheck(session, items);
    expect(blocked.ok).toBe(false);
    expect(blocked.blockers.join()).toContain('必带物品未放入：护照');

    session = setEntryStatus(session, items[0], plan, 'packed');
    const done = tryCompleteCheck(session, items);
    expect(done.ok).toBe(true);
    expect(done.session.completed).toBe(true);
  });

  it('blocks completion while any item is still pending', () => {
    const items = [item('a', { mustHave: true }), item('b')];
    const plan = planWith([{ itemId: 'a' }, { itemId: 'b', x: 10 }]);
    let session = createCheckSession(plan, items);
    session = setEntryStatus(session, items[0], plan, 'packed');

    const blocked = tryCompleteCheck(session, items);
    expect(blocked.ok).toBe(false);
    expect(blocked.blockers.join()).toContain('仍有 1 件物品待准备');
  });

  it('summarizes counts and completion readiness', () => {
    const items = [item('a', { mustHave: true }), item('b'), item('c')];
    const plan = planWith([{ itemId: 'a' }, { itemId: 'b', x: 10 }, { itemId: 'c', x: 20 }]);
    let session = createCheckSession(plan, items);
    session = setEntryStatus(session, items[0], plan, 'packed');
    session = setEntryStatus(session, items[1], plan, 'removed');

    const summary = summarizeCheck(session, items);
    expect(summary).toMatchObject({ total: 3, packed: 1, removed: 1, pending: 1, canComplete: false });
    expect(summary.missingMustHave).toHaveLength(0);
  });

  it('captures the placement fingerprint at confirmation time', () => {
    const items = [item('a')];
    const plan = planWith([{ itemId: 'a', x: 4, y: 2, z: 1 }]);
    const fingerprint = fingerprintOf(items[0], plan);
    expect(fingerprint.dimensions).toEqual({ length: 10, width: 10, height: 10 });
    expect(fingerprint.placement).toMatchObject({ x: 4, y: 2, z: 1 });
  });
});
