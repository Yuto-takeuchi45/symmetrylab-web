# Instagram広告 下書き

このファイルは広告配信前の下書きです。公開前に、求人掲載・送客先・個人情報の取扱いについて必要な許諾と文言確認を行うこと。

## 配信先

- キャンペーン名: `SymmetryLab Career｜Instagram広告｜採用LP誘導`
- 目的: Webサイトへのトラフィック（LP上で問い合わせを受け付ける構成）
- 配置: Instagram Feed / Stories / Reels（クリエイティブの安全領域を確認してから有効化）
- 特別広告カテゴリ: Employment（Metaの現行UIで選択を確認）
- 遷移先:
  `https://symmetrylab.jp/career-check/?utm_source=instagram&utm_medium=paid_social&utm_campaign=consulting_career&utm_content=creative_01`
- クリエイティブ: `ad_creative/assets/instagram-consulting-01.png`

## 広告文案

### メインテキスト

キャリアの次の選択肢を探している方へ。  
事業変革・DX・IT戦略に関わるコンサルタントポジション。  
これまでの経験や希望条件を、12問のキャリア診断で整理してみませんか。

### 見出し

事業変革を担うコンサルタント

### 説明

経験・希望条件を12問で整理

### CTA

詳しくはこちら

## 公開前の差し替え項目

1. LPの受信者名、利用目的、保存期間、問い合わせ窓口を確定する。
2. Meta Pixel ID と配信対象地域・年齢・日予算を設定する。
3. 広告カテゴリごとにUTMを設定する（例：`consulting_career`、`realestate_career`、`it_career`）。
4. 公開URLの表示、フォーム送信、重複送信防止、MetaのLead計測を本番環境で確認する。
5. 広告本文・画像・遷移先を人手で最終確認し、Metaの「確認して公開」を実行する。

現時点では公開URLが未デプロイのため、この下書きを公開してはいけない。
