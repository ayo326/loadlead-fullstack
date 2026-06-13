'use client';
import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

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
  logout: () => void;
  setHeadshotUrl: (url: string) => void;
  updateUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("ll_token");
    if (!token) { setLoading(false); return; }
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
      .catch(() => localStorage.removeItem("ll_token"))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api.login(email, password);
    localStorage.setItem("ll_token", r.token);
    setUser(r.user);
    return r.user;
  };

  const signup = async (email: string, password: string, role: string, orgParams?: Record<string, any>) => {
    const r = await api.signup(email, password, role, orgParams);
    localStorage.setItem("ll_token", r.token);
    setUser(r.user);
    return r.user;
  };

  const logout = () => {
    localStorage.removeItem("ll_token");
    setUser(null);
  };

  const setHeadshotUrl = (url: string) =>
    setUser((u) => u ? { ...u, headshotUrl: url } : u);

  const updateUser = (patch: Partial<AuthUser>) =>
    setUser((u) => u ? { ...u, ...patch } : u);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, setHeadshotUrl, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
