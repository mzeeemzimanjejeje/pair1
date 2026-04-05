import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRequestPairingCode } from '@workspace/api-client-react';
import { Copy, CheckCircle2, Terminal } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Form, FormControl, FormField, FormItem, FormMessage } from './ui/form';

const formSchema = z.object({
  phoneNumber: z.string().min(7, "Number must be at least 7 digits").regex(/^\d+$/, "Digits only, include country code (e.g. 1234567890)"),
});

export function CodeTab() {
  const [copied, setCopied] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      phoneNumber: "",
    },
  });

  const requestMutation = useRequestPairingCode({
    mutation: {
      onSuccess: (data) => {
        setPairingCode(data.code);
      },
      onError: (error) => {
        console.error("Pairing code error:", error);
      }
    }
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    requestMutation.mutate({ data: { phoneNumber: values.phoneNumber } });
  };

  const handleCopy = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-8 py-6 w-full max-w-md mx-auto">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-mono text-secondary neon-text-blue">REQUEST OVERRIDE CODE</h3>
        <p className="text-sm text-muted-foreground font-mono">
          Enter phone number with country code. No +, no spaces.
        </p>
      </div>

      {!pairingCode ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-6">
            <FormField
              control={form.control}
              name="phoneNumber"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <div className="relative">
                      <Terminal className="absolute left-3 top-3 h-5 w-5 text-primary/50" />
                      <Input 
                        placeholder="e.g. 1234567890" 
                        className="pl-10 font-mono bg-black/50 border-primary/30 text-primary focus-visible:ring-primary focus-visible:border-primary text-lg"
                        {...field} 
                      />
                    </div>
                  </FormControl>
                  <FormMessage className="text-destructive font-mono text-xs" />
                </FormItem>
              )}
            />
            <Button 
              type="submit" 
              className="w-full font-mono text-lg tracking-widest bg-primary/20 text-primary border border-primary hover:bg-primary hover:text-black transition-all neon-border"
              disabled={requestMutation.isPending}
            >
              {requestMutation.isPending ? 'GENERATING...' : 'INITIATE SEQUENCE'}
            </Button>
            {requestMutation.isError && (
              <p className="text-destructive text-sm font-mono text-center">
                ERR: FAILED TO GENERATE CODE
              </p>
            )}
          </form>
        </Form>
      ) : (
        <div className="w-full space-y-6 animate-in fade-in zoom-in duration-500">
          <div className="p-6 bg-black/60 border border-secondary/50 rounded-md relative group overflow-hidden">
            {/* Cyber background effect */}
            <div className="absolute inset-0 bg-secondary/5 group-hover:bg-secondary/10 transition-colors" />
            
            <div className="text-center space-y-4 relative z-10">
              <p className="text-xs font-mono text-secondary/70 tracking-widest">ACCESS CODE GENERATED</p>
              
              <div className="text-4xl md:text-5xl font-mono font-bold tracking-[0.2em] text-secondary neon-text-blue py-2">
                {pairingCode}
              </div>
              
              <Button 
                onClick={handleCopy} 
                variant="outline" 
                className="mx-auto flex items-center gap-2 border-secondary/50 text-secondary hover:bg-secondary hover:text-black"
              >
                {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'COPIED TO CLIPBOARD' : 'COPY CODE'}
              </Button>
            </div>
          </div>
          
          <div className="bg-primary/5 border border-primary/20 p-4 rounded-md">
            <h4 className="font-mono text-primary mb-2 text-sm">INSTRUCTIONS:</h4>
            <ol className="text-sm font-mono text-muted-foreground space-y-2 list-decimal list-inside pl-2">
              <li>Open WhatsApp on phone {form.getValues().phoneNumber}</li>
              <li>Tap Settings &gt; Linked Devices</li>
              <li>Tap "Link a Device"</li>
              <li>Tap "Link with phone number instead"</li>
              <li>Enter the access code above</li>
            </ol>
          </div>

          <Button 
            onClick={() => setPairingCode(null)} 
            variant="ghost" 
            className="w-full font-mono text-muted-foreground hover:text-primary"
          >
            &lt; RESET SEQUENCE
          </Button>
        </div>
      )}
    </div>
  );
}
