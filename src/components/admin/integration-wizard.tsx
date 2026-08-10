import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Copy,
  Plus,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import { Field, TextInput, TextArea, SelectInput } from "@/components/admin/form-fields";
import { createIntegration, updateIntegration } from "@/lib/integrations.functions";


type ProviderType =
  | "affiliate_network"
  | "email_service"
  | "ai_service"
  | "analytics"
  | "payment_gateway"
  | "custom_rest_api";

type AuthType = "api_key" | "bearer" | "oauth2" | "basic" | "custom_headers";

type KV = { key: string; value: string };

type WizardData = {
  // step 1
  name: string;
  provider: string;
  description: string;
  providerType: ProviderType | "";
  // step 2
  authType: AuthType;
  // step 3
  baseUrl: string;
  apiVersion: string;
  timeout: string;
  retries: string;
  orchestrationStrategy: "incremental" | "discover_new_offers" | "refresh_existing_only" | "full_sync";
  orchestrationPageSize: string;
  orchestrationMaxPages: string;
  orchestrationMaxApiCalls: string;
  orchestrationNoNewPages: string;
  healthEndpoint: string;
  storesEndpoint: string;
  couponsEndpoint: string;
  dealsEndpoint: string;
  extraEndpoints: KV[];
  // step 4 credentials (varies)
  apiKey: string;
  accessToken: string;
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string;
  customHeaders: KV[];
};

const STEPS = [
  "Provider Details",
  "Authentication",
  "API Configuration",
  "Credentials",
  "Review",
] as const;

const PROVIDER_TYPES: { value: ProviderType; label: string }[] = [
  { value: "affiliate_network", label: "Affiliate Network" },
  { value: "email_service", label: "Email Service" },
  { value: "ai_service", label: "AI Service" },
  { value: "analytics", label: "Analytics" },
  { value: "payment_gateway", label: "Payment Gateway" },
  { value: "custom_rest_api", label: "Custom REST API" },
];

const AUTH_TYPES: { value: AuthType; label: string; hint: string }[] = [
  { value: "api_key", label: "API Key", hint: "Static key sent via header or query." },
  { value: "bearer", label: "Bearer Token", hint: "Authorization: Bearer <token>." },
  { value: "oauth2", label: "OAuth2", hint: "Client credentials, refresh flow, scopes." },
  { value: "basic", label: "Basic Authentication", hint: "Username + password base64." },
  { value: "custom_headers", label: "Custom Headers", hint: "Free-form header key/value pairs." },
];

const INITIAL: WizardData = {
  name: "",
  provider: "",
  description: "",
  providerType: "",
  authType: "api_key",
  baseUrl: "",
  apiVersion: "",
  timeout: "30",
  retries: "3",
  orchestrationStrategy: "incremental",
  orchestrationPageSize: "100",
  orchestrationMaxPages: "2",
  orchestrationMaxApiCalls: "8",
  orchestrationNoNewPages: "2",
  healthEndpoint: "",
  storesEndpoint: "",
  couponsEndpoint: "",
  dealsEndpoint: "",
  extraEndpoints: [],
  apiKey: "",
  accessToken: "",
  username: "",
  password: "",
  clientId: "",
  clientSecret: "",
  authorizationUrl: "",
  tokenUrl: "",
  scopes: "",
  customHeaders: [{ key: "", value: "" }],
};

