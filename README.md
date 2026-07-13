# ORACLE Global v13.2 — Admin Terminal Restore

投稿生成パネルを復旧する差し替え版です。

## 修正内容
- `?admin=doom` で ADMIN TERMINAL を表示
- HTML側にパネルが無い場合も app.js が自動生成
- GLOBAL POST / JAPANESE POST / COPY / REFRESH NOW を復旧
- COPY失敗時のフォールバックを追加
- スマホ表示を調整

## GitHubで上書き
- index.html
- app.js
- style.css

API側の `risk.js` や環境変数は変更しません。
