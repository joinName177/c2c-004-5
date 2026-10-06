import { describe, expect, it } from 'vitest';
import { createSampleSnapshot } from '../../core/sample-data';
import { usePlanner } from '../usePlanner';
import type { PackingSnapshot } from '../../core/models';
import type { PlannerRepository } from '../../ports/planner-repository.port';

class MemoryRepository implements PlannerRepository {
  saved?: PackingSnapshot;
  constructor(private snapshot = createSampleSnapshot()) {}
  load() { return { value: structuredClone(this.snapshot) }; }
  save(snapshot: PackingSnapshot) { this.saved = structuredClone(snapshot); }
}

const createPlanner = (repository = new MemoryRepository()) => usePlanner({ repository, printPort: { print() {} } });

describe('usePlanner 装箱核对', () => {
  it('starts a check session and continues the progress after a reload', () => {
    const repository = new MemoryRepository();
    const planner = createPlanner(repository);
    planner.startCheck();
    planner.setStatus('jacket', 'packed');
    planner.setStatus('shoes', 'out');
    expect(repository.saved?.checkSession?.statuses.jacket).toBe('packed');

    const reloaded = createPlanner(new MemoryRepository(repository.saved!));
    expect(reloaded.state.checkSession?.statuses.jacket).toBe('packed');
    expect(reloaded.state.checkSession?.statuses.shoes).toBe('out');
    expect(reloaded.reconciliation.value).toBeNull();
    expect(reloaded.progress.value?.packedCount).toBe(1);
    expect(reloaded.progress.value?.outCount).toBe(1);
  });

  it('refuses to start while plans are stale', () => {
    const planner = createPlanner();
    planner.updateSuitcase({ maxWeight: 12 });
    planner.startCheck();
    expect(planner.state.checkSession).toBeNull();
    expect(planner.notice.value).toContain('重新计算');
  });

  it('never double counts repeated confirmations', () => {
    const planner = createPlanner();
    planner.startCheck();
    planner.setStatus('jacket', 'packed');
    planner.setStatus('jacket', 'packed');
    planner.setStatus('jacket', 'packed');
    expect(planner.progress.value?.packedCount).toBe(1);
  });

  it('cannot mark an unplaced item as packed', () => {
    const planner = createPlanner();
    planner.addItem({ id: 'fridge', name: '车载冰箱', category: '其他', length: 999, width: 999, height: 999, weight: 30, priority: 1, mustHave: false });
    planner.regenerate();
    planner.startCheck();
    planner.setStatus('fridge', 'packed');
    expect(planner.state.checkSession?.statuses.fridge).toBeUndefined();
    expect(planner.progress.value?.packedCount).toBe(0);
  });

  it('blocks finish on must-have omissions and stays idempotent once finished', () => {
    const planner = createPlanner();
    planner.startCheck();
    planner.finishCheck();
    expect(planner.state.checkSession?.finishedAt).toBeUndefined();
    expect(planner.notice.value).toContain('必带');

    for (const item of planner.state.items.filter((entry) => entry.mustHave)) planner.setStatus(item.id, 'packed');
    planner.finishCheck();
    const finishedAt = planner.state.checkSession?.finishedAt;
    expect(finishedAt).toBeTruthy();

    planner.finishCheck();
    expect(planner.state.checkSession?.finishedAt).toBe(finishedAt);
    expect(planner.progress.value?.packedCount).toBe(3);
  });

  it('keeps untouched items but requires reconfirmation for resized ones', () => {
    const planner = createPlanner();
    planner.startCheck();
    planner.setStatus('jacket', 'packed');
    planner.setStatus('camera', 'packed');
    planner.updateItem('camera', { length: 20 });
    planner.regenerate();

    const diff = planner.reconciliation.value;
    expect(diff).not.toBeNull();
    expect(diff!.changed.map((entry) => entry.itemId)).toContain('camera');
    expect(diff!.kept.map((entry) => entry.itemId)).toContain('jacket');

    planner.applyCheckChanges();
    expect(planner.state.checkSession?.statuses.jacket).toBe('packed');
    expect(planner.state.checkSession?.statuses.camera).toBeUndefined();
    expect(planner.reconciliation.value).toBeNull();
  });

  it('ignores status writes while a reconciliation is pending', () => {
    const planner = createPlanner();
    planner.startCheck();
    planner.setStatus('jacket', 'packed');
    planner.selectPlan('shopping');
    expect(planner.reconciliation.value).not.toBeNull();
    planner.setStatus('shoes', 'packed');
    expect(planner.state.checkSession?.statuses.shoes).toBeUndefined();
  });

  it('surfaces plan switches as a migration preview and restores everything when switching back', () => {
    const planner = createPlanner();
    planner.startCheck();
    planner.setStatus('jacket', 'packed');

    planner.selectPlan('shopping');
    expect(planner.reconciliation.value).not.toBeNull();
    planner.selectPlan('comfort');
    expect(planner.reconciliation.value).toBeNull();
    expect(planner.state.checkSession?.statuses.jacket).toBe('packed');

    planner.selectPlan('shopping');
    planner.applyCheckChanges();
    expect(planner.state.checkSession?.planMode).toBe('shopping');
    expect(planner.state.checkSession?.statuses.jacket).toBeUndefined();
  });

  it('reports deleted items as removed instead of wiping the whole progress', () => {
    const planner = createPlanner();
    planner.startCheck();
    planner.setStatus('jacket', 'packed');
    planner.removeItem('gifts');
    planner.regenerate();

    const diff = planner.reconciliation.value;
    expect(diff!.removed.map((entry) => entry.itemId)).toEqual(['gifts']);
    expect(diff!.kept.map((entry) => entry.itemId)).toContain('jacket');

    planner.applyCheckChanges();
    expect(planner.state.checkSession?.statuses.jacket).toBe('packed');
    expect(planner.state.checkSession?.baseline.gifts).toBeUndefined();
  });

  it('clears the session when resetting the sample or cancelling the check', () => {
    const planner = createPlanner();
    planner.startCheck();
    planner.cancelCheck();
    expect(planner.state.checkSession).toBeNull();
    planner.startCheck();
    planner.resetSample();
    expect(planner.state.checkSession).toBeNull();
  });
});
