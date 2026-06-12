'use client';

import React, { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { REQUIRED_PROFILE_FIELDS } from '@/lib/profileFields';

interface ShipperProfileForm {
  companyName: string;
  companyAddress: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  mcNumber: string;
  dotNumber: string;
  orgId: string;
  freightTypesCsv: string;
  avgMonthlyVolume: string;
  preferredEquipmentCsv: string;
  billingTerms: string;
  carrierType: string;
  operatingAuthorityStatus: string;
  safetyRating: string;
  operatingRegionsCsv: string;
  legalName: string;
  dba: string;
  orgType: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  mcIssueDate: string;
  defaultBroadcastRadius: string;
  defaultMinMcMaturity: string;
}

const initialForm: ShipperProfileForm = {
  companyName: '',
  companyAddress: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  mcNumber: '',
  dotNumber: '',
  orgId: '',
  freightTypesCsv: '',
  avgMonthlyVolume: '0',
  preferredEquipmentCsv: '',
  billingTerms: '',
  carrierType: '',
  operatingAuthorityStatus: '',
  safetyRating: '',
  operatingRegionsCsv: '',
  legalName: '',
  dba: '',
  orgType: '',
  city: '',
  state: '',
  zip: '',
  country: 'US',
  mcIssueDate: '',
  defaultBroadcastRadius: '50',
  defaultMinMcMaturity: '90',
};

const toDateInput = (value: any): string => {
  if (!value) return '';
  const dt = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
};

export default function CarrierProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<ShipperProfileForm>(initialForm);

  const missingRequired = useMemo(() => {
    const required = REQUIRED_PROFILE_FIELDS.SHIPPER;
    return required.filter((field) => !String((form as any)[field] || '').trim());
  }, [form]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.getShipperProfile();
        if (res?.shipper) {
          const s = res.shipper;
          setHasProfile(true);
          setForm({
            companyName: s.companyName || '',
            companyAddress: s.companyAddress || '',
            contactName: s.contactName || '',
            contactPhone: s.contactPhone || '',
            contactEmail: s.contactEmail || '',
            mcNumber: s.mcNumber || '',
            dotNumber: s.dotNumber || '',
            orgId: s.orgId || '',
            freightTypesCsv: Array.isArray(s.freightTypes) ? s.freightTypes.join(', ') : '',
            avgMonthlyVolume: String(s.avgMonthlyVolume ?? 0),
            preferredEquipmentCsv: Array.isArray(s.preferredEquipment) ? s.preferredEquipment.join(', ') : '',
            billingTerms: s.billingTerms || '',
            carrierType: s.carrierType || '',
            operatingAuthorityStatus: s.operatingAuthorityStatus || '',
            safetyRating: s.safetyRating || '',
            operatingRegionsCsv: Array.isArray(s.operatingRegions) ? s.operatingRegions.join(', ') : '',
            legalName: s.legalName || '',
            dba: s.dba || '',
            orgType: s.orgType || '',
            city: s.city || '',
            state: s.state || '',
            zip: s.zip || '',
            country: s.country || 'US',
            mcIssueDate: toDateInput(s.mcIssueDate),
            defaultBroadcastRadius: String(s.defaultBroadcastRadius ?? 50),
            defaultMinMcMaturity: String(s.defaultMinMcMaturity ?? 90),
          });
        }
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.response?.data?.message;
        if (msg && msg !== 'Shipper profile not found') {
          setError(msg);
        }
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
      const payload = {
        companyName: form.companyName.trim(),
        companyAddress: form.companyAddress.trim(),
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
        contactEmail: form.contactEmail.trim(),
        mcNumber: form.mcNumber.trim() || undefined,
        dotNumber: form.dotNumber.trim() || undefined,

        orgId: form.orgId.trim(),
        freightTypes: form.freightTypesCsv.split(',').map((x) => x.trim()).filter(Boolean),
        avgMonthlyVolume: Number(form.avgMonthlyVolume || 0),
        preferredEquipment: form.preferredEquipmentCsv.split(',').map((x) => x.trim()).filter(Boolean),
        billingTerms: form.billingTerms.trim(),

        carrierType: form.carrierType.trim() || undefined,
        operatingAuthorityStatus: form.operatingAuthorityStatus.trim() || undefined,
        safetyRating: form.safetyRating.trim() || undefined,
        operatingRegions: form.operatingRegionsCsv.split(',').map((x) => x.trim()).filter(Boolean),

        legalName: form.legalName.trim() || undefined,
        dba: form.dba.trim() || undefined,
        orgType: form.orgType.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim().toUpperCase() || undefined,
        zip: form.zip.trim() || undefined,
        country: form.country.trim().toUpperCase() || undefined,
        mcIssueDate: form.mcIssueDate || undefined,

        defaultBroadcastRadius: Number(form.defaultBroadcastRadius || 50),
        defaultMinMcMaturity: Number(form.defaultMinMcMaturity || 90),
      };

      if (hasProfile) {
        await api.updateShipperProfile(payload);
        setSuccess('Carrier profile updated successfully.');
      } else {
        await api.createShipperProfile(payload);
        setHasProfile(true);
        setSuccess('Carrier profile created successfully.');
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
    <div className="max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Carrier Profile</h1>

      <Card>
        <p className="text-sm text-gray-600 mb-4">
          ShipperProfiles + CarrierProfiles + Organization schema fields are integrated below.
        </p>

        {error && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {success && <div className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">{success}</div>}

        <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input name="companyName" value={form.companyName} onChange={onChange} className="border rounded-lg p-3" placeholder="Company Name *" />
          <input name="companyAddress" value={form.companyAddress} onChange={onChange} className="border rounded-lg p-3" placeholder="Company Address *" />
          <input name="contactName" value={form.contactName} onChange={onChange} className="border rounded-lg p-3" placeholder="Contact Name *" />
          <input name="contactPhone" value={form.contactPhone} onChange={onChange} className="border rounded-lg p-3" placeholder="Contact Phone *" />
          <input name="contactEmail" type="email" value={form.contactEmail} onChange={onChange} className="border rounded-lg p-3" placeholder="Contact Email *" />
          <input name="orgId" value={form.orgId} onChange={onChange} className="border rounded-lg p-3" placeholder="Organization ID *" />

          <input name="freightTypesCsv" value={form.freightTypesCsv} onChange={onChange} className="border rounded-lg p-3" placeholder="Freight Types (comma-separated) *" />
          <input name="avgMonthlyVolume" value={form.avgMonthlyVolume} onChange={onChange} className="border rounded-lg p-3" placeholder="Average Monthly Volume *" />
          <input name="preferredEquipmentCsv" value={form.preferredEquipmentCsv} onChange={onChange} className="border rounded-lg p-3" placeholder="Preferred Equipment (comma-separated) *" />
          <input name="billingTerms" value={form.billingTerms} onChange={onChange} className="border rounded-lg p-3" placeholder="Billing Terms *" />

          <input name="carrierType" value={form.carrierType} onChange={onChange} className="border rounded-lg p-3" placeholder="Carrier Type" />
          <input name="operatingAuthorityStatus" value={form.operatingAuthorityStatus} onChange={onChange} className="border rounded-lg p-3" placeholder="Operating Authority Status" />
          <input name="safetyRating" value={form.safetyRating} onChange={onChange} className="border rounded-lg p-3" placeholder="Safety Rating" />
          <input name="operatingRegionsCsv" value={form.operatingRegionsCsv} onChange={onChange} className="border rounded-lg p-3" placeholder="Operating Regions (comma-separated)" />

          <input name="legalName" value={form.legalName} onChange={onChange} className="border rounded-lg p-3" placeholder="Legal Name" />
          <input name="dba" value={form.dba} onChange={onChange} className="border rounded-lg p-3" placeholder="DBA" />
          <input name="orgType" value={form.orgType} onChange={onChange} className="border rounded-lg p-3" placeholder="Organization Type" />
          <input name="city" value={form.city} onChange={onChange} className="border rounded-lg p-3" placeholder="City" />
          <input name="state" value={form.state} onChange={onChange} className="border rounded-lg p-3" placeholder="State" />
          <input name="zip" value={form.zip} onChange={onChange} className="border rounded-lg p-3" placeholder="ZIP" />
          <input name="country" value={form.country} onChange={onChange} className="border rounded-lg p-3" placeholder="Country" />
          <input type="date" name="mcIssueDate" value={form.mcIssueDate} onChange={onChange} className="border rounded-lg p-3" placeholder="MC Issue Date" />

          <input name="mcNumber" value={form.mcNumber} onChange={onChange} className="border rounded-lg p-3" placeholder="MC Number" />
          <input name="dotNumber" value={form.dotNumber} onChange={onChange} className="border rounded-lg p-3" placeholder="DOT Number" />
          <input name="defaultBroadcastRadius" value={form.defaultBroadcastRadius} onChange={onChange} className="border rounded-lg p-3" placeholder="Default Radius (miles)" />
          <input name="defaultMinMcMaturity" value={form.defaultMinMcMaturity} onChange={onChange} className="border rounded-lg p-3" placeholder="Default Min MC Maturity (days)" />

          <div className="md:col-span-2 flex gap-3 mt-2">
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : hasProfile ? 'Update Profile' : 'Create Profile'}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
