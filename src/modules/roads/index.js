// roads module — STUB. Owned by the roads builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'roads',
  stub: true,
  wave: 1,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('roads: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('roads: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
