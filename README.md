# ORACLE v5.2 AI Resilience Patch

- Keeps AI running when GDELT returns 429
- Uses short server cache when available
- Uses conservative baseline signals when public source retrieval is degraded
- Keeps `/api/risk` alive instead of falling fully into fallback mode
- Preserves Global/Japanese post generation and tags
