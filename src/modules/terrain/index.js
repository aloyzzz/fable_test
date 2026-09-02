// terrain module — STUB. Owned by the terrain builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'terrain',
  wave: 1,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('terrain: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('terrain: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
