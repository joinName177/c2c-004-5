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

describe('usePlanner', () => {
  it('adds, updates and removes items while marking results stale', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    const initial = planner.state.items.length;
    planner.addItem({ id: 'new', name: '帽子', category: '衣物', length: 12, width: 12, height: 5, weight: 0.2, priority: 2, mustHave: false });
    expect(planner.state.items).toHaveLength(initial + 1);
    expect(planner.isStale.value).toBe(true);
    planner.updateItem('new', { name: '遮阳帽' });
    expect(planner.state.items.find((item) => item.id === 'new')?.name).toBe('遮阳帽');
    planner.removeItem('new');
    expect(planner.state.items).toHaveLength(initial);
  });

  it('regenerates plans and persists the selected mode', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.updateSuitcase({ maxWeight: 12 });
    expect(planner.isStale.value).toBe(true);
    planner.regenerate();
    planner.selectPlan('shopping');
    expect(planner.isStale.value).toBe(false);
    expect(planner.plans.value.shopping.name).toBe('购物版');
    expect(repository.saved?.selectedPlan).toBe('shopping');
  });

  it('starts a check session and only marks placed items as packed', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.startCheck();
    expect(planner.state.check?.entries).toHaveLength(planner.state.items.length);
    expect(planner.state.check?.entries.every((entry) => entry.status === 'pending')).toBe(true);

    const placed = planner.currentPlan.value.placements[0].itemId;
    planner.setItemCheck(placed, 'packed');
    expect(planner.checkSummary.value?.packed).toBe(1);

    const unplaced = planner.state.items.find((item) => !planner.currentPlan.value.placements.some((p) => p.itemId === item.id));
    if (unplaced) {
      planner.setItemCheck(unplaced.id, 'packed');
      expect(planner.state.check?.entries.find((entry) => entry.itemId === unplaced.id)?.status).toBe('pending');
      expect(planner.notice.value).toContain('只有当前方案装入的物品才能记为已放入');
    }
    expect(repository.saved?.check?.entries.find((entry) => entry.itemId === placed)?.status).toBe('packed');
  });

  it('counts a repeated confirmation only once', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.startCheck();
    const placed = planner.currentPlan.value.placements[0].itemId;
    planner.setItemCheck(placed, 'packed');
    planner.setItemCheck(placed, 'packed');
    planner.setItemCheck(placed, 'packed');
    expect(planner.checkSummary.value?.packed).toBe(1);
    expect(planner.state.check?.entries.filter((entry) => entry.itemId === placed)).toHaveLength(1);
  });

  it('blocks declaring completion while must-have items are missing', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.startCheck();
    planner.declareComplete();
    expect(planner.state.check?.completed).toBe(false);
    expect(planner.notice.value).toContain('必带物品未放入');

    for (const item of planner.state.items) {
      const placedInPlan = planner.currentPlan.value.placements.some((p) => p.itemId === item.id);
      planner.setItemCheck(item.id, placedInPlan ? 'packed' : 'removed');
    }
    planner.declareComplete();
    expect(planner.state.check?.completed).toBe(true);
    expect(repository.saved?.check?.completed).toBe(true);
  });

  it('keeps untouched confirmations and resets only edited items after regeneration', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.startCheck();
    const [first, second] = planner.currentPlan.value.placements;
    planner.setItemCheck(first.itemId, 'packed');
    planner.setItemCheck(second.itemId, 'packed');

    planner.updateItem(first.itemId, { length: 40 });
    expect(planner.state.check?.entries.find((entry) => entry.itemId === first.itemId)?.status).toBe('pending');
    expect(planner.checkReport.value?.invalidated.map((entry) => entry.itemId)).toContain(first.itemId);

    planner.regenerate();
    const kept = planner.state.check?.entries.find((entry) => entry.itemId === second.itemId);
    if (kept?.status === 'packed') {
      expect(planner.checkReport.value?.kept.map((entry) => entry.itemId)).toContain(second.itemId);
    }
    expect(planner.state.check?.entries.filter((entry) => entry.status === 'packed').length).toBeLessThanOrEqual(1);
  });

  it('drops deleted items from the session and reports them by name', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.startCheck();
    const placed = planner.currentPlan.value.placements[0].itemId;
    const name = planner.state.items.find((item) => item.id === placed)?.name ?? '';
    planner.setItemCheck(placed, 'packed');
    planner.removeItem(placed);
    expect(planner.state.check?.entries.some((entry) => entry.itemId === placed)).toBe(false);
    expect(planner.checkReport.value?.dropped.map((entry) => entry.name)).toContain(name);
  });

  it('reconciles confirmations against the newly selected plan', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.startCheck();
    const placed = planner.currentPlan.value.placements[0].itemId;
    planner.setItemCheck(placed, 'packed');
    planner.selectPlan('shopping');
    expect(planner.state.check?.planId).toBe('shopping');
    expect(planner.state.check?.entries).toHaveLength(planner.state.items.length);
  });

  it('resumes the in-progress session after a reload', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.startCheck();
    const placed = planner.currentPlan.value.placements[0].itemId;
    planner.setItemCheck(placed, 'packed');

    const reloaded = usePlanner({ repository: new MemoryRepository(repository.saved!), printPort: { print() {} } });
    expect(reloaded.state.check?.entries.find((entry) => entry.itemId === placed)?.status).toBe('packed');
    expect(reloaded.checkSummary.value?.packed).toBe(1);
  });

  it('loads legacy snapshots saved before the check flow existed', () => {
    const legacy = createSampleSnapshot() as Partial<PackingSnapshot>;
    delete legacy.check;
    const planner = usePlanner({ repository: new MemoryRepository(legacy as PackingSnapshot), printPort: { print() {} } });
    expect(planner.state.check).toBeNull();
    planner.startCheck();
    expect(planner.state.check?.entries).toHaveLength(planner.state.items.length);
  });
});
