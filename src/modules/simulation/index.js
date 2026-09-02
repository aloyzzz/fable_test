// simulation module — STUB. Owned by the simulation builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'simulation',
  stub: true,
  wave: 1,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('simulation: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('simulation: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
