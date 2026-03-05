import requests
import time
import subprocess

# Start server
server_process = subprocess.Popen(["python", "server.py"])

try:
    # Poll for server readiness
    for _ in range(20):  # Poll for up to 10 seconds
        try:
            resp = requests.get("http://127.0.0.1:5000/api/health")
            if resp.ok:
                print("Server is up.")
                break
            else:
                time.sleep(0.5)
        except requests.ConnectionError:
            time.sleep(0.5)
    else:
        server_process.terminate()
        raise RuntimeError("Server failed to start in time.")

    # Test config
    resp = requests.get("http://127.0.0.1:5000/api/config")
    assert resp.status_code == 200, f"Config check failed: {resp.status_code}"
    print("Tests passed successfully.")
except Exception as e:
    print(f"Test failed: {e}")
finally:
    server_process.terminate()
