'use client';
import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface AuthUser { userId: string; email: string; role: string; }

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (email: string, password: string, role: string) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("ll_token");
    if (!token) { setLoading(false); return; }
    api.me()
      .then((r) => setUser(r.user))
      .catch(() => localStorage.removeItem("ll_token"))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api.login(email, password);
    localStorage.setItem("ll_token", r.token);
    setUser(r.user);
    return r.user;
  };

  const signup = async (email: string, password: string, role: string) => {
    const r = await api.signup(email, password, role);
    localStorage.setItem("ll_token", r.token);
    setUser(r.user);
    return r.user;
  };

  const logout = () => {
    localStorage.removeItem("ll_token");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
