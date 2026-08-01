# コンサル転職支援LP・Google検索広告 運用仕様書

対象LP: `/consulting-career/`

この資料は、コンサル転職支援LPへGoogle検索広告から集客する際に、画面・申込・広告計測・申込管理を同じ前提で運用するための仕様書です。

広告の成果は「広告をクリックされたか」だけではなく、次の流れで確認します。

```text
Google広告
  ↓ gclid / UTM
コンサル転職支援LP
  ↓ フォーム送信
申込API・申込DB
  ├─ 管理画面で候補者情報を確認
  └─ generate_lead → GTM → GA4 / Google広告
```

## 1. 画面とURL

### 公開ページ

| 画面 | URL | 見られる内容・用途 |
| --- | --- | --- |
| コンサル転職支援LP | `/consulting-career/` | 広告流入者向けのサービス説明、支援内容、利用の流れ、FAQ、無料相談フォーム |
| コンサル転職支援LP（スラッシュなし） | `/consulting-career` | 同じLP。広告の最終URLは `/consulting-career/` に統一する |
| プライバシーポリシー | `/privacy.html` | フォームの同意先。LPとフォームからリンク |
| 運営会社 | `/company.html` | 会社情報。LPフッターからリンク |

ローカルプレビューでは、現在このプロジェクトを次のURLで確認できます。

```text
http://127.0.0.1:8012/consulting-career/
```

### 申込管理画面

| 画面 | URL | 見られる内容・用途 |
| --- | --- | --- |
| コンサル転職相談 申込管理 | `/consulting-career-admin.html` | 申込者情報、希望日時、広告流入情報、対応ステータス、管理メモ |

この画面は一般ユーザー向けではありません。広告やLPからリンクせず、管理者だけがURLを知っている状態で運用します。

申込者の氏名・メールアドレス・電話番号を表示するため、HTTPS、アクセス制限、強い管理キーを必須にします。

### システムAPI

| API | 用途 | 主な利用者 |
| --- | --- | --- |
| `GET /api/tracking-config` | GTM・GA4・Google広告の公開用IDを環境変数から取得 | LPの計測JavaScript |
| `GET /api/available-dates?training_type=case_interview` | ケース面接と共通の空き日程を取得 | LPの日時選択UI |
| `GET /api/available-dates?training_type=case_interview&date=YYYY-MM-DD` | 指定日の空き時間と残席数を取得 | LPの日時選択UI |
| `POST /api/consulting-career/applications` | 無料相談申込を保存 | LPのフォーム |
| `GET /api/admin/consulting-career/applications` | 申込一覧を取得 | 管理画面 |
| `PATCH /api/admin/consulting-career/applications/{application_id}` | 対応ステータス・管理メモを更新 | 管理画面 |
| `GET /api/admin/consulting-career/applications/{application_id}/history` | ステータス変更履歴を取得 | 管理・将来のCRM連携 |
| `GET /api/admin/consulting-career/applications/export` | 申込をCSVで出力 | 管理画面・社内集計 |

管理APIは`X-Admin-Key`ヘッダーで認証します。申込情報を含む管理APIへ、URLクエリの`?key=`でアクセスする仕様ではありません。

## 2. LPの機能

LPには次の順番で情報を配置しています。

1. コンサル転職支援の概要
2. 対象となる転職希望者
3. キャリア相談から入社までの支援内容
4. SymmetryLabを利用する理由
5. 利用の流れ
6. FAQ
7. 無料相談申込フォーム
8. 運営会社・プライバシーポリシーへの導線

フォームはページ内にあり、CTAを押すとフォーム位置へ移動します。

### フォームの入力項目

