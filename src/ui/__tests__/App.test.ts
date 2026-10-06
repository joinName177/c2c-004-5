import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from '../App.vue';
import { LocalPlannerRepository } from '../../adapters/local-planner.repository';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

function render() {
  let printCount = 0;
  const wrapper = mount(App, { props: {
    repository: new LocalPlannerRepository(new MemoryStorage()),
    printPort: { print: () => { printCount += 1; } },
  } });
  return { wrapper, getPrintCount: () => printCount };
}

describe('Luggage planner App', () => {
  it('renders sample luggage and catches invalid dimensions', async () => {
    const { wrapper } = render();
    expect(wrapper.text()).toContain('行李箱空间规划师');
    expect(wrapper.text()).toContain('轻薄外套');
    await wrapper.get('[aria-label="行李箱长度"]').setValue('0');
    expect(wrapper.text()).toContain('行李箱长度必须大于 0');
  });

  it('adds and deletes an item', async () => {
    const { wrapper } = render();
    await wrapper.get('[aria-label="物品名称"]').setValue('新物品');
    await wrapper.get('[data-testid="item-editor"]').trigger('submit');
    expect(wrapper.text()).toContain('新物品');
    await wrapper.get('[aria-label="删除 新物品"]').trigger('click');
    expect(wrapper.text()).not.toContain('新物品');
  });

  it('selects a plan and highlights the same item in both projections', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-plan="shopping"]').trigger('click');
    expect(wrapper.get('[data-plan="shopping"]').classes()).toContain('active');
    const jacket = wrapper.findAll('[data-item-id="jacket"]');
    expect(jacket.length).toBe(2);
    await jacket[0].trigger('click');
    expect(wrapper.findAll('[data-item-id="jacket"].selected')).toHaveLength(2);
  });

  it('delegates printing through the print port', async () => {
    const { wrapper, getPrintCount } = render();
    await wrapper.get('[data-testid="print-button"]').trigger('click');
    expect(getPrintCount()).toBe(1);
  });

  it('runs a check session across list, projection and print sheet without double counting', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-testid="start-check"]').trigger('click');
    expect(wrapper.get('[data-testid="check-panel"]').text()).toContain('待准备');

    await wrapper.get('[data-testid="check-packed-jacket"]').trigger('click');
    await wrapper.get('[data-testid="check-packed-jacket"]').trigger('click');
    expect(wrapper.get('[data-testid="check-panel"] .section-title b').text()).toContain('1/6');
    expect(wrapper.get('[data-testid="chip-jacket"]').text()).toBe('已放入');
    expect(wrapper.findAll('[data-item-id="jacket"] .status-badge.packed')).toHaveLength(2);
    expect(wrapper.get('.print-sheet').text()).toContain('已放入');
    expect(wrapper.get('.print-sheet').text()).toContain('规划位');
  });

  it('blocks declaring completion while must-have items are unpacked', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-testid="start-check"]').trigger('click');
    expect(wrapper.get('[data-testid="complete-check"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="check-blockers"]').text()).toContain('必带未放入');
  });

  it('completes once every item is packed or removed', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-testid="start-check"]').trigger('click');
    for (const id of ['jacket', 'shoes', 'camera', 'toiletry', 'book', 'gifts']) {
      const packed = wrapper.get(`[data-testid="check-packed-${id}"]`);
      if (packed.attributes('disabled') === undefined) await packed.trigger('click');
      else await wrapper.get(`[data-testid="check-removed-${id}"]`).trigger('click');
    }
    await wrapper.get('[data-testid="complete-check"]').trigger('click');
    expect(wrapper.get('[data-testid="check-done"]').text()).toContain('全部装箱完成');
  });

  it('requires re-confirmation only for edited items and keeps the rest', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-testid="start-check"]').trigger('click');
    await wrapper.get('[data-testid="check-packed-jacket"]').trigger('click');
    await wrapper.get('[data-testid="check-packed-shoes"]').trigger('click');

    await wrapper.get('[aria-label="编辑 轻薄外套"]').trigger('click');
    await wrapper.get('[aria-label="编辑长度"]').setValue('40');
    await wrapper.get('[data-testid="save-jacket"]').trigger('submit');

    const report = wrapper.get('[data-testid="check-report"]');
    expect(report.text()).toContain('需重新确认');
    expect(report.text()).toContain('轻薄外套');
    expect(report.text()).toContain('沿用');
    expect(report.text()).toContain('运动鞋');
    expect(wrapper.get('[data-testid="chip-jacket"]').text()).toBe('待准备');
    expect(wrapper.get('[data-testid="chip-shoes"]').text()).toBe('已放入');
  });

  it('drops deleted items from the session and shows the reconcile report', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-testid="start-check"]').trigger('click');
    await wrapper.get('[data-testid="check-packed-jacket"]').trigger('click');
    await wrapper.get('[aria-label="删除 洗漱包"]').trigger('click');

    const report = wrapper.get('[data-testid="check-report"]');
    expect(report.text()).toContain('已移除物品');
    expect(report.text()).toContain('洗漱包');
    expect(wrapper.find('[data-check-item="toiletry"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="chip-jacket"]').text()).toBe('已放入');
  });
});
