# Conditional momentum v1 — 2023

Decision: **NO-GO**

Base signals H1/H2: 140075 / 142818
Rules searched: 198; H1 eligible (>=500 non-overlapping): 196

| Rank | Rule | H1 N | H1 gross bps | H2 N | H2 gross bps | H2 net10 bps | H2 PF | H2 bootstrap 95% CI | Gate |
|---:|---|---:|---:|---:|---:|---:|---:|---|---|
| 1 | `LONG_ONLY|volume_z20:z2+persistence_5:p5` | 1013 | 0.646 | 1009 | -1.225 | -11.225 | 0.134 | [-2.48, -0.03] | FAIL |
| 2 | `LONG_ONLY|volume_z20:z1+persistence_5:p5` | 1413 | 0.596 | 1454 | -0.940 | -10.940 | 0.128 | [-1.99, -0.01] | FAIL |
| 3 | `LONG_ONLY|momentum_strength:q90+persistence_5:p5` | 1789 | 0.458 | 1948 | -0.697 | -10.697 | 0.110 | [-1.43, -0.02] | FAIL |
| 4 | `BOTH|volume_z20:z2+persistence_5:p5` | 1959 | 0.216 | 2068 | -0.995 | -10.995 | 0.148 | [-1.89, -0.22] | FAIL |
| 5 | `LONG_ONLY|momentum_strength:q90+imbalance_strength:q90` | 582 | 0.203 | 1371 | 0.147 | -9.853 | 0.056 | [-0.31, 0.62] | FAIL |
| 6 | `LONG_ONLY|momentum_strength:q75+persistence_5:p5` | 2652 | 0.174 | 2881 | -0.631 | -10.631 | 0.102 | [-1.20, -0.11] | FAIL |
| 7 | `LONG_ONLY|persistence_5:p5` | 3186 | 0.125 | 3377 | -0.651 | -10.651 | 0.097 | [-1.19, -0.17] | FAIL |
| 8 | `LONG_ONLY|volume_z20:z0+persistence_5:p5` | 2157 | 0.101 | 2267 | -0.696 | -10.696 | 0.111 | [-1.42, -0.07] | FAIL |
| 9 | `BOTH|volume_z20:z1+persistence_5:p5` | 2784 | 0.063 | 2954 | -0.878 | -10.878 | 0.136 | [-1.56, -0.26] | FAIL |
| 10 | `LONG_ONLY|momentum_strength:q50+persistence_5:p5` | 3109 | 0.047 | 3303 | -0.611 | -10.611 | 0.099 | [-1.14, -0.14] | FAIL |

## Guardrails

- 2024 and 2025 were not loaded by this experiment.
- H1 thresholds were frozen before H2 evaluation.
- Only one- or two-family rules from the preregistered protocol were searched.
- Primary results use non-overlapping five-minute positions.
- A rule had to exceed 10 bps gross in H2 and remain profitable after 10 bps round-trip cost.
