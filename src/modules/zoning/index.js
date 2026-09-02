// zoning module — STUB. Owned by the zoning builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'zoning',
  stub: true,
  wave: 2,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('zoning: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('zoning: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
