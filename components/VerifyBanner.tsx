import React from "react";
import { MailOpen, RefreshCcw } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { Button } from "./ui/button";

export const VerifyBanner: React.FC = () => {
  const { currentOwner, isEmailVerified, resendVerificationEmail, refreshProfile } = useAuth();
  const [resending, setResending] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");

  if (!currentOwner || isEmailVerified) return null;

  const handleResend = async () => {
    setError("");
    setMessage("");
    setResending(true);
    const result = await resendVerificationEmail();
    setResending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(result.message ?? "Verification email sent.");
  };

  const handleRefresh = async () => {
    setError("");
    setMessage("");
    setRefreshing(true);
    try {
      await refreshProfile();
      setMessage("Verification status refreshed.");
    } catch {
      setError("Unable to refresh verification status right now. Please try again.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-6 mt-6 rounded-lg border border-border/80 bg-card p-5 shadow-subtle">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border/80 bg-background text-foreground shadow-subtle">
            <MailOpen size={22} />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Verify to issue cards
            </div>
            <div className="mt-1 text-base font-semibold text-foreground">
              Check your inbox and confirm your email before issuing cards.
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              If the email is missing, resend it and then refresh this page after you confirm.
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={handleResend}
            className="h-11 px-6 text-base"
            disabled={resending || refreshing}
          >
            <MailOpen className="mr-2" size={18} />
            {resending ? "Sending..." : "Resend email"}
          </Button>
          <Button
            onClick={handleRefresh}
            variant="outline"
            className="h-11 px-6 text-base"
            disabled={resending || refreshing}
          >
            <RefreshCcw className="mr-2" size={18} />
            {refreshing ? "Refreshing..." : "Refresh status"}
          </Button>
        </div>
      </div>
      {message && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}
    </div>
  );
};
