# dsh-notify-push 導入メモ (2026-09-07)

## 何が入ったか
- `ask_user_question` が提示されたときにスマホ (Android Chrome) へ Web Push 通知を送る dsh バンドル。
- ホスト half: `user-questions/request` waterfall を prepend で先頭購読し、全購読者へ push を送ってから next() で委譲する（質問の回答は決して消費しない）。
  - ルート: `/api/push/vapid`, `/api/push/subscribe`, `/api/push/unsubscribe`（connection.requestRejection で /api と同一の認証 fence）、`/push/sw.js`（静的、Service-Worker-Allowed: /）。
  - VAPID 鍵: `~/.dsh/notify-push/vapid.json` (0600, 初回起動時に自動生成)
  - 購読: `~/.dsh/notify-push/subscriptions.json` (0600)
- ブラウザ half: `/notify` コマンド (ON/OFF) で通知許可 + Push 購読。ページ起時の即時ローカル通知にも対応。
- Service Worker: push 受信 → `requireInteraction: true` で通知表示、クリックでアプリをフォーカス。

## 反映手順（ユーザー実施）
1. `systemctl --user restart dsh-web.service`（実行中のターンが切れるので閉じたタイミングで）
2. PC/スマホで DSH を開き直す。
3. `/notify` コマンド → 「ON にする」→ 通知許可ダイアログを承認。
4. 確認: エージェントに `ask_user_question` を提示させて、スマホに通知が来ることを確認。

## 注意
- iOS Chrome は A2HS が必要。Android Chrome はそのまま動く。
- 通知はテールネット上のどのブラウザから購読しても届く（PC Chrome からも ON にできる）。
- web-push の 404/410 応答時に購読を自動掃除する。
