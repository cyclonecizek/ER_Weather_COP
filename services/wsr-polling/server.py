"""WSR API to GRLevelX polling bridge. Python standard library only."""
from __future__ import annotations

import html
import json
import logging
import os
import re
import signal
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

UTC = timezone.utc
LOG = logging.getLogger('wsr-polling')
SITE = 'KPSB'
CONFIG = b'ListFile: dir.list\nSite: KPSB\n'
MAX_FILE_BYTES = 128 * 1024 * 1024


def stamp(value):
    dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def iso(dt):
    return dt.isoformat().replace('+00:00', 'Z')


def scan_name(dt):
    # Same timestamp naming convention as the Iowa State Level II polling feed.
    # .bz2 describes the existing internal bzip2 records. Bytes are not changed.
    return dt.strftime('KPSB_%Y%m%d_%H%M%S.bz2')


def byte_range(header, size):
    if not header:
        return 0, size - 1, False
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', header)
    if not match or not any(match.groups()):
        raise ValueError('Unsupported range')
    first, last = match.groups()
    if not first:
        length = int(last)
        if length <= 0:
            raise ValueError('Empty suffix')
        start, end = max(0, size - length), size - 1
    else:
        start, end = int(first), min(int(last), size - 1) if last else size - 1
    if start >= size or start > end:
        raise ValueError('Unsatisfiable range')
    return start, end, True


class Store:
    def __init__(self, directory, api='https://codiapi-wsr.rad.spaceforce.mil',
                 interval=60, history_minutes=120):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.api = api.rstrip('/')
        self.interval = interval
        self.history_minutes = history_minutes
        self.lock = threading.RLock()
        self.scans = {}
        self.last_attempt = None
        self.last_success = None
        self.error = None
        self.stop = threading.Event()
        # Only reuse our named, complete files after process restarts.
        for path in self.directory.glob('KPSB_????????_??????.bz2'):
            try:
                dt = datetime.strptime(path.name, 'KPSB_%Y%m%d_%H%M%S.bz2').replace(tzinfo=UTC)
                with path.open('rb') as handle:
                    self.validate(handle.read(24), path.stat().st_size)
                self.scans[path.name] = (dt, path.stat().st_size)
            except (OSError, ValueError):
                LOG.warning('Ignoring invalid cache file %s', path.name)
        self.prune(datetime.now(UTC))

    @staticmethod
    def validate(header, size):
        if size <= 24 or size > MAX_FILE_BYTES or not header.startswith((b'AR2V', b'ARCHIVE2')):
            raise ValueError('Not a complete-sized Level II file')
        if header[20:24] != SITE.encode():
            raise ValueError('Unexpected radar site in Level II header')

    def request(self, path):
        return urllib.request.urlopen(urllib.request.Request(
            self.api + path, headers={'User-Agent': 'ER-Weather-WSR-Polling/1.0'}), timeout=30)

    def listing(self, now):
        start = now - timedelta(minutes=self.history_minutes)
        query = urllib.parse.urlencode({'date>': start.strftime('%Y-%m-%dT%H:%M:%S'),
                                        'date<': now.strftime('%Y-%m-%dT%H:%M:%S')})
        with self.request('/wsr/range?' + query) as response:
            rows = json.load(response)
        if not isinstance(rows, list):
            raise ValueError('Unexpected API listing response')
        selected = {}
        for row in rows:
            dt = stamp(row['file_date'])
            size = int(row['file_size'])
            if start <= dt <= now and 24 < size <= MAX_FILE_BYTES:
                selected[scan_name(dt)] = (dt, size)
        return sorted(selected.items(), key=lambda pair: pair[1][0], reverse=True)

    def download(self, name, dt, expected_size):
        with self.lock:
            if self.scans.get(name) == (dt, expected_size):
                return
        query = urllib.parse.urlencode({'date': dt.strftime('%Y-%m-%dT%H:%M:%S')})
        temporary = self.directory / (name + '.part')
        total = 0
        header = b''
        try:
            with self.request('/wsr/latest/download?' + query) as response, temporary.open('wb') as handle:
                while True:
                    block = response.read(65536)
                    if not block:
                        break
                    total += len(block)
                    if total > expected_size:
                        raise ValueError('Download exceeds listed size')
                    header = (header + block)[:24] if len(header) < 24 else header
                    handle.write(block)
            if total != expected_size:
                raise ValueError('Truncated radar file')
            self.validate(header, total)
            with self.lock:
                temporary.replace(self.directory / name)
                self.scans[name] = (dt, total)
        finally:
            temporary.unlink(missing_ok=True)

    def prune(self, now):
        cutoff = now - timedelta(minutes=self.history_minutes)
        with self.lock:
            for name, (dt, _) in list(self.scans.items()):
                if dt < cutoff or dt > now:
                    (self.directory / name).unlink(missing_ok=True)
                    del self.scans[name]

    def sync(self, now=None):
        now = now or datetime.now(UTC)
        with self.lock:
            self.last_attempt = iso(now)
        failures = []
        try:
            for name, (dt, size) in self.listing(now):
                try:
                    self.download(name, dt, size)
                except Exception as exc:
                    LOG.warning('Could not download %s: %s', name, exc)
                    failures.append(name)
            with self.lock:
                self.last_success = iso(datetime.now(UTC))
                self.error = ('Some scans could not be downloaded: ' + ', '.join(failures)) if failures else None
        except Exception as exc:
            LOG.warning('API polling failed: %s', exc)
            with self.lock:
                self.error = 'WSR API request failed; retrying on the next poll.'
        finally:
            self.prune(now)

    def run(self):
        while not self.stop.is_set():
            started = time.monotonic()
            self.sync()
            self.stop.wait(max(0, self.interval - (time.monotonic() - started)))

    def index(self):
        with self.lock:
            return ''.join(f'{size} {name}\n' for name, (dt, size) in
                           sorted(self.scans.items(), key=lambda pair: pair[1][0])).encode()

    def status(self):
        with self.lock:
            newest = max((dt for dt, size in self.scans.values()), default=None)
            age = max(0, (datetime.now(UTC) - newest).total_seconds()) if newest else None
            return {'site': SITE, 'status': 'ready' if newest and age < 1200 and not self.error else 'degraded',
                    'scan_count': len(self.scans), 'newest_scan': iso(newest) if newest else None,
                    'newest_age_seconds': round(age) if age is not None else None,
                    'last_poll_attempt': self.last_attempt, 'last_successful_listing': self.last_success,
                    'poll_interval_seconds': self.interval, 'history_minutes': self.history_minutes,
                    'error': self.error, 'source': self.api}


