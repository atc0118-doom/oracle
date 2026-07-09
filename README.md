# ORACLE v6.0 Reliability Terminal

Final public-release direction:

- Separates FACTS / AI ASSESSMENT / 24H OUTLOOK.
- Adds SOURCE CONFIDENCE and verification language.
- Keeps AI Analysis Active, GDELT resilience, Global/Japanese X post generation.
- Adds AI reasoning lines inside WHY SCORE.
- Uses cautious, source-bound language and avoids unsupported definitive claims.

Deploy:
1. Upload all files and folders.
2. Keep `api/`, `assets/`, `app.js`, `index.html`, `style.css`, `package.json`.
3. Redeploy on Vercel.

Environment:
- `OPENAI_API_KEY` required for AI ANALYSIS ACTIVE.
- Optional `OPENAI_MODEL`, default: `gpt-4o-mini`.
