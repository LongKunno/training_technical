from app.core.app import create_app
from fastapi.testclient import TestClient


def test_health_endpoint_returns_service_status() -> None:
    client = TestClient(create_app())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "Data Pipeline (Python)",
        "message": "San sang hoat dong, dang hung du lieu tu san Crypto!",
    }
