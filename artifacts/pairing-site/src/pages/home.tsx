import React, { useState, useEffect, useRef } from 'react';
import { useGetPairingStatus, useRequestPairingCode, useGetServerStats } from '@workspace/api-client-react';
import './home.css';

// One pairing code is valid for roughly 60 s (one QR registration window).
const CODE_TTL_SECONDS = 60;
const BASE = import.meta.env.BASE_URL;

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function Particles() {
  const list = useRef(
    Array.from({ length: 28 }, (_, i) => ({
      id: i,
      left: `${(i * 3.7) % 100}vw`,
      delay: `${(i * 0.73) % 20}s`,
      duration: `${15 + (i % 5) * 2}s`,
    })),
  );
  return (
    <div className="cx-particles">
      {list.current.map((p) => (
        <div key={p.id} className="cx-particle"
          style={{ left: p.left, animationDelay: p.delay, animationDuration: p.duration }} />
      ))}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

type UiPhase =
  | 'idle'
  | 'generating'
  | 'code_ready'
  | 'waiting_confirm'
  | 'connected'
  | 'expired'
  | 'error';

function StatusBadge({ phase, error }: { phase: UiPhase; error?: string | null }) {
  const map: Record<UiPhase, { icon: string; text: string; cls: string }> = {
    idle:           { icon: 'fa-link',              text: 'Ready to pair',               cls: 'cx-badge-idle' },
    generating:     { icon: 'fa-circle-notch fa-spin', text: 'Generating code…',         cls: 'cx-badge-busy' },
    code_ready:     { icon: 'fa-key',               text: 'Enter code in WhatsApp',      cls: 'cx-badge-active' },
    waiting_confirm:{ icon: 'fa-hourglass-half',    text: 'Waiting for confirmation…',   cls: 'cx-badge-wait' },
    connected:      { icon: 'fa-check-circle',      text: 'Connected ✅',                cls: 'cx-badge-ok' },
    expired:        { icon: 'fa-clock',             text: 'Code expired',                cls: 'cx-badge-warn' },
    error:          { icon: 'fa-times-circle',      text: error ?? 'Something went wrong', cls: 'cx-badge-err' },
  };
  const { icon, text, cls } = map[phase];
  return (
    <div className={`cx-status-badge ${cls}`}>
      <i className={`fas ${icon}`} />
      <span>{text}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function Home() {
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sessionCopied, setSessionCopied] = useState(false);
  const [liveUptime, setLiveUptime] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [phase, setPhase] = useState<UiPhase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Status polling — every 3 s
  const { data: status } = useGetPairingStatus({ query: { refetchInterval: 3000 } });
  const { data: stats }  = useGetServerStats({   query: { refetchInterval: 5000 } });

  // Sync uptime from server, then tick locally
  useEffect(() => {
    if (stats?.uptimeSeconds !== undefined) setLiveUptime(stats.uptimeSeconds);
  }, [stats?.uptimeSeconds]);
  useEffect(() => {
    const id = setInterval(() => setLiveUptime((p) => p + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Detect connection success from server
  useEffect(() => {
    if (status?.connected || status?.state === 'connected') {
      setPhase('connected');
      setPairingCode(null);
      setCountdown(null);
      if (status?.sessionId) setSessionId(status.sessionId);
    }
  }, [status?.connected, status?.state, status?.sessionId]);

  // Detect server-side session wipe only while waiting for WhatsApp to confirm
  useEffect(() => {
    if (
      phase === 'waiting_confirm' &&
      status && !status.pairingCode && !status.connected
    ) {
      setPhase('expired');
      setCountdown(0);
    }
  }, [status?.pairingCode, status?.connected, phase]);

  // Surface server error messages
  useEffect(() => {
    if (status?.lastError && phase !== 'connected') {
      setErrorMsg(status.lastError);
    }
  }, [status?.lastError]);

  const requestMutation = useRequestPairingCode({
    mutation: {
      onMutate: () => {
        setPhase('generating');
        setErrorMsg(null);
        setPairingCode(null);
        setCountdown(null);
      },
      onSuccess: (data) => {
        setPairingCode(data.code);
        setCountdown(CODE_TTL_SECONDS);
        setPhase('code_ready');
      },
      onError: (err: unknown) => {
        const msg =
          (err as any)?.response?.data?.message ||
          (err instanceof Error ? err.message : null) ||
          'Failed to generate code. Please try again.';
        setErrorMsg(msg);
        setPhase('error');
      },
    },
  });

  // Countdown ticker — when the 60 s window expires, auto-request a fresh code
  // so the user never has to manually click "retry" after a timeout.
  useEffect(() => {
    if (countdown === null || countdown <= 0) {
      if (countdown === 0 && phase === 'code_ready' && phone) {
        requestMutation.mutate({ data: { phoneNumber: phone } });
      }
      return;
    }
    const id = setTimeout(() => setCountdown((c) => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  function validatePhone(v: string): boolean {
    if (!/^\d{7,15}$/.test(v)) {
      setPhoneError('Include country code, digits only (e.g. 254712345678)');
      return false;
    }
    setPhoneError('');
    return true;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validatePhone(phone)) return;
    requestMutation.mutate({ data: { phoneNumber: phone } });
  }

  function handleRefresh() {
    if (!phone) { setPhase('idle'); return; }
    requestMutation.mutate({ data: { phoneNumber: phone } });
  }

  function handleReset() {
    setPhase('idle');
    setPhone('');
    setPhoneError('');
    setPairingCode(null);
    setSessionId(null);
    setCountdown(null);
    setErrorMsg(null);
    requestMutation.reset();
  }

  function copyText(text: string, setCopiedFn: (v: boolean) => void) {
    navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
    setCopiedFn(true);
    setTimeout(() => setCopiedFn(false), 2000);
  }

  function handleCopy() {
    if (pairingCode) copyText(pairingCode, setCopied);
  }

  function handleSessionCopy() {
    if (sessionId) copyText(sessionId, setSessionCopied);
  }

  const countdownColor =
    countdown === null ? '#2ecc71'
    : countdown > 30   ? '#2ecc71'
    : countdown > 10   ? '#f39c12'
    :                    '#ff3860';

  const uptime   = stats ? formatUptime(liveUptime) : '–';
  const visitors = stats?.visitors.toLocaleString()  ?? '0';
  const requests = stats?.requests.toLocaleString()  ?? '0';
  const success  = stats?.success.toLocaleString()   ?? '0';
  const failed   = stats?.failed.toLocaleString()    ?? '0';

  return (
    <>
      <div className="cx-bg-animation">
        <div className="cx-aurora-layer cx-aurora-1" />
        <div className="cx-aurora-layer cx-aurora-2" />
        <div className="cx-aurora-layer cx-aurora-3" />
      </div>
      <div className="cx-cyber-grid" />
      <Particles />

      <div className="cx-main-container">

        {/* ── Stats panel ── */}
        <div className="cx-stats-panel">
          <div className="cx-stats-header">
            <div className="cx-stats-icon"><i className="fas fa-chart-line" /></div>
            <div className="cx-stats-title">Server Stats</div>
          </div>
          <div className="cx-stat-item">
            <div className="cx-stat-label"><div className="cx-status-indicator" />Status</div>
            <div className="cx-stat-value">Online</div>
          </div>
          <div className="cx-stat-item">
            <div className="cx-stat-label"><i className="fas fa-clock" />Uptime</div>
            <div className="cx-stat-value">{uptime}</div>
          </div>
          <div className="cx-stat-item">
            <div className="cx-stat-label"><i className="fas fa-users" />Visitors</div>
            <div className="cx-stat-value">{visitors}</div>
          </div>
          <div className="cx-stat-item">
            <div className="cx-stat-label"><i className="fas fa-server" />Requests</div>
            <div className="cx-stat-value">{requests}</div>
          </div>
          <div className="cx-stat-item">
            <div className="cx-stat-label"><i className="fas fa-check-circle" />Success</div>
            <div className="cx-stat-value" style={{ color: 'var(--success)' }}>{success}</div>
          </div>
          <div className="cx-stat-item">
            <div className="cx-stat-label"><i className="fas fa-times-circle" />Failed</div>
            <div className="cx-stat-value" style={{ color: stats?.failed ? 'var(--error)' : 'var(--primary)' }}>{failed}</div>
          </div>
        </div>

        {/* ── Pairing card ── */}
        <div className="cx-container">

          {/* Connected state */}
          {phase === 'connected' ? (
            <div className="cx-connected">
              <div className="cx-connected-icon"><i className="fas fa-shield-alt" /></div>
              <div className="cx-connected-title">SESSION GENERATED</div>
              <div className="cx-connected-sub">
                {status?.phone ? `Linked: +${status.phone}` : 'WhatsApp linked successfully'}
              </div>

              {sessionId && (
                <div className="cx-session-box">
                  <div className="cx-session-label">
                    <i className="fas fa-key" style={{ marginRight: 6 }} />
                    Your Session ID <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>(also sent to your WhatsApp)</span>
                  </div>
                  <div className="cx-session-id">{sessionId}</div>
                  <button
                    className={`cx-copy-btn${sessionCopied ? ' copied' : ''}`}
                    onClick={handleSessionCopy}
                    style={{ marginTop: 10, width: '100%' }}
                  >
                    {sessionCopied
                      ? <><i className="fas fa-check" style={{ marginRight: 8 }} />Copied!</>
                      : <><i className="fas fa-copy" style={{ marginRight: 8 }} />Copy Session ID</>
                    }
                  </button>
                </div>
              )}

              {!sessionId && (
                <div className="cx-loading" style={{ margin: '16px 0' }}>
                  <div className="cx-spinner" />
                  <div className="cx-loading-text">Generating session ID…</div>
                </div>
              )}

              <button className="cx-retry-btn" onClick={handleReset} style={{ marginTop: 12 }}>
                <i className="fas fa-redo" style={{ marginRight: 6 }} />Pair another number
              </button>
            </div>
          ) : (
            <>
              <div className="cx-header">
                <h1 className="cx-title">TRUTH-MD</h1>
                <p className="cx-subtitle">Enter your WhatsApp number with country code</p>
              </div>

              {/* Live status badge */}
              <StatusBadge phase={phase} error={errorMsg} />

              {/* ── Idle / error / expired → show form ── */}
              {(phase === 'idle' || phase === 'error' || phase === 'expired') && (
                <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
                  <div className="cx-input-field">
                    <input
                      type="tel"
                      inputMode="numeric"
                      placeholder="2547xxxxxxxx"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value.replace(/\D/g, ''));
                        if (phoneError) setPhoneError('');
                      }}
                      autoComplete="off"
                    />
                    {phoneError && <div className="cx-error">{phoneError}</div>}
                  </div>
                  <button type="submit" className="cx-btn">
                    {phase === 'expired' ? 'Get Fresh Code' : 'Generate Pair Code'}
                  </button>
                </form>
              )}

              {/* ── Generating ── */}
              {phase === 'generating' && (
                <div className="cx-loading" style={{ marginTop: 24 }}>
                  <div className="cx-spinner" />
                  <div className="cx-loading-text">Generating pairing code…</div>
                </div>
              )}

              {/* ── Code ready ── */}
              {phase === 'code_ready' && pairingCode && (
                <div className="cx-result">
                  <div className="cx-result-label">
                    <i className="fas fa-key" style={{ marginRight: 8 }} />
                    Pairing Code Generated
                  </div>

                  <div className="cx-code-box">{pairingCode}</div>

                  {countdown !== null && (
                    <div className="cx-countdown" style={{ color: countdownColor }}>
                      <i className="fas fa-clock" style={{ marginRight: 5 }} />
                      Refreshes in <strong>{countdown}s</strong>
                    </div>
                  )}

                  <button
                    className={`cx-copy-btn cx-copy-btn-full${copied ? ' copied' : ''}`}
                    onClick={handleCopy}
                  >
                    {copied
                      ? <><i className="fas fa-check" style={{ marginRight: 8 }} />Copied!</>
                      : <><i className="fas fa-clone" style={{ marginRight: 8 }} />Copy Code</>
                    }
                  </button>

                  <div className="cx-instructions">
                    <div className="cx-step">
                      <span className="cx-step-num">1</span>
                      Open <b>WhatsApp</b> → <b>Linked Devices</b> → <b>Link a Device</b>
                    </div>
                    <div className="cx-step">
                      <span className="cx-step-num">2</span>
                      Tap <b>"Link with phone number instead"</b>
                    </div>
                    <div className="cx-step">
                      <span className="cx-step-num">3</span>
                      Enter the code above — session string will arrive on your WhatsApp
                    </div>
                  </div>

                  <button className="cx-retry-btn" onClick={handleReset}>
                    <i className="fas fa-redo" style={{ marginRight: 6 }} />Use different number
                  </button>
                </div>
              )}

              {/* ── Waiting for WhatsApp confirmation ── */}
              {phase === 'waiting_confirm' && (
                <div className="cx-result" style={{ textAlign: 'center' }}>
                  <div className="cx-loading" style={{ margin: '12px 0' }}>
                    <div className="cx-spinner" />
                    <div className="cx-loading-text">Waiting for WhatsApp confirmation…</div>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '8px 0 16px' }}>
                    If nothing happened, the code may have expired.
                  </p>
                  <button className="cx-btn" onClick={handleRefresh}>
                    <i className="fas fa-sync-alt" style={{ marginRight: 8 }} />Get New Code
                  </button>
                  <button className="cx-retry-btn" onClick={handleReset} style={{ marginTop: 8 }}>
                    <i className="fas fa-redo" style={{ marginRight: 6 }} />Use different number
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
