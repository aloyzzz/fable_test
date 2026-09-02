// environment module — STUB. Owned by the environment builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'environment',
  wave: 1,
  deps: [],
  showcaseDeps: [],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('environment: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('environment: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
