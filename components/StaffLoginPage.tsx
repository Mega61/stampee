import React, { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { AuthSplitLayout } from "./AuthSplitLayout";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useAuth } from "./AuthProvider";
import { buildIssuedCardsKioskUrl } from "../lib/links";

const inputCls =
  "h-14 rounded-[1.2rem] border border-black/[0.08] bg-[#f4f1ea] px-4 text-[15px] text-[#171512] shadow-none placeholder:text-[#8a8276] focus-visible:border-black/25 focus-visible:bg-white focus-visible:ring-0";
const labelCls = "block text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[#777062]";

export const StaffLoginPage: React.FC = () => {
  const { currentUser, loginStaff } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const kioskId = searchParams.get("kiosk") ?? "";
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const withTimeout = async <T,>(promise: Promise<T>, ms = 15000): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error("El inicio de sesión tardó demasiado. Inténtalo de nuevo."));
      }, ms);
      promise
        .then((value) => {
          window.clearTimeout(timeoutId);
          resolve(value);
        })
        .catch((err) => {
          window.clearTimeout(timeoutId);
          reject(err);
        });
    });

  useEffect(() => {
    const orgParam = searchParams.get("id") ?? "";
    if (orgParam) {
      setOrgId(orgParam);
    }
  }, [searchParams]);

  if (currentUser) {
    return <Navigate to={kioskId ? buildIssuedCardsKioskUrl(kioskId) : "/issued-cards"} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await withTimeout(loginStaff(email, pin, orgId));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      navigate(kioskId ? buildIssuedCardsKioskUrl(kioskId) : "/issued-cards");
    } catch {
      setError("No se pudo iniciar sesión en este momento. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const hasPrefilledOrgId = Boolean(searchParams.get("id"));

  return (
    <AuthSplitLayout
      title="Portal del personal"
      subtitle="Inicia sesión con tu correo, PIN e ID del negocio para emitir tarjetas, escanear y agilizar la fila."
      badge="Acceso del equipo"
      mode="staff"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <p className="text-sm leading-6 text-[#6d6658]">
          Las credenciales del personal son independientes del inicio de sesión del propietario y están ligadas al ID del negocio correcto.
        </p>

        {kioskId && (
          <div className="rounded-[1.35rem] border border-black/[0.08] bg-[#fbf3e6] px-4 py-4 text-sm text-[#6a5845]">
            Sesión de kiosco detectada. Después de iniciar sesión irás directo al flujo de escaneo de este dispositivo.
          </div>
        )}

        <div className="space-y-1.5">
          <label className={labelCls}>Correo</label>
          <Input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="tu@negocio.com"
            className={inputCls}
            type="email"
            autoComplete="email"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className={labelCls}>PIN</label>
          <Input
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            placeholder="4-6 dígitos"
            className={inputCls}
            type="password"
            inputMode="numeric"
            maxLength={6}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className={labelCls}>ID del negocio</label>
          <Input
            value={orgId}
            onChange={(event) => setOrgId(event.target.value)}
            placeholder="ID del negocio del propietario"
            className={`${inputCls} font-mono`}
            required
            disabled={hasPrefilledOrgId}
          />
          <p className="text-xs leading-6 text-[#6d6658]">
            {hasPrefilledOrgId
              ? "Este ID del negocio se completó automáticamente desde el enlace del portal del personal."
              : "Pídele a tu propietario el ID del negocio en Configuración si aún no tienes el enlace del portal."}
          </p>
        </div>

        {error && (
          <div className="rounded-[1.2rem] border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button
          type="submit"
          className="h-14 w-full rounded-[1.2rem] bg-[#1b1813] text-base font-semibold text-white shadow-none hover:bg-[#11100d]"
          disabled={busy}
        >
          {busy ? "Iniciando sesión..." : "Iniciar sesión como personal"}
          {!busy && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>

        <div className="rounded-[1.35rem] border border-black/[0.08] bg-[#f5f1e8] px-4 py-4 text-sm text-[#6d6658]">
          ¿Eres el propietario?{" "}
          <Link to="/login" className="font-semibold text-[#171512] underline-offset-2 hover:underline">
            Ir al inicio de sesión principal
          </Link>
        </div>
      </form>
    </AuthSplitLayout>
  );
};
