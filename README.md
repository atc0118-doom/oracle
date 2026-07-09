# ORACLE v8.0 Reliability Core

Changes:

- Fixed TOP EVENT mismatch risk: title, summary, source and URL now stay bound to the same selected article.
- Removed unsafe AI top-event merge behavior.
- Separated source types: REPORTING, OFFICIAL, DATA FEEDS, EVENT / AGGREGATION.
- Replaced AI-confidence framing with EVIDENCE STRENGTH.
- FACTS no longer treat official statements as independent reporting.
- Maintains multi-source engine, evidence panel, WHY SCORE, and Global/Japanese post generation.

Deploy by uploading all files and redeploying on Vercel.
