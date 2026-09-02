// buildings module — STUB. Owned by the buildings builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'buildings',
  stub: true,
  wave: 2,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('buildings: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('buildings: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
