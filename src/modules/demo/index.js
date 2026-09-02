// demo module — STUB. Owned by the demo builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'demo',
  wave: 3,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('demo: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('demo: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
