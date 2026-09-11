"""SSH 내부 APK 게시의 요청 보존과 실패 전파 계약을 검사한다."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import threading

import unittest

class AndroidReleasePublishingTest(unittest.TestCase):
    def test_publish_over_ssh_preserves_request_and_failure(self):
        app = Path(__file__).resolve().parent.parent
        source = (app / "Jenkinsfile").read_text()
        start = source.index('                        payload="$(printf')
        end = source.index("                        printf '\\nPublished APK", start)
        publish = "set -Eeuo pipefail\n" + textwrap.dedent(source[start:end])
        expected = {"versionCode": 41, "versionName": "1.0.41", "fileName": "hof-41.apk",
                    "fileSize": 1234, "sha256": "a" * 64, "gitRevision": "b" * 40, "jenkinsBuild": 41}
        records = []
        with tempfile.TemporaryDirectory(prefix="hof-publish-fixture-") as directory:
            root = Path(directory)
            commands = root / "commands"
            commands.mkdir()
            trace = root / "commands.jsonl"
            real_curl = shutil.which("curl")
            assert real_curl
            (commands / "ssh").write_text(f"#!{sys.executable}\n" + textwrap.dedent('''
                import json,os,subprocess,sys
                with open(os.environ['FIXTURE_TRACE'],'a') as out:
                    out.write(json.dumps({'name':'ssh','args':sys.argv[1:]})+'\\n')
                if os.environ.get('FIXTURE_SSH_FAIL')=='true': sys.exit(255)
                env=dict(os.environ, FIXTURE_REMOTE='true')
                sys.exit(subprocess.run(['bash','-c',sys.argv[-1]],env=env).returncode)
'''))
            (commands / "curl").write_text(f"#!{sys.executable}\n" + textwrap.dedent('''
                import json,os,sys
                remote=os.environ.get('FIXTURE_REMOTE')=='true'
                with open(os.environ['FIXTURE_TRACE'],'a') as out:
                    out.write(json.dumps({'name':'curl','remote':remote,'args':sys.argv[1:]})+'\\n')
                if not remote: sys.exit(97)
                os.execv(os.environ['FIXTURE_REAL_CURL'],[os.environ['FIXTURE_REAL_CURL'],*sys.argv[1:]])
'''))
            for path in commands.iterdir():
                path.chmod(0o755)
            for case, status, ssh_fail in [("정상 게시", 200, False), ("게시 거절", 500, False), ("SSH 연결 실패", 200, True)]:
                received = []
                token = 'fixture-only-token-"-\\'

                class Handler(BaseHTTPRequestHandler):
                    def do_POST(self):
                        body = self.rfile.read(int(self.headers["Content-Length"]))
                        received.append({"path": self.path, "body": json.loads(body),
                                         "token": self.headers.get("X-HOF-Release-Token"),
                                         "type": self.headers.get("Content-Type")})
                        self.send_response(status)
                        self.end_headers()
                        self.wfile.write(b'{"published":true}')

                    def log_message(self, *_):
                        pass

                server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                env = dict(os.environ, PATH=str(commands) + os.pathsep + os.environ["PATH"],
                           FIXTURE_TRACE=str(trace), FIXTURE_REAL_CURL=real_curl,
                           FIXTURE_SSH_FAIL=str(ssh_fail).lower(),
                           BACKEND_RELEASE_PUBLISH_URL=f"http://127.0.0.1:{server.server_port}/internal/app-releases/android",
                           HOF_RELEASE_PUBLISH_TOKEN=token, DEPLOY_TARGET="spammy@192.0.2.202",
                           SSH_KEY_FILE="/fixture/key", SSH_KNOWN_HOSTS_FILE="/fixture/known_hosts",
                           VERSION_CODE="41", VERSION_NAME="1.0.41", ARTIFACT_NAME="hof-41.apk",
                           apk_size="1234", apk_sha256="a" * 64, GIT_REVISION="b" * 40, BUILD_NUMBER="41")
                trace.write_text("")
                try:
                    result = subprocess.run(["bash", "-c", publish], cwd=app, env=env,
                                            capture_output=True, text=True, timeout=15)
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()
                calls = [json.loads(line) for line in trace.read_text().splitlines()]
                expected_exit = 255 if ssh_fail else 0 if status == 200 else 22
                errors = []
                if result.returncode != expected_exit:
                    errors.append(f"종료 코드 {result.returncode}; 기대 {expected_exit}")
                if len(received) != (0 if ssh_fail else 1):
                    errors.append("원격 요청 수 불일치")
                if any(call["name"] == "curl" and not call["remote"] for call in calls):
                    errors.append("빌드 워커에서 직접 HTTP 요청")
                ssh_calls = [call for call in calls if call["name"] == "ssh"]
                if len(ssh_calls) != 1:
                    errors.append("SSH 전달 1회가 아님")
                elif not all(option in ssh_calls[0]["args"] for option in ["IdentitiesOnly=yes", "BatchMode=yes", "StrictHostKeyChecking=yes", "UserKnownHostsFile=/fixture/known_hosts"]):
                    errors.append("기존 SSH 검증 옵션 누락")
                if any(token in argument for call in calls for argument in call["args"]):
                    errors.append("게시 토큰이 명령 인수에 포함됨")
                if token in result.stdout or token in result.stderr:
                    errors.append("게시 토큰이 출력에 포함됨")
                for request in received:
                    if request != {"path": "/internal/app-releases/android", "body": expected, "token": token, "type": "application/json"}:
                        errors.append("기존 게시 요청의 본문·헤더·경로 변경")
                records.append({"case": case, "exitCode": result.returncode, "expectedExitCode": expected_exit,
                                "remoteRequests": len(received), "errors": errors})
        self.assertFalse(any(row["errors"] for row in records), json.dumps(records, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
