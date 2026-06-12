'use client';

import React, { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { REQUIRED_PROFILE_FIELDS } from '@/lib/profileFields';

interface ReceiverProfileForm {
  orgId: string;
  facilityName: string;
  facilityAddress: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  receivingHours: string;
  appointmentRequired: 'true' | 'false';
  dockType: string;
  specialInstructions: string;
}

const initialForm: ReceiverProfileForm = {
  orgId: '',
  facilityName: '',
  facilityAddress: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  receivingHours: 'Mon-Fri 08:00-17:00',
  appointmentRequired: 'false',
  dockType: '',
  specialInstructions: '',
};

export default function ReceiverProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<ReceiverProfileForm>(initialForm);

  const missingRequired = useMemo(() => {
    const required = REQUIRED_PROFILE_FIELDS.RECEIVER;
    return required.filter((field) => !String((form as any)[field] || '').trim());
  }, [form]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.getReceiverProfile();
        if (res?.receiver) {
          const r = res.receiver;
          setHasProfile(true);
          const receivingHoursText = typeof r.receivingHours?.default === 'string'
            ? r.receivingHours.default
            : typeof r.receivingHours === 'string'
              ? r.receivingHours
              : Object.entries(r.receivingHours || {}).map(([k, v]) => `${k}: ${v}`).join('; ');

          setForm({
            orgId: r.orgId || '',
            facilityName: r.facilityName || '',
            facilityAddress: r.facilityAddress || '',
            contactName: r.contactName || '',
            contactPhone: r.contactPhone || '',
            contactEmail: r.contactEmail || '',
            receivingHours: receivingHoursText || 'Mon-Fri 08:00-17:00',
            appointmentRequired: r.appointmentRequired ? 'true' : 'false',
            dockType: r.dockType || '',
            specialInstructions: r.specialInstructions || '',
          });
        }
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.response?.data?.message;
        if (msg && msg !== 'Receiver profile not found') {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
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
      const payload = {
        orgId: form.orgId.trim(),
        facilityName: form.facilityName.trim(),
        facilityAddress: form.facilityAddress.trim(),
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
        contactEmail: form.contactEmail.trim(),
        receivingHours: {
          default: form.receivingHours.trim(),
        },
        appointmentRequired: form.appointmentRequired === 'true',
        dockType: form.dockType.trim(),
        specialInstructions: form.specialInstructions.trim() || undefined,
      };

      if (hasProfile) {
        await api.updateReceiverProfile(payload);
        setSuccess('Receiver profile updated successfully.');
      } else {
        await api.createReceiverProfile(payload);
        setHasProfile(true);
        setSuccess('Receiver profile created successfully.');
      }
    } catch (err: any) {
      const body = err?.response?.data;
      const msg = body?.error || body?.message || (Array.isArray(body?.errors) ? body.errors.map((x: any) => x.msg).join(', ') : null) || 'Failed to save profile';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Receiver Profile</h1>

      <Card>
        <p className="text-sm text-gray-600 mb-4">
          ReceiverProfiles schema fields are integrated below.
        </p>

        {error && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {success && <div className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">{success}</div>}

        <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input name="orgId" value={form.orgId} onChange={onChange} className="border rounded-lg p-3" placeholder="Organization ID *" />
          <input name="facilityName" value={form.facilityName} onChange={onChange} className="border rounded-lg p-3" placeholder="Facility Name *" />
          <input name="facilityAddress" value={form.facilityAddress} onChange={onChange} className="border rounded-lg p-3" placeholder="Facility Address *" />
          <input name="contactName" value={form.contactName} onChange={onChange} className="border rounded-lg p-3" placeholder="Contact Name *" />
          <input name="contactPhone" value={form.contactPhone} onChange={onChange} className="border rounded-lg p-3" placeholder="Contact Phone *" />
          <input name="contactEmail" type="email" value={form.contactEmail} onChange={onChange} className="border rounded-lg p-3" placeholder="Contact Email *" />
          <input name="receivingHours" value={form.receivingHours} onChange={onChange} className="border rounded-lg p-3" placeholder="Receiving Hours *" />

          <select name="appointmentRequired" value={form.appointmentRequired} onChange={onChange} className="border rounded-lg p-3">
            <option value="true">Appointment Required: Yes</option>
            <option value="false">Appointment Required: No</option>
          </select>

          <input name="dockType" value={form.dockType} onChange={onChange} className="border rounded-lg p-3" placeholder="Dock Type *" />

          <textarea
            name="specialInstructions"
            value={form.specialInstructions}
            onChange={onChange}
            className="border rounded-lg p-3 md:col-span-2"
            rows={3}
            placeholder="Special instructions"
          />

          <div className="md:col-span-2 flex gap-3 mt-2">
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : hasProfile ? 'Update Profile' : 'Create Profile'}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
