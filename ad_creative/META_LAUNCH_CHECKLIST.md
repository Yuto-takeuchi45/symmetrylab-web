# SymmetryLab Instagram広告 配信前チェックリスト

このチェックリストは、既存HP・既存LPを変更せず、`ad_creative/` の広告導線だけを配信するためのものです。

## 現在実装済み

- `symmetrylab-career-quiz-lp.html`：Wius型の冒頭二択＋12ステップUI
- `jobs.json`：任意で求人情報を紐づける場合のデータファイル
- `/api/ad-creative/jobs/<public_id>`：広告用求人表示API
- `/api/ad-creative/applications`：12ステップ回答・同意・流入情報の保存API
- `/api/admin/ad-creative/applications`：登録情報の確認・ステータス更新API
- Meta Pixel：Pixel IDと有効化フラグが揃った場合だけ読み込み
- `Lead`：DB保存成功後、重複でない登録に限り発火

## 配信前に人が確定する項目

1. 送客先となる提携先（職業紹介事業者等）
2. 提携先へ渡す項目、利用目的、保存期間、問い合わせ先
3. 匿名求人の最新条件と、広告で使う年収・勤務地・働き方・必須条件
4. LPの受信者名、利用目的、保存期間、問い合わせ先の確定
5. `SYMMETRY_META_PIXEL_ID` と `SYMMETRY_META_TRACKING_ENABLED=true`
6. `ADMIN_KEY`、送信通知先、ドメイン認証、Business認証
7. Meta Ads Managerの採用広告カテゴリ、配信地域、予算、開始日時

## Meta Ads Managerで行うこと

- Instagram Professionalアカウント、Facebookページ、Business Portfolio、広告アカウントを同じ会社資産へ紐付ける
- `symmetrylab.jp` のドメイン認証と必要なBusiness認証を完了する
- 採用広告に該当する設定を確認する
- キャンペーン、広告セット、広告をまず停止状態で作成する
- 最終URL例：

```text
https://symmetrylab.jp/career-check/?utm_source=instagram&utm_medium=paid_social&utm_campaign=consulting_career&utm_content=creative_01
```

- Events Managerのテストイベントで `PageView` → `ViewContent` → `StartRegistration` → `Lead` を確認する
- 送信成功1件につき`Lead`が1件、再送では追加発火しないことを確認する
- 予算・配信地域・開始日時・公開ボタンは最後にオーナーが確認する

## 公開を止める条件

- 実求人の一次情報と広告・LPの表示が一致していない
- 提携先・第三者提供の同意文面が未確定
- Meta Pixel IDまたはドメイン認証が未設定
- 管理者が登録情報を確認できない

この状態で広告を公開すると、LPは表示されても登録受付や送客設定が未確定のままになるため、公開しません。
