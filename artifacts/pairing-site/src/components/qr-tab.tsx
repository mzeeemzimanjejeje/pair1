import React from 'react';
import { useGetPairingQr } from '@workspace/api-client-react';
import { RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

export function QrTab() {
  const { data: qrData, isLoading, isError, refetch, isRefetching } = useGetPairingQr({
    query: { refetchInterval: 15000 }
  });

  return (
    <div className="flex flex-col items-center justify-center space-y-8 py-6">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-mono text-primary neon-text">SCAN SECURE QR</h3>
        <p className="text-sm text-muted-foreground font-mono max-w-sm">
          Open WhatsApp on your phone &gt; Settings &gt; Linked Devices &gt; Link a Device. Point your camera at this screen.
        </p>
      </div>

      <div className="relative group">
        {/* Decorative corner brackets */}
        <div className="absolute -top-2 -left-2 w-4 h-4 border-t-2 border-l-2 border-primary"></div>
        <div className="absolute -top-2 -right-2 w-4 h-4 border-t-2 border-r-2 border-primary"></div>
        <div className="absolute -bottom-2 -left-2 w-4 h-4 border-b-2 border-l-2 border-primary"></div>
        <div className="absolute -bottom-2 -right-2 w-4 h-4 border-b-2 border-r-2 border-primary"></div>

        <div className="p-4 bg-white rounded-sm relative z-10">
          {isLoading ? (
            <div className="w-64 h-64 flex items-center justify-center bg-gray-100 rounded">
              <RefreshCw className="w-8 h-8 text-gray-400 animate-spin" />
            </div>
          ) : isError || !qrData?.qr ? (
            <div className="w-64 h-64 flex flex-col items-center justify-center bg-gray-100 rounded text-center p-4">
              <p className="text-destructive font-mono text-sm mb-4">FAILED TO GENERATE QR</p>
              <Button onClick={() => refetch()} variant="outline" className="border-destructive text-destructive hover:bg-destructive/10">
                RETRY
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
        <div className="absolute inset-0 bg-primary/20 h-1 blur-[2px] animate-[scanline_3s_linear_infinite] z-20 pointer-events-none hidden group-hover:block" />
      </div>

      <div className="flex items-center gap-4 text-xs font-mono text-primary/70">
        <span className="flex items-center gap-2">
          {isRefetching ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          )}
          AUTO-REFRESHING (15s)
        </span>
      </div>
    </div>
  );
}