| 項目 | 必須 | 入力方式 | 保存先 |
| --- | --- | --- | --- |
| 氏名 | 必須 | テキスト | 申込DB |
| メールアドレス | 必須 | メール入力 | 申込DB |
| 電話番号 | 必須 | 電話番号入力 | 申込DB |
| 現在の業界 | 必須 | セレクトボックス | 申込DB |
| 現在の職種 | 必須 | セレクトボックス | 申込DB |
| 社会人経験年数 | 必須 | セレクトボックス | 申込DB |
| 現在の年収帯 | 必須 | セレクトボックス | 申込DB |
| 希望するコンサル領域 | 必須 | ラジオボタン | 申込DB |
| 転職希望時期 | 必須 | セレクトボックス | 申込DB |
| 現在の転職活動・選考状況 | 必須 | セレクトボックス | 申込DB |
| 相談内容・志望ファーム | 任意 | テキストエリア | 申込DB |
| 相談希望日時 | 任意 | カレンダー・時間選択 | 申込DB |
| 個人情報の取扱いへの同意 | 必須 | チェックボックス | 同意日時として申込DB |

「日時を選ばず、後で調整する」こともできます。その場合、申込は保存されますが、予約枠は消費しません。

## 3. 申込処理の仕様

### 送信の流れ

1. ブラウザ側で必須項目・メール形式・同意を確認
2. 送信ボタンを無効化し、送信中表示に切り替え
3. `POST /api/consulting-career/applications`へJSONを送信
4. サーバー側で再度入力を検証
5. 申込DBへ保存
6. サーバーが`application_id`を発行
7. 完了画面を表示
8. `generate_lead`を発火

API保存に失敗した場合は、完了画面を表示しません。計測処理だけが失敗しても、保存済みの申込を失敗扱いにしない設計です。

### 二重送信防止

フォーム送信時に`client_submission_id`を発行し、タブの`sessionStorage`へ保存します。

同じIDを再送した場合、DBの一意制約により同じ申込IDを返します。これにより、通信再試行で申込レコードが増殖しません。

サーバー発行の`application_id`は、次の識別子として使用します。

- `application_id`
- `lead_id`
- `event_id`
- `transaction_id`

完了後に新規申込を行う場合は、フォームのリセット操作を使用します。

### 申込DB

申込は既存の有料予約データとは別の`career_applications`テーブルへ保存します。

保存されるものは次の4種類です。

- 候補者情報
- 希望日時・相談内容
- 個人情報同意日時・ポリシーバージョン
- GCLID、UTM、ランディングページ、初回・最終流入日時

申込保存時点では、提携人材紹介会社や外部エージェントへ自動送信していません。

## 4. 面談日時の仕様

### 時間帯

| 曜日 | 選択可能時間 |
| --- | --- |
| 平日 | 19:00〜23:00 |
| 土日 | 9:00〜20:00 |

曜日・時刻の判定は`Asia/Tokyo`（日本時間）を基準にします。

### ケース面接との枠共有

転職相談の日時選択には、既存のケース面接予約の空き日程データを利用しています。

したがって、現在はケース面接とコンサル転職相談が同じ担当者・同じ時間枠を共有します。

残席数は次を合算して計算します。

```text
既存のケース面接予約
+ その日時を選択したコンサル転職相談申込
= 使用済み枠数
```

「後日調整」を選んだ申込や、日時を選んでいない申込は枠数に含めません。対応ステータスが`closed`になった申込は枠数から除外します。

### 空き枠の判定

表示時と申込保存時の両方で、次を確認します。

- `available_slots`に登録された日時か
- `time_slots`に登録された時間か
- `blocked_dates`に含まれていないか
- 過去日時ではないか
- 既存予約と申込を合算して満席になっていないか

画面表示後に別の申込が入った場合は、送信時に再検証され、満席なら申込を保存せず別日時を案内します。

`available_slots`が空の設定では、将来日を基本的に選択可能とし、`time_slots`と曜日・時間帯で絞り込みます。特定日だけを受付する場合は`available_slots`へ日付と時間を登録します。

## 5. 広告流入情報の仕様

### 取得するURLパラメータ

LP表示時に、次のパラメータを読み取ります。

```text
gclid
gbraid
wbraid
utm_source
utm_medium
utm_campaign
utm_term
utm_content
```

Google広告の自動タグ設定が有効なクリックでは、通常`gclid`がGoogle広告によってURLへ付与されます。手動でUTMを設定した広告では、UTMが付与されます。

URLに広告パラメータがない場合も申込は可能です。その場合、広告識別情報は空欄となり、計測イベントでは`direct`、申込DBの流入元では`unknown`として扱います。

### 保存場所

流入情報は次の順番で扱います。

