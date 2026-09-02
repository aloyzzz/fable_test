// audio module — STUB. Owned by the audio builder. See ARCHITECTURE.md §4 for the contract.
export default {
  name: 'audio',
  wave: 1,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 50, triangles: 500000 },
  async init(ctx) { ctx.log('audio: stub init'); },
  update(dt, ctx) {},
  async showcase(ctx) { ctx.log('audio: stub showcase'); },
  dispose(ctx) {},
  api: {},
};
