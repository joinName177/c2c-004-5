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

  it('tracks actual packing status across list, projections and print sheet', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-testid="start-check"]').trigger('click');
    await wrapper.get('[data-testid="check-packed-jacket"]').trigger('click');
    await wrapper.get('[data-testid="check-packed-jacket"]').trigger('click');
    expect(wrapper.get('[data-testid="count-packed"]').text()).toContain('1');
    expect(wrapper.findAll('[data-item-id="jacket"].check-packed')).toHaveLength(2);
    expect(wrapper.find('.item-list .check-badge.packed').exists()).toBe(true);
    expect(wrapper.get('.print-sheet').text()).toContain('已放入');
    await wrapper.get('[data-testid="finish-check"]').trigger('click');
    expect(wrapper.get('.notice').text()).toContain('必带');
  });

  it('asks for a migration review before reusing check results after a resize', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-testid="start-check"]').trigger('click');
    await wrapper.get('[data-testid="check-packed-jacket"]').trigger('click');
    await wrapper.get('[data-plan="shopping"]').trigger('click');
    const box = wrapper.get('[data-testid="reconcile-box"]');
    expect(box.text()).toContain('轻薄外套');
    expect(box.text()).toContain('需重新确认');
    await wrapper.get('[data-testid="apply-reconcile"]').trigger('click');
    expect(wrapper.find('[data-testid="reconcile-box"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="count-packed"]').text()).toContain('0');
  });
});
