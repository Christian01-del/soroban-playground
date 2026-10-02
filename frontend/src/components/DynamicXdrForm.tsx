import React, { useState } from 'react';
import { XdrTypeSpec, XdrSpecEntry } from '../services/wasmXdrParser';

interface DynamicXdrFormProps {
  spec: XdrSpecEntry;
  onSubmit: (args: Record<string, any>) => void;
}

export const DynamicXdrForm: React.FC<DynamicXdrFormProps> = ({ spec, onSubmit }) => {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
    if (errors[fieldName]) {
      setErrors((prev) => ({ ...prev, [fieldName]: '' }));
    }
  };

  const renderInputByType = (name: string, typeSpec: XdrTypeSpec, path: string = name): React.ReactNode => {
    switch (typeSpec.type) {
      case 'bool':
        return (
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!formData[path]}
              onChange={(e) => handleFieldChange(path, e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-slate-300">{name} (bool)</span>
          </label>
        );

      case 'u32':
      case 'i32':
      case 'u64':
      case 'i64':
      case 'u128':
      case 'i128':
        return (
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-400">{name} ({typeSpec.type})</label>
            <input
              type="number"
              value={formData[path] ?? ''}
              onChange={(e) => handleFieldChange(path, e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              placeholder={`Enter ${typeSpec.type}`}
            />
          </div>
        );

      case 'address':
      case 'string':
      case 'symbol':
        return (
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-400">{name} ({typeSpec.type})</label>
            <input
              type="text"
              value={formData[path] ?? ''}
              onChange={(e) => handleFieldChange(path, e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              placeholder={`Enter ${typeSpec.type}`}
            />
          </div>
        );

      case 'vec':
        return (
          <div className="p-3 border border-slate-800 rounded bg-slate-950/40 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-indigo-400">Vector [{typeSpec.type}] - {name}</span>
              <button
                type="button"
                onClick={() => {
                  const currentList = formData[path] || [];
                  handleFieldChange(path, [...currentList, '']);
                }}
                className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1 bg-indigo-950/60 rounded"
              >
                + Add Item
              </button>
            </div>
            {(formData[path] || []).map((_: any, idx: number) => (
              <div key={idx} className="flex items-center space-x-2">
                {renderInputByType(`[${idx}]`, typeSpec.element, `${path}[${idx}]`)}
                <button
                  type="button"
                  onClick={() => {
                    const currentList = [...formData[path]];
                    currentList.splice(idx, 1);
                    handleFieldChange(path, currentList);
                  }}
                  className="text-red-400 hover:text-red-300 text-xs px-2 py-1"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        );

      case 'tuple':
        return (
          <div className="p-3 border border-slate-800 rounded bg-slate-950/40 space-y-3">
            <span className="text-xs font-semibold text-indigo-400">Tuple: {name}</span>
            {typeSpec.elements.map((elType, elIdx) => (
              <div key={elIdx}>
                {renderInputByType(`Element ${elIdx + 1}`, elType, `${path}.${elIdx}`)}
              </div>
            ))}
          </div>
        );

      default:
        return (
          <div className="text-xs text-amber-400">Unsupported or UDT type: {JSON.stringify(typeSpec)}</div>
        );
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-slate-900/60 border border-slate-800 p-5 rounded-lg">
      <div>
        <h3 className="text-base font-semibold text-white">{spec.name}</h3>
        {spec.doc && <p className="text-xs text-slate-400 mt-1">{spec.doc}</p>}
      </div>

      <div className="space-y-3">
        {spec.inputs?.map((input) => (
          <div key={input.name} className="space-y-1">
            {renderInputByType(input.name, input.type, input.name)}
          </div>
        ))}
      </div>

      <button
        type="submit"
        className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded text-sm transition-colors"
      >
        Invoke Function
      </button>
    </form>
  );
};
