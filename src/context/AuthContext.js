import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isSupabaseAuthConfigured, supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

const EMPTY_PROFILE = {
  display_name: "",
  risk_profile: "balanced",
  default_network: "ethereum",
};

function normalizeProfile(profile, user) {
  return {
    ...EMPTY_PROFILE,
    ...(profile || {}),
    display_name:
      profile?.display_name ||
      user?.user_metadata?.name ||
      user?.email?.split("@")[0] ||
      "",
  };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [status, setStatus] = useState(isSupabaseAuthConfigured ? "loading" : "disabled");
  const [profileStatus, setProfileStatus] = useState("idle");
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async (nextUser) => {
    if (!supabase || !nextUser?.id) {
      setProfile(EMPTY_PROFILE);
      setProfileStatus("idle");
      return;
    }

    setProfileStatus("loading");
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, risk_profile, default_network, created_at, updated_at")
      .eq("id", nextUser.id)
      .maybeSingle();

    if (profileError) {
      setError(profileError);
      setProfileStatus("error");
      return;
    }

    setProfile(normalizeProfile(data, nextUser));
    setProfileStatus("ready");
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;

    let mounted = true;

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) {
        setError(sessionError);
        setStatus("error");
        return;
      }

      const nextSession = data?.session || null;
      setSession(nextSession);
      setUser(nextSession?.user || null);
      setStatus(nextSession ? "authenticated" : "anonymous");
      // Run outside the auth callback to avoid holding the session lock.
      setTimeout(() => { if (mounted) loadProfile(nextSession?.user || null); }, 0);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user || null);
      setStatus(nextSession ? "authenticated" : "anonymous");
      setError(null);

      if (event === "SIGNED_OUT") {
        setProfile(EMPTY_PROFILE);
        setProfileStatus("idle");
        return;
      }

      // Run outside the auth callback to avoid holding the session lock.
      setTimeout(() => { if (mounted) loadProfile(nextSession?.user || null); }, 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signInWithPassword = useCallback(async ({ email, password }) => {
    if (!supabase) throw new Error("Supabase Auth n'est pas configure.");
    setStatus("loading");
    setError(null);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError);
      setStatus("anonymous");
      throw signInError;
    }
    setSession(data?.session || null);
    setUser(data?.user || data?.session?.user || null);
    setStatus(data?.session ? "authenticated" : "anonymous");
  }, []);

  const signUpWithPassword = useCallback(async ({ email, password, displayName }) => {
    if (!supabase) throw new Error("Supabase Auth n'est pas configure.");
    setStatus("loading");
    setError(null);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: displayName || email.split("@")[0],
        },
      },
    });
    if (signUpError) {
      setError(signUpError);
      setStatus("anonymous");
      throw signUpError;
    }
    setSession(data?.session || null);
    setUser(data?.user || data?.session?.user || null);
    setStatus(data?.session ? "authenticated" : "anonymous");
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError);
      throw signOutError;
    }
  }, []);

  const updateProfile = useCallback(
    async (patch) => {
      if (!supabase || !user?.id) throw new Error("Utilisateur non connecte.");
      setProfileStatus("saving");
      setError(null);

      const nextProfile = {
        id: user.id,
        display_name: patch.display_name ?? profile.display_name,
        risk_profile: patch.risk_profile ?? profile.risk_profile,
        default_network: patch.default_network ?? profile.default_network,
        updated_at: new Date().toISOString(),
      };

      const { data, error: updateError } = await supabase
        .from("profiles")
        .upsert(nextProfile, { onConflict: "id" })
        .select("id, display_name, risk_profile, default_network, created_at, updated_at")
        .single();

      if (updateError) {
        setError(updateError);
        setProfileStatus("error");
        throw updateError;
      }

      setProfile(normalizeProfile(data, user));
      setProfileStatus("ready");
      return data;
    },
    [profile.default_network, profile.display_name, profile.risk_profile, user],
  );

  const value = useMemo(
    () => ({
      isConfigured: isSupabaseAuthConfigured,
      session,
      user,
      profile,
      status,
      profileStatus,
      error,
      signInWithPassword,
      signUpWithPassword,
      signOut,
      updateProfile,
      refreshProfile: () => loadProfile(user),
    }),
    [
      error,
      loadProfile,
      profile,
      profileStatus,
      session,
      signInWithPassword,
      signOut,
      signUpWithPassword,
      status,
      updateProfile,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
