ORACLE v13.2 Reliability Fix

Files to overwrite:
- api/risk.js
- app.js
- style.css

Fixes:
- Timeline tags now come from the exact article classification used by scoring.
- Duplicate source badges are deduplicated and shown once.
- Regions with 0 signals / 0 sources are excluded from rankings.
- Reliability and cross-check labels now include plain-language definitions.
- API exposes LIVE SOURCES / CACHED-DEGRADED / BASELINE status.
