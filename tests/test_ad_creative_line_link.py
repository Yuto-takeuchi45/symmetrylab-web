import base64
import hashlib
import hmac
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote, urlsplit

from fastapi.testclient import TestClient
from server import app as app_module


class AdCreativeLineLinkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patches = [
            patch.object(app_module, "DB_PATH", str(Path(self.temp.name) / "test.db")),
            patch.object(app_module, "BASE_URL", "http://localhost:8000"),
            patch.object(app_module, "AD_CREATIVE_LINE_ENABLED", True),
            patch.object(app_module, "AD_CREATIVE_LINE_ID", "@226qiliz"),
            patch.object(app_module, "AD_CREATIVE_LINE_CHANNEL_SECRET", "test-secret"),
            patch.object(app_module, "AD_CREATIVE_LINE_CHANNEL_ACCESS_TOKEN", "test-token"),
            patch.object(app_module, "send_ad_creative_application_notifications"),
            patch.object(app_module, "_finish_ad_creative_line_link"),
        ]
        for item in self.patches:
            item.start()
        self.addCleanup(self.temp.cleanup)
        for item in self.patches:
            self.addCleanup(item.stop)
        app_module.init_db()
        self.client = TestClient(app_module.app)
        self.payload = {
            "client_submission_id": "submission_123456789",
            "intention": "info", "q2_timing": "時期未定・情報収集中",
            "q3_income": "400〜599万円", "q5_education": "大学",
            "q8_priority": "仕事内容・ポジション", "q10_age": "30",
            "name": "山田 太郎", "email": "applicant@example.com", "phone": "09012345678",
            "privacy_consent": True, "line_consent": True,
        }

    def submit(self, payload=None):
        return self.client.post("/api/ad-creative/applications", json=payload or self.payload,
                                headers={"Origin": "http://localhost:8000"})

    def webhook(self, text, user="U" + "1" * 32, signature_valid=True):
        body = json.dumps({"events": [{"type": "message", "source": {"type": "user", "userId": user},
                                      "message": {"type": "text", "text": text}, "replyToken": "reply"}]},
                          ensure_ascii=False).encode("utf-8")
        signature = base64.b64encode(hmac.new(b"test-secret", body, hashlib.sha256).digest()).decode("ascii")
        return self.client.post("/api/ad-creative/line-webhook", content=body,
                                headers={"x-line-signature": signature if signature_valid else "invalid"})

    def row(self):
        conn = app_module.get_db()
        try:
            return dict(conn.execute("SELECT * FROM ad_creative_applications").fetchone())
        finally:
            conn.close()

    def test_message_links_saved_application_and_replay_does_not_reassign(self):
        response = self.submit()
        self.assertEqual(response.status_code, 200)
        line_url = response.json()["line"]["message_url"]
        self.assertIn("%40226qiliz", line_url)
        text = unquote(urlsplit(line_url).query)
        self.assertIn("面談について相談", text)
        self.assertNotIn("診断結果", text)
        self.assertEqual(self.row()["line_link_status"], "pending")
        self.assertEqual(self.webhook(text, signature_valid=False).status_code, 403)
        self.assertEqual(self.row()["line_link_status"], "pending")
        self.assertEqual(self.webhook(text).status_code, 200)
        linked = self.row()
        self.assertEqual(linked["line_link_status"], "linked")
        self.assertEqual(linked["line_user_id"], "U" + "1" * 32)
        self.assertTrue(text.endswith(linked["line_reference"]))
        self.webhook(text, user="U" + "2" * 32)
        self.assertEqual(self.row()["line_user_id"], "U" + "1" * 32)
        app_module._finish_ad_creative_line_link.assert_called_once()

    def test_duplicate_submission_allows_original_code_and_only_one_lead(self):
        first = self.submit().json()
        second = self.submit().json()
        self.assertTrue(second["duplicate"])
        self.assertEqual(first["application_id"], second["application_id"])
        self.webhook(unquote(urlsplit(first["line"]["message_url"]).query))
        self.assertEqual(self.row()["line_link_status"], "linked")
        conn = app_module.get_db()
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM ad_creative_applications").fetchone()[0], 1)
        finally:
            conn.close()
        self.assertTrue(self.submit().json()["line"]["already_linked"])

    def test_expired_code_and_missing_consent_are_rejected(self):
        self.assertEqual(self.submit({**self.payload, "line_consent": False}).status_code, 422)
        line_url = self.submit().json()["line"]["message_url"]
        text = unquote(urlsplit(line_url).query)
        self.assertIsNotNone(re.search(r"SL-[A-Za-z0-9_-]{24}", text))
        conn = app_module.get_db()
        try:
            conn.execute("UPDATE ad_creative_line_tokens SET expires_at = '2000-01-01T00:00:00+09:00'")
            conn.commit()
        finally:
            conn.close()
        self.webhook(text)
        self.assertEqual(self.row()["line_link_status"], "pending")
        app_module._finish_ad_creative_line_link.assert_not_called()

    def test_missing_credentials_does_not_create_application(self):
        with patch.object(app_module, "AD_CREATIVE_LINE_CHANNEL_SECRET", ""):
            self.assertEqual(self.submit().status_code, 503)
        conn = app_module.get_db()
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM ad_creative_applications").fetchone()[0], 0)
        finally:
            conn.close()

    def test_disabled_line_keeps_existing_application_flow(self):
        with patch.object(app_module, "AD_CREATIVE_LINE_ENABLED", False):
            response = self.submit({**self.payload, "line_consent": False})
            verify = self.webhook("面談について相談を希望します。")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(verify.status_code, 200)
        self.assertNotIn("line", response.json())
        self.assertEqual(self.row()["line_link_status"], "not_requested")

    def test_receipt_describes_line_step_without_claiming_a_diagnosis(self):
        text = app_module._ad_creative_application_email_html(
            {"name": "山田", "application_id": "test", "line_required": True}, "applicant"
        )
        self.assertIn("公式LINE", text)
        self.assertIn("初回面談", text)
        self.assertNotIn("診断結果", text)


if __name__ == "__main__":
    unittest.main()
