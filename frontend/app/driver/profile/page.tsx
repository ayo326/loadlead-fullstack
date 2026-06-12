'use client';

import React, { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { REQUIRED_PROFILE_FIELDS } from '@/lib/profileFields';
import { TrailerType } from '@/types';

interface DriverProfileForm {
  legalName: string;
  phone: string;
  carrierId: string;
  driverType: string;
  fullName: string;
  dob: string;
  medicalCertExpiration: string;
  licenseNumber: string;
  licenseState: string;
  cdlClass: string;
  endorsementsCsv: string;
  experienceYears: string;
  truckMake: string;
  truckModel: string;
  truckYear: string;
  truckVIN: string;
  trailerType: string;
  trailerLength: string;
  trailerWidth: string;
  trailerHeight: string;
  maxCapacityLbs: string;
  mcNumber: string;
  mcIssueDate: string;
  dotNumber: string;
  authorityStartDate: string;
  cargoInsuranceAmount: string;
  liabilityInsuranceAmount: string;
  insurancePolicyId: string;
  insuranceProvider: string;
  policyNumber: string;
  autoLiabilityAmount: string;
  cargoCoverageAmount: string;
  policyExpirationDate: string;
}

const initialForm: DriverProfileForm = {
  legalName: '',
  phone: '',
  carrierId: '',
  driverType: 'OWNER_OPERATOR',
  fullName: '',
  dob: '',
  medicalCertExpiration: '',
  licenseNumber: '',
  licenseState: '',
  cdlClass: 'A',
  endorsementsCsv: '',
  experienceYears: '0',
  truckMake: '',
  truckModel: '',
  truckYear: String(new Date().getFullYear()),
  truckVIN: '',
  trailerType: TrailerType.BOX_TRUCK,
  trailerLength: '0',
  trailerWidth: '0',
  trailerHeight: '0',
  maxCapacityLbs: '0',
  mcNumber: '',
  mcIssueDate: '',
  dotNumber: '',
  authorityStartDate: '',
  cargoInsuranceAmount: '0',
  liabilityInsuranceAmount: '0',
  insurancePolicyId: '',
  insuranceProvider: '',
  policyNumber: '',
  autoLiabilityAmount: '0',
  cargoCoverageAmount: '0',
  policyExpirationDate: '',
};

const toDateInput = (value: any): string => {
  if (!value) return '';
  const dt = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
};

export default function DriverProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<DriverProfileForm>(initialForm);

  const missingRequired = useMemo(() => {
    const required = REQUIRED_PROFILE_FIELDS.DRIVER;
    return required.filter((field) => !String((form as any)[field] || '').trim());
  }, [form]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.getDriverProfile();
        if (res?.driver) {
          const d = res.driver;
          setHasProfile(true);
          setForm({
            legalName: d.legalName || '',
            phone: d.phone || '',
            carrierId: d.carrierId || '',
            driverType: d.driverType || 'OWNER_OPERATOR',
            fullName: d.fullName || d.legalName || '',
            dob: toDateInput(d.dob),
            medicalCertExpiration: toDateInput(d.medicalCertExpiration),
            licenseNumber: d.licenseNumber || '',
            licenseState: d.licenseState || '',
            cdlClass: d.cdlClass || 'A',
            endorsementsCsv: Array.isArray(d.endorsements) ? d.endorsements.join(', ') : '',
            experienceYears: String(d.experienceYears ?? 0),
            truckMake: d.truckMake || '',
            truckModel: d.truckModel || '',
            truckYear: String(d.truckYear ?? new Date().getFullYear()),
            truckVIN: d.truckVIN || '',
            trailerType: d.trailerType || TrailerType.BOX_TRUCK,
            trailerLength: String(d.trailerLength ?? 0),
            trailerWidth: String(d.trailerWidth ?? 0),
            trailerHeight: String(d.trailerHeight ?? 0),
            maxCapacityLbs: String(d.maxCapacityLbs ?? 0),
            mcNumber: d.mcNumber || '',
            mcIssueDate: toDateInput(d.mcIssueDate),
            dotNumber: d.dotNumber || '',
            authorityStartDate: toDateInput(d.authorityStartDate),
            cargoInsuranceAmount: String(d.cargoInsuranceAmount ?? 0),
            liabilityInsuranceAmount: String(d.liabilityInsuranceAmount ?? 0),
            insurancePolicyId: d.insurancePolicyId || '',
            insuranceProvider: d.insuranceProvider || '',
            policyNumber: d.policyNumber || '',
            autoLiabilityAmount: String(d.autoLiabilityAmount ?? 0),
            cargoCoverageAmount: String(d.cargoCoverageAmount ?? 0),
            policyExpirationDate: toDateInput(d.policyExpirationDate),
          });
        }
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.response?.data?.message;
        if (msg && msg !== 'Driver profile not found') {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
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

    if (form.licenseState.trim().length !== 2) {
      setError('licenseState must be 2 characters (e.g., TX).');
      return;
    }

    if (form.truckVIN.trim().length !== 17) {
      setError('truckVIN must be exactly 17 characters.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        legalName: form.legalName.trim(),
        phone: form.phone.trim(),
        carrierId: form.carrierId.trim(),
        driverType: form.driverType.trim(),
        fullName: form.fullName.trim(),
        dob: form.dob,
        medicalCertExpiration: form.medicalCertExpiration,
        licenseNumber: form.licenseNumber.trim(),
        licenseState: form.licenseState.trim().toUpperCase(),
        cdlClass: form.cdlClass.trim().toUpperCase(),
        endorsements: form.endorsementsCsv.split(',').map((x) => x.trim()).filter(Boolean),
        experienceYears: Number(form.experienceYears || 0),
        truckMake: form.truckMake.trim(),
        truckModel: form.truckModel.trim(),
        truckYear: Number(form.truckYear || 0),
        truckVIN: form.truckVIN.trim(),
        trailerType: form.trailerType,
        trailerLength: Number(form.trailerLength || 0),
        trailerWidth: Number(form.trailerWidth || 0),
        trailerHeight: Number(form.trailerHeight || 0),
        maxCapacityLbs: Number(form.maxCapacityLbs || 0),
        mcNumber: form.mcNumber.trim(),
        mcIssueDate: form.mcIssueDate,
        dotNumber: form.dotNumber.trim(),
        authorityStartDate: form.authorityStartDate,
        cargoInsuranceAmount: Number(form.cargoInsuranceAmount || 0),
        liabilityInsuranceAmount: Number(form.liabilityInsuranceAmount || 0),
        insurancePolicyId: form.insurancePolicyId.trim() || undefined,
        insuranceProvider: form.insuranceProvider.trim() || undefined,
        policyNumber: form.policyNumber.trim() || undefined,
        autoLiabilityAmount: Number(form.autoLiabilityAmount || 0),
        cargoCoverageAmount: Number(form.cargoCoverageAmount || 0),
        policyExpirationDate: form.policyExpirationDate || undefined,
      };

      if (hasProfile) {
        await api.updateDriverProfile(payload);
        setSuccess('Driver profile updated successfully.');
      } else {
        await api.createDriverProfile(payload);
        setHasProfile(true);
        setSuccess('Driver profile created successfully.');
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
      <h1 className="text-3xl font-bold mb-6">Driver Profile</h1>

      <Card>
        <p className="text-sm text-gray-600 mb-4">
          DriverProfiles + InsurancePolicies schema fields are integrated below.
        </p>

        {error && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {success && <div className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">{success}</div>}

        <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input name="legalName" value={form.legalName} onChange={onChange} className="border rounded-lg p-3" placeholder="Legal Name *" />
          <input name="fullName" value={form.fullName} onChange={onChange} className="border rounded-lg p-3" placeholder="Driver Full Name *" />
          <input name="phone" value={form.phone} onChange={onChange} className="border rounded-lg p-3" placeholder="Phone *" />
          <input name="carrierId" value={form.carrierId} onChange={onChange} className="border rounded-lg p-3" placeholder="Carrier ID *" />

          <input name="driverType" value={form.driverType} onChange={onChange} className="border rounded-lg p-3" placeholder="Driver Type *" />
          <input type="date" name="dob" value={form.dob} onChange={onChange} className="border rounded-lg p-3" placeholder="DOB *" />
          <input type="date" name="medicalCertExpiration" value={form.medicalCertExpiration} onChange={onChange} className="border rounded-lg p-3" placeholder="Medical Cert Expiration *" />
          <input type="date" name="mcIssueDate" value={form.mcIssueDate} onChange={onChange} className="border rounded-lg p-3" placeholder="MC Issue Date *" />

          <input name="licenseNumber" value={form.licenseNumber} onChange={onChange} className="border rounded-lg p-3" placeholder="License Number *" />
          <input name="licenseState" value={form.licenseState} onChange={onChange} className="border rounded-lg p-3" placeholder="License State (2-char) *" />

          <select name="cdlClass" value={form.cdlClass} onChange={onChange} className="border rounded-lg p-3">
            <option value="A">CDL A</option>
            <option value="B">CDL B</option>
            <option value="C">CDL C</option>
          </select>
          <input name="experienceYears" value={form.experienceYears} onChange={onChange} className="border rounded-lg p-3" placeholder="Experience Years *" />

          <input name="truckMake" value={form.truckMake} onChange={onChange} className="border rounded-lg p-3" placeholder="Truck Make *" />
          <input name="truckModel" value={form.truckModel} onChange={onChange} className="border rounded-lg p-3" placeholder="Truck Model *" />
          <input name="truckYear" value={form.truckYear} onChange={onChange} className="border rounded-lg p-3" placeholder="Truck Year *" />
          <input name="truckVIN" value={form.truckVIN} onChange={onChange} className="border rounded-lg p-3" placeholder="Truck VIN (17 chars) *" />

          <select name="trailerType" value={form.trailerType} onChange={onChange} className="border rounded-lg p-3">
            {Object.values(TrailerType).map((tt) => (
              <option key={tt} value={tt}>{tt}</option>
            ))}
          </select>
          <input name="maxCapacityLbs" value={form.maxCapacityLbs} onChange={onChange} className="border rounded-lg p-3" placeholder="Max Capacity (lbs) *" />

          <input name="trailerLength" value={form.trailerLength} onChange={onChange} className="border rounded-lg p-3" placeholder="Trailer Length (ft)" />
          <input name="trailerWidth" value={form.trailerWidth} onChange={onChange} className="border rounded-lg p-3" placeholder="Trailer Width (ft)" />
          <input name="trailerHeight" value={form.trailerHeight} onChange={onChange} className="border rounded-lg p-3" placeholder="Trailer Height (ft)" />
          <input name="endorsementsCsv" value={form.endorsementsCsv} onChange={onChange} className="border rounded-lg p-3" placeholder="Endorsements (comma-separated)" />

          <input name="mcNumber" value={form.mcNumber} onChange={onChange} className="border rounded-lg p-3" placeholder="MC Number *" />
          <input name="dotNumber" value={form.dotNumber} onChange={onChange} className="border rounded-lg p-3" placeholder="DOT Number *" />
          <input type="date" name="authorityStartDate" value={form.authorityStartDate} onChange={onChange} className="border rounded-lg p-3" placeholder="Authority Start Date *" />

          <input name="cargoInsuranceAmount" value={form.cargoInsuranceAmount} onChange={onChange} className="border rounded-lg p-3" placeholder="Cargo Insurance Amount" />
          <input name="liabilityInsuranceAmount" value={form.liabilityInsuranceAmount} onChange={onChange} className="border rounded-lg p-3" placeholder="Liability Insurance Amount" />

          <input name="insurancePolicyId" value={form.insurancePolicyId} onChange={onChange} className="border rounded-lg p-3" placeholder="Insurance Policy ID" />
          <input name="insuranceProvider" value={form.insuranceProvider} onChange={onChange} className="border rounded-lg p-3" placeholder="Insurance Provider" />
          <input name="policyNumber" value={form.policyNumber} onChange={onChange} className="border rounded-lg p-3" placeholder="Policy Number" />
          <input name="autoLiabilityAmount" value={form.autoLiabilityAmount} onChange={onChange} className="border rounded-lg p-3" placeholder="Auto Liability Amount" />
          <input name="cargoCoverageAmount" value={form.cargoCoverageAmount} onChange={onChange} className="border rounded-lg p-3" placeholder="Cargo Coverage Amount" />
          <input type="date" name="policyExpirationDate" value={form.policyExpirationDate} onChange={onChange} className="border rounded-lg p-3" placeholder="Policy Expiration Date" />

          <div className="md:col-span-2 flex gap-3 mt-2">
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : hasProfile ? 'Update Profile' : 'Create Profile'}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
