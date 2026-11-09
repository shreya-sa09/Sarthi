import unittest
import tempfile
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.api import apply_stop_action, save_stop_contact
from app.database import Base
from app.models import Activity, DeliveryRun, DeliveryStop
from app.schemas import StopAction, StopContact


class StopActionAPITests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_directory.name, "test.db").as_posix()
        self.engine = create_engine(
            f"sqlite:///{database_path}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)

        with self.Session() as db:
            run = DeliveryRun(rider_name="Test Rider", status="active")
            db.add(run)
            db.flush()
            self.stop_ids = []
            for sequence in range(1, 4):
                stop = DeliveryStop(
                    run_id=run.id,
                    sequence=sequence,
                    order_number=f"T{sequence}",
                    customer_name=f"Customer {sequence}",
                    customer_phone="",
                    address=f"{sequence} Test Street",
                    access_note="",
                    status="pending",
                    otp_code=f"{sequence:05d}",
                )
                db.add(stop)
                db.flush()
                self.stop_ids.append(stop.id)
            db.commit()

    def tearDown(self) -> None:
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()
        self.temp_directory.cleanup()

    def post_action(self, stop_id: int, action: str, otp: str | None = None):
        body = StopAction(action=action, otp=otp)
        with self.Session() as db:
            return apply_stop_action(stop_id, body, db)

    def assert_action_error(self, expected_status: int, stop_id: int, action: str, otp: str | None = None):
        with self.assertRaises(HTTPException) as raised:
            self.post_action(stop_id, action, otp)
        self.assertEqual(raised.exception.status_code, expected_status)

    def activity_count(self, stop_id: int) -> int:
        with self.Session() as db:
            return db.scalar(
                select(func.count(Activity.id)).where(Activity.stop_id == stop_id)
            )

    def read_stop(self, stop_id: int) -> DeliveryStop:
        with self.Session() as db:
            stop = db.get(DeliveryStop, stop_id)
            db.expunge(stop)
            return stop

    def test_successful_exception_actions_and_retries_are_idempotent(self) -> None:
        cases = [
            (self.stop_ids[0], "contact_attempt", "contact_attempt"),
            (self.stop_ids[1], "wrong_address", "wrong_address"),
            (self.stop_ids[2], "reschedule", "reschedule_requested"),
        ]

        for stop_id, action, event_type in cases:
            with self.subTest(action=action):
                first = self.post_action(stop_id, action)
                self.assertEqual(first.id, 1)
                self.assertEqual(self.read_stop(stop_id).status, "exception")
                self.assertEqual(self.read_stop(stop_id).exception_reason, action)

                retry = self.post_action(stop_id, action)
                self.assertEqual(retry.id, 1)
                self.assertEqual(self.activity_count(stop_id), 1)
                self.assertEqual(
                    self.count_event_type(stop_id, event_type), 1
                )

    def test_different_exception_transition_is_rejected_without_mutation(self) -> None:
        stop_id = self.stop_ids[0]
        self.post_action(stop_id, "wrong_address")
        self.assert_action_error(409, stop_id, "reschedule")
        self.assertEqual(self.read_stop(stop_id).exception_reason, "wrong_address")
        self.assertEqual(self.activity_count(stop_id), 1)

    def test_correct_otp_completes_pending_stop(self) -> None:
        stop_id = self.stop_ids[0]

        run = self.post_action(stop_id, "delivered", "00001")

        self.assertEqual(run.id, 1)
        self.assertEqual(self.read_stop(stop_id).status, "delivered")
        self.assertEqual(self.activity_count(stop_id), 1)

    def test_exception_can_only_be_completed_with_correct_otp(self) -> None:
        stop_id = self.stop_ids[0]
        self.post_action(stop_id, "contact_attempt")
        self.post_action(stop_id, "delivered", "00001")

        self.assertEqual(self.read_stop(stop_id).status, "delivered")
        self.assertEqual(self.activity_count(stop_id), 2)

    def test_incorrect_or_missing_otp_does_not_complete_or_record_action(self) -> None:
        stop_id = self.stop_ids[0]

        self.assert_action_error(422, stop_id, "delivered", "99999")
        self.assert_action_error(422, stop_id, "delivered")
        self.assertEqual(self.read_stop(stop_id).status, "pending")
        self.assertEqual(self.activity_count(stop_id), 0)

    def test_delivered_stop_is_terminal_for_actions_and_contact_edits(self) -> None:
        stop_id = self.stop_ids[0]
        self.post_action(stop_id, "delivered", "00001")
        self.assert_action_error(409, stop_id, "delivered", "00001")
        self.assert_action_error(409, stop_id, "contact_attempt")
        with self.Session() as db, self.assertRaises(HTTPException) as raised:
            save_stop_contact(stop_id, StopContact(phone="+1 555 123 4567"), db)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.activity_count(stop_id), 1)
        self.assertEqual(self.read_stop(stop_id).customer_phone, "")

    def test_unknown_action_is_rejected_by_request_validation(self) -> None:
        with self.assertRaises(ValueError):
            StopAction(action="cancelled")
        self.assertEqual(self.activity_count(self.stop_ids[0]), 0)

    def count_event_type(self, stop_id: int, event_type: str) -> int:
        with self.Session() as db:
            return db.scalar(
                select(func.count(Activity.id)).where(
                    Activity.stop_id == stop_id,
                    Activity.event_type == event_type,
                )
            )


if __name__ == "__main__":
    unittest.main()
