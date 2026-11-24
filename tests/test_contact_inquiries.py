"""HPのお問い合わせ（保存・二重送信防止・入力検証・管理画面API・通知メール）のテスト。"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from server import app as app_module

ADMIN_KEY = "test-admin-key"
ORIGIN = {"Origin": "http://localhost:8000"}


class ContactInquiryApiTests(unittest.TestCase):
    """お問い合わせAPIを、一時DBと通知の差し替えで検証する。"""

    def setUp(self):
        """テストごとに空の一時DBを用意し、メール通知は実際には送らないよう差し替える。"""
        self.temp = tempfile.TemporaryDirectory()
        self.notify = patch.object(app_module, "send_contact_inquiry_notifications")
        self.patches = [
            patch.object(app_module, "DB_PATH", str(Path(self.temp.name) / "test.db")),
            patch.object(app_module, "BASE_URL", "http://localhost:8000"),
            patch.object(app_module, "ADMIN_KEY", ADMIN_KEY),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.notify_mock = self.notify.start()
        self.addCleanup(self.notify.stop)
        self.addCleanup(self.temp.cleanup)
        app_module.init_db()
        self.client = TestClient(app_module.app)

    def general_payload(self, **overrides):
        """お問い合わせページのフォームと同じ形の送信内容を作る。"""
        payload = {
            "client_submission_id": "contact_1234567890",
            "website": "",
            "form_type": "general",
            "name": "山田 太郎",
            "email": "taro@example.com",
            "phone": "090-1234-5678",
            "occupation": "社会人",
            "inquiry_type": "講座内容について",
            "message": "ケース面接対策講座について質問があります。",
            "privacy_consent": True,
            "page_url": "https://symmetrylab.jp/contact.html",
        }
        payload.update(overrides)
        return payload

    def consulting_payload(self, **overrides):
        """サービスページのコンサル相談フォームと同じ形の送信内容を作る。"""
        payload = self.general_payload(
            client_submission_id="consult_1234567890",
            form_type="consulting",
            company="株式会社サンプル",
            occupation="",
            inquiry_type="戦略コンサルティング",
            message="中期経営計画の策定について相談したいです。",
            page_url="https://symmetrylab.jp/services.html",
        )
        payload.update(overrides)
        return payload

    def rows(self, table="contact_inquiries"):
        """指定した表の全行を辞書で返す。"""
        conn = app_module.get_db()
        try:
            return [dict(r) for r in conn.execute(f"SELECT * FROM {table} ORDER BY id")]
        finally:
            conn.close()

    def admin(self):
        """管理キーのヘッダー。"""
        return {"X-Admin-Key": ADMIN_KEY}

    def test_general_inquiry_is_saved_and_notified(self):
        res = self.client.post("/api/contact/inquiries", json=self.general_payload(), headers=ORIGIN)
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertFalse(body["duplicate"])
        saved = self.rows()
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]["inquiry_status"], "new")
        self.assertEqual(saved[0]["occupation"], "社会人")
        self.assertEqual(saved[0]["company"], "")
        self.assertTrue(saved[0]["created_at"].endswith("+00:00"))
        self.assertEqual(len(self.rows("contact_inquiry_status_history")), 1)
        self.notify_mock.assert_called_once()
        self.assertEqual(self.notify_mock.call_args.args[0]["inquiry_id"], body["inquiry_id"])

    def test_consulting_inquiry_requires_company_and_ignores_occupation(self):
        res = self.client.post("/api/contact/inquiries", json=self.consulting_payload(company=""), headers=ORIGIN)
        self.assertEqual(res.status_code, 422)
        res = self.client.post("/api/contact/inquiries", json=self.consulting_payload(occupation="学生"), headers=ORIGIN)
        self.assertEqual(res.status_code, 200, res.text)
        saved = self.rows()[0]
        self.assertEqual(saved["form_type"], "consulting")
        self.assertEqual(saved["company"], "株式会社サンプル")
        self.assertEqual(saved["occupation"], "")

    def test_resubmission_with_same_id_is_not_saved_twice(self):
        first = self.client.post("/api/contact/inquiries", json=self.general_payload(), headers=ORIGIN).json()
        second = self.client.post("/api/contact/inquiries", json=self.general_payload(), headers=ORIGIN).json()
        self.assertTrue(second["duplicate"])
        self.assertEqual(first["inquiry_id"], second["inquiry_id"])
        self.assertEqual(len(self.rows()), 1)
        self.notify_mock.assert_called_once()

    def test_rejects_invalid_input(self):
        cases = [
            {"website": "spam"},
            {"privacy_consent": False},
            {"email": "not-an-email"},
            {"phone": "12"},
            {"name": "   "},
            {"message": ""},
            {"inquiry_type": "戦略コンサルティング"},  # お問い合わせページにはない選択肢
            {"occupation": "会社員"},
            {"form_type": "other"},
            {"client_submission_id": "short"},
            {"message": "あ" * 5001},
        ]
        for index, override in enumerate(cases):
            payload = self.general_payload(**{"client_submission_id": f"invalid_case_{index:04d}", **override})
            with self.subTest(override=list(override)):
                res = self.client.post("/api/contact/inquiries", json=payload, headers=ORIGIN)
                self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(self.rows(), [])
        self.notify_mock.assert_not_called()

    def test_rejects_other_origin(self):
        res = self.client.post("/api/contact/inquiries", json=self.general_payload(), headers={"Origin": "https://evil.example"})
        self.assertEqual(res.status_code, 403)
        res = self.client.post("/api/contact/inquiries", json=self.general_payload())
        self.assertEqual(res.status_code, 403)
        self.assertEqual(self.rows(), [])

    def test_admin_endpoints_require_key(self):
        for method, url in [
            ("get", "/api/admin/contact/inquiries"),
            ("get", "/api/admin/contact/inquiries/export"),
        ]:
            self.assertEqual(getattr(self.client, method)(url).status_code, 403)
            self.assertEqual(getattr(self.client, method)(url, headers={"X-Admin-Key": "wrong"}).status_code, 403)
        res = self.client.patch("/api/admin/contact/inquiries/x", json={"status": "completed"})
        self.assertEqual(res.status_code, 403)

    def test_admin_can_list_update_and_export(self):
        self.client.post("/api/contact/inquiries", json=self.general_payload(), headers=ORIGIN)
        consulting_id = self.client.post("/api/contact/inquiries", json=self.consulting_payload(), headers=ORIGIN).json()["inquiry_id"]

        listed = self.client.get("/api/admin/contact/inquiries", headers=self.admin()).json()
        self.assertEqual([r["form_type"] for r in listed], ["consulting", "general"])

        res = self.client.patch(
            f"/api/admin/contact/inquiries/{consulting_id}",
            json={"status": "in_progress", "admin_notes": "  初回連絡済み  "},
            headers=self.admin(),
        )
        self.assertEqual(res.status_code, 200, res.text)
        filtered = self.client.get("/api/admin/contact/inquiries?status=in_progress", headers=self.admin()).json()
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["admin_notes"], "初回連絡済み")
        history = [r["status"] for r in self.rows("contact_inquiry_status_history") if r["inquiry_id"] == consulting_id]
        self.assertEqual(history, ["new", "in_progress"])

        # メモだけ変えた場合は、対応状況の履歴を増やさない
        self.client.patch(f"/api/admin/contact/inquiries/{consulting_id}", json={"status": "in_progress", "admin_notes": "追記"}, headers=self.admin())
        history = [r["status"] for r in self.rows("contact_inquiry_status_history") if r["inquiry_id"] == consulting_id]
        self.assertEqual(history, ["new", "in_progress"])

        self.assertEqual(self.client.patch(f"/api/admin/contact/inquiries/{consulting_id}", json={"status": "bogus"}, headers=self.admin()).status_code, 400)
        self.assertEqual(self.client.patch("/api/admin/contact/inquiries/missing", json={"status": "completed"}, headers=self.admin()).status_code, 404)
        self.assertEqual(self.client.get("/api/admin/contact/inquiries?status=bogus", headers=self.admin()).status_code, 400)

        csv_res = self.client.get("/api/admin/contact/inquiries/export", headers=self.admin())
        self.assertEqual(csv_res.status_code, 200)
        text = csv_res.content.decode("utf-8")
        self.assertTrue(text.startswith("﻿受付ID"))
        self.assertIn("株式会社サンプル", text)

    def test_existing_tables_are_untouched(self):
        """お問い合わせの表を追加しても、既存の申込データの表はそのまま残ることを確認する。"""
        conn = app_module.get_db()
        try:
            conn.execute(
                "INSERT INTO bookings (booking_id, created_at, customer_name, stripe_session_id) VALUES ('b1', '2026-01-01', '既存のお客様', 'cs_1')"
            )
            conn.commit()
        finally:
            conn.close()
        app_module.init_db()  # 再起動時と同じく、もう一度初期化しても既存データは消えない
        self.assertEqual([r["customer_name"] for r in self.rows("bookings")], ["既存のお客様"])


class ContactInquiryNotificationTests(unittest.TestCase):
    """通知メールの宛先と本文（エスケープ）を検証する。"""

    @patch.object(app_module, "CONTACT_NOTIFICATION_EMAIL", "info@symmetrylab.jp, sales@example.com")
    @patch.object(app_module, "send_email", return_value=True)
    def test_sends_to_staff_and_inquirer_with_escaped_values(self, send_email):
        app_module.send_contact_inquiry_notifications({
            "inquiry_id": "inq-1",
            "created_at": "2026-11-24T01:00:00+00:00",
            "form_type": "consulting",
            "name": "山田 <太郎>",
            "email": "taro@example.com",
            "phone": "09012345678",
            "company": "株式会社<script>",
            "inquiry_type": "ITコンサルティング",
            "message": "相談です",
        })
        recipients = [c.args[0] for c in send_email.call_args_list]
        self.assertEqual(recipients, ["info@symmetrylab.jp", "sales@example.com", "taro@example.com"])
        staff_html = send_email.call_args_list[0].args[2]
        self.assertIn("山田 &lt;太郎&gt;", staff_html)
        self.assertIn("株式会社&lt;script&gt;", staff_html)
        self.assertIn("2026年11月24日 10:00", staff_html)  # 日本時間で表示する
        self.assertNotIn("<script>", staff_html)
        self.assertIn("コンサルティング", send_email.call_args_list[0].args[1])
        self.assertIn("相談です", staff_html)
        self.assertIn("受け付けました", send_email.call_args_list[2].args[1])
        # 送信者向けメールには自由記述の本文を載せない（第三者宛ての悪用防止）
        self.assertNotIn("相談です", send_email.call_args_list[2].args[2])

    def test_csv_values_are_not_treated_as_formulas(self):
        self.assertEqual(app_module._csv_safe("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")")
        self.assertEqual(app_module._csv_safe("-1"), "'-1")
        self.assertEqual(app_module._csv_safe("山田"), "山田")
        self.assertEqual(app_module._csv_safe(None), "")

    @patch.object(app_module, "CONTACT_NOTIFICATION_EMAIL", "info@symmetrylab.jp")
    @patch.object(app_module, "send_email", side_effect=RuntimeError("送信サーバー停止"))
    def test_notification_failure_does_not_raise(self, send_email):
        app_module.send_contact_inquiry_notifications({"inquiry_id": "inq-2", "email": "a@example.com", "form_type": "general"})
        self.assertEqual(send_email.call_count, 2)


if __name__ == "__main__":
    unittest.main()
