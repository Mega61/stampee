import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { User, ApiKey, ApiKeyWithSecret } from "../types";
import { api, ApiError, broadcastAuth, onAuthBroadcast } from "../lib/api";
import { normalizeSlug } from "../lib/slug";
import {
  fetchAdmins,
  createAdmin as dbCreateAdmin,
  setAdminAccess as dbSetAdminAccess,
  deleteAdmin as dbDeleteAdmin,
} from "../lib/db/admins";
import {
  fetchApiKeys,
  createApiKey as dbCreateApiKey,
  revokeApiKey as dbRevokeApiKey,
} from "../lib/db/apiKeys";

export type AuthResult = { ok: true; user?: User; message?: string } | { ok: false; error: string };
export type CreateApiKeyResult =
  | { ok: true; apiKey: ApiKeyWithSecret }
  | { ok: false; error: string };

interface MeResponse {
  user: User;
  owner: User | null;
  staffAccounts: User[];
}

interface AuthContextValue {
  currentUser: User | null;
  currentOwner: User | null;
  isOwner: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  isEmailVerified: boolean;
  loading: boolean;
  staffAccounts: User[];
  adminAccounts: User[];
  login: (email: string, password: string) => Promise<AuthResult>;
  loginStaff: (email: string, pin: string, orgId: string) => Promise<AuthResult>;
  loginWithGoogle: (credential: string) => Promise<AuthResult>;
  loginStaffWithGoogle: (credential: string, orgId: string) => Promise<AuthResult>;
  signup: (payload: { businessName: string; email: string; password: string; slug: string }) => Promise<AuthResult>;
  createStaff: (payload: { name: string; email: string; pin: string }) => Promise<AuthResult>;
  updateStaffPin: (staffId: string, pin: string) => Promise<AuthResult>;
  setStaffAccess: (staffId: string, access: "active" | "disabled") => Promise<AuthResult>;
  deleteStaff: (staffId: string) => Promise<AuthResult>;
  createAdmin: (payload: { name: string; email: string }) => Promise<AuthResult>;
  setAdminAccess: (adminId: string, access: "active" | "disabled") => Promise<AuthResult>;
  deleteAdmin: (adminId: string) => Promise<AuthResult>;
  refreshAdmins: () => Promise<void>;
  apiKeys: ApiKey[];
  createApiKey: (payload: { name: string; expiresInDays?: number }) => Promise<CreateApiKeyResult>;
  revokeApiKey: (keyId: string) => Promise<AuthResult>;
  refreshApiKeys: () => Promise<void>;
  deleteAccount: () => Promise<AuthResult>;
  logout: () => Promise<void>;
  resendVerificationEmail: () => Promise<AuthResult>;
  isSlugAvailable: (slug: string) => Promise<boolean>;
  updateProfileInfo: (payload: { businessName?: string; email?: string; slug?: string }) => Promise<AuthResult>;
  updatePassword: (newPassword: string) => Promise<AuthResult>;
  resetPassword: (email: string) => Promise<AuthResult>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Map an ApiError into the legacy { ok: false, error } shape callers expect.
const fail = (err: unknown, fallback: string): { ok: false; error: string } => {
  if (err instanceof ApiError) return { ok: false, error: err.message };
  return { ok: false, error: fallback };
};

const SIGNIN_ERROR_MESSAGE = "Unable to sign in right now. Please try again.";
const SIGNUP_ERROR_MESSAGE = "Unable to create your account right now. Please try again.";
const PROFILE_UPDATE_ERROR = "Unable to update your profile right now. Please try again.";
const PASSWORD_UPDATE_ERROR = "Unable to update your password right now. Please try again.";
const PASSWORD_RESET_ERROR = "Unable to send a reset link right now. Please try again.";
const STAFF_ACTION_ERROR = "Unable to complete this staff action right now. Please try again.";
const ADMIN_ACTION_ERROR = "Unable to complete this admin action right now. Please try again.";
const API_KEY_ACTION_ERROR = "Unable to complete this API key action right now. Please try again.";
const ACCOUNT_ACTION_ERROR = "Unable to complete this account action right now. Please try again.";

const GOOGLE_SIGNIN_ERROR_MESSAGE = "No se pudo iniciar sesión con Google. Inténtalo de nuevo.";

// Map ApiError.code values from the /auth/google* endpoints to friendly
// Spanish messages, matching the recently localized auth UI.
const googleErrorMessage = (err: unknown): string => {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "DOMAIN_NOT_ALLOWED":
        return "Debes usar una cuenta de Google de la empresa.";
      case "NO_ACCOUNT":
        return "No existe una cuenta para este correo. Contacta al administrador.";
      case "ACCOUNT_DISABLED":
        return "Esta cuenta está deshabilitada.";
      case "EMAIL_NOT_VERIFIED":
        return "Tu correo de Google no está verificado.";
      default:
        return GOOGLE_SIGNIN_ERROR_MESSAGE;
    }
  }
  return GOOGLE_SIGNIN_ERROR_MESSAGE;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentOwner, setCurrentOwner] = useState<User | null>(null);
  const [staffAccounts, setStaffAccounts] = useState<User[]>([]);
  const [adminAccounts, setAdminAccounts] = useState<User[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(() => {
    setCurrentUser(null);
    setCurrentOwner(null);
    setStaffAccounts([]);
    setAdminAccounts([]);
    setApiKeys([]);
    setIsEmailVerified(false);
  }, []);

  // Owner-only: pull the co-owner ("admin") list. Returns [] for non-owners.
  const refreshAdmins = useCallback(async (): Promise<void> => {
    const admins = await fetchAdmins();
    setAdminAccounts(admins);
  }, []);

  // Owner + admin: pull the integration API-key list. Returns [] otherwise.
  const refreshApiKeys = useCallback(async (): Promise<void> => {
    const keys = await fetchApiKeys();
    setApiKeys(keys);
  }, []);

  // Pull the whole session shape (user + owner + staff list) in one call.
  // Returns the profile so callers (login / signup) can return it.
  const loadSession = useCallback(async (): Promise<User | null> => {
    try {
      const data = await api.get<MeResponse>("/auth/me");
      setCurrentUser(data.user);
      setCurrentOwner(data.owner ?? data.user);
      setStaffAccounts(data.staffAccounts ?? []);
      setIsEmailVerified(data.user.status === "verified");
      // Only the primary owner manages co-owners, so only they need the list.
      if (data.user.role === "owner") {
        await refreshAdmins();
      } else {
        setAdminAccounts([]);
      }
      // Owner + admin can manage integration API keys.
      if (data.user.role === "owner" || data.user.role === "admin") {
        await refreshApiKeys();
      } else {
        setApiKeys([]);
      }
      return data.user;
    } catch {
      clearSession();
      return null;
    }
  }, [clearSession, refreshAdmins, refreshApiKeys]);

  // Boot: try to resolve the session once. The api.ts auto-refresh-then-retry
  // means an expired access cookie is silently rotated if the refresh cookie
  // is still good.
  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadSession();
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [loadSession]);

  // React to cross-tab logout broadcasts AND to the `auth:expired` event
  // emitted by api.ts when refresh ultimately fails.
  useEffect(() => {
    const handleExpired = () => clearSession();
    window.addEventListener("auth:expired", handleExpired);
    const offBroadcast = onAuthBroadcast((msg) => {
      if (msg.type === "logout") clearSession();
      if (msg.type === "login") void loadSession();
    });
    return () => {
      window.removeEventListener("auth:expired", handleExpired);
      offBroadcast();
    };
  }, [clearSession, loadSession]);

  const refreshProfile = useCallback(async () => {
    await loadSession();
  }, [loadSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      try {
        await api.post("/auth/login", { email: email.trim().toLowerCase(), password });
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code === "ACCOUNT_DISABLED") {
            return { ok: false, error: "This account is disabled." };
          }
          return { ok: false, error: "Unable to sign in. Please check your credentials and try again." };
        }
        return { ok: false, error: SIGNIN_ERROR_MESSAGE };
      }
      const user = await loadSession();
      broadcastAuth({ type: "login" });
      if (!user) return { ok: false, error: SIGNIN_ERROR_MESSAGE };
      return { ok: true, user };
    },
    [loadSession],
  );

  const loginStaff = useCallback(
    async (email: string, pin: string, orgId: string): Promise<AuthResult> => {
      // orgId carries the owner's slug (not an opaque id). The API normalizes.
      try {
        await api.post("/auth/staff-login", {
          email: email.trim().toLowerCase(),
          pin,
          orgId,
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === "ACCOUNT_DISABLED") {
          return { ok: false, error: "This account is disabled. Ask the owner to re-enable it." };
        }
        return { ok: false, error: "Email or PIN is incorrect." };
      }
      const user = await loadSession();
      broadcastAuth({ type: "login" });
      if (!user) return { ok: false, error: SIGNIN_ERROR_MESSAGE };
      return { ok: true, user };
    },
    [loadSession],
  );

  const loginWithGoogle = useCallback(
    async (credential: string): Promise<AuthResult> => {
      try {
        await api.post("/auth/google", { credential });
      } catch (err) {
        return { ok: false, error: googleErrorMessage(err) };
      }
      const user = await loadSession();
      broadcastAuth({ type: "login" });
      if (!user) return { ok: false, error: GOOGLE_SIGNIN_ERROR_MESSAGE };
      return { ok: true, user };
    },
    [loadSession],
  );

  const loginStaffWithGoogle = useCallback(
    async (credential: string, orgId: string): Promise<AuthResult> => {
      try {
        await api.post("/auth/google-staff", { credential, orgId });
      } catch (err) {
        return { ok: false, error: googleErrorMessage(err) };
      }
      const user = await loadSession();
      broadcastAuth({ type: "login" });
      if (!user) return { ok: false, error: GOOGLE_SIGNIN_ERROR_MESSAGE };
      return { ok: true, user };
    },
    [loadSession],
  );

  const signup = useCallback(
    async (payload: {
      businessName: string;
      email: string;
      password: string;
      slug: string;
    }): Promise<AuthResult> => {
      try {
        await api.post("/auth/signup", {
          businessName: payload.businessName.trim(),
          email: payload.email.trim().toLowerCase(),
          password: payload.password,
          slug: normalizeSlug(payload.slug),
        });
        return {
          ok: true,
          message:
            "Signup succeeded. Confirm your email before signing in. Check your inbox and spam folder for the confirmation link.",
        };
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code === "EMAIL_TAKEN") {
            return { ok: false, error: "An account with this email already exists. Please log in instead." };
          }
          if (err.code === "SLUG_TAKEN") {
            return { ok: false, error: "This slug is already taken. Try another." };
          }
          return { ok: false, error: err.message };
        }
        return { ok: false, error: SIGNUP_ERROR_MESSAGE };
      }
    },
    [],
  );

  const createStaff = useCallback(
    async (payload: { name: string; email: string; pin: string }): Promise<AuthResult> => {
      if (!currentOwner || (currentUser?.role !== "owner" && currentUser?.role !== "admin")) {
        return { ok: false, error: "Only owners can manage staff." };
      }
      if (!/^\d{4,6}$/.test(payload.pin)) {
        return { ok: false, error: "PIN should be 4-6 digits." };
      }
      try {
        await api.post("/staff", {
          name: payload.name.trim(),
          email: payload.email.trim().toLowerCase(),
          pin: payload.pin,
        });
      } catch (err) {
        return fail(err, STAFF_ACTION_ERROR);
      }
      await loadSession();
      return { ok: true };
    },
    [currentOwner, currentUser, loadSession],
  );

  const updateStaffPin = useCallback(
    async (staffId: string, pin: string): Promise<AuthResult> => {
      if (!currentOwner || (currentUser?.role !== "owner" && currentUser?.role !== "admin")) {
        return { ok: false, error: "Only owners can manage staff." };
      }
      if (!/^\d{4,6}$/.test(pin)) {
        return { ok: false, error: "PIN should be 4-6 digits." };
      }
      try {
        await api.patch(`/staff/${staffId}/pin`, { pin });
        return { ok: true };
      } catch (err) {
        return fail(err, STAFF_ACTION_ERROR);
      }
    },
    [currentOwner, currentUser],
  );

  const setStaffAccess = useCallback(
    async (staffId: string, access: "active" | "disabled"): Promise<AuthResult> => {
      if (!currentOwner || (currentUser?.role !== "owner" && currentUser?.role !== "admin")) {
        return { ok: false, error: "Only owners can manage staff." };
      }
      try {
        await api.patch(`/staff/${staffId}/access`, { access });
      } catch (err) {
        return fail(err, STAFF_ACTION_ERROR);
      }
      await loadSession();
      return { ok: true };
    },
    [currentOwner, currentUser, loadSession],
  );

  const deleteStaff = useCallback(
    async (staffId: string): Promise<AuthResult> => {
      if (!currentOwner || (currentUser?.role !== "owner" && currentUser?.role !== "admin")) {
        return { ok: false, error: "Only owners can manage staff." };
      }
      try {
        await api.delete(`/staff/${staffId}`);
      } catch (err) {
        return fail(err, STAFF_ACTION_ERROR);
      }
      await loadSession();
      return { ok: true };
    },
    [currentOwner, currentUser, loadSession],
  );

  // --- Co-owner ("admin") management — OWNER ONLY -------------------------
  // Mirrors the staff methods above, but admins are invited by email (no PIN)
  // and only the primary owner may manage them.
  const createAdmin = useCallback(
    async (payload: { name: string; email: string }): Promise<AuthResult> => {
      if (!currentOwner || currentUser?.role !== "owner") {
        return { ok: false, error: "Only owners can manage admins." };
      }
      try {
        await dbCreateAdmin(payload);
      } catch (err) {
        return fail(err, ADMIN_ACTION_ERROR);
      }
      await refreshAdmins();
      return { ok: true };
    },
    [currentOwner, currentUser, refreshAdmins],
  );

  const setAdminAccess = useCallback(
    async (adminId: string, access: "active" | "disabled"): Promise<AuthResult> => {
      if (!currentOwner || currentUser?.role !== "owner") {
        return { ok: false, error: "Only owners can manage admins." };
      }
      try {
        await dbSetAdminAccess(adminId, access);
      } catch (err) {
        return fail(err, ADMIN_ACTION_ERROR);
      }
      await refreshAdmins();
      return { ok: true };
    },
    [currentOwner, currentUser, refreshAdmins],
  );

  const deleteAdmin = useCallback(
    async (adminId: string): Promise<AuthResult> => {
      if (!currentOwner || currentUser?.role !== "owner") {
        return { ok: false, error: "Only owners can manage admins." };
      }
      try {
        await dbDeleteAdmin(adminId);
      } catch (err) {
        return fail(err, ADMIN_ACTION_ERROR);
      }
      await refreshAdmins();
      return { ok: true };
    },
    [currentOwner, currentUser, refreshAdmins],
  );

  // --- Integration API keys — OWNER + ADMIN ------------------------------
  const canManageKeys = currentUser?.role === "owner" || currentUser?.role === "admin";

  const createApiKey = useCallback(
    async (payload: { name: string; expiresInDays?: number }): Promise<CreateApiKeyResult> => {
      if (!canManageKeys) {
        return { ok: false, error: "Only owners and admins can manage API keys." };
      }
      try {
        const apiKey = await dbCreateApiKey(payload);
        await refreshApiKeys();
        return { ok: true, apiKey };
      } catch (err) {
        return fail(err, API_KEY_ACTION_ERROR);
      }
    },
    [canManageKeys, refreshApiKeys],
  );

  const revokeApiKey = useCallback(
    async (keyId: string): Promise<AuthResult> => {
      if (!canManageKeys) {
        return { ok: false, error: "Only owners and admins can manage API keys." };
      }
      try {
        await dbRevokeApiKey(keyId);
      } catch (err) {
        return fail(err, API_KEY_ACTION_ERROR);
      }
      await refreshApiKeys();
      return { ok: true };
    },
    [canManageKeys, refreshApiKeys],
  );

  const deleteAccount = useCallback(async (): Promise<AuthResult> => {
    if (!currentUser) return { ok: false, error: "Not signed in." };
    try {
      await api.delete("/auth/account");
    } catch (err) {
      return fail(err, ACCOUNT_ACTION_ERROR);
    }
    clearSession();
    broadcastAuth({ type: "logout" });
    return { ok: true };
  }, [clearSession, currentUser]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout", {});
    } catch {
      // ignore — cookies may already be gone
    }
    clearSession();
    broadcastAuth({ type: "logout" });
  }, [clearSession]);

  const resendVerificationEmail = useCallback(async (): Promise<AuthResult> => {
    const email = currentUser?.email?.trim().toLowerCase();
    try {
      await api.post("/auth/resend-verification", email ? { email } : {});
      return { ok: true, message: "Verification email sent. Check your inbox and spam folder." };
    } catch (err) {
      return fail(err, "Unable to resend verification email right now. Please try again.");
    }
  }, [currentUser?.email]);

  const isSlugAvailable = useCallback(async (slug: string): Promise<boolean> => {
    try {
      const data = await api.get<{ available: boolean }>("/slug/available", { slug });
      return data.available === true;
    } catch {
      return false;
    }
  }, []);

  const updateProfileInfo = useCallback(
    async (payload: {
      businessName?: string;
      email?: string;
      slug?: string;
    }): Promise<AuthResult> => {
      if (!currentUser) return { ok: false, error: "Not signed in." };
      const body: Record<string, unknown> = {};
      if (payload.businessName?.trim()) body.businessName = payload.businessName.trim();
      if (payload.email?.trim()) body.email = payload.email.trim().toLowerCase();
      if (payload.slug?.trim()) body.slug = normalizeSlug(payload.slug);
      if (Object.keys(body).length === 0) return { ok: true };
      try {
        await api.patch("/profile", body);
      } catch (err) {
        return fail(err, PROFILE_UPDATE_ERROR);
      }
      await refreshProfile();
      return { ok: true };
    },
    [currentUser, refreshProfile],
  );

  const updatePassword = useCallback(async (newPassword: string): Promise<AuthResult> => {
    if (newPassword.length < 8) {
      return { ok: false, error: "New password must be at least 8 characters." };
    }
    try {
      await api.post("/auth/password", { newPassword });
      return { ok: true };
    } catch (err) {
      return fail(err, PASSWORD_UPDATE_ERROR);
    }
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<AuthResult> => {
    try {
      await api.post("/auth/forgot-password", { email: email.trim().toLowerCase() });
      return { ok: true };
    } catch (err) {
      return fail(err, PASSWORD_RESET_ERROR);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      currentOwner,
      isOwner: currentUser?.role === "owner",
      isStaff: currentUser?.role === "staff",
      isAdmin: currentUser?.role === "admin",
      isEmailVerified,
      loading,
      staffAccounts,
      adminAccounts,
      login,
      loginStaff,
      loginWithGoogle,
      loginStaffWithGoogle,
      signup,
      createStaff,
      updateStaffPin,
      setStaffAccess,
      deleteStaff,
      createAdmin,
      setAdminAccess,
      deleteAdmin,
      refreshAdmins,
      apiKeys,
      createApiKey,
      revokeApiKey,
      refreshApiKeys,
      deleteAccount,
      logout,
      resendVerificationEmail,
      isSlugAvailable,
      updateProfileInfo,
      updatePassword,
      resetPassword,
      refreshProfile,
    }),
    [
      currentUser, currentOwner, isEmailVerified, loading, staffAccounts, adminAccounts,
      login, loginStaff, loginWithGoogle, loginStaffWithGoogle, signup, createStaff,
      updateStaffPin, setStaffAccess, deleteStaff, createAdmin, setAdminAccess, deleteAdmin,
      refreshAdmins, apiKeys, createApiKey, revokeApiKey, refreshApiKeys,
      deleteAccount, logout,
      resendVerificationEmail, isSlugAvailable, updateProfileInfo,
      updatePassword, resetPassword, refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
