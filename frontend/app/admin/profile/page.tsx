'use client';

import React, { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { REQUIRED_PROFILE_FIELDS } from '@/lib/profileFields';

interface AdminProfileForm {
  displayName: string;
  email: string;
  supportEmail: string;
  defaultBroadcastRadius: string;
  defaultMinMcMaturity: string;
}

const STORAGE_KEY = 'loadlead_admin_profile_settings';

const initialForm: AdminProfileForm = {
  displayName: 'Platform Admin',
  email: '',
  supportEmail: '',
  defaultBroadcastRadius: '50',
  defaultMinMcMaturity: '90',
};

export default function AdminProfilePage() {
  const [form, setForm] = useState<AdminProfileForm>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const missingRequired = useMemo(() => {
    return REQUIRED_PROFILE_FIELDS.ADMIN.filter((field) => !String((form as any)[field] || '').trim());
  }, [form]);

  useEffect(() => {
    const load = async () => {
      try {
        const me = await api.getMe();
        const saved = localStorage.getItem(STORAGE_KEY);
        const parsed = saved ? JSON.parse(saved) : {};

        setForm({
          displayName: parsed.displayName || 'Platform Admin',
          email: me?.user?.email || '',
          supportEmail: parsed.supportEmail || me?.user?.email || '',
          defaultBroadcastRadius: String(parsed.defaultBroadcastRadius ?? 50),
          defaultMinMcMaturity: String(parsed.defaultMinMcMaturity ?? 90),
        });
      } catch (err: any) {
        setError(err?.response?.data?.error || err?.response?.data?.message || 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (missingRequired.length > 0) {
      setError(`Please fill required fields: ${missingRequired.join(', ')}`);
      return;
    }

    setSaving(true);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          displayName: form.displayName.trim(),
          supportEmail: form.supportEmail.trim(),
          defaultBroadcastRadius: Number(form.defaultBroadcastRadius || 50),
          defaultMinMcMaturity: Number(form.defaultMinMcMaturity || 90),
        })
      );
      setSuccess('Shipper profile settings saved.');
    } catch (err) {
      setError('Failed to save profile settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Shipper Profile</h1>

      <Card>
        <p className="text-sm text-gray-600 mb-4">
          Admin account and policy defaults. Required fields are validated before submission.
        </p>

        {error && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {success && <div className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">{success}</div>}

        <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input name="displayName" value={form.displayName} onChange={onChange} className="border rounded-lg p-3" placeholder="Display Name *" />
          <input name="email" value={form.email} readOnly className="border rounded-lg p-3 bg-gray-100 text-gray-600" placeholder="Email" />
          <input name="supportEmail" value={form.supportEmail} onChange={onChange} className="border rounded-lg p-3" placeholder="Support Email *" />
          <input name="defaultBroadcastRadius" value={form.defaultBroadcastRadius} onChange={onChange} className="border rounded-lg p-3" placeholder="Default Broadcast Radius *" />
          <input name="defaultMinMcMaturity" value={form.defaultMinMcMaturity} onChange={onChange} className="border rounded-lg p-3" placeholder="Default Min MC Maturity *" />

          <div className="md:col-span-2 flex gap-3 mt-2">
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Profile'}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