function isValidUrl(v: string) {
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function mask(v: string) {
  if (!v) return "—";
  return "•".repeat(Math.min(12, Math.max(6, v.length)));
}

export type IntegrationRecord = {
  id: string;
  integration_name: string;
  provider_name: string;
  provider_type: string;
  description: string | null;
  authentication_type: string;
  base_url: string;
  api_version: string | null;
  timeout_seconds: number;
  retry_attempts: number;
  custom_headers: { key: string; value: string }[] | null;
  endpoint_configuration: Record<string, string> | null;
  orchestration_strategy?: WizardData["orchestrationStrategy"] | null;
  orchestration_page_size?: number | null;
  orchestration_max_pages?: number | null;
  orchestration_max_api_calls?: number | null;
  orchestration_no_new_pages?: number | null;
  is_enabled: boolean;
};

function fromRecord(rec: IntegrationRecord): WizardData {
  const ep = rec.endpoint_configuration ?? {};
  return {
    ...INITIAL,
    name: rec.integration_name,
    provider: rec.provider_name,
    description: rec.description ?? "",
    providerType: (rec.provider_type as ProviderType) || "",
    authType: (rec.authentication_type as AuthType) || "api_key",
    baseUrl: rec.base_url,
    apiVersion: rec.api_version ?? "",
    timeout: String(rec.timeout_seconds ?? 30),
    retries: String(rec.retry_attempts ?? 3),
    orchestrationStrategy: rec.orchestration_strategy ?? "incremental",
    orchestrationPageSize: String(rec.orchestration_page_size ?? 100),
    orchestrationMaxPages: String(rec.orchestration_max_pages ?? 2),
    orchestrationMaxApiCalls: String(rec.orchestration_max_api_calls ?? 8),
    orchestrationNoNewPages: String(rec.orchestration_no_new_pages ?? 2),
    healthEndpoint: ep.health ?? "",
    storesEndpoint: ep.stores ?? "",
    couponsEndpoint: ep.coupons ?? "",
    dealsEndpoint: ep.deals ?? "",
    customHeaders: Array.isArray(rec.custom_headers) && rec.custom_headers.length
      ? rec.custom_headers
      : [{ key: "", value: "" }],
  };
}

export function IntegrationWizard({
  onClose,
  onSaved,
  editing,
}: {
  onClose: () => void;
  onSaved?: () => void;
  editing?: IntegrationRecord | null;
}) {
  const isEdit = !!editing;
  const initial = useMemo(() => (editing ? fromRecord(editing) : INITIAL), [editing]);
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showDiscard, setShowDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dirty = useMemo(() => JSON.stringify(data) !== JSON.stringify(initial) || step > 0, [data, initial, step]);
  const createFn = useServerFn(createIntegration);
  const updateFn = useServerFn(updateIntegration);


  // Escape to close, focus trap basics
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        attemptClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // focus first input
    setTimeout(() => {
      const el = dialogRef.current?.querySelector<HTMLElement>(
        "input, select, textarea, button"
      );
      el?.focus();
    }, 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attemptClose = () => {
    if (dirty) setShowDiscard(true);
    else onClose();
  };

  const update = <K extends keyof WizardData>(k: K, v: WizardData[K]) => {
    setData((d) => ({ ...d, [k]: v }));
    setErrors((e) => {
      if (!e[k as string]) return e;
      const n = { ...e };
      delete n[k as string];
      return n;
    });
  };

  const validateStep = (s: number): boolean => {
    const err: Record<string, string> = {};
    if (s === 0) {
      if (!data.name.trim()) err.name = "Integration name is required.";
      if (!data.provider.trim()) err.provider = "Provider name is required.";
      if (!data.providerType) err.providerType = "Select a provider type.";
    }
    if (s === 2) {
      if (!data.baseUrl.trim()) err.baseUrl = "Base URL is required.";
      else if (!isValidUrl(data.baseUrl)) err.baseUrl = "Enter a valid http(s) URL.";
      const t = Number(data.timeout);
      if (!Number.isFinite(t) || t <= 0) err.timeout = "Timeout must be a positive number.";
      const r = Number(data.retries);
      if (!Number.isFinite(r) || r < 0) err.retries = "Retry attempts must be 0 or more.";
      if (data.authType === "oauth2") {
        // moved: auth URLs live in credentials
      }
    }
    if (s === 3) {
      switch (data.authType) {
        case "api_key":
          if (!data.apiKey.trim()) err.apiKey = "API key is required.";
          break;
        case "bearer":
          if (!data.accessToken.trim()) err.accessToken = "Access token is required.";
          break;
        case "basic":
          if (!data.username.trim()) err.username = "Username is required.";
          if (!data.password.trim()) err.password = "Password is required.";
          break;
        case "oauth2":
          if (!data.clientId.trim()) err.clientId = "Client ID is required.";
          if (!data.clientSecret.trim()) err.clientSecret = "Client secret is required.";
          if (!data.authorizationUrl.trim() || !isValidUrl(data.authorizationUrl))
            err.authorizationUrl = "Valid authorization URL is required.";
          if (!data.tokenUrl.trim() || !isValidUrl(data.tokenUrl))
            err.tokenUrl = "Valid token URL is required.";
          break;
        case "custom_headers":
          if (!data.customHeaders.some((h) => h.key.trim() && h.value.trim()))
            err.customHeaders = "Add at least one header key/value pair.";
          break;
      }
    }
    setErrors(err);
    return Object.keys(err).length === 0;
  };

  const next = () => {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const save = async () => {
    if (!validateStep(0) || !validateStep(2) || (!isEdit && !validateStep(3))) {
      toast.error("Please fix validation errors before saving.");
      return;
    }
    const meta = {
      integration_name: data.name.trim(),
      provider_name: data.provider.trim(),
      provider_type: data.providerType || "custom_rest_api",
      description: data.description ?? "",
      authentication_type: data.authType,
      base_url: data.baseUrl.trim(),
      api_version: data.apiVersion ?? "",
      timeout_seconds: Number(data.timeout) || 30,
      retry_attempts: Number(data.retries) || 0,
      custom_headers: data.customHeaders.filter((h) => h.key.trim()),
      endpoint_configuration: {
        health: data.healthEndpoint,
        stores: data.storesEndpoint,
        coupons: data.couponsEndpoint,
        deals: data.dealsEndpoint,
      },
      orchestration_strategy: data.orchestrationStrategy,
      orchestration_page_size: Number(data.orchestrationPageSize) || 100,
      orchestration_max_pages: Number(data.orchestrationMaxPages) || 2,
      orchestration_max_api_calls: Number(data.orchestrationMaxApiCalls) || 8,
      orchestration_no_new_pages: Number(data.orchestrationNoNewPages) || 2,
      is_enabled: isEdit ? editing!.is_enabled : false,
    };
    const credentials = {
      apiKey: data.apiKey,
      accessToken: data.accessToken,
      username: data.username,
      password: data.password,
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      authorizationUrl: data.authorizationUrl,
      tokenUrl: data.tokenUrl,
      scopes: data.scopes,
      customHeaders: data.customHeaders.filter((h) => h.key.trim()),
    };
    const anyCredEntered = Object.values(credentials).some((v) =>
      Array.isArray(v) ? v.length > 0 : (v ?? "").length > 0,
    );

    setSaving(true);
    try {
      if (isEdit) {
        await updateFn({
          data: { id: editing!.id, meta, credentials: anyCredEntered ? credentials : undefined },
        });
        toast.success("Integration updated");
      } else {
        await createFn({ data: { meta, credentials } });
        toast.success("Integration created");
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save integration");
    } finally {
      setSaving(false);
    }
  };


  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={attemptClose}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-md bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 id="wizard-title" className="text-lg font-semibold text-slate-800">
              {isEdit ? "Edit Integration" : "Add Integration"}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Step {step + 1} of {STEPS.length} — {STEPS[step]}
            </p>

          </div>
          <button
            onClick={attemptClose}
            aria-label="Close wizard"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Stepper */}
        <ol className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs">
          {STEPS.map((label, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <li key={label} className="flex flex-1 items-center gap-2">
                <span
                  className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border text-[11px] font-semibold ${
                    done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : current
                        ? "border-slate-800 bg-slate-800 text-white"
                        : "border-slate-300 bg-white text-slate-500"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span
                  className={`hidden truncate sm:inline ${
                    current ? "font-semibold text-slate-800" : "text-slate-500"
                  }`}
                >
                  {label}
                </span>
                {i < STEPS.length - 1 && (
                  <span className="mx-1 hidden h-px flex-1 bg-slate-200 sm:block" />
                )}
              </li>
            );
          })}
        </ol>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 0 && <Step1 data={data} update={update} errors={errors} />}
          {step === 1 && <Step2 data={data} update={update} />}
          {step === 2 && <Step3 data={data} update={update} errors={errors} />}
          {step === 3 && <Step4 data={data} update={update} errors={errors} />}
          {step === 4 && <Step5 data={data} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3">
          <button
            onClick={attemptClose}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={prev}
              disabled={step === 0}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            {step < STEPS.length - 1 ? (
              <button
                onClick={next}
                className="inline-flex items-center gap-1 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? "Saving…" : isEdit ? "Save Changes" : "Save Integration"}
              </button>

            )}
          </div>
        </div>
      </div>

      {showDiscard && (
        <div
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setShowDiscard(false)}
        >
          <div
            className="w-full max-w-sm rounded-md bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-base font-semibold text-slate-800">Discard changes?</h4>
            <p className="mt-1 text-sm text-slate-600">
              You have unsaved changes. Are you sure you want to discard them?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowDiscard(false)}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Continue Editing
              </button>
              <button
                onClick={() => {
                  setShowDiscard(false);
                  onClose();
                }}
                className="rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------- Steps -------------------------- */

function ErrorText({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-xs font-medium text-rose-600">{children}</p>;
}

function Helper({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-slate-500">{children}</p>;
}

function Step1({
  data,
  update,
  errors,
}: {
  data: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-4">
      <Field label="Integration Name" required>
        <TextInput
          value={data.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="e.g. Awin Publisher Feed"
          aria-invalid={!!errors.name}
        />
        <Helper>A short name shown throughout the admin dashboard.</Helper>
        <ErrorText>{errors.name}</ErrorText>
      </Field>

      <Field label="Provider Name" required>
        <TextInput
          value={data.provider}
          onChange={(e) => update("provider", e.target.value)}
          placeholder="e.g. Awin, Impact.com, Resend"
          aria-invalid={!!errors.provider}
        />
        <Helper>The company or service offering the API.</Helper>
        <ErrorText>{errors.provider}</ErrorText>
      </Field>

      <Field label="Description">
        <TextArea
          value={data.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="Optional notes about how this integration will be used."
        />
        <Helper>Optional context for other admins.</Helper>
      </Field>

      <Field label="Provider Type" required>
        <SelectInput
          value={data.providerType}
          onChange={(e) => update("providerType", e.target.value as ProviderType)}
          aria-invalid={!!errors.providerType}
        >
          <option value="">Select a type…</option>
          {PROVIDER_TYPES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </SelectInput>
        <Helper>Determines which endpoint fields we surface next.</Helper>
        <ErrorText>{errors.providerType}</ErrorText>
      </Field>
    </div>
  );
}

function Step2({
  data,
  update,
}: {
  data: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
        Authentication Type
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {AUTH_TYPES.map((a) => {
          const active = data.authType === a.value;
          return (
            <label
              key={a.value}
              className={`flex cursor-pointer items-start gap-3 rounded border p-3 text-sm transition ${
                active ? "border-slate-800 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="authType"
                value={a.value}
                checked={active}
                onChange={() => update("authType", a.value)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-slate-800">{a.label}</span>
                <span className="block text-xs text-slate-500">{a.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Credential fields will change based on this selection.
      </p>
    </fieldset>
  );
}

function Step3({
  data,
  update,
  errors,
}: {
  data: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
  errors: Record<string, string>;
}) {
  const showAffiliate = data.providerType === "affiliate_network" || data.providerType === "custom_rest_api";
  const showEmail = data.providerType === "email_service";

  return (
    <div className="space-y-4">
      <Field label="Base URL" required>
        <TextInput
          value={data.baseUrl}
          onChange={(e) => update("baseUrl", e.target.value)}
          placeholder="https://api.example.com"
          aria-invalid={!!errors.baseUrl}
        />
        <ErrorText>{errors.baseUrl}</ErrorText>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="API Version">
          <TextInput
            value={data.apiVersion}
            onChange={(e) => update("apiVersion", e.target.value)}
            placeholder="v1"
          />
        </Field>
        <Field label="Timeout (seconds)">
          <TextInput
            type="number"
            min={1}
            value={data.timeout}
            onChange={(e) => update("timeout", e.target.value)}
            aria-invalid={!!errors.timeout}
          />
          <ErrorText>{errors.timeout}</ErrorText>
        </Field>
        <Field label="Retry Attempts">
          <TextInput
            type="number"
            min={0}
            value={data.retries}
            onChange={(e) => update("retries", e.target.value)}
            aria-invalid={!!errors.retries}
          />
          <ErrorText>{errors.retries}</ErrorText>
        </Field>
      </div>

      <div className="rounded border border-slate-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            Optional Endpoints
          </h4>
          {data.providerType && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {PROVIDER_TYPES.find((p) => p.value === data.providerType)?.label}
            </span>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Health Check">
            <TextInput
              value={data.healthEndpoint}
              onChange={(e) => update("healthEndpoint", e.target.value)}
              placeholder="/health"
            />
          </Field>

          {showAffiliate && (
            <>
              <Field label="Stores Endpoint">
                <TextInput
                  value={data.storesEndpoint}
                  onChange={(e) => update("storesEndpoint", e.target.value)}
                  placeholder="/merchants"
                />
              </Field>
              <Field label="Coupons Endpoint">
                <TextInput
                  value={data.couponsEndpoint}
                  onChange={(e) => update("couponsEndpoint", e.target.value)}
                  placeholder="/coupons"
                />
              </Field>
              <Field label="Deals Endpoint">
                <TextInput
                  value={data.dealsEndpoint}
                  onChange={(e) => update("dealsEndpoint", e.target.value)}
                  placeholder="/deals"
                />
              </Field>
            </>
          )}

          {showEmail && (
            <>
              <Field label="Send Endpoint">
                <TextInput
                  value={data.couponsEndpoint}
                  onChange={(e) => update("couponsEndpoint", e.target.value)}
                  placeholder="/messages"
                />
              </Field>
              <Field label="Templates Endpoint">
                <TextInput
                  value={data.storesEndpoint}
                  onChange={(e) => update("storesEndpoint", e.target.value)}
                  placeholder="/templates"
                />
              </Field>
            </>
          )}
        </div>
        <Helper>Endpoint availability is not validated in this phase.</Helper>
      </div>
      {showAffiliate && (
        <div className="rounded border border-slate-200 p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Import orchestration</h4>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Strategy">
              <SelectInput value={data.orchestrationStrategy} onChange={(e) => update("orchestrationStrategy", e.target.value as WizardData["orchestrationStrategy"])}>
                <option value="incremental">Incremental</option>
                <option value="discover_new_offers">Discover New Offers</option>
                <option value="refresh_existing_only">Refresh Existing Only</option>
                <option value="full_sync">Full Sync</option>
              </SelectInput>
            </Field>
            <Field label="Page size"><TextInput type="number" min={1} max={500} value={data.orchestrationPageSize} onChange={(e) => update("orchestrationPageSize", e.target.value)} /></Field>
            <Field label="Maximum pages"><TextInput type="number" min={1} value={data.orchestrationMaxPages} onChange={(e) => update("orchestrationMaxPages", e.target.value)} /></Field>
            <Field label="Maximum API calls"><TextInput type="number" min={1} value={data.orchestrationMaxApiCalls} onChange={(e) => update("orchestrationMaxApiCalls", e.target.value)} /></Field>
            <Field label="No-new pages before stop"><TextInput type="number" min={1} value={data.orchestrationNoNewPages} onChange={(e) => update("orchestrationNoNewPages", e.target.value)} /></Field>
          </div>
          <Helper>Uses immutable provider identities only. Preview and Run Import use these same limits.</Helper>
        </div>
      )}
    </div>
  );
}

function SecretInput({
  label,
  value,
  onChange,
  required,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const display = focused || visible ? value : value ? mask(value) : "";
  return (
    <Field label={label} required={required}>
      <div className="relative">
        <input
          type={focused || visible ? "text" : "password"}
          value={focused || visible ? value : display}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          className="h-10 w-full rounded border border-slate-300 bg-white px-3 pr-20 text-sm text-slate-800 outline-none focus:border-slate-700"
        />
        <div className="absolute right-1 top-1 flex gap-0.5">
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide value" : "Show value"}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button
            type="button"
            disabled
            title="Available in Phase 1C"
            aria-label="Copy value (disabled)"
            className="cursor-not-allowed rounded p-1.5 text-slate-300"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
    </Field>
  );
}

function KVEditor({
  label,
  rows,
  onChange,
  error,
}: {
  label: string;
  rows: KV[];
  onChange: (rows: KV[]) => void;
  error?: string;
}) {
  const set = (i: number, patch: Partial<KV>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { key: "", value: "" }]);
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
          {label}
        </span>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="rounded border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
            No headers yet.
          </p>
        )}
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={r.key}
              onChange={(e) => set(i, { key: e.target.value })}
              placeholder="Header name"
              className="h-10 flex-1 rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-700"
            />
            <input
              value={r.value}
              onChange={(e) => set(i, { value: e.target.value })}
              placeholder="Value"
              className="h-10 flex-1 rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-700"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label="Remove row"
              className="rounded border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-rose-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function Step4({
  data,
  update,
  errors,
}: {
  data: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" />
        <p>Credentials are securely encrypted before storage.</p>
      </div>

      {data.authType === "api_key" && (
        <SecretInput
          label="API Key"
          value={data.apiKey}
          onChange={(v) => update("apiKey", v)}
          required
          error={errors.apiKey}
          placeholder="sk_live_..."
        />
      )}

      {data.authType === "bearer" && (
        <SecretInput
          label="Access Token"
          value={data.accessToken}
          onChange={(v) => update("accessToken", v)}
          required
          error={errors.accessToken}
        />
      )}

      {data.authType === "basic" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Username" required>
            <TextInput
              value={data.username}
              onChange={(e) => update("username", e.target.value)}
              aria-invalid={!!errors.username}
            />
            <ErrorText>{errors.username}</ErrorText>
          </Field>
          <SecretInput
            label="Password"
            value={data.password}
            onChange={(v) => update("password", v)}
            required
            error={errors.password}
          />
        </div>
      )}

      {data.authType === "oauth2" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client ID" required>
              <TextInput
                value={data.clientId}
                onChange={(e) => update("clientId", e.target.value)}
                aria-invalid={!!errors.clientId}
              />
              <ErrorText>{errors.clientId}</ErrorText>
            </Field>
            <SecretInput
              label="Client Secret"
              value={data.clientSecret}
              onChange={(v) => update("clientSecret", v)}
              required
              error={errors.clientSecret}
            />
          </div>
          <Field label="Authorization URL" required>
            <TextInput
              value={data.authorizationUrl}
              onChange={(e) => update("authorizationUrl", e.target.value)}
              placeholder="https://provider.com/oauth/authorize"
              aria-invalid={!!errors.authorizationUrl}
            />
            <ErrorText>{errors.authorizationUrl}</ErrorText>
          </Field>
          <Field label="Token URL" required>
            <TextInput
              value={data.tokenUrl}
              onChange={(e) => update("tokenUrl", e.target.value)}
              placeholder="https://provider.com/oauth/token"
              aria-invalid={!!errors.tokenUrl}
            />
            <ErrorText>{errors.tokenUrl}</ErrorText>
          </Field>
          <Field label="Scopes">
            <TextInput
              value={data.scopes}
              onChange={(e) => update("scopes", e.target.value)}
              placeholder="read:coupons write:coupons"
            />
            <Helper>Space-separated list of OAuth scopes.</Helper>
          </Field>
        </div>
      )}

      {data.authType === "custom_headers" && (
        <KVEditor
          label="Custom Headers"
          rows={data.customHeaders}
          onChange={(rows) => update("customHeaders", rows)}
          error={errors.customHeaders}
        />
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="text-right text-sm text-slate-800">{value || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function Step5({ data }: { data: WizardData }) {
  const providerLabel = PROVIDER_TYPES.find((p) => p.value === data.providerType)?.label ?? "—";
  const authLabel = AUTH_TYPES.find((a) => a.value === data.authType)?.label ?? "—";

  const endpoints = [
    data.healthEndpoint && ["Health", data.healthEndpoint],
    data.storesEndpoint && ["Stores", data.storesEndpoint],
    data.couponsEndpoint && ["Coupons", data.couponsEndpoint],
    data.dealsEndpoint && ["Deals", data.dealsEndpoint],
  ].filter(Boolean) as [string, string][];

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="mb-3 text-sm font-semibold text-slate-800">Summary</h4>
        <dl>
          <SummaryRow label="Integration Name" value={data.name} />
          <SummaryRow label="Provider" value={data.provider} />
          <SummaryRow label="Provider Type" value={providerLabel} />
          <SummaryRow label="Authentication" value={authLabel} />
          <SummaryRow label="Base URL" value={data.baseUrl} />
          <SummaryRow label="API Version" value={data.apiVersion} />
          <SummaryRow label="Timeout" value={data.timeout ? `${data.timeout}s` : ""} />
          <SummaryRow label="Retry Attempts" value={data.retries} />
          <SummaryRow
            label="Configured Endpoints"
            value={
              endpoints.length ? (
                <ul className="space-y-0.5 text-right">
                  {endpoints.map(([k, v]) => (
                    <li key={k}>
                      <span className="text-slate-500">{k}: </span>
                      <span className="font-mono text-xs">{v}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                ""
              )
            }
          />
        </dl>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="mb-3 text-sm font-semibold text-slate-800">Credentials</h4>
        <dl>
          {data.authType === "api_key" && (
            <SummaryRow label="API Key" value={mask(data.apiKey)} />
          )}
          {data.authType === "bearer" && (
            <SummaryRow label="Access Token" value={mask(data.accessToken)} />
          )}
          {data.authType === "basic" && (
            <>
              <SummaryRow label="Username" value={data.username} />
              <SummaryRow label="Password" value={mask(data.password)} />
            </>
          )}
          {data.authType === "oauth2" && (
            <>
              <SummaryRow label="Client ID" value={data.clientId} />
              <SummaryRow label="Client Secret" value={mask(data.clientSecret)} />
              <SummaryRow label="Authorization URL" value={data.authorizationUrl} />
              <SummaryRow label="Token URL" value={data.tokenUrl} />
              <SummaryRow label="Scopes" value={data.scopes} />
            </>
          )}
          {data.authType === "custom_headers" && (
            <SummaryRow
              label="Custom Headers"
              value={
                <ul className="space-y-0.5 text-right">
                  {data.customHeaders
                    .filter((h) => h.key.trim())
                    .map((h, i) => (
                      <li key={i}>
                        <span className="font-mono text-xs">{h.key}</span>
                        <span className="text-slate-500">: </span>
                        <span className="font-mono text-xs">{mask(h.value)}</span>
                      </li>
                    ))}
                </ul>
              }
            />
          )}
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          Sensitive values are masked. Secrets are never displayed in plain text after this step.
        </p>
      </div>
    </div>
  );
}
