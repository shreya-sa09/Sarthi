import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app import navigation


class FakeResponse:
    def __init__(self, data, status=200):
        self.data = data
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx
            request = httpx.Request("GET", "https://graphhopper.test")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("provider error", request=request, response=response)

    def json(self):
        return self.data


class FakeClient:
    payload = None
    status = 200
    calls = []

    def __init__(self, timeout=None):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def get(self, url, params=None):
        self.calls.append((url, params))
        return FakeResponse(self.payload, self.status)


class NavigationApiTests(unittest.TestCase):
    def setUp(self):
        FakeClient.calls = []
        FakeClient.status = 200
        FakeClient.payload = None

    def test_route_returns_real_provider_geometry_and_maneuvers(self):
        FakeClient.payload = {"paths": [{
            "distance": 1250.0, "time": 180000,
            "points": {"coordinates": [[73.8, 18.5], [73.81, 18.51], [73.82, 18.52]]},
            "instructions": [{"text": "Turn left", "distance": 320.0, "time": 45000, "sign": -2, "street_name": "Baner Road", "interval": [0, 1]}],
        }]}
        with patch.object(navigation.settings, "graphhopper_api_key", "test-secret"), patch.object(navigation.httpx, "Client", FakeClient):
            result = navigation.calculate_route(navigation.RouteRequest(
                origin={"latitude": 18.5, "longitude": 73.8},
                destination={"latitude": 18.52, "longitude": 73.82}, language="hi-IN",
            ))
        self.assertEqual(result["geometry"][0], [73.8, 18.5])
        self.assertEqual(result["distance_m"], 1250.0)
        self.assertEqual(result["instructions"][0]["position"], [73.81, 18.51])
        self.assertEqual(result["language"], "hi")
        self.assertIn(("key", "test-secret"), FakeClient.calls[0][1])

    def test_missing_api_key_fails_without_route_fallback(self):
        with patch.object(navigation.settings, "graphhopper_api_key", ""):
            with self.assertRaises(HTTPException) as raised:
                navigation.calculate_route(navigation.RouteRequest(
                    origin={"latitude": 18.5, "longitude": 73.8},
                    destination={"latitude": 18.52, "longitude": 73.82},
                ))
        self.assertEqual(raised.exception.status_code, 503)

    def test_provider_no_route_response_is_not_fabricated(self):
        FakeClient.payload = {"paths": []}
        with patch.object(navigation.settings, "graphhopper_api_key", "test-secret"), patch.object(navigation.httpx, "Client", FakeClient):
            with self.assertRaises(HTTPException) as raised:
                navigation.calculate_route(navigation.RouteRequest(
                    origin={"latitude": 18.5, "longitude": 73.8},
                    destination={"latitude": 18.52, "longitude": 73.82},
                ))
        self.assertEqual(raised.exception.status_code, 422)

    def test_rate_limit_is_returned_as_retryable_error(self):
        FakeClient.status = 429
        with patch.object(navigation.settings, "graphhopper_api_key", "test-secret"), patch.object(navigation.httpx, "Client", FakeClient):
            with self.assertRaises(HTTPException) as raised:
                navigation.calculate_route(navigation.RouteRequest(
                    origin={"latitude": 18.5, "longitude": 73.8},
                    destination={"latitude": 18.52, "longitude": 73.82},
                ))
        self.assertEqual(raised.exception.status_code, 429)

    def test_coordinate_ranges_are_validated(self):
        with self.assertRaises(ValueError):
            navigation.RouteRequest(origin={"latitude": 91, "longitude": 0}, destination={"latitude": 18, "longitude": 73})

    def test_geocode_returns_provider_coordinates(self):
        FakeClient.payload = {"hits": [{"name": "Baner, Pune", "point": {"lat": 18.56, "lng": 73.78}}]}
        with patch.object(navigation.settings, "graphhopper_api_key", "test-secret"), patch.object(navigation.httpx, "Client", FakeClient):
            result = navigation.geocode("Baner Road, Pune")
        self.assertEqual(result, {"latitude": 18.56, "longitude": 73.78, "label": "Baner, Pune"})

    def test_unresolved_address_fails_without_guessing(self):
        FakeClient.payload = {"hits": []}
        with patch.object(navigation.settings, "graphhopper_api_key", "test-secret"), patch.object(navigation.httpx, "Client", FakeClient):
            with self.assertRaises(HTTPException) as raised:
                navigation.geocode("Unresolvable address")
        self.assertEqual(raised.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
