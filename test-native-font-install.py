import ctypes
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import uuid
import winreg

# Exercise Chrome's native-message framing through a real successful font install.
project = Path(__file__).resolve().parent
font = (project / 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2').read_bytes()
bridge = project / 'src-tauri/target/release/sightline-bridge.exe'
capture_id = str(uuid.uuid4())
name = 'Sightline native test'
reg_name = f'{name} [{capture_id}] (TrueType)'
reg_path = r'Software\Microsoft\Windows NT\CurrentVersion\Fonts'
with tempfile.TemporaryDirectory() as temp:
    base = Path(temp)
    config = base / 'roaming/com.sightline.app'
    library = base / 'library'
    inbox = base / 'inbox'
    for folder in (config, library, inbox):
        folder.mkdir(parents=True)
    (config / 'library-path.txt').write_text(str(library))
    (config / 'capture-inbox.txt').write_text(str(inbox))
    env = {**os.environ, 'APPDATA': str(base / 'roaming'), 'LOCALAPPDATA': str(base / 'local')}
    proc = subprocess.Popen([str(bridge)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    dest = base / 'local/Microsoft/Windows/Fonts' / f'{capture_id}.ttf'
    def send(message):
        payload = json.dumps(message).encode()
        proc.stdin.write(struct.pack('<I', len(payload)) + payload)
        proc.stdin.flush()
        header = proc.stdout.read(4)
        assert len(header) == 4, 'Native host closed without a complete response'
        length = struct.unpack('<I', header)[0]
        assert length < 1024 * 1024, f'Invalid native-message length {length}: stdout was contaminated'
        return json.loads(proc.stdout.read(length))
    try:
        assert send({'type':'begin', 'id':capture_id, 'extension':'woff2', 'name':name})['ok']
        for offset in range(0, len(font), 32768):
            assert send({'type':'chunk', 'data':list(font[offset:offset+32768])})['ok']
        result = send({'type':'end'})
        assert result['ok'] and result['installed'], result
        assert dest.is_file()
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, reg_path) as key:
            assert winreg.QueryValueEx(key, reg_name)[0] == str(dest)
        print('Native font install completed with clean message framing.')
    finally:
        proc.stdin.close()
        proc.wait(timeout=10)
        if dest.exists():
            ctypes.windll.gdi32.RemoveFontResourceExW(str(dest), 0, None)
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, reg_path, 0, winreg.KEY_SET_VALUE) as key:
            try:
                winreg.DeleteValue(key, reg_name)
            except FileNotFoundError:
                pass