```text
URL
  ↓
ブラウザのlocalStorage
  ↓
フォームの非表示項目
  ↓
申込API
  ↓
career_applications
```

広告流入情報は申込DBへ保存しますが、氏名・メールアドレス・電話番号・相談内容はGA4イベントへ渡しません。

現実の広告運用では、GCLID・UTMの保持期間をGoogle広告のコンバージョン計測期間に合わせて決めます。現在のコードではブラウザ保存期間を自動削除していないため、本番前に社内方針を確定してください。

## 6. 計測イベント仕様

| イベント | 発火タイミング | 主な用途 | コンバージョン |
| --- | --- | --- | --- |
| `career_lp_view` | LPスクリプト読み込み時 | LP閲覧数 | 参考指標 |
| `career_cta_click` | CTAクリック時 | CTAクリック率 | 参考指標 |
| `career_form_start` | フォーム初回フォーカス・入力時 | フォーム開始率 | 参考指標 |
| `career_form_submit_attempt` | 送信を試みたとき | 送信試行数 | 参考指標 |
| `career_form_validation_error` | 入力エラー時 | 入力改善 | 参考指標 |
| `generate_lead` | API保存成功後 | 無料相談申込完了 | 主要コンバージョン |

### `generate_lead`の条件

次の場合だけ発火します。

- クライアント側の入力チェックを通過
- APIが成功レスポンスを返す
- サーバー発行の`lead_id`を取得
- 完了処理へ進む

次の場合は発火しません。

- 必須項目エラー
- 同意漏れ
- サーバー側バリデーションエラー
- API保存エラー
- 通信エラー

### `generate_lead`に含まれる情報

- `lead_id`
- `event_id`
- `transaction_id`
- `appointment_mode`
- `attribution_source`
- `gclid`、`gbraid`、`wbraid`
- 各UTM

個人情報は含めません。

## 7. GTM・GA4・Google広告の構成

### タグ読み込みの優先順位

LPは`GET /api/tracking-config`から公開可能なIDを取得します。

1. 有効なGTMコンテナIDがあればGTMを読み込む
2. GTMがない場合だけ、GA4またはGoogle広告の直接タグをフォールバックとして読み込む
3. IDが空欄またはプレースホルダーなら外部タグを読み込まない

本番ではGTMを入口にし、GTMと直接`gtag.js`を同時に有効化しないでください。

### 広告IDを登録するタイミング

広告を出す前に、計測に使うIDをRenderの環境変数へ登録します。ソースコードや申込フォームへ直接入力するものではありません。

1. GA4プロパティとGTMコンテナを用意し、GTMコンテナIDを取得する
2. Google広告で「申込完了」のコンバージョンアクションを作成する
3. 表示されたGoogle広告コンバージョンIDとラベルを控える
4. Renderの環境変数へ`SYMMETRY_GTM_CONTAINER_ID`、必要に応じて`SYMMETRY_GOOGLE_ADS_CONVERSION_ID`と`SYMMETRY_GOOGLE_ADS_CONVERSION_LABEL`を設定する
5. 再起動後、`/api/tracking-config`で公開用IDが反映されたことを確認し、GTMプレビューでテストする

推奨構成では、GTMコンテナIDをLPに読み込ませ、Google広告のコンバージョンID・ラベルはGTMのGoogle広告コンバージョンタグへ設定します。LP側のGoogle広告ID環境変数は、GTMを使えない場合の直接タグ用です。広告キャンペーンIDをLPやDBへ登録する必要はありません。

Google広告からのクリックでは、Google広告側の設定によりURLへ`gclid`が付く場合があります。付いた場合はLPが自動取得して申込レコードへ保存します。広告管理画面のキャンペーン名などは、広告の最終URLに設定したUTMを通じて保存します。

### GTMで作成するもの

データレイヤー変数:

| 変数名 | データレイヤーキー |
| --- | --- |
| `DLV - lead_id` | `lead_id` |
| `DLV - transaction_id` | `transaction_id` |
| `DLV - appointment_mode` | `appointment_mode` |
| `DLV - gclid` | `gclid` |
| `DLV - utm_campaign` | `utm_campaign` |

カスタムイベントトリガー:

