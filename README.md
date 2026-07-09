# ORACLE v3.2 AI Debug

AI MODE が RULE BASED のままになる原因を特定するためのデバッグ版です。

## 追加内容
- `api/risk.js` で OpenAI の HTTP ステータス、エラー詳細、レスポンス本文プレビューを取得
- 画面下部に `AI DEBUG` を表示
- `OPENAI_API_KEY` が読めているか、HTTP 401/429/model error などを確認可能

## Env
- `OPENAI_API_KEY` 必須
- `OPENAI_MODEL` 任意（未設定なら `gpt-4o-mini`）

## 使い方
1. GitHubへ全ファイル上書き
2. VercelでRedeploy
3. サイト下部の `AI DEBUG` を確認
4. `AI ANALYSIS ACTIVE` になったらデバッグ表示は次版で外します

APIキーは絶対に公開画面やスクリーンショットに写さないでください。
