import React from 'react';
import { useGetPairingStatus } from '@workspace/api-client-react';
import { ShieldCheck, Server } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QrTab } from '@/components/qr-tab';
import { CodeTab } from '@/components/code-tab';

export function Home() {
  const { data: status } = useGetPairingStatus({
    query: { refetchInterval: 3000 }
  });

  const isConnected = status?.connected || status?.state === 'connected';

  if (isConnected) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 relative z-10 scanlines">
        <div className="glass-panel p-12 max-w-lg w-full text-center space-y-8 rounded-lg animate-in slide-in-from-bottom-8 fade-in duration-1000">
          <div className="mx-auto w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center border border-primary neon-border animate-pulse">
            <ShieldCheck className="w-12 h-12 text-primary" />
          </div>
          
          <div className="space-y-2">
            <h1 className="text-4xl font-sans font-bold tracking-wider text-primary neon-text">
              LINK ESTABLISHED
            </h1>
            <p className="text-muted-foreground font-mono text-lg">
              Bot Connected Successfully.
            </p>
          </div>
          
          <div className="font-mono text-sm text-primary/60 border-t border-primary/20 pt-6">
            <p>SYSTEM.OVERRIDE: COMPLETE</p>
            <p>AWAITING COMMANDS...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-4 md:p-8 relative z-10 scanlines">
      <div className="w-full max-w-3xl glass-panel rounded-xl overflow-hidden shadow-2xl relative">
        {/* Decorative header bar */}
        <div className="h-12 bg-black/80 border-b border-primary/30 flex items-center px-4 justify-between">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-destructive/80"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-primary/80"></div>
          </div>
          <div className="font-mono text-xs text-primary/50 flex items-center gap-2">
            <Server className="w-3 h-3" /> TRUTH-MD TERMINAL
          </div>
        </div>

        <div className="p-6 md:p-10 space-y-10">
          <div className="text-center space-y-4">
            <h1 className="text-5xl md:text-7xl font-sans font-bold tracking-tighter text-primary neon-text">
              TRUTH-MD
            </h1>
            <p className="text-lg md:text-xl font-mono text-muted-foreground uppercase tracking-widest">
              Secure Bot Pairing Protocol
            </p>
          </div>

          <Tabs defaultValue="qr" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-black/50 border border-primary/20 p-1 mb-8">
              <TabsTrigger 
                value="qr" 
                className="font-mono tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:neon-border"
              >
                QR MATRIX
              </TabsTrigger>
              <TabsTrigger 
                value="code"
                className="font-mono tracking-widest data-[state=active]:bg-secondary/20 data-[state=active]:text-secondary data-[state=active]:border-secondary data-[state=active]:shadow-[0_0_5px_#00B4FF,inset_0_0_5px_#00B4FF]"
              >
                ACCESS CODE
              </TabsTrigger>
            </TabsList>
            
            <div className="min-h-[400px] flex items-center justify-center border border-primary/10 rounded-lg bg-black/30 backdrop-blur-md">
              <TabsContent value="qr" className="w-full m-0 p-0">
                <QrTab />
              </TabsContent>
              <TabsContent value="code" className="w-full m-0 p-0">
                <CodeTab />
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <div className="bg-black/80 p-4 border-t border-primary/30 text-center">
          <p className="font-mono text-xs text-primary/40 tracking-widest">
            POWERED BY BAILEYS + TRUTH-MD
          </p>
        </div>
      </div>
    </div>
  );
}