```text
generate_lead
```

GA4イベントタグ:

- イベント名: `generate_lead`
- 個人情報をパラメータへ追加しない
- GA4側で必要に応じてキーイベントとして設定

Google広告コンバージョンタグ:

- 同じ`generate_lead`トリガーを使用
- コンバージョンID・ラベルを設定
- 取引IDに`{{DLV - transaction_id}}`を設定
- Google広告側のコンバージョン数は「1回」

Google広告タグを主要コンバージョンにする場合、同じ`generate_lead`をGoogle広告へGA4インポートしないでください。両方を主要コンバージョンにすると二重計測になります。

## 8. 管理画面の使い方

### 申込を確認する

1. `/consulting-career-admin.html`を開く
2. 管理キーを入力
3. 「申込を読み込む」を押す
4. 一覧で申込者、希望日時、流入元を確認
5. 必要に応じてステータスを更新
6. 対応内容を管理メモへ入力
7. 「更新」を押す

一覧には次の情報が表示されます。

- 受付日時
- 氏名、メールアドレス、電話番号
- 希望日時
- 流入元、キャンペーン、GCLIDの有無
- 対応ステータス
- 管理メモ

### ステータスの運用例

```text
new
  ↓ 連絡した
contacted
  ↓ 有効候補者と判断
qualified_candidate
  ↓ 提携先へ紹介
agent_referral
  ↓ 選考中
interview
  ↓ 入社
joined
```

対象外・対応終了の場合は`closed`にします。`closed`にした日時選択申込は、相談枠の残席計算から除外されます。

### 通知メール

申込がDBへ保存された後、次の通知を送ります。

- `ADMIN_EMAIL`に設定した管理者宛て：申込内容、希望日時、流入元、GCLIDなど
- 申込者のメールアドレス宛て：申込受付のお知らせ、申込ID、日時確定に関する案内

メール送信は申込保存後のバックグラウンド処理です。メールが失敗しても申込自体は成功扱いとなり、管理画面の申込レコードを正本として確認します。Renderのログで送信結果を確認できます。

送信サービスはRenderではResendを推奨します。`RESEND_API_KEY`と、Resendで認証済みの`RESEND_FROM_EMAIL`を設定してください。Resend未設定時は既存のSMTP設定（`SMTP_EMAIL`、`SMTP_PASSWORD`など）を使用します。`ADMIN_EMAIL`はカンマ区切りで複数指定できます。

### CSVを出力する

管理画面の「CSV出力」を押すと、次のファイル名で保存されます。

```text
consulting-career-applications.csv
```

CSVには個人情報が含まれるため、共有先・保存場所・保存期間を管理してください。

## 9. データをどこで見るか

### 候補者の個人情報・対応状況

管理画面で確認します。

```text
/consulting-career-admin.html
```

Google AnalyticsやGoogle広告では、氏名やメールアドレスを確認しません。

### LP・フォームの行動

GA4で確認します。

- リアルタイムレポート: 直近のイベント確認
- DebugView: GTMプレビュー中のイベント確認
- イベントレポート: `career_lp_view`、`career_cta_click`などの集計
- キーイベント: `generate_lead`の申込完了数

### 広告の成果

Google広告で確認します。

- コンバージョン概要: 申込完了数
- キャンペーン: キャンペーン別の費用・クリック・申込
- 検索語句: 実際に検索された語句と申込
- コンバージョン診断: タグが発火しているか

広告成果の最終的な候補者情報は、Google広告ではなく管理画面の申込ID・GCLIDと照合します。

## 10. 環境変数

### 計測・申込管理

| 環境変数 | 内容 |
| --- | --- |
| `SYMMETRY_GTM_CONTAINER_ID` | 本番GTMコンテナID |
| `SYMMETRY_GA4_MEASUREMENT_ID` | GTM未使用時のGA4測定ID |
| `SYMMETRY_GOOGLE_ADS_CONVERSION_ID` | 直接タグ用のGoogle広告コンバージョンID |
| `SYMMETRY_GOOGLE_ADS_CONVERSION_LABEL` | 直接タグ用のGoogle広告コンバージョンラベル |
| `ADMIN_KEY` | 管理APIの認証キー。強い秘密値を設定 |
| `ADMIN_EMAIL` | 新規申込通知の宛先。カンマ区切りで複数指定可能 |
| `RESEND_API_KEY` | Resendの送信用APIキー。Renderでは推奨 |
| `RESEND_FROM_EMAIL` | Resendで認証済みの送信元メールアドレス |
| `RESEND_FROM_NAME` | 送信元表示名 |
| `PRIVACY_POLICY_VERSION` | 申込時に保存する同意文面のバージョン |

