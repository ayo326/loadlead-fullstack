'use client';

import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className = '', ...props }) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-slate-200 mb-1">
          {label}
        </label>
      )}
      <input
        className={`w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-900 text-black placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent ${
          error ? 'border-red-500' : ''
        } ${className}`}
        {...props}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
};
