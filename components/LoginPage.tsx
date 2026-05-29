import React, { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { AuthSplitLayout } from "./AuthSplitLayout";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useAuth } from "./AuthProvider";
import type { AuthResult } from "./AuthProvider";
import { trackEvent } from "../lib/analytics";

const inputCls =
  "h-14 rounded-[1.2rem] border border-black/[0.08] bg-[#f4f1ea] px-4 text-[15px] text-[#171512] shadow-none placeholder:text-[#8a8276] focus-visible:border-black/25 focus-visible:bg-white focus-visible:ring-0";
const labelCls = "block text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[#777062]";

export const LoginPage: React.FC = () => {
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

  // Once auth state is resolved and user is logged in, redirect
  if (!loading && currentUser) {
    return <Navigate to={fromPath ?? (currentUser.role === "staff" ? "/issued-cards" : "/dashboard")} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await withTimeout<AuthResult>(login(email, password));
      if ("error" in result) {
        setError(result.error);
      } else {
        trackEvent("Login Success", { role: result.user?.role ?? "owner" });
      }
    } catch {
      setError("Unable to sign in right now. Please try again.");
    } finally {
      setBusy(false);
    }
    // Redirect is handled automatically when currentUser becomes set
  };

  const isSubmitting = busy;
  const isDisabled = busy || loading;

  return (
    <AuthSplitLayout
      title="Welcome back"
      subtitle="Log in to run campaigns, issue digital cards, and track loyalty activity from one place."
      badge="Sign in"
      mode="login"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <p className="text-sm leading-6 text-[#6d6658]">
          Owner access only. Staff members should continue using their dedicated portal link and PIN.
        </p>

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
          <div className="rounded-[1.2rem] border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={isDisabled}
          className="h-14 w-full rounded-[1.2rem] bg-[#1b1813] text-base font-semibold text-white shadow-none hover:bg-[#11100d] disabled:opacity-60"
        >
          {isSubmitting ? "Signing in..." : <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>}
        </Button>
        {loading && !busy && (
          <p className="text-center text-xs text-[#777062]">Checking existing session...</p>
        )}
      </form>
    </AuthSplitLayout>
  );
};
