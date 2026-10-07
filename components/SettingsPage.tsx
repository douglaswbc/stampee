import React, { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useAuth } from "./AuthProvider";
import { buildStaffPortalUrl } from "../lib/links";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSubscriptionContext } from "./SubscriptionContext";
import { useLocale } from "./LocaleProvider";
import { BUSINESS_CURRENCIES, formatCurrency, INTERFACE_LANGUAGES } from "../lib/i18n";
import { updateCompanyLocalePreferences } from "../lib/db/profiles";
import { resetOwnerBusinessData } from "../lib/db/dataManagement";
import { APP_ORIGIN } from "../lib/siteConfig";
import { LocalizedTree } from "./LocalizedTree";
import { LoyaltyPointsSettings } from "./LoyaltyPointsSettings";

const DELETE_CONFIRMATION = "DELETE";

export const SettingsPage: React.FC = () => {
  const publicUrlHost = typeof window !== "undefined" ? window.location.host : new URL(APP_ORIGIN).host;
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [activeSettingsTab, setActiveSettingsTab] = useState<"company" | "loyalty" | "team" | "account">(
    initialTab === "loyalty" || initialTab === "team" || initialTab === "account" ? initialTab : "company"
  );
  const navigate = useNavigate();
  const { staffAccounts, createStaff, updateStaffPin, setStaffAccess, deleteStaff, currentOwner, currentUser, deleteAccount, updateProfileInfo, updatePassword, refreshProfile } = useAuth();
  const { language, currency, t, setPreferredLanguage } = useLocale();
  useSubscriptionContext();

  const [profileForm, setProfileForm] = useState({
    businessName: currentUser?.businessName ?? "",
    email: currentUser?.email ?? "",
    slug: currentOwner?.slug ?? "",
  });
  const [profileSuccess, setProfileSuccess] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [preferences, setPreferences] = useState({ language, currency });
  const [preferencesBusy, setPreferencesBusy] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState("");
  const [preferencesError, setPreferencesError] = useState("");

  useEffect(() => setPreferences({ language, currency }), [language, currency]);

  const handlePreferencesSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentOwner || currentUser?.role !== "owner") return;
    setPreferencesBusy(true);
    setPreferencesMessage("");
    setPreferencesError("");
    const result = await updateCompanyLocalePreferences(currentOwner.id, {
      interface_language: preferences.language,
      currency_code: preferences.currency,
    });
    setPreferencesBusy(false);
    if (!result.ok) {
      setPreferencesError(t("Unable to save company preferences. Please try again."));
      return;
    }
    setPreferredLanguage(preferences.language);
    await refreshProfile();
    setPreferencesMessage("Preferences saved.");
    window.setTimeout(() => setPreferencesMessage(""), 3000);
  };

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
  const [isDeleteStepOneOpen, setIsDeleteStepOneOpen] = useState(false);
  const [isDeleteStepTwoOpen, setIsDeleteStepTwoOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const [isResetBusinessStepOneOpen, setIsResetBusinessStepOneOpen] = useState(false);
  const [isResetBusinessStepTwoOpen, setIsResetBusinessStepTwoOpen] = useState(false);
  const [resetBusinessConfirmText, setResetBusinessConfirmText] = useState("");
  const [resetBusinessError, setResetBusinessError] = useState("");
  const [resetBusinessBusy, setResetBusinessBusy] = useState(false);

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

  const resetBusinessConfirmation = `RESET ${currentOwner?.businessName ?? ""}`;

  const handleResetBusinessData = async () => {
    setResetBusinessError("");
    if (currentUser?.role !== "owner") {
      setResetBusinessError(t("Only the business owner can reset company data."));
      return;
    }
    if (resetBusinessConfirmText.trim().toUpperCase() !== resetBusinessConfirmation.trim().toUpperCase()) {
      setResetBusinessError(t("The confirmation text does not match."));
      return;
    }

    setResetBusinessBusy(true);
    try {
      const result = await resetOwnerBusinessData();
      if (!result.ok) {
        setResetBusinessError(t("Unable to reset business data. Refresh and try again."));
        return;
      }
      window.location.reload();
    } catch {
      setResetBusinessError(t("Unable to reset business data. Refresh and try again."));
    } finally {
      setResetBusinessBusy(false);
    }
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

  const settingsTabs = [
    { id: "company", label: t("Company") },
    { id: "loyalty", label: t("Loyalty program") },
    { id: "team", label: t("Team") },
    { id: "account", label: t("Account & security") },
  ] as const;

  const handleSettingsTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % settingsTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + settingsTabs.length) % settingsTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = settingsTabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = settingsTabs[nextIndex];
    setActiveSettingsTab(nextTab.id);
    requestAnimationFrame(() => document.getElementById(`settings-tab-${nextTab.id}`)?.focus());
  };

  return (
    <LocalizedTree>
    <div className="p-3 sm:p-4 md:p-8 space-y-6 md:space-y-8 animate-fade-in h-full overflow-y-auto flex flex-col bg-gray-50/50">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">{t("Settings")}</h1>
        <p className="text-sm text-muted-foreground">{t("Manage your profile, password, team, and account.")}</p>
      </div>

      <div className="space-y-5">
        <div role="tablist" aria-label={t("Settings sections")} className="grid w-full grid-cols-2 gap-1.5 rounded-xl border bg-white p-1.5 sm:grid-cols-4">
          {settingsTabs.map((tab, index) => (
            <button
              key={tab.id}
              id={`settings-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeSettingsTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              tabIndex={activeSettingsTab === tab.id ? 0 : -1}
              onClick={() => setActiveSettingsTab(tab.id)}
              onKeyDown={(event) => handleSettingsTabKeyDown(event, index)}
              className={`min-h-11 min-w-0 w-full rounded-lg px-2 py-2.5 text-center text-sm leading-tight font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-3 ${
                activeSettingsTab === tab.id
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:bg-gray-100 hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="space-y-5">
          <div id="settings-panel-company" role="tabpanel" aria-labelledby="settings-tab-company" tabIndex={0} hidden={activeSettingsTab !== "company"} className="space-y-5">
      <section className="rounded-2xl md:rounded-3xl border bg-white p-4 md:p-6 shadow-xs space-y-5">
        <div>
          <h2 className="text-lg md:text-xl font-semibold">{t("Company preferences")}</h2>
          <p className="text-sm text-muted-foreground">{t("Choose the language used by the team and the company currency for future monetary reports.")}</p>
        </div>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handlePreferencesSave}>
          <div className="space-y-1.5">
            <Label htmlFor="company-language">{t("Interface language")}</Label>
            <select id="company-language" value={preferences.language} onChange={event => setPreferences(current => ({ ...current, language: event.target.value as typeof current.language }))} className="h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm">
              {INTERFACE_LANGUAGES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-currency">{t("Company currency")}</Label>
            <select id="company-currency" value={preferences.currency} onChange={event => setPreferences(current => ({ ...current, currency: event.target.value as typeof current.currency }))} className="h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm">
              {BUSINESS_CURRENCIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">{t("Currency is ready for future monetary features; current loyalty activity does not record sales amounts.")}</p>
            <p className="text-xs text-muted-foreground">{t("Currency preview")}: {formatCurrency(1234.56, preferences.currency, preferences.language)}</p>
          </div>
          {preferencesError && <p role="alert" className="text-sm text-destructive sm:col-span-2">{preferencesError}</p>}
          {preferencesMessage && <p role="status" className="text-sm text-emerald-700 sm:col-span-2">{t(preferencesMessage)}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" className="w-full sm:w-auto" disabled={preferencesBusy || currentUser?.role !== "owner"}>
              <span>{preferencesBusy ? t("Saving...") : t("Save preferences")}</span>
            </Button>
          </div>
        </form>
      </section>

      {/* Edit Profile */}
      <section className="rounded-2xl md:rounded-3xl border bg-white p-4 md:p-6 shadow-xs space-y-5">
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
                  <span className="text-sm text-muted-foreground shrink-0">{publicUrlHost}/</span>
                  <Input
                    value={profileForm.slug}
                    readOnly
                    className="min-w-0 bg-muted/40 text-muted-foreground cursor-not-allowed"
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
            <Button type="submit" className="w-full rounded-full px-6 sm:w-auto" disabled={profileBusy}>
              {profileBusy ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </form>
      </section>

          </div>

          <div id="settings-panel-loyalty" role="tabpanel" aria-labelledby="settings-tab-loyalty" tabIndex={0} hidden={activeSettingsTab !== "loyalty"} className="space-y-5">
            <LoyaltyPointsSettings />
          </div>

          <div id="settings-panel-team" role="tabpanel" aria-labelledby="settings-tab-team" tabIndex={0} hidden={activeSettingsTab !== "team"} className="space-y-5">
      <section className="rounded-2xl md:rounded-3xl border bg-white p-4 md:p-6 shadow-xs space-y-6">
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
        <div className="hidden xl:block rounded-2xl border border-slate-100 overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_auto] gap-4 px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground bg-slate-50">
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
                className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_auto] gap-4 px-4 py-4 border-t items-center"
              >
                <div className="min-w-0 font-medium text-foreground truncate">{staff.businessName}</div>
                <div className="min-w-0 text-sm text-muted-foreground truncate">{staff.email}</div>
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
        <div className="xl:hidden space-y-3">
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
                    <div className="font-medium text-foreground break-words">{staff.businessName}</div>
                    <div className="text-sm text-muted-foreground break-words">{staff.email}</div>
                  </div>
                  <Badge
                    variant={staff.access === "active" ? "secondary" : "destructive"}
                    className="uppercase tracking-wider shrink-0"
                  >
                    {staff.access}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-w-0"
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
                    className="min-w-0"
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
                    className="col-span-2 w-full"
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
          </div>

          <div id="settings-panel-account" role="tabpanel" aria-labelledby="settings-tab-account" tabIndex={0} hidden={activeSettingsTab !== "account"} className="space-y-5">
      <section className="rounded-2xl md:rounded-3xl border bg-white p-4 md:p-6 shadow-xs space-y-5">
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
            <Button type="submit" className="w-full rounded-full px-6 sm:w-auto" disabled={passwordBusy}>
              {passwordBusy ? "Changing..." : "Change Password"}
            </Button>
          </div>
        </form>
      </section>

      {currentUser?.role === "owner" && (
        <section className="rounded-2xl md:rounded-3xl border border-amber-200 bg-amber-50 p-4 md:p-6 shadow-xs space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg md:text-xl font-semibold text-amber-950">{t("Reset business data")}</h2>
            <p className="text-sm text-amber-900/90">{t("Clear this business's loyalty data and start over while keeping owner access, company preferences, and staff logins.")}</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-white/70 px-4 py-3 text-sm text-amber-950">
            {t("This removes campaigns, customers, cards, transactions, missions, points, rewards, redemption codes, and their history. It does not delete the database schema or uploaded campaign images.")}
          </div>
          <Button
            type="button"
            variant="destructive"
            className="w-full sm:w-auto"
            onClick={() => {
              setResetBusinessError("");
              setResetBusinessConfirmText("");
              setIsResetBusinessStepOneOpen(true);
            }}
          >
            {t("Reset business data")}
          </Button>
        </section>
      )}

      <section className="rounded-2xl md:rounded-3xl border border-rose-200 bg-rose-50 p-4 md:p-6 shadow-xs space-y-4">
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
            className="w-full sm:w-auto"
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
          </div>
        </div>
      </div>

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

      <Dialog open={isResetBusinessStepOneOpen} onOpenChange={(open) => !resetBusinessBusy && setIsResetBusinessStepOneOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Reset business data: Step 1 of 2")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>{t("All campaigns, customer records, cards, visits, missions, points, rewards, and redemption history for this business will be permanently removed.")}</p>
            <p>{t("Your owner login, company profile and preferences, and staff logins will remain available.")}</p>
            <p className="font-medium text-rose-700">{t("This action cannot be undone.")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetBusinessStepOneOpen(false)}>{t("Cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() => {
                setIsResetBusinessStepOneOpen(false);
                setResetBusinessError("");
                setResetBusinessConfirmText("");
                setIsResetBusinessStepTwoOpen(true);
              }}
            >
              {t("Continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isResetBusinessStepTwoOpen}
        onOpenChange={(open) => {
          if (resetBusinessBusy) return;
          setIsResetBusinessStepTwoOpen(open);
          if (!open) {
            setResetBusinessConfirmText("");
            setResetBusinessError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Reset business data: Step 2 of 2")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("Type this exact text to confirm the reset:")}</p>
            <p className="rounded-lg bg-muted px-3 py-2 font-mono text-sm font-semibold break-all">{resetBusinessConfirmation}</p>
            <Input
              value={resetBusinessConfirmText}
              onChange={(event) => setResetBusinessConfirmText(event.target.value)}
              placeholder={resetBusinessConfirmation}
              autoComplete="off"
            />
            {resetBusinessError && <div role="alert" className="text-sm text-rose-600">{resetBusinessError}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetBusinessStepTwoOpen(false)} disabled={resetBusinessBusy}>{t("Cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() => void handleResetBusinessData()}
              disabled={resetBusinessBusy || resetBusinessConfirmText.trim().toUpperCase() !== resetBusinessConfirmation.trim().toUpperCase()}
            >
              {resetBusinessBusy ? t("Resetting...") : t("Permanently reset business data")}
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
    </LocalizedTree>
  );
};
