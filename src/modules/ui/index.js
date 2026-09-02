// ui module — STUB. Owned by the ui builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'ui',
  wave: 1,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('ui: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('ui: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