### サーバー運用

| 環境変数 | 内容 |
| --- | --- |
| `BASE_URL` | 本番サイトの正式URL。送信元チェックや既存決済でも使用 |
| `DB_PATH` | 申込・予約DBの保存場所 |
| `TRAINING_DATES_PATH` | 空き日程JSONの保存場所 |

`tracking.env.example`は値の例であり、本番の実値はソースコードへ直接書き込みません。

### RenderのDB

現在のRender構成は、Render Postgresではなく、Renderの永続ディスク上に既存のSQLite DBを保存する構成です。`render.yaml`で`/var/data`を永続ディスクとしてマウントし、`DB_PATH=/var/data/bookings.db`を指定しています。申込フォームのDB接続先はこの既存DBで、起動時に申込用テーブルが作成されます。永続ディスクを外したり、`DB_PATH`を一時領域へ変更したりするとデータが失われるため、本番では変更しないでください。

## 11. 本番公開前チェックリスト

### サーバー

- [ ] `BASE_URL`を本番URLへ設定
- [ ] 強い`ADMIN_KEY`を秘密管理機能から設定
- [ ] DBの永続ディスク、バックアップ、復旧手順を確認
- [ ] HTTPSで公開
- [ ] `ADMIN_EMAIL`とResendまたはSMTPを設定し、管理者・申込者への通知をテスト
- [ ] 個人情報の保存期間・削除手順を決定
- [ ] 管理画面のアクセス元を制限
- [ ] レート制限・ボット対策を検討

### LP・フォーム

- [ ] 本番LP URLを広告の最終URLへ設定
- [ ] スマートフォンで入力・送信を確認
- [ ] 必須エラー、通信エラー、完了画面を確認
- [ ] 空き日時、満席、ブロック日の表示を確認
- [ ] プライバシーポリシーの内容を確定

### Google広告・GTM・GA4

- [ ] GTMコンテナを本番用に設定
- [ ] `generate_lead`トリガーを作成
- [ ] GA4イベントタグを設定
- [ ] Google広告コンバージョンタグを設定
- [ ] Google広告の取引IDに`transaction_id`を設定
- [ ] Google広告のコンバージョン数を「1回」に設定
- [ ] GA4インポートとGoogle広告タグを二重に主要CVへしない
- [ ] GTMプレビューで成功時1回、失敗時0回を確認
- [ ] GA4 DebugViewで個人情報がないことを確認
- [ ] Google広告のタグ診断を確認

## 12. 将来のオフラインコンバージョン

現在は自動送信していませんが、申込時点で次の情報を保存しています。

- `lead_id`
- `gclid`、`gbraid`、`wbraid`
- 申込日時
- 対応ステータス
- ステータス変更履歴

将来は、次の段階をGoogle広告へ別コンバージョンとして送信できます。

```text
無料相談申込
→ 有効候補者
→ 提携先紹介
→ 入社
```

オフライン連携を実装する際は、クリックID、コンバージョン日時、コンバージョン名、重複送信防止、送信済み管理を追加で設計します。

## 13. 現在の制限事項

- 申込保存後のメール通知は実装済み。ResendまたはSMTPの環境変数設定が必要
- Slack通知は未実装
- 提携人材紹介会社やCRMへの自動連携は未実装
- Google広告へのオフラインコンバージョン自動送信は未実装
- CAPTCHA・本格的なレート制限は別途導入が必要
- GCLID・UTMの保存期限は本番運用方針に合わせて設定が必要
- ケース面接と転職相談は現在、同じ時間枠・定員を共有

この資料の内容と実際の管理画面・広告アカウント設定が一致していることを、本番公開前に必ず確認してください。
