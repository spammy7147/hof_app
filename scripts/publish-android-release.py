"""기존 배포 SSH 안에서 APK 메타데이터를 게시한다. 토큰은 stdin으로만 전달한다."""
import json
import os
import subprocess
import sys


def main():
    try:
        payload = json.dumps(json.load(sys.stdin), ensure_ascii=False, separators=(",", ":"))
        token = os.environ["HOF_RELEASE_PUBLISH_TOKEN"]
        url = os.environ["BACKEND_RELEASE_PUBLISH_URL"]
        if not token or any(ord(char) < 32 or ord(char) == 127 for char in token + url):
            raise ValueError("Invalid publication settings")
        command = [
            "ssh", "-i", os.environ["SSH_KEY_FILE"],
            "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
            "-o", "UserKnownHostsFile=" + os.environ["SSH_KNOWN_HOSTS_FILE"],
            "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10",
            os.environ["DEPLOY_TARGET"],
            "curl --fail --silent --show-error --connect-timeout 10 --max-time 60 --config -",
        ]
    except (KeyError, ValueError):
        print("APK 게시 설정 또는 JSON 본문이 올바르지 않습니다.", file=sys.stderr)
        return 2
    config = "\n".join(
        key + " = " + json.dumps(value, ensure_ascii=False)
        for key, value in [
            ("url", url), ("request", "POST"),
            ("header", "Content-Type: application/json"),
            ("header", "X-HOF-Release-Token: " + token), ("data-binary", payload),
        ]
    ) + "\n"
    return subprocess.run(command, input=config.encode("utf-8")).returncode


if __name__ == "__main__":
    sys.exit(main())
