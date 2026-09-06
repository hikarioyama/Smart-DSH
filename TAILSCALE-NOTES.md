# Tailscale Serve + DSH — リモートアクセスとスマホ通知のセット設定メモ

実測（2026-09-07, Arch Linux）に基づく設定メモ。秘密（token、tailscale ドメインの完全形、
内部 IP）は書かない。他環境で再現する際に machine 固有の部分は「オプション」として分離した。

## 最小構成（誰でも再現できる形）

```
スマホ (Android Chrome, tailnet)
  │  https://<machine>.<tailnet>.ts.net   ← tailscale serve --bg (tailnet only, Funnel 不使用)
  ▼
Linux box (tailscaled 有効)
  │  proxy → 127.0.0.1:3080
  ▼
DSH web server (127.0.0.1 bind)
```

1. DSH を 127.0.0.1 bind で起動（`--trusted-host <machine>.<tailnet>.ts.net` を忘れない）
2. `tailscale serve --bg 3080`（旧 CLI は `tailscale serve https / http://127.0.0.1:3080`）
3. スマホの Chrome で `https://<machine>.<tailnet>.ts.net` を開いて DSH 認証
4. `/notify` → ON → 通知許可 → push 購読が `~/.dsh/notify-push/subscriptions.json` に載る

### secure context 要件（ここが最重要）

Web Push の購読 (`pushManager.subscribe`) は secure context でのみ動く。
`http://<tailscale-ip>:3080` で直接開いた場合は**購読自体ができない**。
`https://...ts.net` 経由なら証明書は Tailscale が自動発行するので追加作業なし。

## machine 固有のオプション（このリポジトリの作者環境では使用、必須ではない）

- **systemd --user unit 化** (`~/.config/systemd/user/dsh-web.service` + `Linger=yes`):
  再起動後も自動起動。README に最小形がある。
- **単一インスタンス保証**: `flock` + `/proc` を走査して dsh ランチャーの二重起動を
  fail-closed で拒否する guard script。DSH は同一ロックを抱えて動くため、テスト用の
  第二インスタンスは立てられない → バンドルの検証は README の fake-ctx ハーネスで。
- **起動時の token 付き URL 自動更新**: ExecStartPost で PC/モバイル用のログイン URL を
  0600 ファイルに書き出す。cookie は 30 日有効なので通常は再ログイン不要。

## 確認済みの事実 (2026-09-07)

- serve は `https → http://127.0.0.1:3080` のみ。証明書検証 OK、認証なし HTTPS は 401。
- スマホ: Android Chrome。ブラウザごとに通知を購読できる。
- PWA manifest は DSH 本体が配信済み → ホーム画面追加からの起動でも notificationclick の focus が効く。
- Android Chrome は追加要件なし。**iOS Chrome は A2HS (Add-to-Home-Screen) 必須** (16.4+)。

## 運用上の注意

- **DSH の再起動は実行中の会話ターンを切る**: セッションは append-only log で永続化、
  UI から再開可能。モデルサーバー等の別プロセスには無影響だが、GPU ジョブ稼働中は安易に
  restart しない。
- **通知が鳴らないときの切り分け順**:
  1. `~/.dsh/notify-push/vapid.json` が再起動後も残っているか（消えると全購読が無効化。
     意図的に鍵をリセットした場合は subscriptions.json も消す）
  2. サーバーログに `notify-push` エラーがないか
  3. スマホの Chrome サイト設定 → 通知が「許可」か / Android システム設定の Chrome 通知が有効か
  4. `subscriptions.json` の endpoint 数（404/410 掃除で 0 になっていないか）
- serve の解除は `tailscale serve reset`（全 serve 設定が消えるので部分的なら status で確認）。
