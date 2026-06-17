import React, { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useAuth } from "./AuthProvider";
import { buildStaffPortalUrl } from "../lib/links";
import { useNavigate } from "react-router-dom";
import { useSubscriptionContext } from "./SubscriptionContext";
import type { ApiKey, ApiKeyWithSecret } from "../types";

const DELETE_CONFIRMATION = "DELETE";

const API_KEY_EXPIRY_OPTIONS: Array<{ label: string; days?: number }> = [
  { label: "Sin vencimiento" },
  { label: "30 días", days: 30 },
  { label: "90 días", days: 90 },
  { label: "1 año", days: 365 },
];

const formatDate = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
};

const apiKeyStatusVariant = (status: ApiKey["status"]): "secondary" | "destructive" | "outline" =>
  status === "active" ? "secondary" : status === "expired" ? "outline" : "destructive";

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { staffAccounts, createStaff, updateStaffPin, setStaffAccess, deleteStaff, adminAccounts, createAdmin, setAdminAccess, deleteAdmin, isOwner, isAdmin, currentOwner, currentUser, deleteAccount, updateProfileInfo, updatePassword, apiKeys, createApiKey, revokeApiKey } = useAuth();
  useSubscriptionContext();

  const [profileForm, setProfileForm] = useState({
    businessName: currentUser?.businessName ?? "",
    email: currentUser?.email ?? "",
    slug: currentOwner?.slug ?? "",
  });
  const [profileSuccess, setProfileSuccess] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);

  useEffect(() => {
    setProfileForm({
      businessName: currentUser?.businessName ?? "",
      email: currentUser?.email ?? "",
      slug: currentOwner?.slug ?? "",
    });
  }, [currentUser, currentOwner]);

  const [passwordForm, setPasswordForm] = useState({ next: "", confirm: "" });
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [form, setForm] = useState({ name: "", email: "", pin: "" });
  const [error, setError] = useState("");
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffActionBusyId, setStaffActionBusyId] = useState<string | null>(null);
  const [staffActionError, setStaffActionError] = useState("");
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null);
  const [resetPin, setResetPin] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [deleteStaffTarget, setDeleteStaffTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteStaffError, setDeleteStaffError] = useState("");
  const [deleteStaffBusy, setDeleteStaffBusy] = useState(false);

  // --- Co-owner ("Administradores") section state -------------------------
  const [adminForm, setAdminForm] = useState({ name: "", email: "" });
  const [adminError, setAdminError] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminActionBusyId, setAdminActionBusyId] = useState<string | null>(null);
  const [adminActionError, setAdminActionError] = useState("");
  const [deleteAdminTarget, setDeleteAdminTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteAdminError, setDeleteAdminError] = useState("");
  const [deleteAdminBusy, setDeleteAdminBusy] = useState(false);

  // --- API key ("Integraciones") section state ---------------------------
  const canManageApiKeys = isOwner || isAdmin;
  const [apiKeyForm, setApiKeyForm] = useState<{ name: string; expiryIndex: number }>({ name: "", expiryIndex: 0 });
  const [apiKeyError, setApiKeyError] = useState("");
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [newApiKey, setNewApiKey] = useState<ApiKeyWithSecret | null>(null);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [revokeApiKeyTarget, setRevokeApiKeyTarget] = useState<{ id: string; name: string } | null>(null);
  const [revokeApiKeyError, setRevokeApiKeyError] = useState("");
  const [revokeApiKeyBusy, setRevokeApiKeyBusy] = useState(false);

  const [isDeleteStepOneOpen, setIsDeleteStepOneOpen] = useState(false);
  const [isDeleteStepTwoOpen, setIsDeleteStepTwoOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);

  const handleProfileSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileError("");
    setProfileSuccess("");
    setProfileBusy(true);
    const result = await updateProfileInfo({
      businessName: profileForm.businessName,
      email: profileForm.email,
    });
    setProfileBusy(false);
    if (!result.ok) {
      setProfileError(result.error);
    } else {
      setProfileSuccess("Profile updated successfully.");
      setTimeout(() => setProfileSuccess(""), 3000);
    }
  };

  const handlePasswordSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    const result = await updatePassword(passwordForm.next);
    setPasswordBusy(false);
    if (!result.ok) {
      setPasswordError(result.error);
    } else {
      setPasswordSuccess("Password changed successfully.");
      setPasswordForm({ next: "", confirm: "" });
      setTimeout(() => setPasswordSuccess(""), 3000);
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setStaffActionError("");
    setStaffBusy(true);
    const result = await createStaff(form);
    setStaffBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setForm({ name: "", email: "", pin: "" });
  };

  const handleReset = async () => {
    if (!resetTarget) return;
    setResetError("");
    setResetBusy(true);
    const result = await updateStaffPin(resetTarget.id, resetPin);
    setResetBusy(false);
    if (!result.ok) {
      setResetError(result.error);
      return;
    }
    setResetPin("");
    setResetTarget(null);
  };

  const handleSetStaffAccess = async (staffId: string, access: "active" | "disabled") => {
    setStaffActionError("");
    setStaffActionBusyId(staffId);
    const result = await setStaffAccess(staffId, access);
    setStaffActionBusyId(null);
    if (!result.ok) {
      setStaffActionError(result.error);
    }
  };

  const handleDeleteFinal = async () => {
    setDeleteError("");
    if (deleteConfirmText.trim().toUpperCase() !== DELETE_CONFIRMATION) {
      setDeleteError(`Type ${DELETE_CONFIRMATION} to confirm account deletion.`);
      return;
    }

    setDeleteAccountBusy(true);
    const result = await deleteAccount();
    setDeleteAccountBusy(false);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }

    setIsDeleteStepTwoOpen(false);
    setDeleteConfirmText("");
    navigate("/signup");
  };

  const handleDeleteStaff = async () => {
    if (!deleteStaffTarget) return;
    setDeleteStaffError("");
    setDeleteStaffBusy(true);
    const result = await deleteStaff(deleteStaffTarget.id);
    setDeleteStaffBusy(false);
    if (!result.ok) {
      setDeleteStaffError(result.error);
      return;
    }
    setDeleteStaffTarget(null);
  };

  const handleCreateAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    setAdminError("");
    setAdminActionError("");
    setAdminBusy(true);
    const result = await createAdmin(adminForm);
    setAdminBusy(false);
    if (!result.ok) {
      setAdminError(result.error);
      return;
    }
    setAdminForm({ name: "", email: "" });
  };

  const handleSetAdminAccess = async (adminId: string, access: "active" | "disabled") => {
    setAdminActionError("");
    setAdminActionBusyId(adminId);
    const result = await setAdminAccess(adminId, access);
    setAdminActionBusyId(null);
    if (!result.ok) {
      setAdminActionError(result.error);
    }
  };

  const handleDeleteAdmin = async () => {
    if (!deleteAdminTarget) return;
    setDeleteAdminError("");
    setDeleteAdminBusy(true);
    const result = await deleteAdmin(deleteAdminTarget.id);
    setDeleteAdminBusy(false);
    if (!result.ok) {
      setDeleteAdminError(result.error);
      return;
    }
    setDeleteAdminTarget(null);
  };

  const handleCreateApiKey = async (event: React.FormEvent) => {
    event.preventDefault();
    setApiKeyError("");
    if (!apiKeyForm.name.trim()) {
      setApiKeyError("Ponle un nombre a la clave para identificarla.");
      return;
    }
    setApiKeyBusy(true);
    const result = await createApiKey({
      name: apiKeyForm.name,
      expiresInDays: API_KEY_EXPIRY_OPTIONS[apiKeyForm.expiryIndex]?.days,
    });
    setApiKeyBusy(false);
    if (!result.ok) {
      setApiKeyError(result.error);
      return;
    }
    setApiKeyForm({ name: "", expiryIndex: 0 });
    setApiKeyCopied(false);
    setNewApiKey(result.apiKey);
  };

  const handleCopyApiKey = async () => {
    if (!newApiKey) return;
    try {
      await navigator.clipboard.writeText(newApiKey.key);
      setApiKeyCopied(true);
    } catch {
      setApiKeyCopied(false);
    }
  };

  const handleRevokeApiKey = async () => {
    if (!revokeApiKeyTarget) return;
    setRevokeApiKeyError("");
    setRevokeApiKeyBusy(true);
    const result = await revokeApiKey(revokeApiKeyTarget.id);
    setRevokeApiKeyBusy(false);
    if (!result.ok) {
      setRevokeApiKeyError(result.error);
      return;
    }
    setRevokeApiKeyTarget(null);
  };

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 animate-fade-in h-full overflow-y-auto flex flex-col bg-gray-50/50">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your profile, password, team, and account.</p>
      </div>

      {/* Edit Profile */}
      <section className="rounded-2xl md:rounded-3xl border bg-white p-4 md:p-6 shadow-sm space-y-5">
        <div>
          <h2 className="text-lg md:text-xl font-semibold">Edit Profile</h2>
          <p className="text-sm text-muted-foreground">Update your business name and email address.</p>
        </div>
        <form className="space-y-4" onSubmit={handleProfileSave}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Business / Display Name</Label>
              <Input
                value={profileForm.businessName}
                onChange={(e) => setProfileForm({ ...profileForm, businessName: e.target.value })}
                placeholder="Your Business"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email Address</Label>
              <Input
                value={profileForm.email}
                onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                type="email"
                placeholder="you@brand.com"
                required
              />
            </div>
            {currentUser?.role === "owner" && (
              <div className="space-y-1.5">
                <Label>Public URL Slug</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">stampee.co/</span>
                  <Input
                    value={profileForm.slug}
                    readOnly
                    className="bg-muted/40 text-muted-foreground cursor-not-allowed"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">Your public URL cannot be changed after signup.</p>
              </div>
            )}
          </div>
          {profileError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {profileError}
            </div>
          )}
          {profileSuccess && (
            <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {profileSuccess}
            </div>
          )}
          <div>
            <Button type="submit" className="rounded-full px-6" disabled={profileBusy}>
              {profileBusy ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </form>
      </section>

      {/* Change Password */}
      <section className="rounded-2xl md:rounded-3xl border bg-white p-4 md:p-6 shadow-sm space-y-5">
        <div>
          <h2 className="text-lg md:text-xl font-semibold">Change Password</h2>
          <p className="text-sm text-muted-foreground">Update your account password. Must be at least 6 characters.</p>
        </div>
        <form className="space-y-4" onSubmit={handlePasswordSave}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>New Password</Label>
              <Input
                type="password"
                value={passwordForm.next}
                onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })}
                placeholder="••••••••"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm New Password</Label>
              <Input
                type="password"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                placeholder="••••••••"
                required
              />
            </div>
          </div>
          {passwordError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {passwordError}
            </div>
          )}
          {passwordSuccess && (
            <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {passwordSuccess}
            </div>
          )}
          <div>
            <Button type="submit" className="rounded-full px-6" disabled={passwordBusy}>
              {passwordBusy ? "Changing..." : "Change Password"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl md:rounded-3xl border bg-white p-4 md:p-6 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-lg md:text-xl font-semibold">Staff Accounts</h2>
            <p className="text-sm text-muted-foreground">
              Create staff logins for issuing cards and managing stamps.
            </p>
          </div>
          {currentOwner?.slug && currentOwner?.id && (
            <div className="text-xs text-muted-foreground space-y-2 md:text-right">
              <div>
                Org ID: <span className="font-mono break-all">{currentOwner.id}</span>
              </div>
              <div className="text-[11px] text-muted-foreground/80">
                Share this Org ID or portal link with staff.
              </div>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={buildStaffPortalUrl(currentOwner.slug, currentOwner.id)}
                  className="text-[11px] font-mono bg-muted/40 min-w-0"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => navigator.clipboard.writeText(buildStaffPortalUrl(currentOwner.slug!, currentOwner.id))}
                >
                  Copy
                </Button>
              </div>
            </div>
          )}
        </div>

        <form className="space-y-3" onSubmit={handleCreate}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Jamie Staff"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="staff@brand.com"
                type="email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>PIN</Label>
              <Input
                value={form.pin}
                onChange={(event) => setForm({ ...form, pin: event.target.value })}
                placeholder="4-6 digits"
                maxLength={6}
                required
              />
            </div>
          </div>
          <Button type="submit" className="rounded-full h-10 px-6 w-full sm:w-auto" disabled={staffBusy}>
            {staffBusy ? "Adding..." : "Add Staff"}
          </Button>
        </form>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {staffActionError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {staffActionError}
          </div>
        )}

        {/* Staff table — desktop */}
        <div className="hidden md:block rounded-2xl border border-slate-100 overflow-hidden">
          <div className="grid grid-cols-[1.2fr_1.4fr_0.8fr_auto] gap-4 px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground bg-slate-50">
            <span>Name</span>
            <span>Email</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>
          {staffAccounts.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No staff yet. Add your first teammate above.
            </div>
          ) : (
            staffAccounts.map((staff) => (
              <div
                key={staff.id}
                className="grid grid-cols-[1.2fr_1.4fr_0.8fr_auto] gap-4 px-4 py-4 border-t items-center"
              >
                <div className="font-medium text-foreground truncate">{staff.businessName}</div>
                <div className="text-sm text-muted-foreground truncate">{staff.email}</div>
                <div>
                  <Badge
                    variant={staff.access === "active" ? "secondary" : "destructive"}
                    className="uppercase tracking-wider"
                  >
                    {staff.access}
                  </Badge>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={staffActionBusyId === staff.id}
                    onClick={() => {
                      setResetTarget({ id: staff.id, name: staff.businessName });
                      setResetPin("");
                      setResetError("");
                    }}
                  >
                    Reset PIN
                  </Button>
                  <Button
                    variant={staff.access === "active" ? "destructive" : "default"}
                    size="sm"
                    disabled={staffActionBusyId === staff.id}
                    onClick={() =>
                      handleSetStaffAccess(staff.id, staff.access === "active" ? "disabled" : "active")
                    }
                  >
                    {staffActionBusyId === staff.id ? "Saving..." : (staff.access === "active" ? "Disable" : "Enable")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={staffActionBusyId === staff.id}
                    onClick={() => {
                      setDeleteStaffTarget({ id: staff.id, name: staff.businessName });
                      setDeleteStaffError("");
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Staff list — mobile cards */}
        <div className="md:hidden space-y-3">
          {staffAccounts.length === 0 ? (
            <div className="rounded-2xl border border-slate-100 px-4 py-6 text-sm text-muted-foreground">
              No staff yet. Add your first teammate above.
            </div>
          ) : (
            staffAccounts.map((staff) => (
              <div
                key={staff.id}
                className="rounded-2xl border border-slate-100 bg-slate-50/50 px-4 py-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{staff.businessName}</div>
                    <div className="text-sm text-muted-foreground truncate">{staff.email}</div>
                  </div>
                  <Badge
                    variant={staff.access === "active" ? "secondary" : "destructive"}
                    className="uppercase tracking-wider shrink-0"
                  >
                    {staff.access}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={staffActionBusyId === staff.id}
                    onClick={() => {
                      setResetTarget({ id: staff.id, name: staff.businessName });
                      setResetPin("");
                      setResetError("");
                    }}
                  >
                    Reset PIN
                  </Button>
                  <Button
                    variant={staff.access === "active" ? "destructive" : "default"}
                    size="sm"
                    className="flex-1"
                    disabled={staffActionBusyId === staff.id}
                    onClick={() =>
                      handleSetStaffAccess(staff.id, staff.access === "active" ? "disabled" : "active")
                    }
                  >
                    {staffActionBusyId === staff.id ? "Saving..." : (staff.access === "active" ? "Disable" : "Enable")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1"
                    disabled={staffActionBusyId === staff.id}
                    onClick={() => {
                      setDeleteStaffTarget({ id: staff.id, name: staff.businessName });
                      setDeleteStaffError("");
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {isOwner && (
        <section className="rounded-2xl md:rounded-3xl border bg-white p-4 md:p-6 shadow-sm space-y-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-lg md:text-xl font-semibold">Administradores</h2>
              <p className="text-sm text-muted-foreground">
                Invita a usuarios de tu empresa para que administren campañas, clientes y personal.
              </p>
            </div>
          </div>

          <form className="space-y-3" onSubmit={handleCreateAdmin}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input
                  value={adminForm.name}
                  onChange={(event) => setAdminForm({ ...adminForm, name: event.target.value })}
                  placeholder="María Administradora"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Correo</Label>
                <Input
                  value={adminForm.email}
                  onChange={(event) => setAdminForm({ ...adminForm, email: event.target.value })}
                  placeholder="admin@empresa.com"
                  type="email"
                  required
                />
              </div>
            </div>
            <Button type="submit" className="rounded-full h-10 px-6 w-full sm:w-auto" disabled={adminBusy}>
              {adminBusy ? "Invitando..." : "Invitar administrador"}
            </Button>
          </form>

          {adminError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {adminError}
            </div>
          )}

          {adminActionError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {adminActionError}
            </div>
          )}

          {/* Admin table — desktop */}
          <div className="hidden md:block rounded-2xl border border-slate-100 overflow-hidden">
            <div className="grid grid-cols-[1.4fr_1.6fr_0.8fr_auto] gap-4 px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground bg-slate-50">
              <span>Nombre</span>
              <span>Correo</span>
              <span>Estado</span>
              <span className="text-right">Acciones</span>
            </div>
            {adminAccounts.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                Aún no hay administradores. Invita al primero arriba.
              </div>
            ) : (
              adminAccounts.map((admin) => (
                <div
                  key={admin.id}
                  className="grid grid-cols-[1.4fr_1.6fr_0.8fr_auto] gap-4 px-4 py-4 border-t items-center"
                >
                  <div className="font-medium text-foreground truncate">{admin.businessName}</div>
                  <div className="text-sm text-muted-foreground truncate">{admin.email}</div>
                  <div>
                    <Badge
                      variant={admin.access === "active" ? "secondary" : "destructive"}
                      className="uppercase tracking-wider"
                    >
                      {admin.access}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant={admin.access === "active" ? "destructive" : "default"}
                      size="sm"
                      disabled={adminActionBusyId === admin.id}
                      onClick={() =>
                        handleSetAdminAccess(admin.id, admin.access === "active" ? "disabled" : "active")
                      }
                    >
                      {adminActionBusyId === admin.id ? "Guardando..." : (admin.access === "active" ? "Deshabilitar" : "Habilitar")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={adminActionBusyId === admin.id}
                      onClick={() => {
                        setDeleteAdminTarget({ id: admin.id, name: admin.businessName });
                        setDeleteAdminError("");
                      }}
                    >
                      Eliminar
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Admin list — mobile cards */}
          <div className="md:hidden space-y-3">
            {adminAccounts.length === 0 ? (
              <div className="rounded-2xl border border-slate-100 px-4 py-6 text-sm text-muted-foreground">
                Aún no hay administradores. Invita al primero arriba.
              </div>
            ) : (
              adminAccounts.map((admin) => (
                <div
                  key={admin.id}
                  className="rounded-2xl border border-slate-100 bg-slate-50/50 px-4 py-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{admin.businessName}</div>
                      <div className="text-sm text-muted-foreground truncate">{admin.email}</div>
                    </div>
                    <Badge
                      variant={admin.access === "active" ? "secondary" : "destructive"}
                      className="uppercase tracking-wider shrink-0"
                    >
                      {admin.access}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant={admin.access === "active" ? "destructive" : "default"}
                      size="sm"
                      className="flex-1"
                      disabled={adminActionBusyId === admin.id}
                      onClick={() =>
                        handleSetAdminAccess(admin.id, admin.access === "active" ? "disabled" : "active")
                      }
                    >
                      {adminActionBusyId === admin.id ? "Guardando..." : (admin.access === "active" ? "Deshabilitar" : "Habilitar")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex-1"
                      disabled={adminActionBusyId === admin.id}
                      onClick={() => {
                        setDeleteAdminTarget({ id: admin.id, name: admin.businessName });
                        setDeleteAdminError("");
                      }}
                    >
                      Eliminar
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {canManageApiKeys && (
        <section className="rounded-2xl md:rounded-3xl border bg-white p-4 md:p-6 shadow-sm space-y-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-lg md:text-xl font-semibold">API e integraciones</h2>
              <p className="text-sm text-muted-foreground">
                Genera claves para que sistemas externos consulten y actualicen tus datos vía la API. Cada clave tiene acceso de lectura y escritura a tu negocio.
              </p>
            </div>
          </div>

          <form className="space-y-3" onSubmit={handleCreateApiKey}>
            <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input
                  value={apiKeyForm.name}
                  onChange={(event) => setApiKeyForm({ ...apiKeyForm, name: event.target.value })}
                  placeholder="Sistema de facturación"
                  maxLength={80}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Vencimiento</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={apiKeyForm.expiryIndex}
                  onChange={(event) => setApiKeyForm({ ...apiKeyForm, expiryIndex: Number(event.target.value) })}
                >
                  {API_KEY_EXPIRY_OPTIONS.map((opt, index) => (
                    <option key={opt.label} value={index}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="submit" className="rounded-full h-10 px-6 w-full sm:w-auto" disabled={apiKeyBusy}>
              {apiKeyBusy ? "Generando..." : "Generar clave"}
            </Button>
          </form>

          {apiKeyError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {apiKeyError}
            </div>
          )}

          {/* API keys table — desktop */}
          <div className="hidden md:block rounded-2xl border border-slate-100 overflow-hidden">
            <div className="grid grid-cols-[1.4fr_1.3fr_0.8fr_1fr_auto] gap-4 px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground bg-slate-50">
              <span>Nombre</span>
              <span>Clave</span>
              <span>Estado</span>
              <span>Último uso</span>
              <span className="text-right">Acciones</span>
            </div>
            {apiKeys.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                Aún no hay claves. Genera la primera arriba.
              </div>
            ) : (
              apiKeys.map((key) => (
                <div
                  key={key.id}
                  className="grid grid-cols-[1.4fr_1.3fr_0.8fr_1fr_auto] gap-4 px-4 py-4 border-t items-center"
                >
                  <div className="font-medium text-foreground truncate">{key.name}</div>
                  <div className="text-sm text-muted-foreground font-mono truncate">{key.keyPrefix}…</div>
                  <div>
                    <Badge variant={apiKeyStatusVariant(key.status)} className="uppercase tracking-wider">
                      {key.status}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">{formatDate(key.lastUsedAt)}</div>
                  <div className="flex items-center justify-end gap-2">
                    {key.status === "active" ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setRevokeApiKeyTarget({ id: key.id, name: key.name });
                          setRevokeApiKeyError("");
                        }}
                      >
                        Revocar
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* API keys list — mobile cards */}
          <div className="md:hidden space-y-3">
            {apiKeys.length === 0 ? (
              <div className="rounded-2xl border border-slate-100 px-4 py-6 text-sm text-muted-foreground">
                Aún no hay claves. Genera la primera arriba.
              </div>
            ) : (
              apiKeys.map((key) => (
                <div key={key.id} className="rounded-2xl border border-slate-100 bg-slate-50/50 px-4 py-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{key.name}</div>
                      <div className="text-sm text-muted-foreground font-mono truncate">{key.keyPrefix}…</div>
                      <div className="text-xs text-muted-foreground mt-1">Último uso: {formatDate(key.lastUsedAt)}</div>
                    </div>
                    <Badge variant={apiKeyStatusVariant(key.status)} className="uppercase tracking-wider shrink-0">
                      {key.status}
                    </Badge>
                  </div>
                  {key.status === "active" && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setRevokeApiKeyTarget({ id: key.id, name: key.name });
                        setRevokeApiKeyError("");
                      }}
                    >
                      Revocar
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      )}

      <section className="rounded-2xl md:rounded-3xl border border-rose-200 bg-rose-50 p-4 md:p-6 shadow-sm space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg md:text-xl font-semibold text-rose-900">Danger Zone</h2>
          <p className="text-sm text-rose-800/90">
            Delete your owner account, all staff logins, and all campaign/customer data for this business.
          </p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-white/70 px-4 py-3 text-xs text-rose-800">
          This action is permanent and cannot be undone.
        </div>
        <div>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setDeleteError("");
              setDeleteConfirmText("");
              setIsDeleteStepOneOpen(true);
            }}
          >
            Delete Account
          </Button>
        </div>
      </section>

      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && !resetBusy && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset PIN for {resetTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>New PIN</Label>
            <Input
              value={resetPin}
              onChange={(event) => setResetPin(event.target.value)}
              placeholder="4-6 digits"
              maxLength={6}
            />
            {resetError && (
              <div className="text-sm text-rose-600">{resetError}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)} disabled={resetBusy}>
              Cancel
            </Button>
            <Button onClick={handleReset} disabled={resetBusy}>
              {resetBusy ? "Updating..." : "Update PIN"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteStaffTarget} onOpenChange={(open) => !open && setDeleteStaffTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete staff account?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This will permanently remove <span className="font-semibold text-foreground">{deleteStaffTarget?.name}</span> and revoke their login access.
            </p>
            {deleteStaffError && (
              <div className="text-sm text-rose-600">{deleteStaffError}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteStaffTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteStaff} disabled={deleteStaffBusy}>
              {deleteStaffBusy ? "Deleting..." : "Delete Staff"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteAdminTarget} onOpenChange={(open) => !open && setDeleteAdminTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar administrador?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Esto eliminará permanentemente a <span className="font-semibold text-foreground">{deleteAdminTarget?.name}</span> y revocará su acceso.
            </p>
            {deleteAdminError && (
              <div className="text-sm text-rose-600">{deleteAdminError}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAdminTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteAdmin} disabled={deleteAdminBusy}>
              {deleteAdminBusy ? "Eliminando..." : "Eliminar administrador"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Newly-minted API key — the secret is shown here exactly once. */}
      <Dialog open={!!newApiKey} onOpenChange={(open) => !open && setNewApiKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tu nueva clave API</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Copia esta clave ahora. <span className="font-semibold text-foreground">No volverá a mostrarse.</span> Guárdala en un lugar seguro.
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={newApiKey?.key ?? ""} className="font-mono text-sm" />
              <Button type="button" variant="outline" onClick={handleCopyApiKey}>
                {apiKeyCopied ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Úsala en el encabezado: <span className="font-mono">Authorization: Bearer {newApiKey?.keyPrefix}…</span>
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewApiKey(null)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revokeApiKeyTarget} onOpenChange={(open) => !open && setRevokeApiKeyTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Revocar clave API?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              La clave <span className="font-semibold text-foreground">{revokeApiKeyTarget?.name}</span> dejará de funcionar de inmediato. Esta acción no se puede deshacer.
            </p>
            {revokeApiKeyError && <div className="text-sm text-rose-600">{revokeApiKeyError}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeApiKeyTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleRevokeApiKey} disabled={revokeApiKeyBusy}>
              {revokeApiKeyBusy ? "Revocando..." : "Revocar clave"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteStepOneOpen} onOpenChange={(open) => !deleteAccountBusy && setIsDeleteStepOneOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account: Step 1 of 2</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              You are about to delete <span className="font-semibold text-foreground">{currentOwner?.businessName}</span>.
            </p>
            <p>This will remove owner access, all staff accounts, campaigns, and customer history.</p>
            <p className="text-rose-600 font-medium">This action cannot be undone.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteStepOneOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setIsDeleteStepOneOpen(false);
                setDeleteError("");
                setDeleteConfirmText("");
                setIsDeleteStepTwoOpen(true);
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isDeleteStepTwoOpen}
        onOpenChange={(open) => {
          if (deleteAccountBusy) return;
          setIsDeleteStepTwoOpen(open);
          if (!open) {
            setDeleteConfirmText("");
            setDeleteError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account: Step 2 of 2</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-mono font-semibold text-foreground">{DELETE_CONFIRMATION}</span> to permanently
              delete this account.
            </p>
            <Input
              value={deleteConfirmText}
              onChange={(event) => setDeleteConfirmText(event.target.value)}
              placeholder={DELETE_CONFIRMATION}
            />
            {deleteError && <div className="text-sm text-rose-600">{deleteError}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteStepTwoOpen(false)} disabled={deleteAccountBusy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteFinal}
              disabled={deleteAccountBusy || deleteConfirmText.trim().toUpperCase() !== DELETE_CONFIRMATION}
            >
              {deleteAccountBusy ? "Deleting..." : "Permanently Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
