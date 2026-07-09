# ORACLE v9.0 Scoring Core

Changes:
- Dynamic driver scoring from current article/category signals instead of fixed-looking template values.
- TOP CONTRIBUTORS added so the global score shows which regions are actually driving the index.
- SCORE BRIDGE added to explain Raw Score → Global Risk Index.
- TOP EVENT summary is source-bound and tied to the selected article only.
- 24H TIMELINE uses source time labels instead of fake minute offsets when timestamps are available.
- AI Confidence wording replaced with Evidence Strength.
- Reporting / Official / Data Feed separation retained.

Deploy:
Upload all files to GitHub and redeploy on Vercel.


## ORACLE v11.0 Explainable Intelligence Engine

- Dynamic driver scores include contribution points, signal weight and source count.
- Top Contributors use index contribution points instead of percentages.
- Hot Regions remain regional risk scores, separated from global contribution.
- Raw-to-Index bridge explains stability, duplicate/noise, and global synchronization adjustments.
- Top Event summary is bound to the selected article and not merged with unrelated timeline signals.

## v12.0 Zero Evidence Gate
- Contributor rows now hard-gate zero-evidence regions: 0 signals or 0 sources always displays `No verified signal`, `0 signals`, `0 sources`, and `+0 pts`.
- The API now includes `signals` and `sources` in contributor payloads so the UI cannot infer impact from a region score alone.
- Local low-relevance disaster stories such as small California earthquakes from local outlets are excluded from geopolitical scoring.
- News queries no longer pull generic earthquake terms; USGS remains the dedicated disaster source.
