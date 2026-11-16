import hashlib
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from starlette.requests import Request

from server import app as app_module


def make_request(headers=None, client=("198.51.100.20", 12345)):
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "https",
        "path": "/api/ad-creative/applications",
        "raw_path": b"/api/ad-creative/applications",
        "query_string": b"",
        "headers": [(key.lower().encode("latin-1"), value.encode("latin-1")) for key, value in (headers or {}).items()],
        "client": client,
        "server": ("symmetrylab.jp", 443),
    }
    return Request(scope)


class MetaCapiPayloadTests(unittest.TestCase):
    def setUp(self):
        self.application = SimpleNamespace(
            client_submission_id="submission_123456789",
            email="  Alice.Example+tag@Example.COM ",
            phone="090-1234-5678",
            fbclid="click-id-123",
            first_touch_at="1970-01-01T00:00:05+00:00",
        )
        self.request = make_request({
            "x-forwarded-for": "203.0.113.15, 10.0.0.2",
            "user-agent": "Example Browser/1.0",
        })
        self.saved_at = "1970-01-01T00:00:10+00:00"

    def test_hashes_normalized_phone_fbc_and_request_data(self):
        with patch.dict(os.environ, {}, clear=True):
            payload = app_module._build_meta_capi_lead_payload(self.application, self.request, self.saved_at)

        event = payload["data"][0]
        user_data = event["user_data"]
        expected_email = hashlib.sha256(b"alice.example+tag@example.com").hexdigest()
        expected_phone = hashlib.sha256(b"819012345678").hexdigest()
        self.assertEqual(user_data["em"], [expected_email])
        self.assertEqual(user_data["ph"], [expected_phone])
        self.assertEqual(user_data["fbc"], "fb.1.5.click-id-123")
        self.assertEqual(user_data["client_ip_address"], "203.0.113.15")
        self.assertEqual(user_data["client_user_agent"], "Example Browser/1.0")
        self.assertEqual(event["event_name"], "Lead")
        self.assertEqual(event["event_time"], 10)
        self.assertEqual(event["event_id"], self.application.client_submission_id)
        self.assertEqual(event["event_source_url"], "https://symmetrylab.jp/career-check/")
        self.assertEqual(event["action_source"], "website")
        self.assertNotIn("test_event_code", payload)

    def test_invalid_first_touch_uses_saved_timestamp(self):
        self.application.first_touch_at = "not-a-date"
        with patch.dict(os.environ, {}, clear=True):
            payload = app_module._build_meta_capi_lead_payload(self.application, self.request, self.saved_at)
        self.assertEqual(payload["data"][0]["user_data"]["fbc"], "fb.1.10.click-id-123")

    def test_empty_fbclid_omits_fbc(self):
        self.application.fbclid = "  "
        with patch.dict(os.environ, {}, clear=True):
            payload = app_module._build_meta_capi_lead_payload(self.application, self.request, self.saved_at)
        self.assertNotIn("fbc", payload["data"][0]["user_data"])

    def test_test_event_code_is_added_only_when_configured(self):
        with patch.dict(os.environ, {"SYMMETRY_META_CAPI_TEST_EVENT_CODE": "TEST123"}, clear=True):
            payload = app_module._build_meta_capi_lead_payload(self.application, self.request, self.saved_at)
        self.assertEqual(payload["test_event_code"], "TEST123")


class MetaCapiSendTests(unittest.TestCase):
    def setUp(self):
        self.application = SimpleNamespace(
            client_submission_id="submission_123456789",
            email="applicant@example.com",
            phone="09012345678",
            fbclid="",
            first_touch_at="",
        )
        self.request = make_request({"user-agent": "Example Browser/1.0"})

    def test_missing_or_invalid_send_prerequisites_skip_http(self):
        base = {
            "SYMMETRY_META_TRACKING_ENABLED": "true",
            "SYMMETRY_META_PIXEL_ID": "123456789012345",
            "SYMMETRY_META_CAPI_ACCESS_TOKEN": "test-token",
        }
        cases = [
            ({**base, "SYMMETRY_META_TRACKING_ENABLED": "false"}, "tracking disabled"),
            ({**base, "SYMMETRY_META_PIXEL_ID": "pixel-id"}, "invalid pixel id"),
            ({**base, "SYMMETRY_META_CAPI_ACCESS_TOKEN": "  "}, "missing token"),
            ({key: value for key, value in base.items() if key != "SYMMETRY_META_CAPI_ACCESS_TOKEN"}, "unset token"),
        ]
        for environment, label in cases:
            with self.subTest(label=label), patch.dict(os.environ, environment, clear=True), patch.object(
                app_module.urllib.request, "urlopen"
            ) as urlopen:
                app_module.send_meta_capi_lead(
                    self.application, self.request, "1970-01-01T00:00:10+00:00"
                )
                urlopen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
