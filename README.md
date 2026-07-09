# ORACLE | World Risk Intelligence

A silent world-risk intelligence terminal.

## v2.1 AI Engine

- Public world-news signal ingestion via GDELT
- Rule-based risk scoring
- Optional LLM-assisted assessment via OpenAI API
- Dynamic WHY SCORE? calculation
- Auto-ranked hot regions
- 60-second refresh
- Hidden admin terminal: `?admin=doom`

## Optional AI setup on Vercel

Add Environment Variables:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` optional, default: `gpt-4.1-mini`

If no API key is set, ORACLE uses rule-based analysis.
