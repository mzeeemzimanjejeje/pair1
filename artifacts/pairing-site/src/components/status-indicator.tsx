import React from 'react';
import { useGetPairingStatus } from '@workspace/api-client-react';

export function StatusIndicator() {
  const { data: status } = useGetPairingStatus({
    query: { refetchInterval: 5000, queryKey: ['pairing-status'] }
  });

  const isConnected = status?.connected;
  const state = status?.state || 'disconnected';
  
  let colorClass = 'bg-red-500';
  let label = 'DISCONNECTED';
  let glowClass = 'shadow-[0_0_8px_#ef4444]';

  if (isConnected || state === 'connected') {
    colorClass = 'bg-primary';
    label = 'CONNECTED';
    glowClass = 'shadow-[0_0_8px_#00FF41]';
  } else if (state === 'connecting') {
    colorClass = 'bg-yellow-500';
    label = 'CONNECTING';
    glowClass = 'shadow-[0_0_8px_#eab308]';
  } else if (state === 'qr_ready' || state === 'code_ready') {
    colorClass = 'bg-secondary';
    label = 'READY';
    glowClass = 'shadow-[0_0_8px_#00B4FF]';
  }

  return (
    <div className="fixed top-6 right-6 flex items-center gap-3 z-40 glass-panel px-4 py-2 rounded-full border-primary/30">
      <div className="font-mono text-xs tracking-widest text-primary/80">
        SYS.STATUS
      </div>
      <div className={`w-2.5 h-2.5 rounded-full ${colorClass} ${glowClass} ${!isConnected && state !== 'disconnected' ? 'animate-pulse' : ''}`} />
      <div className="font-mono text-sm font-bold tracking-wider" style={{ color: colorClass === 'bg-primary' ? '#00FF41' : colorClass === 'bg-secondary' ? '#00B4FF' : colorClass === 'bg-yellow-500' ? '#eab308' : '#ef4444' }}>
        {label}
      </div>
    </div>
  );
}
