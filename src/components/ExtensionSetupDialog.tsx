import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Download, FolderOpen, Puzzle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

export type DetectedExtension = {
  id: string;
  browser: string;
  profile: string;
  path: string;
  registered: boolean;
};

export type ExtensionSetupStatus = {
  connected: boolean;
  registeredIds: string[];
  detected: DetectedExtension[];
  extensionDir: string;
  bridgeReady: boolean;
  bridgePath?: string | null;
};

export type RuntimeToolsStatus = {
  ffmpeg: boolean;
  ffprobe: boolean;
  python: boolean;
  galleryDl: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toolsStatus: RuntimeToolsStatus | null;
  onRefreshTools: () => Promise<RuntimeToolsStatus | null>;
  onInstallMissingTools: (tools: string[]) => Promise<void>;
  installingTools: boolean;
  onCheckForUpdates: () => Promise<void>;
  checkingUpdates: boolean;
  updateStatusMessage: string;
  appVersion: string;
};

export function ExtensionSetupDialog({
  open,
  onOpenChange,
  toolsStatus,
  onRefreshTools,
  onInstallMissingTools,
  installingTools,
  onCheckForUpdates,
  checkingUpdates,
  updateStatusMessage,
  appVersion,
}: Props) {
  const [status, setStatus] = useState<ExtensionSetupStatus | null>(null);
  const [extensionId, setExtensionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    setError('');
    try {
      const next = await invoke<ExtensionSetupStatus>('get_extension_setup_status');
      setStatus(next);
      const unregistered = next.detected.find((d) => !d.registered) || next.detected[0];
      if (unregistered && !extensionId) {
        setExtensionId(unregistered.id);
      }
      await onRefreshTools();
    } catch (e) {
      setError(String(e));
    }
  }, [extensionId, onRefreshTools]);

  useEffect(() => {
    if (!open) return;
    setMessage('');
    setError('');
    void loadStatus();
  }, [open, loadStatus]);

  const openFolder = async () => {
    setError('');
    try {
      const opened = await invoke<string>('open_extension_folder');
      setMessage(`Opened ${opened}`);
      await loadStatus();
    } catch (e) {
      setError(String(e));
    }
  };

  const connect = async (idToConnect = extensionId) => {
    const clean = idToConnect.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await invoke<ExtensionSetupStatus>('connect_browser_extension', {
        extensionId: clean,
      });
      setStatus(next);
      setExtensionId(clean);
      setMessage('Browser extension connected to Chrome, Brave, and Edge.');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const missingTools: string[] = [];
  if (toolsStatus && !toolsStatus.ffmpeg) missingTools.push('ffmpeg');
  if (toolsStatus && !toolsStatus.python) missingTools.push('python');
  if (toolsStatus && !toolsStatus.galleryDl) missingTools.push('gallery-dl');

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="source-dialog extension-setup-dialog">
        <div className="dialog-title">
          <div>
            <DialogTitle className="flex items-center gap-2">
              <Puzzle size={16} /> Browser extension &amp; tools
              {status && (
                <Badge variant={status.connected ? 'secondary' : 'outline'}>
                  {status.connected ? 'Connected' : 'Not connected'}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="mt-2">
              Capture pages, clips, and webfonts from Chrome, Brave, or Edge directly into Sightline.
            </DialogDescription>
          </div>
        </div>

        <div className="setup-section">
          <div className="setup-section-head">
            <strong>1. Load unpacked extension once</strong>
            <Button variant="outline" size="sm" type="button" onClick={() => void openFolder()}>
              <FolderOpen size={14} /> Open extension folder
            </Button>
          </div>
          <p className="setup-help">
            Open <code>chrome://extensions</code>, enable{' '}
            <strong>Developer mode</strong>, click <strong>Load unpacked</strong>, and select the
            extension folder. Future Sightline updates refresh this folder automatically.
          </p>
          {status?.extensionDir && (
            <code className="setup-path">{status.extensionDir}</code>
          )}
        </div>

        <div className="setup-section">
          <div className="setup-section-head">
            <strong>2. Connect native bridge</strong>
            <Button variant="ghost" size="sm" type="button" onClick={() => void loadStatus()}>
              <RefreshCw size={13} /> Detect
            </Button>
          </div>

          {status && status.detected.length > 0 && (
            <div className="detected-ext-list">
              {status.detected.map((item) => (
                <Button
                  key={`${item.browser}-${item.id}`}
                  type="button"
                  variant={item.registered ? 'secondary' : 'outline'}
                  size="sm"
                  className="detected-ext-chip"
                  onClick={() => void connect(item.id)}
                >
                  {item.registered && <Check size={13} />}
                  <span>{item.browser}</span>
                  <code>{item.id}</code>
                </Button>
              ))}
            </div>
          )}

          <div className="connect-row">
            <Input
              aria-label="Browser extension ID"
              placeholder="Paste 32-character Extension ID"
              value={extensionId}
              onChange={(e) => setExtensionId(e.target.value)}
            />
            <Button
              type="button"
              disabled={!extensionId.trim() || busy || !status?.bridgeReady}
              onClick={() => void connect()}
            >
              {busy ? 'Connecting...' : 'Connect'}
            </Button>
          </div>
          {status && !status.bridgeReady && (
            <p className="setup-warn">
              Bridge executable not found next to the app. Reinstall from a release build or run <code>prepare:bundle</code>.
            </p>
          )}
          {status && status.registeredIds.length > 0 && (
            <p className="setup-help">
              Connected IDs: {status.registeredIds.join(', ')}
            </p>
          )}
        </div>

        <Separator />

        <div className="setup-section">
          <div className="setup-section-head">
            <strong>Media tools &amp; updates</strong>
            <span className="setup-version">{appVersion ? `v${appVersion}` : ''}</span>
          </div>
          <div className="tools-status-row">
            <Badge variant={toolsStatus?.ffmpeg ? 'secondary' : 'outline'}>
              FFmpeg: {toolsStatus ? (toolsStatus.ffmpeg ? 'Ready' : 'Missing') : '...'}
            </Badge>
            <Badge variant={toolsStatus?.python ? 'secondary' : 'outline'}>
              Python: {toolsStatus ? (toolsStatus.python ? 'Ready' : 'Missing') : '...'}
            </Badge>
            <Badge variant={toolsStatus?.galleryDl ? 'secondary' : 'outline'}>
              gallery-dl: {toolsStatus ? (toolsStatus.galleryDl ? 'Ready' : 'Optional') : '...'}
            </Badge>
          </div>
          <div className="dialog-actions">
            {missingTools.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={installingTools}
                onClick={() => void onInstallMissingTools(missingTools)}
              >
                <Download size={14} /> {installingTools ? 'Installing tools...' : 'Install missing tools'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={checkingUpdates}
              onClick={() => void onCheckForUpdates()}
            >
              <RefreshCw size={14} /> {checkingUpdates ? 'Checking...' : 'Check for updates'}
            </Button>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>

        {message && <p className="setup-ok" role="status">{message}</p>}
        {updateStatusMessage && <p className="setup-help" role="status">{updateStatusMessage}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
