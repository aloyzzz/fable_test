// tools module — STUB. Owned by the tools builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'tools',
  stub: true,
  wave: 2,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('tools: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('tools: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
