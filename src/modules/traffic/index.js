// traffic module — STUB. Owned by the traffic builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'traffic',
  wave: 2,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('traffic: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('traffic: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
