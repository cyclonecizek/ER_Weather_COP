import importlib.util
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('wsr_server', Path(__file__).parents[1] / 'server.py')
wsr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wsr)
NOW = datetime.now(timezone.utc).replace(microsecond=0)
DATA = b'AR2V0006.001' + b'\x00' * 8 + b'KPSB' + b'radar payload' * 20
assert DATA[20:24] == b'KPSB'


class Download:
    def __init__(self, data): self.data, self.offset = data, 0
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, size=-1):
        if size < 0: size = len(self.data)
        block = self.data[self.offset:self.offset + size]
        self.offset += len(block)
        return block


class PollingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = wsr.Store(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()
    def add(self, dt=NOW):
        name = wsr.scan_name(dt)
        with patch.object(self.store, 'request', return_value=Download(DATA)):
            self.store.download(name, dt, len(DATA))
        return name

    def test_atomic_download_and_cache_reuse(self):
        name = self.add()
        self.assertEqual((Path(self.tmp.name) / name).read_bytes(), DATA)
        with patch.object(self.store, 'request', side_effect=AssertionError('Duplicate download')):
            self.store.download(name, NOW, len(DATA))
        self.assertEqual(self.store.index(), f'{len(DATA)} {name}\n'.encode())
        self.assertFalse(list(Path(self.tmp.name).glob('*.part')))

    def test_bad_download_never_listed_or_served(self):
        for bad in [DATA[:-1], DATA + b'excess', DATA[:20] + b'KMLB' + DATA[24:], b'not a radar' * 30]:
            with self.subTest(size=len(bad)):
                with patch.object(self.store, 'request', return_value=Download(bad)):
                    with self.assertRaises(ValueError):
                        self.store.download(wsr.scan_name(NOW), NOW, len(DATA))
                self.assertEqual(self.store.index(), b'')
                self.assertEqual(list(Path(self.tmp.name).iterdir()), [])

    def test_retention_and_reload(self):
        self.add(NOW - timedelta(minutes=119))
        old = self.add(NOW - timedelta(minutes=121))
        reloaded = wsr.Store(self.tmp.name)
        self.assertEqual(len(reloaded.scans), 1)
        self.assertFalse((Path(self.tmp.name) / old).exists())

    def test_api_failure_keeps_previous_scan(self):
        self.add()
        with patch.object(self.store, 'listing', side_effect=OSError('Unavailable')):
            self.store.sync(NOW)
        self.assertEqual(len(self.store.scans), 1)
        self.assertEqual(self.store.status()['status'], 'degraded')
        self.assertIsNotNone(self.store.status()['error'])

    def test_listing_filters_window_and_downloads_newest_first(self):
        rows = [{'file_date': wsr.iso(dt), 'file_size': len(DATA)} for dt in
                [NOW - timedelta(minutes=50), NOW - timedelta(minutes=121), NOW - timedelta(minutes=2), NOW + timedelta(minutes=1)]]
        with patch.object(self.store, 'request', return_value=Download(json.dumps(rows).encode())):
            selected = self.store.listing(NOW)
        self.assertEqual([item[1][0] for item in selected], [NOW - timedelta(minutes=2), NOW - timedelta(minutes=50)])

    def test_http_config_index_head_and_ranges(self):
        name = self.add()
        server = ThreadingHTTPServer(('127.0.0.1', 0), wsr.Handler)
        server.store = self.store
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            for path in ['/config.cfg', '/grlevel2.cfg']:
                with urllib.request.urlopen(base + path) as r:
                    self.assertEqual(r.read(), b'ListFile: dir.list\nSite: KPSB\n')
            with urllib.request.urlopen(base + '/KPSB/dir.list') as r:
                self.assertEqual(r.read(), f'{len(DATA)} {name}\n'.encode())
            url = base + '/KPSB/' + name
            with urllib.request.urlopen(url) as r:
                self.assertEqual(r.read(), DATA)
            with urllib.request.urlopen(urllib.request.Request(url, method='HEAD')) as r:
                self.assertEqual(int(r.headers['Content-Length']), len(DATA))
                self.assertEqual(r.read(), b'')
            for header, expected in [('bytes=0-23', DATA[:24]), ('bytes=24-', DATA[24:]), ('bytes=-5', DATA[-5:])]:
                with urllib.request.urlopen(urllib.request.Request(url, headers={'Range': header})) as r:
                    self.assertEqual(r.status, 206)
                    self.assertEqual(r.read(), expected)
            for path in ['/../server.py', '/KPSB/missing.bz2', '/KMLB/dir.list']:
                with self.assertRaises(urllib.error.HTTPError) as cm:
                    urllib.request.urlopen(base + path)
                self.assertEqual(cm.exception.code, 404)
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(urllib.request.Request(url, headers={'Range': 'bytes=99999-'}))
            self.assertEqual(cm.exception.code, 416)
        finally:
            server.shutdown()
            server.server_close()

    def test_ranges_reject_invalid_and_multi(self):
        for value in ['bytes=1-0', 'bytes=-0', 'bytes=300-', 'bytes=0-1,3-4', 'garbage']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                wsr.byte_range(value, 100)
        self.assertEqual(wsr.byte_range('bytes=10-200', 100), (10, 99, True))


if __name__ == '__main__': unittest.main()
