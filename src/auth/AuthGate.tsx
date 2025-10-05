import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  if (!supabaseUrl || !supabaseAnon) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="w-full max-w-lg rounded-xl border p-6">
          <h1 className="text-xl font-semibold mb-2">Environment not configured</h1>
          <p className="text-sm text-gray-600">Add the following to <code>.env.local</code> and restart:</p>
          <pre className="mt-3 rounded bg-gray-50 p-3 text-xs overflow-auto">{`VITE_SUPABASE_URL=...\nVITE_SUPABASE_ANON_KEY=...`}</pre>
        </div>
      </div>
    );
  }

  useEffect(() => {
    const getSession = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setLoading(false);
    };
    getSession();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return <div className="min-h-screen grid place-items-center">Loading...</div>;
  }
  if (!session) {
    return (
      <div className="min-h-screen grid place-items-center p-4">
        <div className="w-full max-w-md rounded-xl border p-6 shadow-sm">
          <h1 className="text-xl font-semibold mb-4">Sign in</h1>
          <Auth supabaseClient={supabase} appearance={{ theme: ThemeSupa }} providers={[]} />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}


