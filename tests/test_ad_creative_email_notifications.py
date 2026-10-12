import unittest
from unittest.mock import call, patch

from server import app as app_module


class AdCreativeEmailNotificationTests(unittest.TestCase):
    @patch.object(app_module, "AD_CREATIVE_NOTIFICATION_EMAIL", "info@symmetrylab.jp")
    @patch.object(app_module, "send_email")
    def test_sends_internal_and_applicant_receipts(self, send_email):
        send_email.return_value = True
        application = {
            "application_id": "application-123",
            "name": "山田 <太郎>",
            "email": "applicant@example.com",
            "phone": "09012345678",
            "utm_source": "instagram",
            "utm_campaign": "consulting_career",
        }

        app_module.send_ad_creative_application_notifications(application)

        self.assertEqual(send_email.call_count, 2)
        admin_call, applicant_call = send_email.call_args_list
        self.assertEqual(admin_call.args[0], "info@symmetrylab.jp")
        self.assertIn("Instagram LP", admin_call.args[1])
        self.assertIn("山田 &lt;太郎&gt;", admin_call.args[2])
        self.assertEqual(applicant_call.args[0], "applicant@example.com")
        self.assertIn("登録を受け付けました", applicant_call.args[1])
        self.assertIn("求人への応募ではありません", applicant_call.args[2])
        self.assertNotIn("山田 <太郎>", applicant_call.args[2])

    @patch.object(app_module, "AD_CREATIVE_NOTIFICATION_EMAIL", "first@example.com, second@example.com")
    @patch.object(app_module, "send_email", return_value=True)
    def test_supports_multiple_internal_recipients(self, send_email):
        app_module.send_ad_creative_application_notifications(
            {
                "application_id": "application-456",
                "name": "山田 花子",
                "email": "applicant@example.com",
            }
        )

        self.assertEqual(
            [entry.args[0] for entry in send_email.call_args_list],
            ["first@example.com", "second@example.com", "applicant@example.com"],
        )


if __name__ == "__main__":
    unittest.main()
