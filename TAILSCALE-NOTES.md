# Tailscale Serve + DSH 設定メモ（スマホ接続のセット）

実測に基づく設定メモ。秘密（token、tailscale DNS名の完全形、内部IP）は書かない。

## 構成

```
スマホ (Android Chrome, tailnet)
  │  https://<machine>.<tailnet>.ts.net   ← tailscale serve (tailnet only, Funnel 無効)
  ▼
Linux host (tailscaled enabled)
  │  proxy → 127.0.0.1:3080
  ▼
dsh-web.service (systemd --user, enabled, Linger=yes)
  └─ flock single.lock で単一インスタンス保証
       ├─ ExecStartPre: guard-single-dsh.py（二重起動 fail-closed）
       ├─ ExecStartPre: startup.log truncate
       └─ ExecStartPost: update-login-urls.py（pc/mobile の URL ファイル更新, 0600）
```

## 確認済みの事実 (2026-09-07)

- serve は `https / → http://127.0.0.1:3080` のみ。証明書検証 OK、認証なし HTTPS は 401。
- スマホ端末: Android Chrome。接続経路・他端末の情報は記録しない。
- 通知許可 + SW 登録は `https` origin で実施（`http://<tailscale-ip>` では push 不可 — secure context 要件）。
- PWA manifest は DSH 本体が配信済み → ホーム画面追加からの起動でも notificationclick の focus が効く。

## 運用上の注意

- **dsh の再起動は会話ターンを切る**: セッションは append-only log で永続化、UI から再開可能。
  vLLM 等の別プロセス（root で動く）には無影響。GPU ジョブ稼働中は安易に restart しない（HANDOFF ルール）。
- **再起動後の URL 再発行**: token 付き URL は `~/.dsh/web-service/pc-login-url.txt` / `mobile-login-url.txt` (0600) に
  ExecStartPost で自動更新される。旧 Cookie は 30 日有効で再ログイン不要。
- 二重起動は禁止（guard が fail-closed）。テスト用の第二インスタンスは立てられないので、
  バンドルの検証は fake-ctx ハーネスで行う（README 参照）。
- 通知が鳴らないときの切り分け順:
  1. `~/.dsh/notify-push/vapid.json` が再起動後も残っているか（消えると全購読が無効化）
  2. `~/.dsh/web-service/startup.log` に `notify-push` エラーがないか
  3. スマホの Chrome サイト設定 → 通知が「許可」か / Android システム設定の Chrome 通知が有効か
  4. subscriptions.json の endpoint 数（404/410 掃除で 0 になっていないか）
