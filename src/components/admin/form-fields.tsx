import type { ReactNode } from "react";

export function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-600">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-700 ${props.className ?? ""}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      {...props}
      className={`w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-700 ${props.className ?? ""}`}
    />
  );
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-700 ${props.className ?? ""}`}
    />
  );
}

export function FieldSet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded border border-slate-200 p-4">
      <legend className="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
        {title}
      </legend>
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}
