import warnings

import pytest


def pytest_collection_modifyitems(items):
    for it in items:
        if "blackbox" in str(it.fspath):
            it.add_marker(pytest.mark.deep)

warnings.filterwarnings("ignore", message=".*httpx.*")


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
