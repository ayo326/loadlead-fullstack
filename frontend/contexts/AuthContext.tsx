'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { User, UserRole } from '@/types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, role: UserRole) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const response = await api.getMe();
        setUser(response.user);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      localStorage.removeItem('token');
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const response = await api.login(email, password);
      setUser(response.user);
      
      // Redirect based on role
      switch (response.user.role) {
        case UserRole.ADMIN:
          router.push('/admin');
          break;
        case UserRole.SHIPPER:
          router.push('/shipper');
          break;
        case UserRole.DRIVER:
          router.push('/driver');
          break;
        case UserRole.RECEIVER:
          router.push('/receiver');
          break;
        default:
          router.push('/');
      }
    } catch (error) {
      throw error;
    }
  };

  const signup = async (email: string, password: string, role: UserRole) => {
    try {
      const response = await api.signup(email, password, role);
      setUser(response.user);
      
      // Redirect to appropriate dashboard
      switch (role) {
        case UserRole.ADMIN:
          router.push('/admin');
          break;
        case UserRole.SHIPPER:
          router.push('/shipper');
          break;
        case UserRole.DRIVER:
          router.push('/driver');
          break;
        case UserRole.RECEIVER:
          router.push('/receiver');
          break;
        default:
          router.push('/');
      }
    } catch (error) {
      throw error;
    }
  };

  const logout = () => {
    api.logout();
    setUser(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        signup,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
