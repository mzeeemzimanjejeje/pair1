import React, { useState } from 'react';
import { useGetPairingStatus, useRequestPairingCode, useGetServerStats } from '@workspace/api-client-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Copy, CheckCircle2, Loader2, ShieldCheck, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';

const formSchema = z.object({
  phoneNumber: z
    .string()
    .min(7, 'Too short — include country code')
    .regex(/^\d+$/, 'Digits only, no spaces or +'),
});

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-2 border-r border-primary/20 last:border-r-0">
      <span className="text-[10px] font-mono tracking-widest text-primary/40 uppercase">{label}</span>
      <span className={`text-sm font-mono font-bold ${accent || 'text-primary'}`}>{value}</span>
    </div>
  );
}

export function Home() {
  const [copied, setCopied] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const { data: status } = useGetPairingStatus({ query: { refetchInterval: 4000 } });
  const { data: stats } = useGetServerStats({ query: { refetchInterval: 5000 } });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { phoneNumber: '' },
  });

  const requestMutation = useRequestPairingCode({
    mutation: {
      onSuccess: (data) => setPairingCode(data.code),
      onError: () => {},
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    setPairingCode(null);
    requestMutation.mutate({ data: { phoneNumber: values.phoneNumber } });
  };

  const handleCopy = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const isConnected = status?.connected || status?.state === 'connected';

  if (isConnected) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 relative z-10 scanlines">
        <div className="glass-panel p-12 max-w-lg w-full text-center space-y-8 rounded-lg animate-in slide-in-from-bottom-8 fade-in duration-1000">
          <div className="mx-auto w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center border border-primary neon-border animate-pulse">
            <ShieldCheck className="w-12 h-12 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-mono font-bold tracking-wider text-primary neon-text">LINK ESTABLISHED</h1>
            <p className="text-muted-foreground font-mono">Bot Connected Successfully.</p>
          </div>
          <div className="font-mono text-sm text-primary/50 border-t border-primary/20 pt-6">
            <p>SYSTEM.OVERRIDE: COMPLETE</p>
            <p className="mt-1">AWAITING COMMANDS...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col relative z-10 scanlines">

      {/* ── Stats Bar ── */}
      <div className="w-full bg-black/80 border-b border-primary/20 backdrop-blur-md">
        <div className="max-w-2xl mx-auto flex items-center justify-center flex-wrap">
          <StatCard label="Status" value="Online" accent="text-green-400" />
          <StatCard label="Uptime" value={stats ? formatUptime(stats.uptimeSeconds) : '—'} />
          <StatCard label="Visitors" value={stats?.visitors ?? '—'} />
          <StatCard label="Requests" value={stats?.requests?.toLocaleString() ?? '—'} />
          <StatCard label="Success" value={stats?.success?.toLocaleString() ?? '—'} accent="text-green-400" />
          <StatCard label="Failed" value={stats?.failed?.toLocaleString() ?? '—'} accent={stats?.failed ? 'text-red-400' : 'text-primary'} />
        </div>
      </div>

      {/* ── Main Panel ── */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-md glass-panel rounded-xl overflow-hidden shadow-2xl">

          {/* Terminal header */}
          <div className="h-10 bg-black/80 border-b border-primary/30 flex items-center px-4 gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/70" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
            <div className="w-3 h-3 rounded-full bg-primary/80" />
            <span className="ml-auto font-mono text-[10px] text-primary/40 tracking-widest">TRUTH-MD SESSION</span>
          </div>

          <div className="p-8 space-y-8">
            {/* Title */}
            <div className="text-center space-y-2">
              <h1 className="text-6xl font-mono font-bold tracking-tighter text-primary neon-text">
                TRUTH-MD
              </h1>
              <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase">
                Enter your WhatsApp number with country code
              </p>
            </div>

            {/* Form */}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="phoneNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          placeholder="2547xxxxxxxx"
                          className="font-mono text-center text-lg bg-black/60 border-primary/30 text-primary placeholder:text-primary/25 focus-visible:ring-primary focus-visible:border-primary h-12 tracking-widest"
                          inputMode="numeric"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-red-400 font-mono text-xs text-center" />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full h-12 font-mono text-sm tracking-widest bg-primary/20 text-primary border border-primary/60 hover:bg-primary hover:text-black transition-all neon-border"
                  disabled={requestMutation.isPending}
                >
                  {requestMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      GENERATING CODE...
                    </span>
                  ) : (
                    'Generate Pair Code'
                  )}
                </Button>

                {requestMutation.isError && (
                  <p className="text-red-400 text-xs font-mono text-center">
                    Failed to generate code. Make sure number is correct with country code.
                  </p>
                )}
              </form>
            </Form>

            {/* Pairing Code display */}
            {pairingCode && (
              <div className="animate-in fade-in zoom-in-95 duration-500 space-y-4">
                <div className="bg-black/70 border border-primary/40 rounded-lg p-6 text-center space-y-4">
                  <p className="text-[10px] font-mono text-primary/50 tracking-widest uppercase">Pairing Code Generated</p>
                  <div className="text-3xl md:text-4xl font-mono font-bold text-primary neon-text tracking-[0.15em]">
                    {pairingCode}
                  </div>
                  <Button
                    onClick={handleCopy}
                    variant="outline"
                    size="sm"
                    className="border-primary/50 text-primary hover:bg-primary hover:text-black font-mono text-xs tracking-widest transition-all"
                  >
                    {copied ? (
                      <span className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3" /> COPIED</span>
                    ) : (
                      <span className="flex items-center gap-2"><Copy className="w-3 h-3" /> Copy Code</span>
                    )}
                  </Button>
                </div>

                <div className="text-xs font-mono text-primary/40 space-y-1 text-center border-t border-primary/10 pt-4">
                  <p>WhatsApp &gt; Linked Devices &gt; Link a Device</p>
                  <p>&gt; Link with phone number instead</p>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setPairingCode(null); form.reset(); requestMutation.reset(); }}
                  className="w-full font-mono text-xs text-primary/30 hover:text-primary/70 gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Try again
                </Button>
              </div>
            )}
          </div>

          <div className="bg-black/80 px-4 py-3 border-t border-primary/20 text-center">
            <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
              Powered by Baileys + TRUTH-MD
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
