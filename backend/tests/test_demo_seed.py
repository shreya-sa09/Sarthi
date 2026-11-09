import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.api import apply_stop_action
from app.database import Base
from app.main import DEMO_OTP, DEMO_STOPS, seed_demo_run
from app.models import Activity, DeliveryRun, DeliveryStop
from app.schemas import StopAction, StopView


class DemoSeedTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_directory.name, "demo.db").as_posix()
        self.engine = create_engine(f"sqlite:///{database_path}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()
        self.temp_directory.cleanup()

    def test_seed_repairs_demo_otp_and_is_idempotent(self) -> None:
        with self.Session() as db:
            run = DeliveryRun(rider_name="Demo Rider", status="active", is_demo=True)
            db.add(run)
            db.flush()
            old_order = dict(DEMO_STOPS[0])
            old_order.update(run_id=run.id, otp_code="0000")
            db.add(DeliveryStop(**old_order))
            db.commit()

        with patch("app.main.SessionLocal", self.Session):
            seed_demo_run()
            seed_demo_run()

        with self.Session() as db:
            seeded = db.scalar(select(DeliveryStop).where(DeliveryStop.order_number == "1042"))
            self.assertEqual(seeded.otp_code, DEMO_OTP)
            self.assertEqual(
                {stop.otp_code for stop in db.scalars(select(DeliveryStop)).all()},
                {DEMO_OTP},
            )
            self.assertEqual(db.scalar(select(func.count(DeliveryStop.id))), len(DEMO_STOPS))
            # Seeded delivered and exception samples each create one event.
            expected_events = sum(stop["status"] in {"delivered", "exception"} for stop in DEMO_STOPS)
            self.assertEqual(db.scalar(select(func.count(Activity.id))), expected_events)

            run_id = seeded.run_id
            action_run = apply_stop_action(seeded.id, StopAction(action="delivered", otp=DEMO_OTP), db)
            completed = db.scalar(select(DeliveryStop).where(DeliveryStop.order_number == "1042"))
            self.assertEqual(completed.status, "delivered")
            self.assertEqual(action_run.id, run_id)

    def test_delivery_response_does_not_expose_stored_otp(self) -> None:
        self.assertNotIn("otp_code", StopView.model_fields)


if __name__ == "__main__":
    unittest.main()
