import React, { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useAuth } from "./AuthProvider";
import { trackEvent } from "../lib/analytics";

const inputCls =
  "h-12 rounded-xl border-black/[0.1] bg-[#f5f5f7] text-[#1d1d1f] placeholder:text-[#6e6e73]/50 focus-visible:border-[#1d1d1f] focus-visible:ring-0";
const labelCls = "block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6e6e73]";

export const LoginClassicPage: React.FC = () => {
  const { currentUser, loading, login } = useAuth();
  const location = useLocation();
  const fromPath = (location.state as { from?: { pathname?: string } })?.from?.pathname;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const withTimeout = async <T,>(promise: Promise<T>, ms = 15000): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error("Sign in timed out. Please try again."));
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

  if (!loading && currentUser) {
    return <Navigate to={fromPath ?? (currentUser.role === "staff" ? "/issued-cards" : "/dashboard")} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await withTimeout(login(email, password));
      if (!result.ok) {
        setError(result.error);
      } else {
        trackEvent("Login Success", { role: result.user?.role ?? "owner" });
      }
    } catch {
      setError("Unable to sign in right now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const isSubmitting = busy;
  const isDisabled = busy || loading;

  return (
    <AuthLayout
      title="Welcome back."
      subtitle="Manage campaigns, issue stamps, and track loyalty performance in real time."
      badge="Sign in"
      theme="login"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="mb-2">
          <h2 className="text-xl font-semibold text-[#1d1d1f]">Sign in to your account</h2>
          <p className="mt-1 text-sm text-[#6e6e73]">Enter your credentials below to continue.</p>
        </div>

        <div className="space-y-1.5">
          <label className={labelCls}>Email</label>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@brand.com"
            className={inputCls}
            type="email"
            autoComplete="email"
            required
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className={labelCls}>Password</label>
            <Link
              to="/forgot-password"
              className="text-[11px] text-[#6e6e73] underline-offset-2 hover:underline hover:text-[#1d1d1f]"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            className={inputCls}
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={isDisabled}
          className="h-12 w-full rounded-full bg-[#1d1d1f] text-base font-medium text-white shadow-sm hover:bg-black/80"
        >
          {isSubmitting ? "Signing in..." : <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>}
        </Button>
        {loading && !busy && (
          <p className="text-center text-xs text-[#6e6e73]">Checking existing session...</p>
        )}

        <p className="text-center text-sm text-[#6e6e73]">
          New here?{" "}
          <Link to="/signup" className="font-semibold text-[#1d1d1f] underline-offset-2 hover:underline">
            Create your workspace
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};
