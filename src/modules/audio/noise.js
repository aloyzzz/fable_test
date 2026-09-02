// Deterministic noise buffers (white / pink / brown) generated from the seeded rng.
// Loops are seamless: the first `fade` seconds are cross-faded with the tail past the loop point.
export function makeNoiseBuffers(ac, rng, seconds = 6, fadeSeconds = 0.25) {
  const sr = ac.sampleRate;
  const n = Math.floor(sr * seconds), F = Math.floor(sr * fadeSeconds), total = n + F;
  const white = new Float32Array(total), pink = new Float32Array(total), brown = new Float32Array(total);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < total; i++) {
    const w = rng.next() * 2 - 1;
    white[i] = w;
    // Paul Kellet's refined pink filter
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
    pink[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    br = (br + 0.02 * w) / 1.02; brown[i] = br;
  }
  const finish = (arr, targetPeak) => {
    const out = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      let v = arr[i];
      if (i < F) { const t = i / F; v = arr[i] * t + arr[n + i] * (1 - t); }
      out[i] = v; const a = v < 0 ? -v : v; if (a > peak) peak = a;
    }
    const g = peak > 0 ? targetPeak / peak : 1;
    for (let i = 0; i < n; i++) out[i] *= g;
    const buf = ac.createBuffer(1, n, sr);
    buf.copyToChannel(out, 0);
    return buf;
  };
  return { white: finish(white, 0.95), pink: finish(pink, 0.95), brown: finish(brown, 0.95) };
}
