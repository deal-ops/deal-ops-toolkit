# Performance (Tech design §5)

Measured 2026-10-17 with Node v26.8.1 on darwin/arm64 (median of runs). Browser timings are checked again at M2.

| Module | Size | Median | Target |
|---|---|---|---|
| Reconcile | 500 investors × 2,000 lines | 100.0 ms | < 200 ms |
| Allocate | 500 investors, scale-back | 0.8 ms | < 50 ms |
| Distribute | 500 holdings, hurdle + catch-up | 0.3 ms | < 10 ms |
