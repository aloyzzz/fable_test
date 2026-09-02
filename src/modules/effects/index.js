// effects module — STUB. Owned by the effects builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'effects',
  stub: true,
  wave: 1,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('effects: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('effects: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
