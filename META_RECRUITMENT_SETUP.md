# Instagram求人導線（SymmetryLab Career）

この導線は、既存のGoogle広告LP・Google Ads計測とは別のInstagram / Meta広告専用面です。
既存の `/consulting-career/` と `career_applications` は利用せず、`/recruitment/`、専用JavaScript/CSS、`recruitment_applications` テーブルを使います。

今回のMeta環境は、既存のVキャリ環境・個人運用環境を使わず、会社用に新規作成します。会社用メール欄には `info@symmetrylab.jp` を使用します。なお、Metaの管理者ログインでは会社メールだけでなく、管理者本人のFacebookアカウント情報・パスワード・認証が必要になる場合があります。

## 公開URL

- 求人一覧・確認用：`/recruitment/`
- 求人別LP：`/jobs/001/`
- 別求人の例：`/jobs/002/`

`/recruitment/` は求人一覧と運用確認用です。広告の遷移先は必ず `/jobs/<public_id>/` の求人別URLにしてください。LP本体は共通テンプレートですが、URL・求人情報・計測コンテキストは求人ごとに分かれます。

Instagram広告の遷移先には、求人別LPのURLへUTMを付けてください。

```text
/jobs/<public_id>/?utm_source=instagram&utm_medium=paid_social&utm_campaign=<campaign>&utm_content=<creative>
```

旧形式の `/recruitment/?job=<slug>`、`/recruitment/<slug>/` は確認用の後方互換です。新規の広告URLには使用しません。

## 求人データの差し替え

`recruitment/jobs.json` の1要素が1求人です。`public_id` は広告URLに使う短い求人ID（例：`001`）で一意にします。`slug` は内部識別用の半角英小文字・数字・ハイフンです。
`status` は公開時に `published`、準備中は `sample`、非公開は `draft` などに変更してください。応募受付を止める場合は `application_enabled` を `false` にします。

本番反映前に、サンプル求人の文言を承認済み求人情報へ置き換えてください。`sample` の求人はプレビュー専用で、`application_enabled` が `true` でも候補者データを保存できません。候補者データを受け付けるには、サンプルではない承認済み求人を `status: "published"` かつ `application_enabled: true` で公開します。

```json
{
  "public_id": "001",
  "slug": "example-role",
  "status": "published",
  "application_enabled": true,
  "is_sample": false,
  "title": "求人タイトル",
  "catch_copy": "キャッチコピー",
  "job_type": "職種",
  "company_name": "会社名",
  "location": "勤務地",
  "salary": "想定年収",
  "annual_holidays": "年間休日",
  "employment_type": "雇用形態",
  "bonus": "賞与",
  "remote": "リモート可否",
  "relocation": "転勤有無",
  "inexperienced_ok": "未経験可否",
  "company_features": ["会社特徴"],
  "responsibilities": ["仕事内容"],
  "requirements": ["必須要件"],
  "preferred": ["歓迎要件"],
  "highlights": ["その他訴求ポイント"],
  "application_id": "内部で管理する求人識別ID"
}
```

## フォームと保存

フォームは転職希望時期、現在の職種、社会人経験年数、希望勤務地、年齢、氏名、電話番号、メールアドレスの順に1問ずつ表示します。送信前にプライバシーポリシーと、提携する職業紹介事業者へ情報共有する可能性の説明への同意を取得します。

送信先は `POST /api/recruitment/applications` です。応募情報は `recruitment_applications` に保存され、`client_submission_id` によって同じ送信の二重登録を防ぎます。管理用の取得・更新APIは以下です。

- `GET /api/admin/recruitment/applications`
- `GET /api/admin/recruitment/applications?status=new`
- `PATCH /api/admin/recruitment/applications/{application_id}`

管理APIは `X-Admin-Key` ヘッダーを要求します。ステータスは `new`、`contacted`、`interview_scheduled`、`interview_completed`、`sent_to_wius`、`applied`、`in_selection`、`placed`、`rejected` を想定しています。提携先の名称・共有先・法的な説明文は、承認済みの運用情報に差し替えてください。

## 流入元とMeta計測

専用のlocalStorage領域 `symmetrylab_recruitment_attribution_v1` に、以下の値だけを保存して送信時にDBへ記録します。

- `utm_source` / `utm_medium` / `utm_campaign` / `utm_term` / `utm_content`
- `fbclid`
- `meta_campaign_id` / `meta_adset_id` / `meta_ad_id` / `meta_placement`
- `landing_page` / `first_touch_at` / `last_touch_at`

Meta Pixelは次の2つを同時に満たす場合だけ有効です。

```text
SYMMETRY_META_PIXEL_ID=<数字のPixel ID>
SYMMETRY_META_TRACKING_ENABLED=true
```

未設定・空欄・プレースホルダー・無効値では、Meta用スクリプトを読み込みません。候補者の氏名、メール、電話番号、年齢、職種、自由記述、UTM、`fbclid` はMetaイベントへ渡しません。

発火イベントは以下です。

- `PageView`：求人LP表示後
- `ViewContent`：求人LP表示後（求人IDと公開求人名のみ）
- `StartRegistration`：フォーム開始時
- `Lead`：新規応募がDBへ保存された後だけ。重複送信では発火しない

## Instagram / Facebook / Meta側で人が行う作業

以下は今回新規に作成するMeta側の作業です。既存のVキャリ環境は使用しません。現在、正式な新規環境としての完成判定は未完了です。誤って既存環境配下に作成された資産がある場合も、本番資産として扱わず、新規環境の作成後に整理します。

1. 採用窓口用のInstagramアカウントを新規作成し、`info@symmetrylab.jp`、Professional account、2段階認証、管理者を設定する
2. Facebookページを新規作成し、ページ名・プロフィール・連絡先・採用方針を承認する
3. Meta Business Portfolioを新規作成する
4. Instagramアカウント、Facebookページ、広告アカウントをBusiness Portfolioへ追加・関連付けする
5. 担当者・管理者へ必要な権限を割り当て、個人アカウントに依存しない運用にする
6. 広告アカウントを新規作成し、タイムゾーン・通貨・支払い方法・請求担当を確定する
7. Pixel / Datasetを新規作成し、関連するBusiness資産へ接続して実際のPixel IDを取得する
8. `symmetrylab.jp` のドメイン認証と、Meta側で要求されるBusiness / アカウント認証を完了する
9. Employment / Special Ad Categoryを含むMetaの採用広告要件をAds Managerで確認する
10. 求人内容、広告クリエイティブ、第三者提供・利用目的の法的文言を承認する
11. RenderへPixel IDを登録し、`SYMMETRY_META_TRACKING_ENABLED=true` を承認後に設定する
12. Meta Events Managerのテストイベントで、成功応募1件につきLead 1件になることを確認する
13. 承認済み求人へ差し替えた後、求人別LPのURLでキャンペーン・広告セット・広告を作成して公開する

### 法務確認用ドラフト

以下の同意文言は実装上のドラフトです。第三者提供先、利用目的、保存期間、問い合わせ先などを確定してから公開文言に置き換えてください。

> 本フォームで取得した情報は、求人の詳細案内、応募可否の確認、転職支援およびこれらに付随する連絡のために利用します。必要に応じて、提携する職業紹介事業者へ情報を提供する場合があります。提供先、利用目的、保存期間などの詳細は、確定版のプライバシーポリシーをご確認ください。
