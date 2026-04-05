import React, { useState, useEffect, useRef } from 'react';
import { useGetPairingStatus, useRequestPairingCode, useGetServerStats } from '@workspace/api-client-react';
import './home.css';

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function Particles() {
  const particles = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}vw`,
    delay: `${Math.random() * 20}s`,
    duration: `${15 + Math.random() * 10}s`,
  }));

  return (
    <div className="cx-particles">
      {particles.map((p) => (
        <div
          key={p.id}
          className="cx-particle"
          style={{ left: p.left, animationDelay: p.delay, animationDuration: p.duration }}
        />
      ))}
    </div>
  );
}

export function Home() {
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: status } = useGetPairingStatus({ query: { refetchInterval: 4000 } });
  const { data: stats } = useGetServerStats({ query: { refetchInterval: 5000 } });

  const requestMutation = useRequestPairingCode({
    mutation: {
      onSuccess: (data) => setPairingCode(data.code),
      onError: () => {},
    },
  });

  const isConnected = status?.connected || status?.state === 'connected';

  function validatePhone(value: string): boolean {
    if (!/^\d{7,15}$/.test(value)) {
      setPhoneError('Invalid number format. Use country code + number, digits only.');
      return false;
    }
    setPhoneError('');
    return true;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validatePhone(phone)) return;
    setPairingCode(null);
    requestMutation.mutate({ data: { phoneNumber: phone } });
  }

  function handleCopy() {
    if (!pairingCode) return;
    navigator.clipboard.writeText(pairingCode).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = pairingCode;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleReset() {
    setPairingCode(null);
    setPhone('');
    setPhoneError('');
    requestMutation.reset();
  }

  const uptime = stats ? formatUptime(stats.uptimeSeconds) : 'Loading...';
  const visitors = stats ? stats.visitors.toLocaleString() : '0';
  const requests = stats ? stats.requests.toLocaleString() : '0';
  const success = stats ? stats.success.toLocaleString() : '0';
  const failed = stats ? stats.failed.toLocaleString() : '0';

  return (
    <>
      {/* CypherX.space aurora background */}
      <div className="cx-bg-animation">
        <div className="cx-aurora-layer cx-aurora-1" />
        <div className="cx-aurora-layer cx-aurora-2" />
        <div className="cx-aurora-layer cx-aurora-3" />
      </div>
      <div className="cx-cyber-grid" />
      <Particles />

      <div className="cx-main-container">

        {/* ── Stats Panel ── */}
        <div className="cx-stats-panel">
          <div className="cx-stats-header">
            <div className="cx-stats-icon">
              <i className="fas fa-chart-line" />
            </div>
            <div className="cx-stats-title">Server Stats</div>
          </div>

          <div className="cx-stat-item">
            <div className="cx-stat-label">
              <div className="cx-status-indicator" />
              Status
            </div>
            <div className="cx-stat-value">Online</div>
          </div>

          <div className="cx-stat-item">
            <div className="cx-stat-label">
              <i className="fas fa-clock" />
              Uptime
            </div>
            <div className="cx-stat-value">{uptime}</div>
          </div>

          <div className="cx-stat-item">
            <div className="cx-stat-label">
              <i className="fas fa-users" />
              Visitors
            </div>
            <div className="cx-stat-value">{visitors}</div>
          </div>

          <div className="cx-stat-item">
            <div className="cx-stat-label">
              <i className="fas fa-server" />
              Requests
            </div>
            <div className="cx-stat-value">{requests}</div>
          </div>

          <div className="cx-stat-item">
            <div className="cx-stat-label">
              <i className="fas fa-check-circle" />
              Success
            </div>
            <div className="cx-stat-value" style={{ color: 'var(--success)' }}>{success}</div>
          </div>

          <div className="cx-stat-item">
            <div className="cx-stat-label">
              <i className="fas fa-times-circle" />
              Failed
            </div>
            <div className="cx-stat-value" style={{ color: stats?.failed ? 'var(--error)' : 'var(--primary)' }}>{failed}</div>
          </div>
        </div>

        {/* ── Main Pairing Card ── */}
        <div className="cx-container">

          {isConnected ? (
            <div className="cx-connected">
              <div className="cx-connected-icon">
                <i className="fas fa-shield-alt" />
              </div>
              <div className="cx-connected-title">LINK ESTABLISHED</div>
              <div className="cx-connected-sub">Bot connected successfully</div>
            </div>
          ) : (
            <>
              <div className="cx-header">
                <h1 className="cx-title">TRUTH-MD</h1>
                <p className="cx-subtitle">Enter your WhatsApp number with country code</p>
              </div>

              <form onSubmit={handleSubmit}>
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
                    disabled={requestMutation.isPending}
                    autoComplete="off"
                  />
                  {phoneError && <div className="cx-error">{phoneError}</div>}
                  {requestMutation.isError && !phoneError && (
                    <div className="cx-error">
                      Failed to generate code. Ensure your number includes country code.
                    </div>
                  )}
                </div>

                {requestMutation.isPending ? (
                  <div className="cx-loading">
                    <div className="cx-spinner" />
                    <div className="cx-loading-text">Generating Code...</div>
                  </div>
                ) : (
                  <button type="submit" className="cx-btn" disabled={requestMutation.isPending}>
                    Generate Pair Code
                  </button>
                )}
              </form>

              {pairingCode && (
                <div className="cx-result">
                  <div className="cx-result-label">Pairing Code Generated</div>
                  <div className="cx-code-display">{pairingCode}</div>
                  <button
                    className={`cx-copy-btn${copied ? ' copied' : ''}`}
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <><i className="fas fa-check" style={{ marginRight: 8 }} />Copied!</>
                    ) : (
                      <><i className="fas fa-copy" style={{ marginRight: 8 }} />Copy Code</>
                    )}
                  </button>
                  <div className="cx-instructions">
                    WhatsApp → Linked Devices → Link a Device<br />
                    → Link with phone number instead
                  </div>
                  <button className="cx-retry-btn" onClick={handleReset}>
                    <i className="fas fa-redo" style={{ marginRight: 6 }} />Try again
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
