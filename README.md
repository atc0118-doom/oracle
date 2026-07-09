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


## v11.1 Evidence Gate Hotfix

- Regions with `0 signals` or `0 sources` are now hard-gated to `score: 0`, `change: +0`, and `No verified signal`.
- Local/low-relevance disaster noise, including Bay Area / Salinas-style small earthquake headlines and earthquakes under M6.0, is filtered out of geopolitical scoring.
- Disaster monitoring remains separated from geopolitical risk scoring.
- Source pills now explicitly label `Verified` and `Limited` states so border differences are understandable rather than looking like a UI bug.
