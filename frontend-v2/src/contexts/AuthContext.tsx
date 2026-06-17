'use client';
import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

// Auth tokens are stored in httpOnly cookies set by the backend.
// The browser sends the cookie automatically with every credentialed request
// (credentials: 'include' is set in api.ts).
// This context never reads or writes localStorage for auth purposes.

interface AuthUser {
  userId: string;
  email: string;
  role: string;
  headshotUrl?: string;
  displayName?: string;
  phone?: string;
  createdAt?: number;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (email: string, password: string, role: string, orgParams?: Record<string, any>) => Promise<AuthUser>;
  signupCarrier: (params: { email: string; password: string; legalName: string; dba?: string; mcNumber?: string; dotNumber?: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
  setHeadshotUrl: (url: string) => void;
  updateUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: check if the browser already holds a valid ll_token cookie.
  // If the cookie exists and is valid, /api/auth/me returns the user object.
  // If not (cookie missing / expired), it returns 401 and we stay logged out.
  useEffect(() => {
    api.me()
      .then(async (r) => {
        let headshotUrl: string | undefined;
        if (r.user.role === "DRIVER") {
          try {
            const profile = await api.getDriverProfile();
            headshotUrl = profile.driver?.headshotUrl || undefined;
          } catch { /* profile may not exist yet */ }
        }
        setUser({ ...r.user, headshotUrl });
      })
      .catch(() => { /* 401 = no valid cookie; stay logged out */ })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api.login(email, password);
    // Backend sets httpOnly cookie in Set-Cookie header.
    // We use the returned user object to populate context state.
    setUser(r.user);
    return r.user;
  };

  const signup = async (email: string, password: string, role: string, orgParams?: Record<string, any>) => {
    const r = await api.signup(email, password, role, orgParams);
    // Backend sets httpOnly cookie in Set-Cookie header.
    setUser(r.user);
    return r.user;
  };

  // Dedicated atomic carrier signup — separate from signup() above, does not
  // share a code path with the four existing personas.
  const signupCarrier = async (params: { email: string; password: string; legalName: string; dba?: string; mcNumber?: string; dotNumber?: string }) => {
    const r = await api.signupCarrier(params);
    setUser(r.user);
    return r.user;
  };

  const logout = async () => {
    // Ask backend to clear the httpOnly cookie via Set-Cookie: ll_token=; Max-Age=0.
    // JavaScript cannot clear an httpOnly cookie directly.
    await api.logout().catch(() => {});
    setUser(null);
  };

  const setHeadshotUrl = (url: string) =>
    setUser((u) => u ? { ...u, headshotUrl: url } : u);

  const updateUser = (patch: Partial<AuthUser>) =>
    setUser((u) => u ? { ...u, ...patch } : u);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, signupCarrier, logout, setHeadshotUrl, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
