import unittest
import json
from types import SimpleNamespace

from fastapi import HTTPException

from app.evon import ACTION_BY_INTENT, _system_prompt, build_delivery_context
from app.voice import normalize_wav_lengths


def sentinel_wav() -> bytes:
    pcm = b"\x00\x00" * 16
    return (
        b"RIFF\xff\xff\xff\xffWAVE"
        + b"fmt "
        + (16).to_bytes(4, "little")
        + b"\x01\x00\x01\x00"
        + (24000).to_bytes(4, "little")
        + (48000).to_bytes(4, "little")
        + b"\x02\x00\x10\x00"
        + b"data\xff\xff\xff\xff"
        + pcm
    )


class TimbreWavTests(unittest.TestCase):
    def test_repairs_unknown_riff_and_data_chunk_lengths(self) -> None:
        normalized = normalize_wav_lengths(sentinel_wav())
        self.assertEqual(int.from_bytes(normalized[4:8], "little"), len(normalized) - 8)
        data_offset = normalized.index(b"data")
        self.assertEqual(int.from_bytes(normalized[data_offset + 4:data_offset + 8], "little"), len(normalized) - data_offset - 8)

    def test_rejects_non_wav_or_empty_audio(self) -> None:
        for audio in (b"not an audio file", sentinel_wav()[:44]):
            with self.subTest(size=len(audio)), self.assertRaises(HTTPException) as raised:
                normalize_wav_lengths(audio)
            self.assertEqual(raised.exception.status_code, 502)

    def test_rejects_truncated_audio_chunk(self) -> None:
        audio = bytearray(sentinel_wav())
        audio[40:44] = (2000).to_bytes(4, "little")
        audio[4:8] = (len(audio) - 8).to_bytes(4, "little")
        with self.assertRaises(HTTPException) as raised:
            normalize_wav_lengths(bytes(audio))
        self.assertEqual(raised.exception.status_code, 502)


class VoiceIntentContractTests(unittest.TestCase):
    def test_delivery_operations_have_explicit_confirmation_actions(self) -> None:
        self.assertEqual(ACTION_BY_INTENT["DELIVERY_COMPLETED"], "delivered")
        self.assertEqual(ACTION_BY_INTENT["CUSTOMER_UNREACHABLE"], "contact_attempt")
        self.assertEqual(ACTION_BY_INTENT["WRONG_ADDRESS"], "wrong_address")
        self.assertEqual(ACTION_BY_INTENT["RESCHEDULE_REQUESTED"], "reschedule")
        self.assertEqual(ACTION_BY_INTENT["CALL_CUSTOMER"], "call_customer")
        self.assertEqual(ACTION_BY_INTENT["NAVIGATE_TO_STOP"], "directions")

    def test_decision_prompt_has_grounded_read_only_delivery_intents(self) -> None:
        prompt = _system_prompt()
        for intent in ("PARCEL_QUERY", "PAYMENT_QUERY", "DELIVERY_INSTRUCTIONS_QUERY", "NEXT_ACTION_QUERY"):
            with self.subTest(intent=intent):
                self.assertIn(intent, prompt)
        self.assertIn("Never invent those facts", prompt)
        self.assertIn("Delivery completion always requires OTP verification", prompt)
        self.assertIn("same language and script", prompt)

    def test_navigation_is_explicit_and_never_implied_by_delivery_completion(self) -> None:
        prompt = _system_prompt()
        self.assertIn("NAVIGATE_TO_STOP as an immediate in-app route request only when the rider explicitly asks", prompt)
        self.assertIn("Delivery completion, OTP verification, and selecting a next delivery never imply navigation", prompt)
        self.assertIn("Do not repeat or execute a previous intent based on assistant history", prompt)

    def test_navigation_controls_are_distinct_voice_intents(self) -> None:
        prompt = _system_prompt()
        for intent in ("STOP_NAVIGATION", "PAUSE_NAVIGATION", "RESUME_NAVIGATION", "REPEAT_DIRECTIONS", "CURRENT_TURN_QUERY", "REMAINING_ROUTE_QUERY"):
            with self.subTest(intent=intent):
                self.assertIn(intent, prompt)
        self.assertIn("distinguish stopping the assistant speech from stopping, pausing, or resuming the active route", prompt)

    def test_decision_context_is_sequence_ordered_and_excludes_phone_and_otp(self) -> None:
        first = SimpleNamespace(id=1, sequence=2, order_number="1043", customer_name="Ananya Patil", address="Aundh", access_note="Gate C", parcel_description="Clothing", package_category="Clothing", weight_kg=0.8, payment_type="cod", cod_amount=1299, delivery_window="12-2", status="pending", exception_reason=None, customer_phone="+1 555 000 0000", otp_code="1234")
        active = SimpleNamespace(id=2, sequence=1, order_number="1042", customer_name="Rahul Sharma", address="Baner", access_note="Gate 2", parcel_description="Earbuds", package_category="Electronics", weight_kg=0.3, payment_type="prepaid", cod_amount=None, delivery_window="10-12", status="pending", exception_reason=None, customer_phone="+1 555 111 1111", otp_code="4821")
        delivered = SimpleNamespace(id=3, sequence=0, order_number="1041", customer_name="Dev Shah", address="Pune", access_note="", parcel_description="Book", package_category="Books", weight_kg=1.0, payment_type="prepaid", cod_amount=None, delivery_window=None, status="delivered", exception_reason=None, customer_phone="+1 555 222 2222", otp_code="0000")
        run = SimpleNamespace(rider_name="Rider", status="active", stops=[first, delivered, active])

        current, context_json = build_delivery_context(run, None)
        context = json.loads(context_json)
        self.assertEqual(json.loads(current)["order_number"], "1042")
        self.assertEqual(context["active_delivery"]["order_number"], "1042")
        self.assertEqual(context["next_pending_delivery"]["order_number"], "1043")
        self.assertEqual([item["sequence"] for item in context["deliveries"]], [0, 1, 2])
        self.assertNotIn("customer_phone", context_json)
        self.assertNotIn("otp_code", context_json)

    def test_selected_delivery_is_used_as_conversation_context(self) -> None:
        stop = SimpleNamespace(id=7, sequence=1, order_number="1042", customer_name="Rahul Sharma", address="Baner", access_note="Gate 2", parcel_description="Earbuds", package_category="Electronics", weight_kg=0.3, payment_type="prepaid", cod_amount=None, delivery_window="10-12", status="pending", exception_reason=None, customer_phone="+1 555 000 0000", otp_code="4821")
        next_stop = SimpleNamespace(id=8, sequence=2, order_number="1043", customer_name="Ananya Patil", address="Aundh", access_note="Gate C", parcel_description="Clothing", package_category="Clothing", weight_kg=0.8, payment_type="cod", cod_amount=1299, delivery_window="12-2", status="pending", exception_reason=None, customer_phone="+1 555 111 1111", otp_code="5632")
        current, _ = build_delivery_context(SimpleNamespace(rider_name="Rider", status="active", stops=[stop, next_stop]), 8)
        self.assertEqual(json.loads(current)["order_number"], "1043")

if __name__ == "__main__":
    unittest.main()
