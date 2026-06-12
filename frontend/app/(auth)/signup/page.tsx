'use client';

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { UserRole } from '@/types';
import Link from 'next/link';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.DRIVER);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      await signup(email, password, role);
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 to-slate-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-white tracking-tight">LoadLead</h1>
          <p className="text-sm text-slate-300">Create your account</p>
        </div>
        <form className="mt-4 space-y-5 bg-slate-800/60 border border-slate-700 rounded-2xl p-6 shadow-xl" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-900/40 border border-red-500 text-red-200 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                Account Type
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-900 text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option value={UserRole.DRIVER}>Driver / Owner Operator</option>
                <option value={UserRole.SHIPPER}>Shipper / Broker</option>
                <option value={UserRole.RECEIVER}>Receiver</option>
              </select>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating account...' : 'Sign up'}
          </Button>

          <div className="text-center">
            <Link href="/login" className="text-slate-200 hover:text-white text-sm font-medium">
              Already have an account? Sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
