# Google検索広告 開始準備

対象LP: `/consulting-career/`

この資料は、ローカル・プレビュー環境で計測設計を確認し、本番のタグIDを設定するための手順です。今回の実装では、本番タグIDをソースコードへ書き込んでいません。

## 実装済みの構成

- `js/consulting-career-tracking.js` がLP専用の `dataLayer` イベントを発火します。
- `/api/tracking-config` が環境変数から公開可能なタグIDだけを返します。
- `SYMMETRY_GTM_CONTAINER_ID` が有効な場合はGTMを読み込みます。GTMが未設定で、GA4またはGoogle広告のIDが有効な場合だけ、フォールバックとしてgtag.jsを読み込みます。
- IDが空欄または `XXXX` のプレースホルダーの場合、外部タグは読み込みません。
- 申込内容、氏名、メールアドレス、電話番号、自由記述は `dataLayer` とGA4へ送信しません。

## 環境変数

`tracking.env.example` の値を、実行環境の環境変数として設定します。

| 環境変数 | 用途 |
| --- | --- |
| `SYMMETRY_GTM_CONTAINER_ID` | GTMコンテナID。通常はこれを優先して設定 |
| `SYMMETRY_GA4_MEASUREMENT_ID` | GTMを使わないフォールバック用のGA4測定ID |
| `SYMMETRY_GOOGLE_ADS_CONVERSION_ID` | フォールバック用のGoogle広告コンバージョンID |
| `SYMMETRY_GOOGLE_ADS_CONVERSION_LABEL` | フォールバック用のGoogle広告コンバージョンラベル |

本番ではGTMをタグ管理の入口にし、GA4・Google広告のタグ設定はGTM側で管理する想定です。GTMと直接gtagを同時に有効にしないことで、二重送信を避けます。

## イベント設計

| イベント | 発火条件 | 用途 | コンバージョン扱い |
| --- | --- | --- | --- |
| `career_lp_view` | LP表示時に1回 | LPへの流入・閲覧数 | 参考指標 |
| `career_cta_click` | 申込フォームへのCTAクリック | CTAのクリック率 | 参考指標 |
| `career_form_start` | フォーム内で初回入力・フォーカス | フォーム離脱率 | 参考指標 |
| `career_form_submit_attempt` | 送信ボタン押下 | 送信試行数 | 参考指標 |
| `career_form_validation_error` | 必須項目・形式エラー発生時 | フォーム改善 | 参考指標 |
| `generate_lead` | バリデーション成功後、完了画面へ遷移する処理で1回 | 無料相談申込完了 | 主要コンバージョン |

`generate_lead` に含める識別情報は、ランダム生成した `lead_id` / `event_id` / `transaction_id` だけです。これらは個人情報ではなく、同一申込の重複防止と将来のCRM紐付けに使用します。

### 正常完了と二重計測

- バリデーションエラーでは `generate_lead` を発火しません。
- 現在のモック処理では、入力成功後の完了画面へ切り替えるコールバック内でだけ発火します。
- 本番の送信処理へ置き換える場合は、APIが正常応答した箇所から `recordApplicationComplete(form)` を呼び出します。送信ボタン押下時やAPIエラー時には呼び出しません。
- 同一フォームの完了処理は `WeakMap` と送信中フラグで1回に制限します。
- Google広告タグでは `transaction_id` に `lead_id` を渡してください。GTMで同じ値をGoogle広告コンバージョンタグの取引IDに設定します。
- 完了画面からフォームを意図的にリセットして再送信した場合は、別申込として新しいIDを発行します。

## 流入情報と申込データの紐付け

LP表示時に、次の値をURLから取得し、ブラウザのローカル保存領域へ保存します。

`gclid`, `gbraid`, `wbraid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`

申込フォームには同じ値を非表示項目として保持しています。実際の申込APIを作る際は、次の項目を申込レコードへ保存してください。

- `tracking_lead_id`
- `gclid`, `gbraid`, `wbraid`
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- `landing_page`, `first_touch_at`, `last_touch_at`

URL全体やフォームの個人情報をGA4イベントパラメータへ渡さないでください。特に氏名、メールアドレス、電話番号、自由記述、職務経歴の値は送信対象外です。

## GTM側の設定

1. GTMでデータレイヤー変数を作成します。
   - `DLV - lead_id` → `lead_id`
   - `DLV - transaction_id` → `transaction_id`
   - `DLV - appointment_mode` → `appointment_mode`
   - 必要に応じて `gclid`、各UTMを同様に作成
2. カスタムイベントトリガー `generate_lead` を作成します。
3. GA4イベントタグを作成し、イベント名を `generate_lead` とします。主要イベントとして扱う設定はGA4管理画面で行います。
4. Google広告のコンバージョンタグを作成し、同じ `generate_lead` トリガーを設定します。コンバージョンID・ラベルはGoogle広告の値を設定し、取引IDへ `{{DLV - transaction_id}}` を指定します。
5. プレビューで、入力エラー時にGoogle広告タグが発火しないこと、正常完了時に1回だけ発火することを確認します。
6. 公開前にGTMのバージョンを公開し、GA4のリアルタイム・DebugViewとGoogle広告のタグ診断で確認します。

## オフラインコンバージョンの拡張

申込時に保存した `lead_id` とクリックIDをCRMの候補者レコードへ引き継ぎます。将来は、次の段階を別コンバージョンとしてGoogle広告へ連携できます。

`qualified_candidate`（有効候補者） → `agent_referral`（エージェント紹介） → `joined`（入社）

連携時は、Google広告のオフラインコンバージョン要件に合わせてクリックID、発生日時、コンバージョン名、任意の値を送ります。メールアドレス等を使う拡張コンバージョンを採用する場合は、同意取得・ハッシュ化・Googleのポリシー確認を別途行ってください。

## 本番前の残作業

- GTMコンテナとGA4プロパティを本番用に作成・設定する
- Google広告で「無料相談申込完了」コンバージョンを作成する
- 本番環境へ4つの環境変数を設定する
- 実送信APIの成功応答と `recordApplicationComplete` を接続する
- 同意管理・プライバシーポリシー・計測に関する社内確認を行う
- GTMプレビュー、GA4 DebugView、Google広告のテストで発火回数を確認する
