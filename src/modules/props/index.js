// props module — STUB. Owned by the props builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'props',
  stub: true,
  wave: 2,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('props: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('props: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