class Handler(BaseHTTPRequestHandler):
    server_version = 'WSRPolling/1.0'

    def do_HEAD(self):
        self.do_GET()

    def respond(self, code, body, content_type='text/plain; charset=utf-8', cache='no-store'):
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', cache)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        store = self.server.store
        if path in ('/config.cfg', '/grlevel2.cfg'):
            return self.respond(200, CONFIG, cache='public, max-age=60')
        if path == '/KPSB/dir.list':
            return self.respond(200, store.index(), cache='no-cache, max-age=0')
        if path in ('/healthz', '/readyz', '/status.json'):
            status = store.status()
            code = 503 if path == '/readyz' and status['status'] != 'ready' else 200
            return self.respond(code, json.dumps(status).encode(), 'application/json')
        if path == '/':
            status = store.status()
            content = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><title>KPSB GR2 Polling</title><style>body{{background:#0b1525;color:#dce7f6;font:17px system-ui;max-width:780px;margin:7vh auto;padding:24px}}h1{{font-size:36px}}a{{color:#80d9ff}}code,pre{{background:#14263d;padding:12px;border-radius:8px;overflow:auto}}p{{line-height:1.6}}.tag{{color:#80d9ff;text-transform:uppercase;font-size:13px;letter-spacing:2px}}</style><p class="tag">Eastern Range · WSR</p><h1>KPSB radar polling</h1><p>In GR2Analyst, open File → Configure Polling, add this website’s root URL (ending in /), set the polling interval to 60 seconds, and select KPSB.</p><p>This feed serves complete Level II files from the WSR API. It checks every {store.interval} seconds and retains {store.history_minutes} minutes of scans. API delivery delays remain visible in the timestamps.</p><p>Cached scans: {status['scan_count']} · Status: {status['status']}<br>Newest scan: {html.escape(status['newest_scan'] or 'Waiting for first scan')}</p><p>{html.escape(status['error'] or '')}</p><p><a href="KPSB/dir.list">Scan index</a> · <a href="status.json">Feed status</a> · <a href="config.cfg">GR configuration</a></p><p>When first starting or waking from sleep, the newest available scan is loaded first, followed by the rest of the two-hour history. If your GR version does not list KPSB, its custom radar-site setup must be checked before this polling feed can be used.</p></html>'''
            return self.respond(200, content.encode(), 'text/html; charset=utf-8')
        match = re.fullmatch(r'/KPSB/(KPSB_\d{8}_\d{6}\.bz2)', path)
        if not match:
            return self.respond(404, b'Not found\n')
        name = match.group(1)
        with store.lock:
            info = store.scans.get(name)
            if not info:
                return self.respond(404, b'Scan is not available in the retained history\n')
            try:
                handle = (store.directory / name).open('rb')
            except FileNotFoundError:
                return self.respond(404, b'Scan is no longer available\n')
        with handle:
            size = os.fstat(handle.fileno()).st_size
            try:
                start, end, partial = byte_range(self.headers.get('Range'), size)
            except ValueError:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            self.send_response(206 if partial else 200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(end - start + 1))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'public, max-age=86400, immutable')
            self.send_header('Last-Modified', self.date_time_string(info[0].timestamp()))
            if partial:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            if self.command != 'HEAD':
                handle.seek(start)
                remaining = end - start + 1
                while remaining:
                    block = handle.read(min(65536, remaining))
                    if not block:
                        break
                    self.wfile.write(block)
                    remaining -= len(block)

    def log_message(self, fmt, *args):
        LOG.info('%s %s', self.address_string(), fmt % args)


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    store = Store(os.getenv('CACHE_DIR', '/tmp/wsr-polling'),
                  api=os.getenv('WSR_API_BASE', 'https://codiapi-wsr.rad.spaceforce.mil'),
                  interval=max(30, int(os.getenv('POLL_SECONDS', '60'))),
                  history_minutes=max(10, int(os.getenv('HISTORY_MINUTES', '120'))))
    server = ThreadingHTTPServer(('0.0.0.0', int(os.getenv('PORT', '8080'))), Handler)
    server.daemon_threads = True
    server.store = store
    threading.Thread(target=store.run, daemon=True).start()
    def shutdown(signum, frame):
        store.stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    LOG.info('Serving WSR polling on port %s', server.server_port)
    try:
        server.serve_forever()
    finally:
        store.stop.set()
        server.server_close()


if __name__ == '__main__':
    main()
