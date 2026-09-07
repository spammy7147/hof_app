import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("package_extension", Path(__file__).with_name("package-chrome-extension.py"))
package_extension = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package_extension)


class ExtensionPackageTest(unittest.TestCase):
    def test_packages_loadable_extension_and_excludes_other_release_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / "expo").mkdir()
            (source / "expo/app.js").write_text("console.log('extension')")
            (source / "index.html").write_text('<script src="/expo/app.js"></script>')
            (source / "service-worker.js").write_text("// worker")
            (source / "manifest.json").write_text(json.dumps({
                "manifest_version": 3, "version": "1.0.0",
                "background": {"service_worker": "service-worker.js"},
                "side_panel": {"default_path": "index.html"},
            }))
            (source / "old.apk").write_text("apk")
            (source / "old.zip").write_text("previous zip")
            output = source / "extension.zip"
            package_extension.package_extension(source, output, "1.0.67")
            with ZipFile(output) as archive:
                self.assertEqual(set(archive.namelist()), {
                    "HOF_Chrome_Extension/manifest.json", "HOF_Chrome_Extension/index.html",
                    "HOF_Chrome_Extension/service-worker.js", "HOF_Chrome_Extension/expo/app.js",
                })
                self.assertEqual(json.loads(archive.read("HOF_Chrome_Extension/manifest.json"))["version"], "1.0.67")
            (source / "expo/app.js").unlink()
            with self.assertRaisesRegex(ValueError, "Missing extension script"):
                package_extension.package_extension(source, output, "1.0.68")
            with self.assertRaisesRegex(ValueError, "Chrome extension version"):
                package_extension.package_extension(source, output, "1.0.65536")


if __name__ == "__main__":
    unittest.main()
