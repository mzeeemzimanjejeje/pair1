import React, { useState } from 'react';
import { useGetPairingQr } from '@workspace/api-client-react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from './ui/button';
import { getApiBase } from '@/lib/api-base';

export function QrTab() {
  const [isResetting, setIsResetting] = useState(false);

  const { data: qrData, isLoading, isError, refetch, isRefetching } = useGetPairingQr({
    query: { refetchInterval: 10000 }
  });

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await fetch(`${getApiBase()}api/pair/reset`, { method: 'POST' });
      // Wait a moment for the new session to initialize
      setTimeout(() => {
        refetch();
        setIsResetting(false);
      }, 3000);
    } catch {
      setIsResetting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-8 py-6">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-mono text-primary neon-text">SCAN SECURE QR</h3>
        <p className="text-sm text-muted-foreground font-mono max-w-sm">
          Open WhatsApp &gt; Settings &gt; Linked Devices &gt; Link a Device. Point your camera at this screen.
        </p>
      </div>

      <div className="relative group">
        {/* Decorative corner brackets */}
        <div className="absolute -top-2 -left-2 w-4 h-4 border-t-2 border-l-2 border-primary"></div>
        <div className="absolute -top-2 -right-2 w-4 h-4 border-t-2 border-r-2 border-primary"></div>
        <div className="absolute -bottom-2 -left-2 w-4 h-4 border-b-2 border-l-2 border-primary"></div>
        <div className="absolute -bottom-2 -right-2 w-4 h-4 border-b-2 border-r-2 border-primary"></div>

        <div className="p-4 bg-white rounded-sm relative z-10">
          {isLoading || isResetting ? (
            <div className="w-64 h-64 flex flex-col items-center justify-center bg-[#0D0D0D] rounded gap-3">
              <RefreshCw className="w-8 h-8 text-primary animate-spin" />
              <p className="text-primary font-mono text-xs">
                {isResetting ? 'RESETTING SESSION...' : 'GENERATING QR...'}
              </p>
            </div>
          ) : isError || !qrData?.qr ? (
            <div className="w-64 h-64 flex flex-col items-center justify-center bg-[#0D0D0D] rounded text-center p-4 gap-3">
              <p className="text-yellow-400 font-mono text-sm">QR EXPIRED OR UNAVAILABLE</p>
              <p className="text-primary/60 font-mono text-xs">Session may still be initializing</p>
              <Button onClick={() => refetch()} variant="outline" size="sm" className="border-primary/50 text-primary hover:bg-primary/10 font-mono text-xs">
                REFRESH
              </Button>
            </div>
          ) : (
            <img
              src={qrData.qr}
              alt="WhatsApp Pairing QR Code"
              className="w-64 h-64 object-contain"
            />
          )}
        </div>

        {/* Scanning line effect */}
        <div className="absolute inset-0 bg-primary/20 h-1 blur-[2px] animate-[scanline_3s_linear_infinite] z-20 pointer-events-none" />
      </div>

      <div className="flex items-center gap-4 flex-wrap justify-center">
        <span className="flex items-center gap-2 text-xs font-mono text-primary/70">
          {isRefetching ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          )}
          AUTO-REFRESH (10s)
        </span>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          disabled={isResetting}
          className="text-xs font-mono text-primary/50 hover:text-primary hover:bg-primary/10 gap-1"
        >
          <RotateCcw className="w-3 h-3" />
          RESET SESSION
        </Button>
      </div>
    </div>
  );
}
