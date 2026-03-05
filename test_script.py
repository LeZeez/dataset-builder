import requests
import time
import subprocess

# Start server
server_process = subprocess.Popen(["python", "server.py"])
time.sleep(2)

try:
    # Test health check
    resp = requests.get("http://127.0.0.1:5000/api/health")
    assert resp.status_code == 200, f"Health check failed: {resp.status_code}"

    # Test config
    resp = requests.get("http://127.0.0.1:5000/api/config")
    assert resp.status_code == 200, f"Config check failed: {resp.status_code}"
    print("Tests passed successfully.")
except Exception as e:
    print(f"Test failed: {e}")
finally:
    server_process.terminate()
